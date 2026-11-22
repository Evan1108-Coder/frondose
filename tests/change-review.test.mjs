import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { parsePatch, textPatch, foldRows, hideWhitespaceChanges, fileKind, patchFiles } from '../src/lib/change-review.js';
import { createWorkbenchService } from '../server/workbench-service.mjs';
import { createChangeReviewService } from '../server/change-review-service.mjs';
import { createProviderAdapter } from '../server/connectors/adapters.mjs';
import { createLocalApi } from './fixtures/legacy-account-api.mjs';
import { createServer } from 'node:http';
import { parsePage, pageHash } from '../src/lib/navigation.js';

test('file types, line coordinates, blank lines and bounded context are preserved', () => {
  assert.equal(parsePage(pageHash('projects','project',{reviewId:'snapshot'})).reviewId,'snapshot');
  assert.equal(parsePage('#/projects/project?review=one&review=two').view,'overview');
  assert.equal(fileKind('schema.sql').type, 'database'); assert.equal(fileKind('index.mjs').label, 'JS');
  const before = Array.from({ length: 100 }, (_, i) => `Line ${i}`).join('\n');
  const after = before.replace('Line 50', 'Changed 50');
  const rows = parsePatch(textPatch(before, after));
  assert.equal(rows.find(row => row.type === 'addition').newLine, 51);
  assert.equal(rows.find(row => row.type === 'deletion').oldLine, 51);
  assert.equal(rows.filter(row => row.type === 'context').length, 99);
  assert.equal(foldRows(rows).filter(row => row.type === 'fold').length, 2);
  const whitespace = parsePatch(textPatch('const x = 1', '  const x = 1'));
  assert.equal(hideWhitespaceChanges(whitespace).filter(row => row.type === 'addition').length, 0);
  assert.equal(parsePatch(textPatch('', 'Hello'))[1].newLine, 1);
  assert.equal(textPatch('unchanged', 'unchanged'), '');
  assert.equal(patchFiles('diff --git a/schema.sql b/schema.sql\n--- a/schema.sql\n+++ b/schema.sql\n@@ -1 +1 @@\n-SELECT 1;\n+SELECT 2;')[0].path,'schema.sql');
  assert.equal(patchFiles('Not a patch').length,0);
  assert.equal(parsePatch(textPatch('', 'SELECT 1;\n')).filter(row=>row.type==='addition').length,1);
  assert.match(textPatch('one','one\n'), /No newline at end of file/);
});

async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'rumbo-review-test-')), root = join(dir, 'repo'); await mkdir(root); await mkdir(join(dir, 'storage'));
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE workspaces(id TEXT PRIMARY KEY,archived_at TEXT); INSERT INTO workspaces VALUES('ws',NULL),('other',NULL);
  CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,local_path TEXT,archived_at TEXT);
  CREATE TABLE runs(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,chat_id TEXT,task_id TEXT,title TEXT);
  CREATE TABLE documents(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,team_id TEXT,archived_at TEXT);
  CREATE TABLE change_log(id TEXT PRIMARY KEY,workspace_id TEXT,entity_type TEXT,entity_id TEXT,name TEXT,before_json TEXT,after_json TEXT,created_at TEXT,action TEXT);`);
  db.prepare('INSERT INTO projects VALUES(?,?,?,NULL)').run('project', 'ws', root);
  db.exec("INSERT INTO runs VALUES('run','ws','project',NULL,NULL,'Test run'); INSERT INTO documents VALUES('doc','ws','project',NULL,NULL)");
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-b', 'master'); await writeFile(join(root, 'index.js'), 'const x = 1;\n'); git('add', 'index.js'); git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','Initial');
  const wb = createWorkbenchService({ db, dataDir: join(dir, 'storage') });
  let deny = '', deniedScope = '';
  const service = createChangeReviewService({ db, workbench: wb, platform: { list: async () => [] }, authorize: (ws, actor, permission, scope) => { if (permission === deny || deniedScope && scope?.scope_id === deniedScope || ws !== 'ws' || actor !== 'owner') throw new Error('access denied'); } });
  const actor = { id: 'owner', name: 'Test Owner' }, scope = { workspace_id: 'ws', target_type: 'project', target_id: 'project' };
  const call = async (path = '', method = 'GET', body = {}, query = scope) => (await service.handle({ path: `/change-reviews${path}`, method, body, query, actor })).result;
  try { await fn({ root, dir, db, git, service, actor, scope, call, deny: value => { deny = value; }, denyScope: value => { deniedScope = value; } }); }
  finally { wb.close(); db.close(); await rm(dir, { recursive: true, force: true }); }
}
test('local review snapshots are immutable, scoped, stale-safe and line-bound', async () => fixture(async ({ root, dir, git, scope, call, deny }) => {
  await writeFile(join(root, 'index.js'), 'const x = 2;\n'); await writeFile(join(root, '.env'), 'SECRET=hidden'); await symlink(join(dir, 'storage'), join(root, 'outside'));
  const source = { kind: 'local', mode: 'working' };
  const comparison = await call('/compare', 'POST', { ...scope, source });
  assert.deepEqual(comparison.files.map(f => f.path), ['index.js']); assert.match(comparison.files[0].patch, /const x = 2/);
  assert.equal(git('status', '--porcelain').includes(' M index.js'), true);
  const review = await call('', 'POST', { ...scope, source, fingerprint: comparison.fingerprint });
  const replay = await call('', 'POST', { ...scope, source, fingerprint: comparison.fingerprint }); assert.equal(review.id, replay.id);
  const commented = await call(`/${review.id}/comments`, 'POST', { path: 'index.js', side: 'new', line: 1, body: 'Why?' }); assert.equal(commented.comments[0].author_id, 'owner');
  await assert.rejects(call(`/${review.id}/comments`, 'POST', { path: 'index.js', side: 'new', line: 999, body: 'Bad' }), /exact snapshot/);
  assert.deepEqual((await call(`/${review.id}/reviewed`, 'POST', { path: 'index.js', reviewed: true })).reviewed, ['index.js']);
  await writeFile(join(root, 'index.js'), 'const x = 3;\n');
  await assert.rejects(call('', 'POST', { ...scope, source, fingerprint: comparison.fingerprint }), /source changed/);
  assert.equal((await call(`/${review.id}/refresh`, 'POST', {})).current, false);
  assert.match((await call(`/${review.id}`)).comparison.files[0].patch, /const x = 2/);
  await assert.rejects(call('/compare', 'POST', { ...scope, workspace_id: 'other', source }), /available review target/);
  deny('workbench.read'); await assert.rejects(call(`/${review.id}`), /access denied/); assert.deepEqual(await call(), []);
}));
test('staged, untracked, branch and renamed comparisons never change the checkout', async () => fixture(async ({ root, git, scope, call }) => {
  await writeFile(join(root, 'new.sql'), 'SELECT 1;\n');
  const working = await call('/compare', 'POST', { ...scope, source: { kind: 'local' } }); assert.equal(working.files[0].path, 'new.sql');
  git('mv', 'index.js', 'renamed.js');
  const staged = await call('/compare', 'POST', { ...scope, source: { kind: 'local', mode: 'staged' } }); assert.equal(staged.files[0].oldPath, 'index.js');
  git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','Rename');
  const parent = git('rev-parse', 'HEAD~1').trim();
  const compared = await call('/compare', 'POST', { ...scope, source: { kind: 'local', mode: 'compare', base: parent, head: 'HEAD' } }); assert.equal(compared.files[0].path, 'renamed.js');
  await assert.rejects(call('/compare', 'POST', { ...scope, source: { kind: 'local', mode: 'compare', base: '--help', head: 'HEAD' } }), /branch/);
  assert.equal(git('branch', '--show-current').trim(), 'master');
}));
test('document revision compares saved history and run capture excludes pre-existing changes', async () => fixture(async ({ root, db, service, actor, call }) => {
  db.prepare('INSERT INTO change_log VALUES(?,?,?,?,?,?,?,?,?)').run('rev','ws','documents','doc','Brief',JSON.stringify({ title:'Brief',content:'Old' }),JSON.stringify({ title:'Brief',content:'New' }),new Date().toISOString(),'update');
  const doc = await call('/compare','POST',{ workspace_id:'ws',target_type:'document',target_id:'doc',source:{kind:'document',revision_id:'rev'} }); assert.match(doc.files[0].patch,/\+New/);
  await writeFile(join(root,'index.js'),'Pre-existing\n'); await service.beginRun('run',actor,root);
  await writeFile(join(root,'index.js'),'After agent\n');
  const id = await service.finishRun('run',actor), saved = await service.get(id,actor);
  assert.match(saved.comparison.files[0].patch,/-Pre-existing/); assert.match(saved.comparison.files[0].patch,/\+After agent/);
  assert.equal(saved.source.kind,'run'); assert.equal((await call()).length,1);
  assert.equal((await call(`/${id}/refresh`, 'POST', {})).immutable, true);
}));

test('document reviews recheck both historical scopes for previews and every saved-snapshot operation', async () => fixture(async ({ db, call, denyScope }) => {
  db.exec("INSERT INTO projects VALUES('private','ws',NULL,NULL)");
  const current = { workspace_id: 'ws', project_id: 'project', team_id: null, title: 'Public document', content: 'Current text' };
  for (const [id, before, after, blockedScope] of [
    ['old-project', { ...current, project_id: 'private', content: 'Private before' }, current, 'private'],
    ['new-project', current, { ...current, project_id: 'private', content: 'Private after' }, 'private'],
    ['old-team', { ...current, project_id: null, team_id: 'private-team', content: 'Private team before' }, current, 'private-team'],
    ['new-team', current, { ...current, project_id: null, team_id: 'private-team', content: 'Private team after' }, 'private-team'],
  ]) {
    db.prepare('INSERT INTO change_log VALUES(?,?,?,?,?,?,?,?,?)').run(id, 'ws', 'documents', 'doc', 'Document revision', JSON.stringify(before), JSON.stringify(after), new Date().toISOString(), 'updated');
    const query = { workspace_id: 'ws', target_type: 'document', target_id: 'doc', source: { kind: 'document', revision_id: id } };
    const comparison = await call('/compare', 'POST', query);
    const saved = await call('', 'POST', { ...query, fingerprint: comparison.fingerprint });
    denyScope(blockedScope);
    await assert.rejects(call('/compare', 'POST', query), /access denied/);
    await assert.rejects(call('', 'POST', { ...query, fingerprint: comparison.fingerprint }), /access denied/);
    await assert.rejects(call(`/${saved.id}`), /access denied/);
    await assert.rejects(call(`/${saved.id}/refresh`, 'POST'), /access denied/);
    await assert.rejects(call(`/${saved.id}/comments`, 'POST', { path: 'document.md', side: 'new', line: 3, body: 'Hidden content' }), /access denied/);
    await assert.rejects(call(`/${saved.id}/reviewed`, 'POST', { path: 'document.md', reviewed: true }), /access denied/);
    assert.equal((await call('', 'GET', {}, query)).some(row => row.id === saved.id), false);
    denyScope('');
    assert.equal((await call(`/${saved.id}`)).id, saved.id);
  }
}));

test('GitHub review reads filter private paths, preserve missing-patch states and reject mixed commits', async () => {
  let changed = false, reads = 0;
  const head = 'a'.repeat(40), base = 'b'.repeat(40);
  const adapter = createProviderAdapter('github', async url => {
    if (/\/pulls\/12$/.test(url)) return { head: { sha: changed && reads++ ? 'c'.repeat(40) : head }, base: { sha: base }, changed_files: 102, title: 'Review fixture', state: 'open' };
    if (url.includes('/files?') && url.endsWith('page=1')) return [{ filename: 'index.js', patch: '@@ -1 +1 @@\n-old\n+new', additions: 1, deletions: 1 }, { filename: '.env', patch: 'SECRET' }, { filename: 'safe.js', previous_filename: 'credentials.json', patch: 'SECRET' }];
    if (url.includes('/files?')) return [{ filename: 'image.png' }];
    if (url.includes('/check-runs')) throw new Error('Checks scope unavailable');
    if (url.includes('/comments?')) return [{ id: 1, path: '.env', body: 'private' }, { id: 2, path: 'index.js', line: null, commit_id: base, body: 'Old comment' }];
    return [];
  });
  const result = await adapter.readCode({ resource_id: 'owner/repo', kind: 'pull', number: '12' });
  assert.deepEqual(result.files.map(f => f.path), ['index.js','image.png']); assert.match(result.files[1].unavailable, /no text patch/);
  assert.equal(result.limited, true); assert.equal(result.checksUnavailable, true); assert.equal(result.comments.length, 1); assert.equal(result.comments[0].outdated, true);
  changed = true; await assert.rejects(adapter.readCode({resource_id:'owner/repo',kind:'pull',number:'12'}), /changed during loading/);
});

test('GitHub inline review validates exact line and commit before any external write', async () => {
  const head = 'a'.repeat(40); let latest = head, writes = [];
  const adapter = createProviderAdapter('github', async (url, options) => {
    if (options?.method === 'POST') { writes.push(options.body); return { id: 1 }; }
    if (url.includes('/files?')) return [{ filename:'index.js',patch:'@@ -1 +1 @@\n-old\n+new' }];
    return { head:{sha:latest},base:{sha:'b'.repeat(40)},changed_files:1 };
  });
  const input = {resource_id:'owner/repo',number:'12',commit_id:head,event:'COMMENT',body:'Question',path:'index.js',line:'1',side:'new'};
  await adapter.execute('review_pull',input); assert.equal(writes[0].comments[0].side,'RIGHT'); assert.equal(writes[0].commit_id,head);
  await assert.rejects(adapter.execute('review_pull',{...input,line:'20'}), /not available/);
  await assert.rejects(adapter.execute('review_pull',{...input,path:'.env'}), /visible line/);
  latest = 'c'.repeat(40); await assert.rejects(adapter.execute('review_pull',input), /changed/); assert.equal(writes.length,1);
});

test('review endpoints work through the real API and retain server-side actor attribution', async () => {
  const dir = await mkdtemp(join(tmpdir(),'rumbo-review-api-'));
  const api = createLocalApi({ dataDir:dir,seedMode:'clean',integrationOptions:{env:{},fetchImpl:()=>{throw new Error('No external transport in fixture');}} });
  const server = createServer(api.middleware); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function req(path,method='GET',body) { const res=await fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined}); const result=await res.json(); assert.ok(res.ok,JSON.stringify(result)); return result; }
  try {
    const workspace=(await req('/workspaces','POST',{name:'Review QA'})).workspace;
    const project=(await req('/projects','POST',{workspace_id:workspace.id,name:'Review project'})).project;
    const created=await req('/documents','POST',{workspace_id:workspace.id,project_id:project.id,title:'Review API',content:'Before'});
    await req(`/documents/${created.document.id}`,'PATCH',{content:'After'});
    const history=await req(`/history/${created.document.id}?workspace_id=${workspace.id}`);
    const scope={workspace_id:workspace.id,target_type:'document',target_id:created.document.id,source:{kind:'document',revision_id:history.result[0].id}};
    const compared=(await req('/change-reviews/compare','POST',scope)).result;
    const saved=(await req('/change-reviews','POST',{...scope,fingerprint:compared.fingerprint})).result;
    const reply=(await req(`/change-reviews/${saved.id}/comments`,'POST',{path:'document.md',side:'new',line:3,body:'API comment',author_id:'forged'})).result;
    assert.notEqual(reply.comments[0].author_id,'forged');
    const forbidden=await fetch(base+'/change-reviews/compare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...scope,workspace_id:'not-this-workspace'})}); assert.equal(forbidden.ok,false);
    const member=(await req('/governance','POST',{workspace_id:workspace.id,action:'create_member',name:'Restricted reader',email:'reader@example.invalid'})).result;
    await req('/governance','POST',{workspace_id:workspace.id,action:'grant',member_id:member.id,permission:'projects.read',effect:'deny',scope_type:'project',scope_id:project.id,reason:'Review access fixture'});
    const setup=await fetch(base+'/identity/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',email:'owner@example.invalid',password:'fixture password only 123'})});
    assert.equal(setup.ok,true); const ownerCookie=setup.headers.get('set-cookie').split(';')[0];
    const invite=await fetch(base+'/identity/invite',{method:'POST',headers:{'Content-Type':'application/json',cookie:ownerCookie},body:JSON.stringify({workspace_id:workspace.id,member_id:member.id})});
    const invitation=(await invite.json()).result;
    const accept=await fetch(base+'/identity/accept',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:invitation.invitation_token,password:'fixture reader password 123'})});
    assert.equal(accept.ok,true); const readerCookie=accept.headers.get('set-cookie').split(';')[0];
    for (const [path,method,body] of [[`/change-reviews/${saved.id}`,'GET'],['/change-reviews/compare','POST',scope],[`/change-reviews?${new URLSearchParams({workspace_id:workspace.id,target_type:'project',target_id:project.id})}`,'GET']]) {
      const response=await fetch(base+path,{method,headers:{cookie:readerCookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
      assert.equal(response.status,403,`${method} ${path} must respect project denial`);
    }
  } finally { await new Promise(resolve=>server.close(resolve)); api.close(); await rm(dir,{recursive:true,force:true}); }
});

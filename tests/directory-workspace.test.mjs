import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { chmod, link, mkdir, mkdtemp, opendir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import test from 'node:test';
import { createDirectoryWorkspaceService, directoryRelativePath } from '../server/directory-workspace.mjs';
import { createLocalApi } from '../server/local-api.mjs';

const owner = { id: 'local-owner' };
test('read-only text is reported and cannot be replaced through atomic rename', async () => fixture(async ({ service, bind, root }) => {
  const linked = await bind(), path = join(root, 'readonly.txt');
  await writeFile(path, 'original'); await chmod(path, 0o444);
  try {
    const current = await service.file('ws', owner, 'readonly.txt', linked.binding.version);
    assert.equal(current.read_only, true); assert.equal(current.mode, undefined);
    await assert.rejects(service.save('ws', owner, { path: 'readonly.txt', content: 'replacement', expected_version: current.version, expected_binding_version: linked.binding.version, confirmed: true }), { statusCode: 403, code: 'file_read_only' });
    assert.equal(await readFile(path, 'utf8'), 'original');
  } finally { await chmod(path, 0o644); }
}));
async function fixture(callback, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'frondose-directory-'));
  const root = join(directory, 'project with spaces'), otherRoot = join(directory, 'another'), storage = join(directory, 'private');
  await Promise.all([mkdir(root), mkdir(otherRoot), mkdir(storage)]);
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE workspaces(id TEXT PRIMARY KEY,archived_at TEXT);
    CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,local_path TEXT,archived_at TEXT);
    CREATE TABLE runs(id TEXT PRIMARY KEY,workspace_id TEXT,status TEXT);
    INSERT INTO workspaces VALUES('ws',NULL),('other',NULL);`);
  db.prepare('INSERT INTO projects VALUES(?,?,?,?,NULL)').run('p', 'ws', 'Primary', root);
  db.prepare('INSERT INTO projects VALUES(?,?,?,?,NULL)').run('legacy', 'ws', 'Legacy untouched', otherRoot);
  db.prepare('INSERT INTO projects VALUES(?,?,?,?,NULL)').run('foreign', 'other', 'Foreign', otherRoot);
  const service = createDirectoryWorkspaceService({ db, dataDir: storage, ...options });
  const bind = (input = {}) => service.bind('ws', owner, { project_id: 'p', path: root, confirmed: true, ...input });
  try { await callback({ directory, root, otherRoot, storage, db, service, bind }); }
  finally { db.close(); await rm(directory, { recursive: true, force: true }); }
}

test('local file and directory activity records changed metadata only after successful writes', async () => {
  const events = [];
  await fixture(async ({ service, bind }) => {
    await assert.rejects(bind({ confirmed: false }));
    const linked = await bind();
    const relinked = await bind({ expected_version: linked.binding.version });
    const input = { path: 'plan.md', content: 'private draft contents', expected_version: null, expected_binding_version: relinked.binding.version, confirmed: true };
    const saved = await service.save('ws', owner, input);
    await assert.rejects(service.save('ws', owner, input));
    const same = await service.save('ws', owner, { ...input, expected_version: saved.version });
    const edited = await service.save('ws', owner, { ...input, expected_version: same.version, content: 'another private draft' });
    assert.equal(edited.content, 'another private draft');
  }, { recordActivity: async event => { events.push(event); if (event.title === 'File saved') throw Error('fixture recorder failed'); } });
  assert.deepEqual(events, [
    { workspaceId: 'ws', kind: 'directory.linked', title: 'Project directory linked', entityId: 'p' },
    { workspaceId: 'ws', kind: 'file.saved', title: 'Markdown file created', entityId: 'p', path: 'plan.md' },
    { workspaceId: 'ws', kind: 'file.saved', title: 'File saved', entityId: 'p', path: 'plan.md' },
  ]);
});

test('directory paths reject POSIX and Windows traversal, drives, ADS and credential names', () => {
  for (const path of ['../secret', 'src/../file', 'src\\..\\file', '/etc/passwd', 'C:\\data\\test.md', 'C:test.md', '\\\\server\\share', 'file.md:secret', '.env', '.env.example', '.ssh/id_rsa', 'src/.npmrc', 'a/private.sqlite', 'a/credentials.json', 'a\0b', '.', 'src/./test']) assert.throws(() => directoryRelativePath(path), undefined, path);
  assert.equal(directoryRelativePath('docs\\hello world.md'), 'docs/hello world.md');
  assert.equal(directoryRelativePath('文档/新项目.md'), '文档/新项目.md');
  assert.equal(directoryRelativePath('', { allowRoot: true }), '');
  assert.throws(() => directoryRelativePath(''));
});

test('GET never auto-adopts legacy projects or changes their folders', async () => fixture(async ({ service, root, db }) => {
  const before = db.prepare('SELECT * FROM projects ORDER BY id').all();
  const result = await service.get('ws', owner);
  assert.equal(result.bound, false); assert.equal(result.ready, false); assert.equal(result.binding, null);
  assert.equal(result.projects.length, 2); assert.equal(result.projects.find(row => row.id === 'p').path, root);
  assert.deepEqual(db.prepare('SELECT * FROM projects ORDER BY id').all(), before);
  await assert.rejects(service.file('ws', owner, 'readme.md'), { code: 'directory_not_bound' });
}));

test('explicit directory binding preserves unrelated projects and enforces scope/version', async () => fixture(async ({ service, bind, root, otherRoot, db }) => {
  await assert.rejects(bind({ confirmed: false }), /Confirm/);
  await assert.rejects(bind({ project_id: 'foreign' }), /belonging/);
  await assert.rejects(bind({ path: join(root, 'missing') }), /unavailable/);
  const linked = await bind();
  assert.equal(linked.ready, true); assert.equal(linked.binding.projectId, 'p');
  assert.ok(linked.binding.version); assert.match(linked.binding.path, /project with spaces$/);
  assert.equal(db.prepare("SELECT local_path FROM projects WHERE id='legacy'").get().local_path, otherRoot);
  await assert.rejects(bind({ path: otherRoot }), { statusCode: 409 });
  await assert.rejects(bind({ expected_version: 'stale' }), { statusCode: 409 });
  const rebound = await bind({ path: otherRoot, expected_version: linked.binding.version });
  assert.notEqual(rebound.binding.version, linked.binding.version);
  assert.equal(rebound.binding.path, db.prepare("SELECT local_path FROM projects WHERE id='p'").get().local_path);
}));

test('binding rejects root/home/private storage and archived selections', async () => fixture(async ({ bind, storage, root, db }) => {
  for (const path of [parse(root).root, homedir(), storage, join(storage, '..')]) await assert.rejects(bind({ path }), /specific|private storage/);
  db.prepare("UPDATE projects SET archived_at='archived' WHERE id='p'").run();
  await assert.rejects(bind(), /active project/);
}));

test('owner and current project permissions protect inventory, reads and writes', async () => fixture(async ({ service, bind }) => {
  await assert.rejects(service.get('ws', null), { statusCode: 403 });
  await assert.rejects(service.get('ws', { id: 'member' }), { statusCode: 403 });
  await assert.rejects(service.get('missing', owner), /active workspace/);
  await bind();
  await assert.rejects(service.file('ws', { id: 'member' }, 'readme.md'), { statusCode: 403 });
}));

test('injected permission boundary is checked for binding and inherited root operations', async () => {
  let permit = true;
  await fixture(async ({ bind, service, root }) => {
    await writeFile(join(root, 'readme.md'), 'local text');
    await bind(); permit = false;
    await assert.rejects(service.get('ws', owner), { statusCode: 403 });
    await assert.rejects(service.file('ws', owner, 'readme.md'), { statusCode: 403 });
    await assert.rejects(service.save('ws', owner, { path: 'new.md', content: '', expected_version: null, confirmed: true }), { statusCode: 403 });
  }, { allowed: () => permit });
});

test('active recorded work and injected native sessions prevent directory changes', async () => {
  let sessions = [];
  await fixture(async ({ bind, db }) => {
    db.exec("INSERT INTO runs VALUES('run','ws','running')");
    await assert.rejects(bind(), /active work/);
    db.exec("UPDATE runs SET status='completed'");
    sessions = [{ id: 'native' }];
    await assert.rejects(bind(), /active work/);
    sessions = []; await bind();
  }, { activeSessionsFor: () => sessions });
});

test('work starting during filesystem checks cancels linking without updating records', async () => {
  let probes = 0;
  await fixture(async ({ bind, db, service, root }) => {
    await assert.rejects(bind(), /Work started/);
    assert.equal(service.binding('ws'), undefined);
    assert.equal(db.prepare("SELECT local_path FROM projects WHERE id='p'").get().local_path, root);
  }, { activeSessionsFor: () => ++probes > 1 ? [{ id: 'newly-started' }] : [] });
});

test('detached running terminals are exposed without output and no-op links do not invalidate their root',async()=>fixture(async({bind,db,service,otherRoot})=>{
  const linked=await bind();
  db.exec("CREATE TABLE workbench_terminals(id TEXT,workspace_id TEXT,project_id TEXT,name TEXT,status TEXT,output TEXT); INSERT INTO workbench_terminals VALUES('t','ws','p','Detached terminal','running','private output');");
  const current=await service.get('ws',owner);
  assert.deepEqual(current.blockers,{terminals:[{id:'t',name:'Detached terminal',projectId:'p',scope:'project',status:'running'}],other:0});
  assert.equal((await bind({path:linked.binding.path,expected_version:linked.binding.version})).binding.version,linked.binding.version);
  await assert.rejects(bind({path:otherRoot,expected_version:linked.binding.version}),/active work/);
  db.exec("UPDATE workbench_terminals SET status='stopped'");
  assert.equal((await bind({path:otherRoot,expected_version:linked.binding.version})).binding.path,await service.rootFor('ws',owner).then(root=>root.root));
}));

test('folder disappearance, replacement or project path changes do not fall back elsewhere', async () => fixture(async ({ service, bind, root, otherRoot, db }) => {
  const first = await bind();
  await rename(root, `${root}-moved`);
  const unavailable = await service.get('ws', owner);
  assert.equal(unavailable.bound, true); assert.equal(unavailable.ready, false); assert.match(unavailable.error, /unavailable/);
  await mkdir(root);
  assert.equal((await service.get('ws', owner)).ready, false);
  await assert.rejects(service.tree('ws', owner), { statusCode: 409 });
  await bind({ expected_version: first.binding.version });
  db.prepare("UPDATE projects SET local_path=? WHERE id='p'").run(otherRoot);
  await assert.rejects(service.tree('ws', owner), { statusCode: 409 });
}));

test('readiness checks actual directory-open permission and retains binding after access revocation', async () => {
  let denied = false, opened = 0, closed = 0;
  await fixture(async ({ bind, service }) => {
    denied = true;
    await assert.rejects(bind(), /cannot be opened/);
    assert.equal(service.binding('ws'), undefined);
    denied = false;
    const linked = await bind();
    assert.equal(linked.ready, true); assert.ok(opened > 0); assert.equal(closed, opened);
    denied = true;
    const unavailable = await service.get('ws', owner);
    assert.equal(unavailable.bound, true); assert.equal(unavailable.ready, false);
    assert.equal(unavailable.binding.version, linked.binding.version);
    assert.match(unavailable.error, /cannot be opened/);
    await assert.rejects(service.tree('ws', owner), /cannot be opened/);
    denied = false;
    assert.equal((await service.get('ws', owner)).ready, true);
    assert.equal(closed, opened);
  }, { openDirectory: async path => {
    if (denied) throw Object.assign(Error('Fixture permission denied'), { code: 'EACCES' });
    const handle = await opendir(path); opened++;
    return { close: async () => { await handle.close(); closed++; } };
  } });
});

test('Unix unreadable directory is not reported ready after a successful stat', { skip: process.platform === 'win32' || typeof process.getuid !== 'function' || process.getuid() === 0 }, async () => fixture(async ({ bind, service, root }) => {
  const linked = await bind();
  try {
    await chmod(root, 0o000);
    const unavailable = await service.get('ws', owner);
    assert.equal(unavailable.bound, true); assert.equal(unavailable.ready, false);
    assert.equal(unavailable.binding.version, linked.binding.version);
    assert.match(unavailable.error, /cannot be opened/);
  } finally { await chmod(root, 0o700); }
  assert.equal((await service.get('ws', owner)).ready, true);
}));

test('tree and text reads are bounded, typed and never expose private files', async () => fixture(async ({ root, service, bind }) => {
  await mkdir(join(root, 'src')); await mkdir(join(root, '.github'));
  await writeFile(join(root, '.env'), 'TOP_SECRET'); await writeFile(join(root, '.npmrc'), 'TOKEN=PRIVATE');
  await writeFile(join(root, 'src', 'hello.md'), '# Hello 世界\nText');
  await writeFile(join(root, 'binary.dat'), Buffer.from([1, 0, 2]));
  await writeFile(join(root, 'invalid.txt'), Buffer.from([255, 254]));
  await writeFile(join(root, 'large.txt'), Buffer.alloc(512_001, 'a'));
  await bind();
  const tree = await service.tree('ws', owner);
  assert.ok(tree.entries.some(row => row.name === '.github'));
  for (const name of ['.env', '.npmrc']) assert.equal(tree.entries.some(row => row.name === name), false);
  const file = await service.file('ws', owner, 'src/hello.md');
  assert.equal(file.content, '# Hello 世界\nText'); assert.match(file.version, /^[a-f0-9]{64}$/);
  assert.equal(file.size, Buffer.byteLength(file.content)); assert.ok(file.modified_at);
  for (const path of ['.env', '.npmrc', '../outside.md']) await assert.rejects(service.file('ws', owner, path));
  for (const [path, kind] of [['binary.dat','binary'],['invalid.txt','encoding'],['large.txt','large']]) { const unsupported = await service.file('ws', owner, path); assert.equal(unsupported.unsupported,kind); assert.equal(unsupported.content,undefined); assert.equal(unsupported.version,undefined); }
}));

test('raw previews are bounded, explicit, read-only and never grant text overwrite authority',async()=>fixture(async({root,service,bind})=>{
  const original=Buffer.concat([Buffer.from([0,27,255]),Buffer.alloc(80000,65)]);await writeFile(join(root,'binary.dat'),original);const linked=await bind();
  const request=path=>service.dispatch({workspaceId:'ws',actor:owner,action:'raw-file',query:new URLSearchParams({path,expected_binding_version:linked.binding.version})});
  const result=await request('binary.dat');assert.equal(result.read_only,true);assert.equal(result.preview_bytes,65536);assert(result.truncated);assert.match(result.raw_preview,/⟦00⟧⟦1b⟧/);assert.equal(result.content,undefined);assert.equal(result.version,undefined);
  await assert.rejects(service.dispatch({workspaceId:'ws',actor:owner,action:'raw-file',query:new URLSearchParams({path:'binary.dat',expected_binding_version:'old'})}),{statusCode:409});
  await assert.rejects(request('.env'));await assert.rejects(request('../outside'));
  await assert.rejects(service.save('ws',owner,{path:'binary.dat',content:'lossy',expected_version:'forged',expected_binding_version:linked.binding.version,confirmed:true}),/UTF-8/);
  assert.deepEqual(await readFile(join(root,'binary.dat')),original);
}));

test('symlink and hardlink files cannot expose or change another path', async t => fixture(async ({ root, directory, service, bind }) => {
  const outside = join(directory, 'outside.md'); await writeFile(outside, 'outside');
  await link(outside, join(root, 'hard.md'));
  const linked = await bind();
  await assert.rejects(service.file('ws', owner, 'hard.md'), /non-linked/);
  if (process.platform === 'win32') { t.diagnostic('File-symlink privileges vary on Windows; hardlink boundary still verified.'); return; }
  await symlink(outside, join(root, 'link.md'));
  await symlink(directory, join(root, 'jump'));
  await assert.rejects(service.file('ws', owner, 'link.md'), /Symbolic/);
  await assert.rejects(service.tree('ws', owner, 'jump'), /Symbolic/);
  await assert.rejects(service.save('ws', owner, { path: 'link.md', content: 'bad', expected_version: null, expected_binding_version: linked.binding.version, confirmed: true }), /Symbolic/);
  await assert.rejects(service.save('ws', owner, { path: 'jump/outside.md', content: 'bad', expected_version: null, expected_binding_version: linked.binding.version, confirmed: true }), /Symbolic/);
  assert.equal(await readFile(outside, 'utf8'), 'outside');
}));

test('filename/content search uses bounded safe files and actual line snippets', async () => fixture(async ({ root, service, bind }) => {
  await mkdir(join(root, 'docs'));
  await writeFile(join(root, 'docs', 'hello.md'), '# Title\nThis contains needle and context.\n');
  await writeFile(join(root, '.env'), 'needle SECRET');
  await writeFile(join(root, 'binary'), Buffer.from([0, 1]));
  await bind();
  assert.equal((await service.search('ws', owner, 'hello')).entries[0].path, 'docs/hello.md');
  const result = await service.search('ws', owner, 'needle', 'contents');
  assert.equal(result.entries.length, 1); assert.equal(result.entries[0].line, 2); assert.match(result.entries[0].snippet, /needle/);
  assert.equal(result.limited, false);
  await assert.rejects(service.search('ws', owner, '', 'names'));
  await assert.rejects(service.search('ws', owner, 'x', 'shell'));
}));

test('search results have an enforced limit rather than unrestricted recursive output', async () => fixture(async ({ root, service, bind }) => {
  await Promise.all(Array.from({ length: 110 }, (_, index) => writeFile(join(root, `match-${index}.md`), `needle ${index}`)));
  await bind();
  for (const mode of ['names', 'contents']) {
    const result = await service.search('ws', owner, mode === 'names' ? 'match' : 'needle', mode);
    assert.equal(result.entries.length, 100); assert.equal(result.limited, true);
  }
}));

test('new Markdown file creation is explicit, no-overwrite and survives reopening', async () => fixture(async ({ service, bind, root, db, storage }) => {
  const linked = await bind();
  const input = { path: 'New 文件.md', content: '# My project\n', expected_version: null, expected_binding_version: linked.binding.version, confirmed: true };
  await assert.rejects(service.save('ws', owner, { ...input, confirmed: false }), /Confirm/);
  await assert.rejects(service.save('ws', owner, { ...input, path: 'run.sh' }), /\.md/);
  const created = await service.save('ws', owner, input);
  assert.equal(created.content, input.content);
  await assert.rejects(service.save('ws', owner, input), { statusCode: 409 });
  assert.equal(await readFile(join(root, input.path), 'utf8'), input.content);
  assert.equal((await readdir(root)).some(name => name.startsWith('.env.frondose-save')), false);
  const reopened = createDirectoryWorkspaceService({ db, dataDir: storage });
  assert.equal((await reopened.get('ws', owner)).ready, true);
  assert.equal((await reopened.file('ws', owner, input.path)).content, input.content);
}));

test('stale new drafts cannot be created in a workspace rebound by another window', async () => fixture(async ({ service, bind, root, otherRoot, db, storage }) => {
  const linked = await bind();
  const input = { path: 'draft.md', content: '# Retained in the editor', expected_version: null, expected_binding_version: linked.binding.version, confirmed: true };
  const anotherWindow = createDirectoryWorkspaceService({ db, dataDir: storage });
  const rebound = await anotherWindow.bind('ws', owner, { project_id: 'p', path: otherRoot, confirmed: true, expected_version: linked.binding.version });
  await assert.rejects(service.save('ws', owner, input), { code: 'directory_conflict', statusCode: 409 });
  assert.deepEqual(await readdir(root), []); assert.deepEqual(await readdir(otherRoot), []);
  await assert.rejects(service.save('ws', owner, { ...input, expected_binding_version: undefined }), { statusCode: 409 });
  const saved = await service.save('ws', owner, { ...input, expected_binding_version: rebound.binding.version });
  assert.equal(saved.content, input.content); assert.deepEqual(await readdir(root), []);
  assert.equal(await readFile(join(otherRoot, input.path), 'utf8'), input.content);
}));

test('stale restored editor reads reject a different root\'s same-name file', async () => fixture(async ({ service, bind, root, otherRoot, db, storage }) => {
  await writeFile(join(root, 'readme.md'), 'Original root');
  await writeFile(join(otherRoot, 'readme.md'), 'Different root');
  const linked = await bind();
  assert.equal((await service.file('ws', owner, 'readme.md', linked.binding.version)).content, 'Original root');
  const anotherWindow = createDirectoryWorkspaceService({ db, dataDir: storage });
  const rebound = await anotherWindow.bind('ws', owner, { project_id: 'p', path: otherRoot, confirmed: true, expected_version: linked.binding.version });
  await assert.rejects(service.file('ws', owner, 'readme.md', linked.binding.version), { code: 'directory_conflict', statusCode: 409 });
  const query = new URLSearchParams({ path: 'readme.md', expected_binding_version: linked.binding.version });
  await assert.rejects(service.dispatch({ workspaceId: 'ws', actor: owner, action: 'file', method: 'GET', query }), { statusCode: 409 });
  query.set('expected_binding_version', rebound.binding.version);
  assert.equal((await service.dispatch({ workspaceId: 'ws', actor: owner, action: 'file', method: 'GET', query })).content, 'Different root');
  assert.equal((await service.file('ws', owner, 'readme.md')).content, 'Different root', 'Compatibility reads without a tab revision use the currently linked root.');
}));

test('save requires current disk baseline and retains external edits after a conflict', async () => fixture(async ({ root, service, bind }) => {
  await writeFile(join(root, 'readme.md'), 'before'); const linked = await bind();
  const initial = await service.file('ws', owner, 'readme.md');
  await assert.rejects(service.save('ws', owner, { path: 'readme.md', content: 'my draft', expected_binding_version: linked.binding.version, confirmed: true }), { statusCode: 409 });
  const saved = await service.save('ws', owner, { path: 'readme.md', content: 'my draft', expected_version: initial.version, expected_binding_version: linked.binding.version, confirmed: true });
  assert.equal(saved.content, 'my draft'); assert.notEqual(saved.version, initial.version);
  await writeFile(join(root, 'readme.md'), 'external writer');
  await assert.rejects(service.save('ws', owner, { path: 'readme.md', content: 'old draft', expected_version: saved.version, expected_binding_version: linked.binding.version, confirmed: true }), { statusCode: 409 });
  assert.equal(await readFile(join(root, 'readme.md'), 'utf8'), 'external writer');
}));

test('concurrent saves of one disk baseline cannot overwrite each other', async () => fixture(async ({ root, service, bind }) => {
  await writeFile(join(root, 'readme.md'), 'before'); const linked = await bind();
  const initial = await service.file('ws', owner, 'readme.md');
  const results = await Promise.allSettled(['one', 'two'].map(content => service.save('ws', owner, { path: 'readme.md', content, expected_version: initial.version, expected_binding_version: linked.binding.version, confirmed: true })));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.filter(row => row.status === 'rejected' && row.reason.statusCode === 409).length, 1);
  assert.equal(await readFile(join(root, 'readme.md'), 'utf8'), 'one');
}));

test('save rejects oversized, private, invalid and missing-parent paths without creating files', async () => fixture(async ({ root, service, bind }) => {
  const linked = await bind();
  const base = { content: 'draft', expected_version: null, expected_binding_version: linked.binding.version, confirmed: true };
  for (const input of [
    { ...base, path: '.env' }, { ...base, path: '../escape.md' }, { ...base, path: 'missing/new.md' },
    { ...base, path: 'notes.md', content: '\0secret' }, { ...base, path: 'notes.md', content: 'a'.repeat(512_001) },
    { ...base, path: 'notes.md', expected_version: undefined },
  ]) await assert.rejects(service.save('ws', owner, input));
  assert.deepEqual(await readdir(root), []);
  await assert.rejects(service.dispatch({ workspaceId: 'ws', actor: owner, action: 'execute', method: 'POST' }), { statusCode: 404 });
}));

test('directory API is local-only, owner-authenticated, scoped and origin protected', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frondose-directory-api-'));
  const dataDir = join(directory, 'storage'), root = join(directory, 'project'); await mkdir(root);
  const forbidden = () => { throw Error('No provider execution or network'); };
  const api = createLocalApi({ dataDir, productMode: 'local', integrationOptions: { env: {}, execute: forbidden, spawnProcess: forbidden, fetchImpl: forbidden } });
  const server = createServer(api.middleware);
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const call = async (path, body, method = body ? 'POST' : 'GET') => {
      const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, body: await response.json(), headers: response.headers };
    };
    const workspace = (await call('/workspaces', { name: 'Fixture' })).body.workspace;
    const project = (await call('/projects', { workspace_id: workspace.id, name: 'Project' })).body.project;
    const q = `?workspace_id=${workspace.id}`;
    assert.equal((await call('/directory-workspace' + q)).body.result.bound, false);
    const linked = await call('/directory-workspace', { workspace_id: workspace.id, project_id: project.id, path: root, confirmed: true }, 'PUT');
    assert.equal(linked.status, 200, JSON.stringify(linked.body)); assert.equal(linked.body.result.ready, true);
    assert.equal(linked.headers.get('cache-control'), 'no-store');
    const workstation = await call('/workstation-tools' + q);
    assert.equal(workstation.status, 200);
    assert.equal(workstation.body.result.environment.state, 'coming-soon');
    assert.equal(workstation.body.result.ios.state, 'coming-soon');
    for (const operation of ['devices/list', 'devices/boot-android', 'environment/create', 'environment/start', 'environment/exec', 'environment/stop']) {
      const response = await call('/workstation-tools/' + operation, { workspace_id: workspace.id, confirmed: true, expected_binding_version: linked.body.result.binding.version });
      assert.equal(response.status, 409, operation); assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(JSON.stringify(response.body), /coming_soon/, operation);
    }
    const unsafeDraft = { workspace_id: workspace.id, path: 'notes.md', content: '# fixture', expected_version: null, confirmed: true };
    assert.equal((await call('/directory-workspace/file', unsafeDraft, 'PUT')).status, 409);
    assert.equal((await call('/directory-workspace/file', { ...unsafeDraft, expected_binding_version: 'stale' }, 'PUT')).status, 409);
    assert.deepEqual(await readdir(root), []);
    const created = await call('/directory-workspace/file', { workspace_id: workspace.id, path: 'notes.md', content: '# fixture', expected_version: null, expected_binding_version: linked.body.result.binding.version, confirmed: true }, 'PUT');
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const loaded = await call('/directory-workspace/file' + q + '&path=notes.md');
    assert.equal(loaded.body.result.content, '# fixture');
    assert.equal((await call('/directory-workspace/file' + q + '&path=notes.md&expected_binding_version=stale')).status, 409);
    assert.equal((await call('/directory-workspace/file' + q + '&path=notes.md&expected_binding_version=' + linked.body.result.binding.version)).status, 200);
    assert.equal((await fetch(base + '/directory-workspace' + q, { headers: { origin: 'https://attacker.example' } })).status, 403);
    await call('/identity/setup', { name: 'Owner', email: 'fixture@example.invalid', password: 'fixture-password-1234' });
    assert.equal((await call('/directory-workspace' + q)).status, 401);
    assert.equal((await call('/workstation-tools' + q)).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); api.close(); await rm(directory, { recursive: true, force: true }); }
});

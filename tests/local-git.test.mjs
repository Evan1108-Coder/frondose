import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { createDirectoryWorkspaceService } from '../server/directory-workspace.mjs';
import { createLocalGitService } from '../server/local-git.mjs';
import { createLocalApi } from '../server/local-api.mjs';
import { resolveRunnerExecutable } from '../server/runner-process.mjs';
import { githubRepositoryFromRemote, localGitApiPath, localGitSetupPrompt, localGithubReadFailure } from '../src/lib/local-git.js';

const exec = promisify(execFile), owner = { id: 'local-owner' };
const expected = state => ({ expected_version: state.version, expected_binding_version: state.bindingVersion, confirmed: true });
async function fixture(callback, { repository = true, remote = true, commandHook, sessions = () => [], recordActivity } = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'frondose-local-git-')));
  const root = join(directory, 'project with spaces'), storage = join(directory, 'private'), home = join(directory, 'owner');
  await Promise.all([mkdir(root), mkdir(storage), mkdir(home)]);
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE workspaces(id TEXT PRIMARY KEY,archived_at TEXT);
    CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,local_path TEXT,archived_at TEXT);
    CREATE TABLE runs(id TEXT PRIMARY KEY,workspace_id TEXT,status TEXT);
    CREATE TABLE workbench_terminals(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,name TEXT,status TEXT);
    INSERT INTO workspaces VALUES('ws',NULL),('other',NULL);`);
  db.prepare('INSERT INTO projects VALUES(?,?,?,?,NULL)').run('p','ws','Fixture Project',root);
  db.prepare('INSERT INTO projects VALUES(?,?,?,?,NULL)').run('other-p','other','Other',root);
  const roots = createDirectoryWorkspaceService({ db, dataDir: storage });
  const gitBinary = await resolveRunnerExecutable(process.platform === 'win32' ? 'git.exe' : 'git');
  assert(gitBinary, 'Git is required for the isolated local Git fixture');
  const environment = { PATH: process.env.PATH, Path: process.env.Path, SystemRoot: process.env.SystemRoot, HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(home, 'empty-config'), GIT_TERMINAL_PROMPT: '0' };
  await writeFile(join(home, 'empty-config'), '');
  const git = async (...args) => (await exec(gitBinary.path, args, { cwd: root, env: environment, encoding: 'utf8', shell: false })).stdout;
  if (repository) {
    await git('init','--initial-branch=main');
    await writeFile(join(root,'README.md'),'main version\n');
    await git('add','README.md'); await git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture initial');
    await git('checkout','-b','feature'); await writeFile(join(root,'README.md'),'feature version\n');
    await git('add','README.md'); await git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture feature'); await git('checkout','main');
    if (remote) await git('remote','add','origin','https://github.com/example/frondose-fixture.git');
  }
  const calls = [];
  const runCommand = async command => {
    calls.push(command);
    const override = await commandHook?.(command);
    if (override !== undefined) return override;
    if (command.tool === 'gh') {
      if (command.args[0] === 'auth') return '';
      if (command.args[0] === 'api') return '{"login":"fixture-owner"}';
      if (command.args[0] === 'pr') return JSON.stringify([{ number: 7, title: 'Fixture PR', url: 'javascript:alert(1)', headRefName: 'feature', baseRefName: 'main', isDraft: false, reviewDecision: 'APPROVED', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }], updatedAt: '2026-10-26T00:00:00Z' }]);
      if (command.args[0] === 'issue') return JSON.stringify([{number:9,title:'Fixture issue',state:'OPEN',url:'javascript:alert(1)',assignees:[{login:'fixture-owner'}],labels:[{name:'bug'}],updatedAt:'2026-10-26T00:00:00Z'}]);
      throw Error('Unexpected fixture gh command');
    }
    try { return (await exec(gitBinary.path, command.args, { cwd: command.cwd, env: environment, encoding: 'utf8', shell: false })).stdout; }
    catch (error) { throw Object.assign(error, { commandFailed: true }); }
  };
  const service = createLocalGitService({ db, dataDir: storage, roots, runCommand, activeSessionsFor: sessions, recordActivity });
  const bind = workspaceId => roots.bind(workspaceId, owner, { project_id: workspaceId === 'other' ? 'other-p' : 'p', path: root, confirmed: true });
  const connect = async () => service.connect('ws', owner, expected(await service.inspect('ws',owner)));
  try { await callback({ directory, root, storage, db, roots, service, bind, connect, git, calls, runCommand }); }
  finally { db.close(); await rm(directory,{ recursive: true, force: true }); }
}

test('branch activity records only a verified change, without branch or checkout paths', async () => {
  const events = [];
  await fixture(async ({ service, bind, connect }) => {
    await bind('ws');
    const state = await connect();
    const input = { ...expected(state), drafts_confirmed: true, branch: 'feature' };
    await assert.rejects(service.switchBranch('ws', owner, { ...input, branch: 'missing' }));
    const switched = await service.switchBranch('ws', owner, input);
    assert.equal(switched.branch, 'feature');
    await service.switchBranch('ws', owner, { ...input, ...expected(switched) });
  }, { recordActivity: event => { events.push(event); throw Error('fixture recorder failed'); } });
  assert.deepEqual(events, [{ workspaceId: 'ws', kind: 'git.branch_changed', title: 'Git branch switched', entityId: 'p' }]);
});

test('GitHub remotes become canonical credential-free URLs only for supported github.com repositories', () => {
  for (const url of ['git@github.com:example/repo.git','https://github.com/example/repo.git','ssh://git@github.com/example/repo.git']) assert.deepEqual(githubRepositoryFromRemote(url),{owner:'example',repo:'repo',slug:'example/repo',url:'https://github.com/example/repo'});
  assert.equal(githubRepositoryFromRemote('https://a-token@github.com/example/repo.git').url,'https://github.com/example/repo');
  for (const url of ['https://github.com.evil.test/a/b','https://github.com/a/b?token=secret','https://github.com/a/b#secret','file:///etc/passwd','git@github.com:../../secret','https://github.com/a/b/extra','ssh://root@github.com/a/b','https://github.com:8443/a/b','https://x:secret@github.com/a/b','https://github.com/a/..','git@github.com:a/b\nrun']) assert.equal(githubRepositoryFromRemote(url),null,url);
});

test('Versions reads local commit history and bounded changes without network or index writes',async()=>fixture(async({service,bind,git,calls})=>{
  await bind('ws');const state=await service.inspect('ws',owner),before=await git('status','--porcelain');calls.length=0;
  const request=(action,input={})=>service.dispatch({workspaceId:'ws',actor:owner,method:'POST',action,input:{expected_binding_version:state.bindingVersion,...input}});
  const history=await request('history');assert.equal(history.rows[0].title,'fixture initial');assert.match(history.rows[0].id,/^[a-f0-9]{40}$/);
  const diff=await request('history-diff',{commit:history.rows[0].id,path:'README.md'});assert.match(diff.patch,/main version/);
  await assert.rejects(request('history',{expected_binding_version:'stale'}),/directory changed/);await assert.rejects(request('history-diff',{commit:'--evil',path:'README.md'}),/Choose a commit/);
  await assert.rejects(request('history-diff',{commit:history.rows[0].id,path:'../secret'}));
  assert(calls.every(c=>c.tool==='git'));assert(!calls.some(c=>c.args.some(arg=>['fetch','push','commit','checkout','add'].includes(arg))));assert.equal(await git('status','--porcelain'),before);
}));
test('setup prompts use the real directory/name and never invent a remote or execute commands', () => {
  const prompt = localGitSetupPrompt({ directory:'/tmp/Project with spaces',projectName:'My workspace',isRepository:false });
  assert.match(prompt,/\/tmp\/Project with spaces/); assert.match(prompt,/My workspace/); assert.match(prompt,/do not invent/); assert.match(prompt,/Never reset/); assert.doesNotMatch(prompt,/https:\/\/github\.com\/[^ ]+\/[^ ]+/);
  assert.match(localGitSetupPrompt({ directory:'/project',isRepository:true,github:{slug:'example/existing'} }),/example\/existing/);
  assert.match(localGitSetupPrompt(),/wait for my choice/);
  assert.equal(localGitApiPath('ws','branch'),'/api/local-git/branch?workspace_id=ws');
});
test('local detection never connects, authenticates or contacts GitHub automatically', async () => fixture(async ({ service,bind,calls,storage }) => {
  assert.equal((await service.inspect('ws',owner)).bound,false);
  await bind('ws'); const state = await service.inspect('ws',owner);
  assert.equal(state.isRepository,true); assert.equal(state.branch,'main'); assert.equal(state.connected,false); assert.equal(state.github.slug,'example/frondose-fixture'); assert.deepEqual(state.branches,['feature','main']); assert.equal(state.account.authenticated,null);
  assert.equal(calls.filter(row=>row.tool==='gh').length,0); assert(!((await readdir(storage)).includes('local-git-connections.json')));
}));
test('branch cards use genuine local commits and upstream counts without fetching or account reads', async () => fixture(async ({service,bind,git,calls}) => {
  await bind('ws');const head=(await git('rev-parse','main')).trim();await git('update-ref','refs/remotes/origin/main',head);await git('branch','--set-upstream-to=origin/main','feature');
  const state=await service.inspect('ws',owner), main=state.branchDetails.find(item=>item.name==='main'), feature=state.branchDetails.find(item=>item.name==='feature');
  assert.equal(main.subject,'fixture initial');assert.equal(feature.subject,'fixture feature');assert.equal(main.commit,head);assert.equal(main.shortCommit,head.slice(0,8));assert(Number.isFinite(Date.parse(main.committedAt)));
  assert.equal(main.tracking,null);assert.deepEqual(feature.tracking,{ahead:1,behind:0});assert.equal(feature.upstream,'origin/main');assert.match(state.tabScope,/^[a-f0-9]{64}$/);
  assert.equal(calls.filter(call=>call.tool==='gh').length,0);assert.equal(calls.some(call=>call.args.includes('fetch')),false);
}));
test('Blame requires explicit connection and reads scoped committed HEAD without GitHub calls', async () => fixture(async ({service,bind,connect,calls}) => {
  await bind('ws'); let state = await service.inspect('ws',owner);
  await assert.rejects(service.fileBlame('ws',owner,{...expected(state),path:'README.md'}),{code:'github_not_connected'});
  await connect(); state = await service.inspect('ws',owner); const before = calls.filter(call=>call.tool==='gh').length;
  const result = await service.dispatch({workspaceId:'ws',actor:owner,action:'file-blame',method:'POST',input:{...expected(state),path:'README.md'}});
  assert.equal(result.source,'local_git_history'); assert.equal(result.lines[0].text,'main version'); assert.equal(result.lines[0].line,1); assert.equal(result.lines[0].author,'Fixture'); assert.match(result.lines[0].commit,/^[a-f0-9]{40}$/);
  assert.equal(calls.filter(call=>call.tool==='gh').length,before);
  await assert.rejects(service.fileBlame('ws',owner,{...expected(state),path:'../owner/empty-config'}));
  await assert.rejects(service.fileBlame('ws',owner,{...expected(state),path:'.git/config'}));
  await assert.rejects(service.fileBlame('ws',owner,{...expected(state),path:'README.md',expected_binding_version:'stale'}),{statusCode:409});
}));
test('raw native Git exit 128 for a missing upstream is an optional result, not an API error', async () => {
  let rawGit; const failures = [];
  await fixture(async ({ bind, service, git, calls }) => {
    rawGit = git; await bind('ws'); const state = await service.inspect('ws', owner);
    assert.equal(state.branch, 'main'); assert.equal(state.tracking, null); assert.equal(state.isRepository, true);
    assert(failures.some(row => row.code === 128 && row.args.includes('rev-list')));
    assert.equal(calls.filter(row => row.tool === 'gh').length, 0);
  }, { commandHook: async ({ tool, args }) => {
    if (tool !== 'git') return;
    try { return await rawGit(...args); }
    catch (error) { failures.push({ code: error.code, args }); throw error; }
  } });
});
test('directories with no Git or no GitHub remote remain unconnected and get truthful reasons', async () => {
  await fixture(async({bind,service})=>{await bind('ws');const state=await service.inspect('ws',owner);assert.equal(state.reason,'not_a_repository');assert.equal(state.github,null);},{repository:false});
  await fixture(async({bind,service})=>{await bind('ws');const state=await service.inspect('ws',owner);assert.equal(state.reason,'github_remote_missing');await assert.rejects(service.connect('ws',owner,expected(state)),{code:'github_remote_missing'});},{remote:false});
});
test('explicit owner consent persists privately without copying credentials or granting imports authority', async () => fixture(async ({service,bind,connect,storage,db,roots,runCommand,calls}) => {
  await bind('ws'); const state=await service.inspect('ws',owner);
  await assert.rejects(service.connect('ws',owner,{...expected(state),confirmed:false}),/Confirm/);
  await assert.rejects(service.connect('ws',owner,{...expected(state),expected_version:'stale'}),{statusCode:409});
  await assert.rejects(service.inspect('ws',{id:'member'}),{statusCode:403});
  const connected=await connect(); assert.equal(connected.connected,true);assert.equal(connected.account.login,'fixture-owner');
  const record=await readFile(join(storage,'local-git-connections.json'),'utf8');assert.doesNotMatch(record,/token|password|secret/i);assert.equal((await lstat(join(storage,'local-git-connections.json'))).nlink,1);
  const ghCalls=calls.filter(row=>row.tool==='gh').length;
  const reopened=createLocalGitService({db,dataDir:storage,roots,runCommand});assert.equal((await reopened.inspect('ws',owner)).connected,true);assert.equal(calls.filter(row=>row.tool==='gh').length,ghCalls);
  await reopened.disconnect('ws',owner); assert.equal((await service.inspect('ws',owner)).connected,false);
}));
test('a changed remote or rebound root invalidates the previous repository connection',async()=>fixture(async({bind,connect,service,git,roots,root})=>{
  await bind('ws');await connect();await git('remote','set-url','origin','git@github.com:example/different.git');assert.equal((await service.inspect('ws',owner)).connected,false);
  await connect();const binding=roots.binding('ws');await roots.bind('ws',owner,{project_id:'p',path:root,confirmed:true,expected_version:binding.version});assert.equal((await service.inspect('ws',owner)).connected,false);
}));
test('safe branch switching refreshes disk content and rotates the file-editor binding epoch',async()=>fixture(async({bind,connect,service,root,roots})=>{
  await bind('ws');const state=await connect();const file=await roots.file('ws',owner,'README.md',state.bindingVersion);
  const changed=await service.switchBranch('ws',owner,{...expected(state),branch:'feature',drafts_confirmed:true});
  assert.equal(changed.branch,'feature');assert.equal(changed.branchChanged,true);assert.equal(changed.connected,true);assert.notEqual(changed.bindingVersion,state.bindingVersion);assert.equal(await readFile(join(root,'README.md'),'utf8'),'feature version\n');
  await assert.rejects(roots.save('ws',owner,{path:'README.md',content:'stale editor',expected_version:file.version,expected_binding_version:state.bindingVersion,confirmed:true}),{statusCode:409});
  await assert.rejects(service.switchBranch('ws',owner,{...expected(state),branch:'main',drafts_confirmed:true}),{statusCode:409});
}));
test('dirty, untracked, active and invalid branch requests never discard work or launch git switch',async()=>fixture(async({bind,connect,service,root,calls,db})=>{
  await bind('ws');let state=await connect();
  for(const branch of ['--detach','feature\nwhoami','missing'])await assert.rejects(service.switchBranch('ws',owner,{...expected(state),branch,drafts_confirmed:true}));
  await assert.rejects(service.switchBranch('ws',owner,{...expected(state),branch:'feature',drafts_confirmed:false}),/Save or discard/);
  await writeFile(join(root,'notes.md'),'keep me');state=await service.inspect('ws',owner);await assert.rejects(service.switchBranch('ws',owner,{...expected(state),branch:'feature',drafts_confirmed:true}),/untracked/);assert.equal(await readFile(join(root,'notes.md'),'utf8'),'keep me');await rm(join(root,'notes.md'));
  db.exec("INSERT INTO workbench_terminals VALUES('t','ws','p','Test terminal','running')");state=await service.inspect('ws',owner);await assert.rejects(service.switchBranch('ws',owner,{...expected(state),branch:'feature',drafts_confirmed:true}),/Stop active/);
  assert.equal(calls.filter(row=>row.tool==='git'&&row.args.includes('switch')).length,0);
}));
test('another workspace using the same physical checkout also blocks unsafe branch changes',async()=>fixture(async({bind,connect,service,db})=>{
  await bind('ws');await bind('other');await connect();db.exec("INSERT INTO runs VALUES('r','other','running')");const state=await service.inspect('ws',owner);assert.equal(state.activeWork,true);await assert.rejects(service.switchBranch('ws',owner,{...expected(state),branch:'feature',drafts_confirmed:true}),/Stop active/);
}));
test('a shared checkout branch change invalidates stale new-file drafts in every linked workspace',async()=>fixture(async({bind,connect,service,roots})=>{
  await bind('ws');const other=await bind('other');const state=await connect();
  await service.switchBranch('ws',owner,{...expected(state),branch:'feature',drafts_confirmed:true});
  assert.notEqual(roots.binding('other').version,other.binding.version);
  await assert.rejects(roots.save('other',owner,{path:'new.md',content:'old branch draft',expected_version:null,expected_binding_version:other.binding.version,confirmed:true}),{statusCode:409});
}));
test('switches disable repository hooks and refuse custom content filters',async()=>{
  await fixture(async({bind,connect,service,root})=>{await bind('ws');const state=await connect();await writeFile(join(root,'.git/hooks/post-checkout'),'#!/bin/sh\ntouch hook-ran\n',{mode:0o700});await service.switchBranch('ws',owner,{...expected(state),branch:'feature',drafts_confirmed:true});await assert.rejects(lstat(join(root,'hook-ran')),{code:'ENOENT'});});
  await fixture(async({bind,connect,service,git,calls})=>{await bind('ws');await connect();await git('config','filter.fixture.smudge','echo should-not-run');const state=await service.inspect('ws',owner);await assert.rejects(service.switchBranch('ws',owner,{...expected(state),branch:'feature',drafts_confirmed:true}),/content filters/);assert.equal(calls.filter(row=>row.args.includes('switch')).length,0);});
});
test('linked Git metadata is rejected rather than following a different repository',async()=>fixture(async({bind,service,root,directory})=>{
  await bind('ws');await rename(join(root,'.git'),join(directory,'outside-git'));await symlink(join(directory,'outside-git'),join(root,'.git'),'dir');await assert.rejects(service.inspect('ws',owner),{code:'unsafe_git_metadata'});
}));
test('pull requests require explicit connected-owner reads and return only canonical repository links',async()=>fixture(async({bind,connect,service,calls})=>{
  await bind('ws');let state=await service.inspect('ws',owner);await assert.rejects(service.pullRequests('ws',owner,expected(state)),{code:'github_not_connected'});await connect();state=await service.inspect('ws',owner);await assert.rejects(service.pullRequests('ws',owner,{...expected(state),confirmed:false}),/Choose Refresh/);
  const result=await service.pullRequests('ws',owner,expected(state));assert.equal(result.requests.length,1);assert.equal(result.requests[0].url,'https://github.com/example/frondose-fixture/pull/7');assert.equal(result.requests[0].review,'APPROVED');assert.equal(result.requests[0].checks.failed,0);assert(calls.some(row=>row.tool==='gh'&&row.args[0]==='pr'));
}));
test('missing GitHub CLI is honest while local repository connection and branches remain usable',async()=>fixture(async({bind,connect,service})=>{
  await bind('ws');const state=await connect();assert.equal(state.connected,true);assert.equal(state.account.installed,false);await assert.rejects(service.pullRequests('ws',owner,expected(state)),{code:'gh_not_installed'});
},{commandHook:({tool})=>{if(tool==='gh')throw Object.assign(Error('fixture missing'),{code:'gh_not_installed'});}}));
test('issue search is explicit, owner-scoped, repository-bound and passed as discrete read-only arguments',async()=>fixture(async({bind,connect,service,calls})=>{
  await bind('ws');let state=await service.inspect('ws',owner);
  await assert.rejects(service.issues('ws',owner,expected(state)),{code:'github_not_connected'});
  await connect();state=await service.inspect('ws',owner);
  await assert.rejects(service.issues('ws',owner,{...expected(state),confirmed:false}),/Choose Search/);
  await assert.rejects(service.issues('ws',{id:'member'},expected(state)),{statusCode:403});
  const query='label:bug "two words" ; echo not-a-command';
  const result=await service.dispatch({workspaceId:'ws',actor:owner,action:'issues',method:'POST',input:{...expected(state),query,state:'closed',assigned_to_me:true}});
  assert.equal(result.issues[0].url,'https://github.com/example/frondose-fixture/issues/9');
  assert.deepEqual(result.issues[0].assignees,['fixture-owner']);assert.deepEqual(result.issues[0].labels,['bug']);
  const read=calls.find(row=>row.tool==='gh'&&row.args[0]==='issue');
  assert.equal(read.args[read.args.indexOf('--search')+1],query);assert.equal(read.args[read.args.indexOf('--repo')+1],'github.com/example/frondose-fixture');
  assert.equal(read.args[read.args.indexOf('--state')+1],'closed');assert.equal(read.args[read.args.indexOf('--assignee')+1],'@me');
  assert.equal(calls.some(row=>row.tool==='gh'&&['create','edit','close','reopen','comment'].some(action=>row.args.includes(action))),false);
}));
test('invalid issue filters or a stale repository never trigger GitHub issue reads',async()=>fixture(async({bind,connect,service,calls})=>{
  await bind('ws');const state=await connect();
  for(const fields of [{query:'x'.repeat(301)},{query:'line\ncommand'},{query:'repo:other/repo'},{query:'bug OR org:other'},{query:'is:pr'},{state:'--all'},{assigned_to_me:'yes'},{expected_version:'stale'}])await assert.rejects(service.issues('ws',owner,{...expected(state),...fields}));
  assert.equal(calls.some(row=>row.tool==='gh'&&row.args[0]==='issue'),false);
}));
test('issue results are bounded and canonicalized instead of trusting returned URLs or duplicated IDs',async()=>fixture(async({bind,connect,service})=>{
  await bind('ws');const state=await connect();const result=await service.issues('ws',owner,expected(state));
  assert.equal(result.limited,true);assert(result.issues.length<=20);assert.equal(new Set(result.issues.map(row=>row.number)).size,result.issues.length);
  assert(result.issues.every(row=>row.url.startsWith('https://github.com/example/frondose-fixture/issues/')));
  assert(result.issues.every(row=>row.assignees.length<=10&&row.labels.length<=10));
},{commandHook:({tool,args})=>{if(tool==='gh'&&args[0]==='issue')return JSON.stringify(Array.from({length:50},(_,i)=>({number:i<2?1:i,title:'<script>unsafe</script>\n',state:'CLOSED',url:'https://evil.test',assignees:Array.from({length:30},()=>({login:'name'})),labels:[]})));}}));
test('issue source failures are actionable and never expose raw command stderr',async()=>{
  await fixture(async({bind,connect,service})=>{await bind('ws');const state=await connect();await assert.rejects(service.issues('ws',owner,expected(state)),error=>error.code==='github_read_failed'&&!/private fixture stderr/.test(error.message));},{commandHook:({tool,args})=>{if(tool==='gh'&&args[0]==='issue')throw Error('private fixture stderr');}});
  for(const [code,title]of [['gh_not_installed','GitHub source unavailable'],['gh_account_unverified','GitHub account could not be checked'],['local_git_conflict','Repository changed']])assert.equal(localGithubReadFailure({code,message:'private'}).title,title);
  assert.doesNotMatch(localGithubReadFailure({code:'unknown',message:'private fixture stderr'}).message,/private fixture stderr/);
});
test('a failed network/account probe remains unknown rather than claiming the user signed out',async()=>fixture(async({bind,connect,service})=>{
  await bind('ws');const state=await connect();assert.equal(state.connected,true);assert.equal(state.account.installed,true);assert.equal(state.account.authenticated,null);assert.equal(state.account.reason,'gh_account_unverified');
  await assert.rejects(service.pullRequests('ws',owner,expected(state)),error=>error.code==='gh_account_unverified'&&/network/.test(error.message));
},{commandHook:({tool})=>{if(tool==='gh')throw Object.assign(Error('fixture offline'),{commandFailed:true});}}));
test('missing Git is not misreported as a connected or authenticated repository',async()=>fixture(async({bind,service,calls})=>{
  await bind('ws');const state=await service.inspect('ws',owner);assert.equal(state.isRepository,false);assert.equal(state.reason,'git_not_installed');assert.equal(state.connected,false);assert.equal(calls.filter(row=>row.tool==='gh').length,0);
},{commandHook:({tool})=>{if(tool==='git')throw Object.assign(Error('fixture Git missing'),{code:'git_not_installed'});}}));
test('a linked private connection record cannot read or overwrite an outside file',async()=>fixture(async({bind,connect,service,storage,directory})=>{
  await bind('ws');await connect();const outside=join(directory,'outside.json');await writeFile(outside,'{"secret":"untouched"}',{mode:0o600});await rm(join(storage,'local-git-connections.json'));await symlink(outside,join(storage,'local-git-connections.json'));
  await assert.rejects(service.inspect('ws',owner),error=>error.code==='local_git_storage'&&!/untouched/.test(error.message));assert.equal(await readFile(outside,'utf8'),'{"secret":"untouched"}');
}));
test('metadata failure after successful Git is reported as changed and never blindly replayed',async()=>{
  let perform,fault;
  await fixture(async({bind,connect,service,git,storage,roots,root,calls})=>{
    await bind('ws');const state=await connect();perform=git;fault=()=>writeFile(join(storage,'local-git-connections.json'),'invalid fixture metadata');
    await assert.rejects(service.switchBranch('ws',owner,{...expected(state),branch:'feature',drafts_confirmed:true}),error=>error.code==='branch_changed_refresh_required'&&/completed the branch change/.test(error.message));
    assert.equal(await readFile(join(root,'README.md'),'utf8'),'feature version\n');assert.notEqual(roots.binding('ws').version,state.bindingVersion);assert.equal(calls.filter(row=>row.tool==='git'&&row.args.includes('switch')).length,1);
  },{commandHook:async({tool,args})=>{if(tool==='git'&&args.includes('switch')){const output=await perform(...args);await fault();return output;}}});
});
test('a branch mutation reserves the physical checkout against terminals and queued stale saves',async()=>{
  let began,release;const started=new Promise(resolve=>{began=resolve;}),resume=new Promise(resolve=>{release=resolve;});
  await fixture(async({bind,connect,service,roots})=>{
    await bind('ws');await bind('other');const state=await connect();const file=await roots.file('ws',owner,'README.md',state.bindingVersion);
    const operation=service.switchBranch('ws',owner,{...expected(state),branch:'feature',drafts_confirmed:true});await started;
    assert.throws(()=>service.assertNoMutation('ws'),{statusCode:409});assert.throws(()=>service.assertNoMutation('other'),{statusCode:409});
    const save=roots.save('ws',owner,{path:'README.md',content:'stale',expected_version:file.version,expected_binding_version:state.bindingVersion,confirmed:true});
    release();await operation;await assert.rejects(save,{statusCode:409});service.assertNoMutation('ws');
  },{commandHook:async({tool,args})=>{if(tool==='git'&&args.includes('switch')){began();await resume;}}});
});
test('local Git HTTP routes stay local-only, owner-authenticated, origin protected and no-store',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'frondose-local-git-http-'));const api=createLocalApi({dataDir:directory,productMode:'local',integrationOptions:{autoDetect:false}});const server=createServer((req,res)=>void api.handle(req,res));
  try{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;const call=async(path,body)=>{const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return{status:response.status,headers:response.headers,body:await response.json()};};const workspace=(await call('/workspaces',{name:'Git fixture'})).body.workspace;const path=`/local-git?workspace_id=${workspace.id}`;const state=await call(path);assert.equal(state.status,200);assert.equal(state.body.result.bound,false);assert.equal(state.headers.get('cache-control'),'no-store');assert.equal((await fetch(base+path,{headers:{origin:'https://attacker.example'}})).status,403);await call('/identity/setup',{name:'Fixture',email:'fixture@example.invalid',password:'fixture-password-1234'});assert.equal((await call(path)).status,401);
  }finally{await new Promise(resolve=>server.close(resolve));api.close();await rm(directory,{recursive:true,force:true});}
});
test('GitHub Routes HTTP creates a local Route only after explicit connection, configuration and sync',async()=>fixture(async({directory,root,runCommand,calls})=>{
  const api=createLocalApi({dataDir:join(directory,'api-private'),productMode:'local',integrationOptions:{autoDetect:false},localGitOptions:{runCommand},githubRouteOptions:{start:false}});
  const server=createServer((req,res)=>void api.handle(req,res));
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
    const call=async(path,body,method=body?'POST':'GET')=>{const response=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return{status:response.status,headers:response.headers,body:await response.json()};};
    const created=await call('/workspaces',{name:'Issue import fixture'}); assert.equal(created.status,201); const workspace=created.body.workspace;
    const source=`/github-routes?workspace_id=${workspace.id}`;
    const empty=await call(source);assert.equal(empty.status,200);assert.equal(empty.body.result.connected,false);assert.equal(empty.headers.get('cache-control'),'no-store');
    assert.equal((await fetch(base+source,{headers:{origin:'https://attacker.example'}})).status,403);
    const project=(await call('/projects',{workspace_id:workspace.id,name:'Fixture project'})).body.project;
    const bind=await call('/directory-workspace',{workspace_id:workspace.id,project_id:project.id,path:root,confirmed:true},'PUT');assert.equal(bind.status,200);
    let git=(await call(`/local-git?workspace_id=${workspace.id}`)).body.result;
    assert.equal((await call('/local-git/connect',{workspace_id:workspace.id,...expected(git)})).status,200);
    const before=calls.filter(row=>row.tool==='gh').length;
    const state=(await call(source)).body.result;assert.equal(state.connected,true);assert.equal(calls.filter(row=>row.tool==='gh').length,before);
    const save=await call('/github-routes/settings',{workspace_id:workspace.id,confirmed:true,enabled:false,project_id:project.id,expected_revision:null,expected_binding_version:state.bindingVersion,expected_repository:state.repository.slug});
    assert.equal(save.status,200,JSON.stringify(save.body));assert.equal(calls.filter(row=>row.tool==='gh').length,before);
    const sync=await call('/github-routes/sync',{workspace_id:workspace.id,confirmed:true,expected_revision:save.body.result.config.revision});
    assert.equal(sync.status,200,JSON.stringify(sync.body));assert.equal(sync.body.result.sync.created,1);
    const routes=(await call(`/tasks?workspace_id=${workspace.id}`)).body.tasks;assert.equal(routes.length,1);assert.equal(routes[0].project_id,project.id);assert.match(routes[0].description,/https:\/\/github.com\/example\/frondose-fixture\/issues\/9/);
    const repeated=await call('/github-routes/sync',{workspace_id:workspace.id,confirmed:true,expected_revision:save.body.result.config.revision});assert.equal(repeated.body.result.sync.existing,1);
    await call('/identity/setup',{name:'Fixture',email:'fixture@example.invalid',password:'fixture-password-1234'});assert.equal((await call(source)).status,401);
  } finally {await new Promise(resolve=>server.close(resolve));api.close();}
}));

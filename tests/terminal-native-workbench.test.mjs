import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createWorkbenchService } from '../server/workbench-service.mjs';
import { createLocalAutomationService } from '../server/local-cli-automations.mjs';
import { randomUUID } from 'node:crypto';
import { composeNativeAgentPrompt } from '../src/lib/native-agent-session.js';

async function fixture(callback, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'frondose-native-terminal-test-'));
  const root = join(directory, 'project'), dataDir = join(directory, 'private');
  await mkdir(root); await mkdir(dataDir);
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE workspaces(id TEXT PRIMARY KEY,archived_at TEXT); CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,local_path TEXT,archived_at TEXT); INSERT INTO workspaces VALUES ('ws',NULL),('other',NULL);`);
  db.prepare('INSERT INTO projects VALUES (?,?,?,NULL)').run('project', 'ws', root);
  const spawned = [];
  const ptyFactory = { spawn(command, args, options) {
    const terminal = { command, args, options, onData(callback) { this.data = callback; }, onExit(callback) { this.exit = callback; }, resize() {}, write() {}, kill() { this.exit?.({ exitCode: 0 }); } };
    spawned.push(terminal); return terminal;
  } };
  const service = createWorkbenchService({ db, dataDir, ptyFactory, ...options });
  const project = service.scope('ws', 'project');
  const call = (action, method = 'GET', body = {}, query = {}, actor = { id: 'local-owner' }) => service.dispatch(project, action, method, body, new URL(`http://127.0.0.1/api/workbench?${new URLSearchParams(query)}`), { actor });
  try { await callback({ service, call, spawned, root, db }); }
  finally { service.close(); db.close(); await rm(directory, { recursive: true, force: true }); }
}

test('catalog discovery and restoring session summaries never create PTYs or authenticate accounts', async () => fixture(async ({ call, spawned }) => {
  const catalog = await call('terminal-providers');
  assert.equal(catalog.providers.find(item => item.id === 'codex').installed, true);
  assert.equal(catalog.providers.find(item => item.id === 'codex').authenticated, null);
  assert.ok(catalog.providers.every(item => item.path === undefined));
  assert.deepEqual((await call('')).terminals, []); assert.equal(spawned.length, 0);
}, { terminalPlatform: 'linux', terminalEnv: { PATH: '/bin' }, terminalResolveExecutable: async command => command === 'codex' ? { path: '/bin/codex' } : null }));

test('bounded terminal reads wake on real output and input remains raw for native slash commands', async () => fixture(async ({ call, spawned }) => {
  const terminal = await call('terminals', 'POST', { confirm_execution: true });
  const read = call(`terminals/${terminal.id}`, 'GET', {}, { cursor: 0, wait_ms: 80 });
  spawned[0].data('native output\r\n');
  const result = await read;
  assert.equal(result.output, 'native output\r\n'); assert.equal(result.cursor, 15);
  let input; spawned[0].write = value => { input = value; };
  await call(`terminals/${terminal.id}/input`, 'POST', { data: '/resume\r' });
  assert.equal(input, '/resume\r');
  await assert.rejects(call(`terminals/${terminal.id}`, 'GET', {}, { cursor: 0, wait_ms: 1000 }), /between 0 and 80/);
}));

test('Quick Commands CRUD is scoped and never runs the stored text implicitly', async () => fixture(async ({ call, spawned }) => {
  const command = await call('commands', 'POST', { name: 'Inspect', command: 'git status --short' });
  assert.equal((await call('')).commands[0].command, 'git status --short');
  await call(`commands/${command.id}`, 'PATCH', { name: 'Inspect branch', command: 'git branch --show-current' });
  assert.equal((await call('')).commands[0].name, 'Inspect branch');
  await assert.rejects(call('commands/not-this-project', 'PATCH', { name: 'No', command: 'no' }), /unavailable/);
  assert.equal(spawned.length, 0);
  await call(`commands/${command.id}`, 'DELETE'); assert.equal((await call('')).commands.length, 0);
}));

test('live output is immediate, bounded and flushed to durable history on terminal exit', async () => fixture(async ({ call, spawned, db }) => {
  const terminal = await call('terminals', 'POST', { confirm_execution: true });
  spawned[0].data('x'.repeat(250010)); spawned[0].data('last');
  const live = await call(`terminals/${terminal.id}`);
  assert.equal(live.output.length, 250000); assert.equal(live.output.endsWith('last'), true); assert.equal(live.reset, true); assert.equal(live.cursor, 250014);
  spawned[0].exit({ exitCode: 0 });
  const stored = db.prepare('SELECT output,output_offset FROM workbench_terminals WHERE id=?').get(terminal.id);
  assert.equal(stored.output, live.output); assert.equal(stored.output_offset, 14);
  assert.equal((await call(`terminals/${terminal.id}`)).output, live.output);
}));

test('graceful service close flushes terminal history before releasing the native process', async () => fixture(async ({ call, spawned, db, service }) => {
  const terminal = await call('terminals', 'POST', { confirm_execution: true });
  spawned[0].data('output before close'); service.close();
  assert.equal(db.prepare('SELECT output FROM workbench_terminals WHERE id=?').get(terminal.id).output, 'output before close');
}));

test('Git branch mutation lock blocks terminal launch before creating any reservation or PTY', async () => fixture(async ({ call, spawned, service }) => {
  await assert.rejects(call('terminals', 'POST', { confirm_execution: true }), /branch switch pending/);
  assert.equal(spawned.length, 0); assert.deepEqual(service.activeSessionsFor('projects', 'project'), []);
}, { assertDirectoryMutable: workspaceId => { assert.equal(workspaceId, 'ws'); throw Error('branch switch pending'); } }));

test('provider launch is confirmed, server-selected, scoped, prompt-free and redacts operator secrets', async () => fixture(async ({ call, spawned, root }) => {
  await assert.rejects(call('terminals', 'POST', { provider_id: 'codex' }), /Confirm/);
  await assert.rejects(call('terminals', 'POST', { confirm_execution: true, provider_id: 'codex', command: 'overwrite' }), /not both/);
  await assert.rejects(call('terminals', 'POST', { confirm_execution: true, provider_id: '../malicious' }), /local CLI catalog/);
  assert.equal(spawned.length, 0);
  const terminal = await call('terminals', 'POST', { name: 'Codex', confirm_execution: true, provider_id: 'codex' });
  assert.equal(spawned.length, 1); assert.equal(spawned[0].command, '/usr/bin/codex'); assert.deepEqual(spawned[0].args, []);
  assert.equal(spawned[0].options.cwd, await realpath(root)); assert.equal(spawned[0].options.env.OPENAI_API_KEY, undefined);
  assert.equal(terminal.command, '[codex CLI]');
  assert.equal((await call('')).terminals[0].id, terminal.id); assert.equal(spawned.length, 1);
}, { terminalPlatform: 'linux', terminalEnv: { PATH: '/usr/bin', OPENAI_API_KEY: 'not-to-inherit' }, terminalResolveExecutable: async command => command === 'codex' ? { path: '/usr/bin/codex' } : null }));

test('Windows shell fixture uses native Windows argv and environment rather than Unix assumptions', async () => fixture(async ({ call, spawned }) => {
  await call('terminals', 'POST', { confirm_execution: true, shell_id: 'powershell' });
  assert.equal(spawned[0].command, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(spawned[0].args, ['-NoLogo', '-NoProfile']); assert.equal(spawned[0].options.env.USERPROFILE, 'C:\\Users\\Fixture');
  assert.equal(spawned[0].options.env.ANTHROPIC_API_KEY, undefined);
}, { terminalPlatform: 'win32', terminalEnv: { SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\Fixture', ANTHROPIC_API_KEY: 'not-to-inherit' } }));

test('personalized agent launch cannot silently ignore its instructions by using a raw terminal', async () => fixture(async ({ call, spawned }) => {
  await assert.rejects(call('terminals', 'POST', { confirm_execution: true, confirm_paid: true, request_id: 'blocked-task-000001', agent_id: 'agent', provider_id: 'codex' }), /instructions must not be silently omitted/i);
  assert.equal(spawned.length, 0);
}));

test('in-flight launch reservations prevent directory rebinding before the terminal row exists', async () => {
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  await fixture(async ({ call, service }) => {
    const launch = call('terminals', 'POST', { confirm_execution: true, provider_id: 'codex' });
    await ready;
    try {
      assert.equal(service.activeSessionsFor('projects', 'project')[0].status, 'starting');
      assert.equal(service.activeSessionsFor('workspaces', 'ws')[0].status, 'starting');
      assert.equal(service.activeSessionsFor('workspaces', 'other').length, 0);
    } finally { release(); }
    const terminal = await launch;
    const current = service.activeSessionsFor('workspaces', 'ws');
    assert.equal(current.length, 1); assert.equal(current[0].id, terminal.id); assert.equal(current[0].status, 'running');
  }, { terminalPlatform: 'linux', terminalEnv: {}, terminalResolveExecutable: async () => { entered(); await wait; return { path: '/usr/bin/codex' }; } });
});

const profile = () => ({ id: 'agent', workspace_id: 'ws', name: 'Research agent', provider: 'codex', version: 1, instructions: 'Use evidence.\nKeep a clear record.', native_binding_revision: 'local:codex:1' });
async function review(call, agent = 'agent', provider = 'codex') { return call('native-agent-preview', 'GET', {}, { agent_id: agent, provider_id: provider }); }
const approved = preview => ({ provider_id: preview.provider_id, agent_id: preview.agent_id, agent_version: preview.version, agent_snapshot_hash: preview.snapshot_hash, task: 'Read the project and describe the next step.', confirm_paid: true, confirm_execution: true, request_id: 'native-task-000000001' });
const nativeOptions = agent => ({ terminalPlatform: 'linux', terminalEnv: { PATH: '/bin' }, terminalResolveExecutable: async command => ({ path: `/bin/${command}` }), authorizeNativeAgent: ({ actor, workspaceId, projectId, agentId, providerId }) => { assert.equal(actor.id, 'local-owner'); assert.equal(workspaceId, 'ws'); assert.equal(projectId, 'project'); assert.equal(agentId, 'agent'); assert.equal(providerId, 'codex'); return agent; } });

test('only an approved scheduled receipt can add workspace activity to canonical Route argv', () => fixture(async ({call,spawned,db,root,service}) => {
  const owner = {id:'local-owner'};
  const privateActivity = 'START untrusted workspace activity\nFile saved: example.md\nEND untrusted workspace activity';
  db.exec(`CREATE TABLE directory_workspaces(workspace_id TEXT PRIMARY KEY,project_id TEXT,path TEXT,version TEXT);
    CREATE TABLE tasks(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,archived_at TEXT,status TEXT,version INTEGER,title TEXT,description TEXT,updated_at TEXT);
    INSERT INTO tasks VALUES ('route','ws','project',NULL,'ready',1,'Review','Review this exact task.','2026-10-30');`);
  db.prepare('INSERT INTO directory_workspaces VALUES (?,?,?,?)').run('ws','project',root,'binding');
  const project = service.scope('ws','project');
  let clock = Date.parse('2026-10-30T08:00:00Z');
  const automations = createLocalAutomationService({db,roots:{async rootFor(){return {root,project};}},workbench:service,activityContext:()=>privateActivity,now:()=>clock,intervalMs:0});
  const dispatch = (action,input)=>automations.dispatch({workspaceId:'ws',actor:owner,action,method:'POST',input});
  try {
    const preview = await call('route-task-preview','GET',{}, {route_id:'route',provider_id:'codex'});
    const id = 'automation_'+randomUUID();
    const raw = {route_id:'route',agent_version:preview.version,agent_snapshot_hash:preview.snapshot_hash,expected_binding_version:'binding',provider_id:'codex',confirm_execution:true,confirm_paid:true,request_id:id,view_id:id};
    await assert.rejects(call('terminals','POST',{...raw,reviewed_activity_context:privateActivity}),/not a launch request/);
    await assert.rejects(service.dispatch(project,'terminals','POST',raw,new URL('http://local/'),{actor:owner,reviewedActivityContext:privateActivity}),/not approved/);
    assert.equal(spawned.length,0);
    const choice={route_id:'route',provider_id:'codex',include_workspace_activity:true};
    const review=await dispatch('preview',choice);
    await dispatch('',{...choice,title:'Review',request_id:randomUUID(),route_version:review.version,snapshot_hash:review.snapshot_hash,binding_version:'binding',timezone:'UTC',local_time:'2026-10-30T09:00',recurrence:'none',confirm_recurring:true});
    clock=Date.parse('2026-10-30T09:00:00Z');
    await automations.tick();
    assert.equal(spawned.length,1);
    assert.deepEqual(spawned[0].args,[preview.prompt+'\n\n'+privateActivity]);
    const receipt=db.prepare('SELECT prompt_text,status FROM workbench_agent_terminal_launches').get();
    assert.equal(receipt.status,'launched');
    assert.equal(receipt.prompt_text,preview.prompt);
  } finally { automations.close(); }
}, nativeOptions(profile())));

test('named preview reads only current personalization and never launches or sends a model task', async () => fixture(async ({ call, spawned, db }) => {
  const preview = await review(call);
  assert.equal(preview.instructions, profile().instructions); assert.equal(preview.name, 'Research agent');
  assert.match(preview.snapshot_hash, /^[a-f0-9]{64}$/); assert.equal(preview.native_binding_revision, undefined);
  assert.equal(spawned.length, 0); assert.equal(db.prepare('SELECT count(*) AS n FROM workbench_agent_terminal_launches').get().n, 0);
}, nativeOptions(profile())));

test('named first task requires both consents, a reviewed current profile, and nonempty bounded task', async () => fixture(async ({ call, spawned }) => {
  const body = approved(await review(call));
  for (const change of [{ confirm_execution: false }, { confirm_paid: false }, { task: '' }, { task: ' ' }, { task: 'x\0y' }, { task: 'x'.repeat(8001) }, { request_id: 'short' }, { agent_version: 2 }, { agent_snapshot_hash: 'wrong' }]) await assert.rejects(call('terminals', 'POST', { ...body, ...change }));
  assert.equal(spawned.length, 0);
}, nativeOptions(profile())));

test('named task carries exact owner personalization and task as one native argv argument with durable linkage', async () => fixture(async ({ call, spawned, db }) => {
  const preview = await review(call), body = { ...approved(preview), task: 'Use "quotes"; text $(not-a-shell-command)\nand & syntax literally.' };
  const terminal = await call('terminals', 'POST', body);
  assert.equal(spawned.length, 1); assert.equal(spawned[0].args.length, 1);
  assert.equal(spawned[0].args[0], composeNativeAgentPrompt(preview, body.task));
  assert.equal(terminal.agent_id, 'agent'); assert.equal(terminal.agent_profile_version, 1); assert.equal(terminal.name, preview.name);
  const receipt = db.prepare('SELECT * FROM workbench_agent_terminal_launches').get();
  assert.equal(receipt.terminal_id, terminal.id); assert.equal(receipt.actor_id, 'local-owner'); assert.equal(receipt.status, 'launched');
  assert.equal(receipt.prompt_text, spawned[0].args[0]); assert.equal(receipt.snapshot_hash, preview.snapshot_hash);
}, nativeOptions(profile())));

test('lost-response retry returns the same named terminal even at the process limit, never replaying a paid task', async () => fixture(async ({ call, spawned }) => {
  await call('settings', 'PATCH', { maxTerminals: 1 });
  const body = approved(await review(call));
  const first = await call('terminals', 'POST', body), second = await call('terminals', 'POST', body);
  assert.equal(first.id, second.id); assert.equal(spawned.length, 1);
  await assert.rejects(call('terminals', 'POST', { ...body, task: 'Different task' }), /different reviewed work/);
  assert.equal(spawned.length, 1);
}, nativeOptions(profile())));

test('parallel copies of one reviewed task reserve exactly one invocation', async () => fixture(async ({ call, spawned }) => {
  const body = approved(await review(call));
  const results = await Promise.allSettled([call('terminals', 'POST', body), call('terminals', 'POST', body)]);
  const completed = results.filter(item => item.status === 'fulfilled');
  assert.ok(completed.length >= 1); assert.equal(new Set(completed.map(item => item.value.id)).size, 1);
  assert.equal(spawned.length, 1);
}, nativeOptions(profile())));

test('profile text/binding changes invalidate review even without a version bump', async () => {
  for (const change of [{ instructions: 'Changed personalization' }, { native_binding_revision: 'revoked-or-rebound' }]) {
    const agent = profile();
    await fixture(async ({ call, spawned }) => { const body = approved(await review(call)); Object.assign(agent, change); await assert.rejects(call('terminals', 'POST', body), /changed/); assert.equal(spawned.length, 0); }, nativeOptions(agent));
  }
});

test('current agent authority and fingerprint are checked again immediately before spawning', async () => {
  const agent = profile(); let release, entered;
  const ready = new Promise(resolve => { entered = resolve; }), wait = new Promise(resolve => { release = resolve; });
  await fixture(async ({ call, spawned, db }) => {
    const body = approved(await review(call));
    const launching = call('terminals', 'POST', body); await ready; agent.version = 2; release();
    await assert.rejects(launching, /changed while/); assert.equal(spawned.length, 0);
    assert.equal(db.prepare('SELECT status FROM workbench_agent_terminal_launches').get().status, 'failed');
  }, { ...nativeOptions(agent), terminalResolveExecutable: async () => { entered(); await wait; return { path: '/bin/codex' }; } });
});

test('a spawn failure leaves an uncertain receipt which never retries the task automatically', async () => {
  let attempts = 0;
  await fixture(async ({ call, db, service }) => {
    const body = approved(await review(call));
    await assert.rejects(call('terminals', 'POST', body), /fixture spawn failed/);
    assert.equal(db.prepare('SELECT status FROM workbench_agent_terminal_launches').get().status, 'uncertain');
    assert.equal(service.activeSessionsFor('workspaces', 'ws')[0].status, 'uncertain');
    await assert.rejects(call('terminals', 'POST', body), /uncertain/); assert.equal(attempts, 1);
  }, { ...nativeOptions(profile()), ptyFactory: { spawn() { attempts++; throw new Error('fixture spawn failed'); } } });
});

test('named Windows batch shim refuses unsafe first-task transport before a PTY starts', async () => fixture(async ({ call, spawned }) => {
  const body = approved(await review(call));
  await assert.rejects(call('terminals', 'POST', body), /native \.exe CLI on Windows/); assert.equal(spawned.length, 0);
}, { ...nativeOptions(profile()), terminalPlatform: 'win32', terminalEnv: { SystemRoot: 'C:\\Windows' }, terminalResolveExecutable: async () => ({ path: 'C:\\Tools\\codex.cmd' }) }));

test('raw provider sessions cannot silently accept a first-task field without a reviewed profile', async () => fixture(async ({ call, spawned }) => {
  await assert.rejects(call('terminals', 'POST', { provider_id: 'codex', task: 'Unreviewed task', confirm_execution: true }), /reviewed named native agent/); assert.equal(spawned.length, 0);
}, nativeOptions(profile())));

test('selected worktree summaries and review fingerprints name the actual execution directory', async () => fixture(async ({ call, db, root, spawned }) => {
  const alternate = join(root, 'worktree'); await mkdir(alternate);
  db.prepare('INSERT INTO workbench_environments VALUES (?,?,?,?,?,?,?)').run('env', 'ws', 'project', 'Worktree', alternate, 'branch', new Date().toISOString());
  assert.equal((await call('', 'GET', {}, { environment_id: 'env' })).root, await realpath(alternate));
  const basePreview = await review(call), environmentPreview = await call('native-agent-preview', 'GET', {}, { agent_id: 'agent', provider_id: 'codex', environment_id: 'env' });
  assert.notEqual(basePreview.snapshot_hash, environmentPreview.snapshot_hash);
  await assert.rejects(call('terminals', 'POST', { ...approved(basePreview), environment_id: 'env' }), /changed/);
  assert.equal(spawned.length, 0);
  const terminal = await call('terminals', 'POST', { ...approved(environmentPreview), environment_id: 'env' });
  assert.equal(terminal.cwd, await realpath(alternate));
}, nativeOptions(profile())));

test('per-agent native session limits count current work and release capacity only after a real stop', async () => fixture(async ({ call, spawned }) => {
  const preview = await review(call), firstBody = approved(preview);
  const first = await call('terminals', 'POST', firstBody);
  await call('terminals', 'POST', { ...firstBody, request_id: 'native-task-000000002' });
  await assert.rejects(call('terminals', 'POST', { ...firstBody, request_id: 'native-task-000000003' }), /allowed active or uncertain native work/);
  assert.equal(spawned.length, 2);
  await call(`terminals/${first.id}/stop`, 'POST');
  await call('terminals', 'POST', { ...firstBody, request_id: 'native-task-000000003' });
  assert.equal(spawned.length, 3);
}, nativeOptions({ ...profile(), native_max_concurrent_sessions: 2 })));

test('invalid first-task text reports a validation error before reserving or starting work', async () => fixture(async ({ call, db, spawned }) => {
  const body = { ...approved(await review(call)), task: '' };
  await assert.rejects(call('terminals', 'POST', body), error => error.statusCode === 400);
  assert.equal(spawned.length, 0); assert.equal(db.prepare('SELECT count(*) AS n FROM workbench_agent_terminal_launches').get().n, 0);
}, nativeOptions(profile())));

test('CLI settings are owner-only, revision guarded, workspace scoped and never start a PTY', async () => fixture(async ({call,spawned,db,service,root})=>{
  assert.deepEqual(await call('cli-settings'),{revision:0,commands:{}});
  await assert.rejects(call('cli-settings','GET',{}, {}, {id:'foreign'}),/local owner/);
  await assert.rejects(call('cli-settings','PATCH',{commands:{},expected_revision:0}),/Confirm/);
  const commands={codex:{executable:'custom-codex',args:['--model','fixture']}};
  assert.deepEqual(await call('cli-settings','PATCH',{commands,expected_revision:0,confirmed:true}),{revision:1,commands});
  assert.equal(db.prepare('SELECT settings_json FROM local_workspace_terminal_preferences WHERE project_id=?').get('ws').settings_json.includes('custom-codex'),true);
  await assert.rejects(call('cli-settings','PATCH',{commands:{},expected_revision:0,confirmed:true}),/changed/);
  await assert.rejects(call('cli-settings','PATCH',{commands:{codex:{executable:'codex && no',args:[]}},expected_revision:1,confirmed:true}),/executable/i);
  assert.equal((await call('cli-settings')).revision,1);
  db.prepare('INSERT INTO projects VALUES (?,?,?,NULL)').run('other-project','other',root);const other=service.scope('other','other-project');
  assert.deepEqual(await service.dispatch(other,'cli-settings','GET',{},new URL('http://localhost/?host_scope=workspace'),{actor:{id:'local-owner'}}),{revision:0,commands:{}});
  assert.equal((await call('terminal-providers')).providers.find(p=>p.id==='codex').installed,true);
  assert.equal(spawned.length,0);
  await call('terminals','POST',{confirm_execution:true,provider_id:'codex'});
  assert.equal(spawned[0].command,'/fixture/custom-codex');assert.deepEqual(spawned[0].args,['--model','fixture']);
}, {terminalPlatform:'linux',terminalEnv:{PATH:'/fixture'},terminalResolveExecutable:async command=>['codex','custom-codex'].includes(command)?{path:'/fixture/'+command,kind:'native'}:null}));

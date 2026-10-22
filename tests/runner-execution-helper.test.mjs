import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  authorizeRunner, forgetRunnerConfig, getRunnerStatus, pairRunner, readRunnerPolicy, resolveRunnerProject, runRunnerHelper,
  sendRunnerHeartbeat, writeRunnerConfig, writeRunnerPolicy,
} from '../scripts/frondose-runner.mjs';
import { EMPTY_RUNNER_POLICY } from '../src/lib/runner-policy.js';

const CREDENTIAL = 'X'.repeat(43);
const CONFIG = { version: 1, server: 'https://frondose.example', runner_id: 'runner_execution_fixture', credential: CREDENTIAL, platform: process.platform, architecture: process.arch };
const response = result => new Response(JSON.stringify({ result }), { headers: { 'content-type': 'application/json' } });
const policy = patch => ({ ...EMPTY_RUNNER_POLICY, enabled: true, provider_ids: ['codex'], project_ids: [], project_paths: {}, ...patch });
const makeJob = patch => ({ id: 'job_fixture', leaseToken: 'fixture_lease', providerId: 'codex', prompt: 'Fixture reviewed prompt — never sent to a provider', model: 'fixture-model', workspaceId: 'workspace_fixture', actorId: 'actor_fixture', sessionId: 'session_fixture', workMode: 'conversation', nativeToolsApproved: false, deadlineAt: Date.now() + 30_000, timeoutMs: 5_000, ...patch });
const paused = () => new Promise(resolve => setTimeout(resolve, 8));

test('unconfirmed process cleanup quarantines the helper and advertises execution disabled',async t=>{
  const {directory}=await fixture(t);await writeRunnerPolicy(directory,policy());
  const heartbeats=[],statuses=[];let claims=0;
  const result=await runRunnerHelper({directory,discover:async()=>[],onStatus:status=>statuses.push(status),wait:paused,
    fetchImpl:async(url,request)=>{const body=JSON.parse(request.body);if(url.endsWith('/heartbeat')){heartbeats.push(body.execution_policy.enabled);return response({state:'connected',execution_available:body.execution_policy.enabled});}if(url.endsWith('/poll')){claims++;return response({job:makeJob()});}return response({received:true});},
    execute:async()=>{throw Object.assign(new Error('Fixture could not confirm cleanup'),{code:'runtime_cleanup_failed'});},
  });
  assert.equal(result.state,'quarantined');assert.equal(claims,1);assert.deepEqual(heartbeats,[true,false]);assert.ok(statuses.some(item=>item.state==='quarantined'));
});

test('provider-reported cancellation never becomes a completed canonical reply',async t=>{
  const {directory}=await fixture(t);await writeRunnerPolicy(directory,policy());const controller=new AbortController();let complete;
  await runRunnerHelper({directory,signal:controller.signal,discover:async()=>[],wait:async()=>{await paused();if(complete)controller.abort();},
    fetchImpl:async(url,request)=>{if(url.endsWith('/heartbeat'))return response({state:'connected',execution_available:true});if(url.endsWith('/poll'))return response({job:complete?null:makeJob()});complete=JSON.parse(request.body);return response({received:true});},
    execute:async()=>({text:'Partial must not become a reply',stopReason:'cancelled'}),
  });
  assert.equal(complete.status,'stopped');assert.equal(complete.text,'');
});

async function fixture(t, { paired = true } = {}) {
  const base = await mkdtemp(path.join(await realpath(os.tmpdir()), 'frondose-execution-helper-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const directory = path.join(base, 'runner');
  if (paired) await writeRunnerConfig(directory, CONFIG);
  return { base, directory };
}

test('execution policy starts disabled and consent requires pairing plus the exact local confirmation', async t => {
  const { directory } = await fixture(t, { paired: false });
  assert.deepEqual(await readRunnerPolicy(directory), { ...EMPTY_RUNNER_POLICY, project_paths: {} });
  await assert.rejects(authorizeRunner(['--providers', 'codex'], { directory, confirm: async () => 'AUTHORIZE', output: { write() {} } }), { code: 'not_paired' });
  await writeRunnerConfig(directory, CONFIG);
  for (const answer of ['yes', 'authorize', '', 'AUTHORIZE later']) {
    await assert.rejects(authorizeRunner(['--providers', 'codex'], { directory, confirm: async () => answer, output: { write() {} } }), { code: 'cancelled' });
    assert.equal((await readRunnerPolicy(directory)).enabled, false);
  }
});

test('local authorize parses provider, sharing, package, tool, concurrency and explicit project consent', async t => {
  const { base, directory } = await fixture(t);
  const folder = path.join(base, 'project=with space');
  await mkdir(folder);
  let printed = '', confirmations = 0;
  const result = await authorizeRunner(['--providers', 'codex,claude', '--allow-native-tools', '--allow-shared', '--allow-package-downloads', '--max-concurrent', '3', '--project', `project_one=${folder}`], {
    directory, confirm: async () => { confirmations++; return 'AUTHORIZE'; }, output: { write(text) { printed += text; } },
  });
  assert.equal(confirmations, 1);
  assert.match(printed, /incur charges/);
  assert.match(printed, /not a Frondose sandbox/);
  assert.equal(printed.includes(CREDENTIAL), false);
  assert.equal(result.enabled, true);
  const saved = await readRunnerPolicy(directory);
  assert.deepEqual(saved.provider_ids, ['claude', 'codex']);
  assert.deepEqual(saved.project_ids, ['project_one']);
  assert.equal(saved.project_paths.project_one, await realpath(folder));
  assert.equal(saved.native_tools_approved, true);
  assert.equal(saved.allow_workspace_members, true);
  assert.equal(saved.package_execution_approved, true);
  assert.equal(saved.max_concurrent_sessions, 3);
  if (process.platform !== 'win32') assert.equal((await lstat(path.join(directory, 'execution.json'))).mode & 0o777, 0o600);
});

test('invalid authorize arguments never reach confirmation or persist an enabled policy', async t => {
  const { directory } = await fixture(t);
  for (const args of [[], ['--providers'], ['--providers', 'unknown-fixture'], ['--providers', 'codex', '--max-concurrent', '0'], ['--providers', 'codex', '--max-concurrent', '9'], ['--providers', 'codex', '--max-concurrent', 'NaN'], ['--providers', 'codex', '--project', 'invalid'], ['--providers', 'codex', '--unknown']]) {
    let confirmed = false;
    await assert.rejects(authorizeRunner(args, { directory, confirm: async () => { confirmed = true; return 'AUTHORIZE'; }, output: { write() {} } }));
    assert.equal(confirmed, false, args.join(' '));
    assert.equal((await readRunnerPolicy(directory)).enabled, false);
  }
});

test('project mapping refuses root, home, helper storage, helper descendants and an ancestor containing helper storage', async t => {
  const { base, directory } = await fixture(t);
  const nested = path.join(directory, 'child'); await mkdir(nested);
  for (const folder of [path.parse(base).root, os.homedir(), directory, nested, base]) {
    await assert.rejects(resolveRunnerProject(folder, directory), { code: 'unsafe_storage' });
  }
  await assert.rejects(resolveRunnerProject('relative/project', directory), { code: 'invalid_storage' });
  const file = path.join(base, 'not-folder'); await writeFile(file, 'fixture');
  await assert.rejects(resolveRunnerProject(file, directory), { code: 'invalid_storage' });
  const project = path.join(base, 'project'); await mkdir(project);
  assert.equal(await resolveRunnerProject(project, directory), await realpath(project));
});

test('execution policy rejects symlinks, shared hardlinks and nonprivate POSIX files', async t => {
  const { base, directory } = await fixture(t);
  await writeRunnerPolicy(directory, policy());
  const file = path.join(directory, 'execution.json');
  const hardlink = path.join(base, 'policy-hardlink');
  await link(file, hardlink);
  await assert.rejects(readRunnerPolicy(directory), { code: 'unsafe_storage' });
  await assert.rejects(writeRunnerPolicy(directory, policy()), { code: 'unsafe_storage' });
  await rm(hardlink);
  if (process.platform !== 'win32') {
    await chmod(file, 0o644);
    await assert.rejects(readRunnerPolicy(directory), { code: 'unsafe_storage' });
    await chmod(file, 0o600);
  }
  const alternative = path.join(base, 'external-policy.json');
  await writeFile(alternative, JSON.stringify(policy()), { mode: 0o600 });
  await rm(file);
  try { await symlink(alternative, file); }
  catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') { t.diagnostic('File symlink creation unavailable; hardlink and directory checks remain exercised.'); return; } throw error; }
  await assert.rejects(readRunnerPolicy(directory), { code: 'unsafe_storage' });
  await assert.rejects(writeRunnerPolicy(directory, policy()), { code: 'unsafe_storage' });
  assert.deepEqual(JSON.parse(await readFile(alternative, 'utf8')), policy());
});

test('policy reading rejects mismatched project maps and unknown policy metadata', async t => {
  const { directory } = await fixture(t);
  await writeRunnerPolicy(directory, policy());
  const target = path.join(directory, 'execution.json');
  for (const invalid of [policy({ project_ids: ['missing'] }), policy({ project_paths: { unexpected: '/private/fixture' } }), policy({ unknown: true })]) {
    await writeFile(target, JSON.stringify(invalid), { mode: 0o600 });
    await assert.rejects(readRunnerPolicy(directory));
  }
});

test('policy writes reject invalid mappings before replacing a previously valid consent file', async t => {
  const { directory } = await fixture(t);
  await writeRunnerPolicy(directory, policy());
  const target = path.join(directory, 'execution.json'), initial = await readFile(target, 'utf8');
  for (const invalid of [policy({ project_ids: ['missing'] }), policy({ project_paths: { unexpected: '/private/fixture' } }), policy({ project_ids: ['unsafe'], project_paths: { unsafe: os.homedir() } })]) {
    await assert.rejects(writeRunnerPolicy(directory, invalid));
    assert.equal(await readFile(target, 'utf8'), initial);
  }
});

test('local status distinguishes saved consent from unchecked server availability and never returns paths or credentials', async t => {
  const { base, directory } = await fixture(t);
  const folder = path.join(base, 'private-project'); await mkdir(folder);
  await writeRunnerPolicy(directory, policy({ project_ids: ['project_one'], project_paths: { project_one: folder } }));
  const status = await getRunnerStatus(directory);
  assert.equal(status.local_execution_enabled, true); assert.deepEqual(status.authorized_providers, ['codex']);
  assert.equal(status.execution_available, false); assert.equal(status.connection_state, 'not_checked');
  assert.equal(JSON.stringify(status).includes(folder), false); assert.equal(JSON.stringify(status).includes(CREDENTIAL), false);
});

test('pairing a new server registration never inherits prior execution, tools or workspace-sharing consent', async t => {
  const { directory } = await fixture(t);
  await writeRunnerPolicy(directory, policy({ native_tools_approved: true, allow_workspace_members: true, package_execution_approved: true }));
  await forgetRunnerConfig(directory);
  await pairRunner({ server: 'https://second-frondose.example', directory, readCode: async () => 'C'.repeat(43),
    fetchImpl: async () => response({ runner_id: 'runner_new_registration', credential: 'Y'.repeat(43), state: 'approval_required' }),
  });
  assert.deepEqual(await readRunnerPolicy(directory), { ...EMPTY_RUNNER_POLICY, project_paths: {} });
});

test('heartbeat sender strips local project mappings and normalizes omitted consent flags', async () => {
  let body;
  await sendRunnerHeartbeat(CONFIG, { executionPolicy: { enabled: true, provider_ids: ['codex'], project_ids: ['project_one'], project_paths: { project_one: '/private/not-for-server' } }, discover: async () => [],
    fetchImpl: async (_url, request) => { body = JSON.parse(request.body); return response({ state: 'connected', execution_available: true }); },
  });
  assert.deepEqual(body.execution_policy, { ...EMPTY_RUNNER_POLICY, enabled: true, provider_ids: ['codex'], project_ids: ['project_one'] });
  assert.equal(JSON.stringify(body).includes('/private/not-for-server'), false);
  await assert.rejects(sendRunnerHeartbeat(CONFIG, { executionPolicy: { enabled: true }, discover: async () => [], fetchImpl: async () => { throw Error('Invalid consent must fail before fetch'); } }));
});

test('run heartbeat publishes execution consent metadata but never local project paths or executable locations', async t => {
  const { base, directory } = await fixture(t);
  const project = path.join(base, 'project'); await mkdir(project);
  await writeRunnerPolicy(directory, policy({ project_ids: ['project_one'], project_paths: { project_one: project } }));
  let heartbeat;
  const result = await runRunnerHelper({ directory, once: true, discover: async () => [{ providerId: 'codex', state: 'installed', path: '/private/provider/cli' }],
    fetchImpl: async (url, request) => { assert.ok(url.endsWith('/heartbeat')); heartbeat = JSON.parse(request.body); return response({ state: 'connected', execution_available: true }); },
    execute: () => { throw Error('A one-shot heartbeat must not execute'); },
  });
  assert.equal(result.execution_available, true);
  assert.deepEqual(heartbeat.execution_policy, { ...EMPTY_RUNNER_POLICY, enabled: true, provider_ids: ['codex'], project_ids: ['project_one'] });
  assert.deepEqual(heartbeat.runtimes, [{ id: 'codex', state: 'installed' }]);
  assert.equal(JSON.stringify(heartbeat).includes(project), false);
  assert.equal(JSON.stringify(heartbeat).includes('/private/provider'), false);
  assert.equal(JSON.stringify(heartbeat).includes(CREDENTIAL), false);
});

test('discovery without local authorization never polls or invokes execution even if server advertises availability', async t => {
  const { directory } = await fixture(t);
  const controller = new AbortController(), requests = [];
  await runRunnerHelper({ directory, signal: controller.signal, discover: async () => [],
    fetchImpl: async url => { requests.push(url); return response({ state: 'connected', execution_available: true }); },
    execute: () => { throw Error('No local consent'); }, wait: async () => controller.abort(),
  });
  assert.equal(requests.length, 1); assert.ok(requests[0].endsWith('/heartbeat'));
});

test('helper executes one leased fixture request, streams ordered events and completes once in a disposable chat directory', { timeout: 10_000 }, async t => {
  const { directory } = await fixture(t); await writeRunnerPolicy(directory, policy());
  const controller = new AbortController(), events = [], complete = [], starts = [];
  let polls = 0, waits = 0;
  const job = makeJob();
  const result = await runRunnerHelper({ directory, signal: controller.signal, discover: async () => [],
    fetchImpl: async (url, request) => {
      assert.equal(request.headers.Authorization, `Bearer ${CREDENTIAL}`);
      const body = JSON.parse(request.body);
      if (url.endsWith('/heartbeat')) return response({ state: 'connected', execution_available: true });
      if (url.endsWith('/poll')) return response({ job: ++polls === 1 ? job : null });
      assert.equal(body.job_id, job.id); assert.equal(body.lease_token, job.leaseToken);
      if (url.endsWith('/events')) { events.push(...body.events); return response({ accepted: true }); }
      if (url.endsWith('/complete')) { complete.push(body); return response({ accepted: true }); }
      throw Error('Unknown fixture endpoint');
    },
    execute: async options => { starts.push(options); options.emit({ kind: 'progress', text: 'Fixture progress' }); options.emit({ kind: 'message', text: 'Fixture answer' }); return { text: 'Fixture final', providerSessionId: 'native_fixture' }; },
    wait: async () => { await paused(); if (complete.length || ++waits > 50) controller.abort(); },
  });
  assert.equal(result.state, 'stopped'); assert.equal(starts.length, 1);
  assert.equal(starts[0].prompt, job.prompt); assert.equal(starts[0].localOwnerApproved, true);
  assert.equal(starts[0].nativeToolsApproved, false); assert.equal(starts[0].packageExecutionApproved, false);
  assert.notEqual(starts[0].cwd, os.homedir()); assert.notEqual(starts[0].cwd, directory);
  await assert.rejects(lstat(starts[0].cwd), { code: 'ENOENT' });
  assert.deepEqual(events.map(event => event.sequence), [1, 2]);
  assert.equal(complete.length, 1); assert.equal(complete[0].status, 'completed');
  assert.equal(complete[0].text, 'Fixture final'); assert.equal(complete[0].provider_session_id, 'native_fixture');
});

test('server cancellation aborts an active fixture and reports stopped instead of a partial answer', { timeout: 10_000 }, async t => {
  const { directory } = await fixture(t); await writeRunnerPolicy(directory, policy());
  const controller = new AbortController(), complete = [];
  let polls = 0, waits = 0, aborted = false;
  const job = makeJob();
  await runRunnerHelper({ directory, signal: controller.signal, discover: async () => [],
    fetchImpl: async (url, request) => {
      if (url.endsWith('/heartbeat')) return response({ state: 'connected', execution_available: true });
      if (url.endsWith('/poll')) return response(++polls === 1 ? { job } : { cancel_job_ids: [job.id] });
      if (url.endsWith('/complete')) { complete.push(JSON.parse(request.body)); return response({ accepted: true }); }
      return response({ accepted: true });
    },
    execute: ({ signal }) => new Promise(resolve => { const stop = () => { aborted = true; resolve({ text: 'Must not deliver cancelled partial answer' }); }; if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true }); }),
    wait: async () => { await paused(); if (complete.length || ++waits > 50) controller.abort(); },
  });
  assert.equal(aborted, true); assert.equal(complete.length, 1);
  assert.equal(complete[0].status, 'stopped'); assert.equal(complete[0].text, '');
});

test('local policy removal stops an active fixture, republishes disabled policy and prevents further poll dispatch', { timeout: 10_000 }, async t => {
  const { directory } = await fixture(t); await writeRunnerPolicy(directory, policy());
  const controller = new AbortController(), complete = [], heartbeats = [];
  let polls = 0, waits = 0, aborted = false;
  await runRunnerHelper({ directory, signal: controller.signal, discover: async () => [],
    fetchImpl: async (url, request) => {
      if (url.endsWith('/heartbeat')) { const body = JSON.parse(request.body); heartbeats.push(body.execution_policy); return response({ state: 'connected', execution_available: body.execution_policy.enabled }); }
      if (url.endsWith('/poll')) { polls++; return response({ job: makeJob() }); }
      if (url.endsWith('/complete')) { complete.push(JSON.parse(request.body)); return response({ accepted: true }); }
      return response({ accepted: true });
    },
    execute: ({ signal }) => new Promise((resolve, reject) => { const stop = () => { aborted = true; reject(Object.assign(Error('Fixture stopped'), { code: 'session_cancelled' })); }; if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true }); }),
    wait: async () => { await paused(); if (++waits === 1) await writeRunnerPolicy(directory, { ...EMPTY_RUNNER_POLICY, project_paths: {} }); if (complete.length || waits > 50) controller.abort(); },
  });
  assert.equal(aborted, true); assert.equal(polls, 1); assert.equal(complete[0]?.status, 'stopped');
  assert.equal(heartbeats.at(-1).enabled, false);
});

test('unauthorized provider or native tools in a lease fail before any fixture executable starts', { timeout: 10_000 }, async t => {
  for (const patch of [{ providerId: 'claude' }, { nativeToolsApproved: true }]) {
    const { directory } = await fixture(t); await writeRunnerPolicy(directory, policy());
    const controller = new AbortController(), complete = [];
    let offered = false, starts = 0, waits = 0;
    await runRunnerHelper({ directory, signal: controller.signal, discover: async () => [],
      fetchImpl: async (url, request) => {
        if (url.endsWith('/heartbeat')) return response({ state: 'connected', execution_available: true });
        if (url.endsWith('/poll')) { if (offered) return response({}); offered = true; return response({ job: makeJob(patch) }); }
        if (url.endsWith('/complete')) { complete.push(JSON.parse(request.body)); return response({ accepted: true }); }
        return response({ accepted: true });
      },
      execute: async () => { starts++; return { text: 'Must not run' }; },
      wait: async () => { await paused(); if (complete.length || ++waits > 50) controller.abort(); },
    });
    assert.equal(starts, 0); assert.equal(complete.length, 1);
    assert.equal(complete[0].status, 'failed'); assert.equal(complete[0].error_code, 'access_denied');
  }
});

test('mapped project execution keeps its explicit folder and refuses concurrent physical-root aliases', { timeout: 10_000 }, async t => {
  const { base, directory } = await fixture(t);
  const folder = path.join(base, 'mapped-project'); await mkdir(folder);
  await writeRunnerPolicy(directory, policy({ max_concurrent_sessions: 2, project_ids: ['project_one', 'project_alias'], project_paths: { project_one: folder, project_alias: folder } }));
  const controller = new AbortController(), complete = [], starts = [];
  let polls = 0, waits = 0;
  const first = makeJob({ id: 'job_first', workMode: 'project', projectId: 'project_one' });
  const second = makeJob({ id: 'job_second', workMode: 'project', projectId: 'project_alias' });
  await runRunnerHelper({ directory, signal: controller.signal, discover: async () => [],
    fetchImpl: async (url, request) => {
      if (url.endsWith('/heartbeat')) return response({ state: 'connected', execution_available: true });
      if (url.endsWith('/poll')) { polls++; return response(polls === 1 ? { job: first } : polls === 2 ? { job: second } : { cancel_job_ids: [first.id] }); }
      if (url.endsWith('/complete')) { complete.push(JSON.parse(request.body)); return response({ accepted: true }); }
      return response({ accepted: true });
    },
    execute: options => { starts.push(options); return new Promise(resolve => { const stop = () => resolve({ text: '' }); if (options.signal.aborted) stop(); else options.signal.addEventListener('abort', stop, { once: true }); }); },
    wait: async () => { await paused(); if (complete.length === 2 || ++waits > 50) controller.abort(); },
  });
  assert.equal(starts.length, 1); assert.equal(starts[0].cwd, await realpath(folder));
  assert.equal((await lstat(folder)).isDirectory(), true);
  const refused = complete.find(entry => entry.job_id === second.id);
  assert.equal(refused?.status, 'failed'); assert.equal(refused?.error_code, 'runner_project_busy');
});

test('expired leased requests fail locally before a runtime starts', { timeout: 10_000 }, async t => {
  const { directory } = await fixture(t); await writeRunnerPolicy(directory, policy());
  const controller = new AbortController(), complete = [];
  let offered = false, starts = 0, waits = 0;
  await runRunnerHelper({ directory, signal: controller.signal, discover: async () => [],
    fetchImpl: async (url, request) => {
      if (url.endsWith('/heartbeat')) return response({ state: 'connected', execution_available: true });
      if (url.endsWith('/poll')) { if (offered) return response({}); offered = true; return response({ job: makeJob({ deadlineAt: Date.now() - 1000 }) }); }
      if (url.endsWith('/complete')) { complete.push(JSON.parse(request.body)); return response({ accepted: true }); }
      return response({ accepted: true });
    },
    execute: async () => { starts++; return { text: 'Must not run' }; },
    wait: async () => { await paused(); if (complete.length || ++waits > 50) controller.abort(); },
  });
  assert.equal(starts, 0); assert.equal(complete.length, 1);
  assert.equal(complete[0].error_code, 'runner_deadline');
});

test('runtime failure reports only a bounded code and never retries an inference or sends exception secrets', { timeout: 10_000 }, async t => {
  const { directory } = await fixture(t); await writeRunnerPolicy(directory, policy());
  const controller = new AbortController(), complete = [], statuses = [];
  let offered = false, starts = 0, waits = 0;
  await runRunnerHelper({ directory, signal: controller.signal, discover: async () => [], onStatus: event => statuses.push(event),
    fetchImpl: async (url, request) => {
      if (url.endsWith('/heartbeat')) return response({ state: 'connected', execution_available: true });
      if (url.endsWith('/poll')) { if (offered) return response({}); offered = true; return response({ job: makeJob() }); }
      if (url.endsWith('/complete')) { complete.push(JSON.parse(request.body)); return response({ accepted: true }); }
      return response({ accepted: true });
    },
    execute: async () => { starts++; throw Object.assign(Error(`Private ${CREDENTIAL}`), { code: `bad code ${CREDENTIAL}` }); },
    wait: async () => { await paused(); if (complete.length || ++waits > 50) controller.abort(); },
  });
  assert.equal(starts, 1); assert.equal(complete.length, 1);
  assert.equal(complete[0].status, 'failed'); assert.equal(complete[0].error_code, 'runtime_failed');
  assert.equal(JSON.stringify(complete).includes(CREDENTIAL), false);
  assert.equal(JSON.stringify(statuses).includes(CREDENTIAL), false);
});

test('an uncertain completion response never retries inference or submits a contradictory failed completion', { timeout: 10_000 }, async t => {
  const { directory } = await fixture(t); await writeRunnerPolicy(directory, policy());
  const controller = new AbortController(), complete = [];
  let offered = false, starts = 0, waits = 0;
  await runRunnerHelper({ directory, signal: controller.signal, discover: async () => [],
    fetchImpl: async (url, request) => {
      if (url.endsWith('/heartbeat')) return response({ state: 'connected', execution_available: true });
      if (url.endsWith('/poll')) { if (offered) return response({}); offered = true; return response({ job: makeJob() }); }
      if (url.endsWith('/complete')) { complete.push(JSON.parse(request.body)); throw Error('Fixture network lost after accepting completion'); }
      return response({ accepted: true });
    },
    execute: async () => { starts++; return { text: 'Fixture final answer' }; },
    wait: async () => { await paused(); if (complete.length || ++waits > 50) controller.abort(); },
  });
  assert.equal(starts, 1); assert.equal(complete.length, 1);
  assert.equal(complete[0].status, 'completed'); assert.equal(complete[0].text, 'Fixture final answer');
});

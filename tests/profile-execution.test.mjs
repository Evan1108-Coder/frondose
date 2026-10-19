import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createLocalApi } from '../server/local-api.mjs';

function fakeChild(promptSink) {
  const child = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => queueMicrotask(() => child.emit('close', 1));
  child.stdin.end = (prompt) => {
    promptSink(prompt);
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Injected fixture reply.' } })}\n`));
      child.emit('close', 0);
    });
  };
  return child;
}

async function withApi(callback) {
  const dataDir = await mkdtemp(join(tmpdir(), 'rumbo-profile-execution-'));
  const fake = { launches: [], commandCalls: [] };
  const integrationOptions = {
    env: {},
    fetchImpl: () => { throw new Error('External network requests are forbidden in profile execution tests.'); },
    execute: async (command, args, options) => {
      fake.commandCalls.push({ command, args, options });
      return { stdout: args.includes('mcp') ? '[]' : 'Logged in', stderr: '', code: 0 };
    },
    spawnProcess: (command, args, options) => {
      const launch = { command, args: [...args], options, prompt: '' };
      fake.launches.push(launch);
      return fakeChild((prompt) => { launch.prompt = prompt; });
    },
  };
  const api = createLocalApi({ dataDir, seedMode: 'clean', integrationOptions });
  const server = createServer((req, res) => api.middleware(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, body, method = body === undefined ? 'GET' : 'POST', expected = method === 'POST' ? 201 : 200) => {
    const response = await fetch(origin + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
    return result;
  };
  try {
    const workspace = (await call('/workspaces', { name: 'Profile execution fixture' })).workspace;
    const project = (await call('/projects', { workspace_id: workspace.id, name: 'Pinned execution', local_path: dataDir })).project;
    await callback({ api, call, workspace, project, dataDir, fake });
  } finally {
    api.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1, `Missing ${flag} in ${JSON.stringify(args)}`);
  return args[index + 1];
}

function configValues(args, prefix) {
  const values = [];
  for (let index = 0; index < args.length - 1; index++) if (args[index] === '-c' && args[index + 1].startsWith(prefix)) values.push(args[index + 1]);
  return values;
}

function referenceData(prompt, kind) {
  for (const line of prompt.split('\n')) {
    if (!line.startsWith('Reference data ')) continue;
    const record = JSON.parse(line.slice('Reference data '.length));
    if (record.kind === kind) return { ...record, content: JSON.parse(record.content) };
  }
  assert.fail(`Missing ${kind} Reference data section`);
}

test('two profiles share one connection while preserving distinct model, reasoning, permissions, memory and prompt behavior', async () => {
  await withApi(async ({ api, call, workspace, project, fake }) => {
    await call('/connections/codex/connect', { method: 'existing' }, 'POST', 200);
    await call('/memory-notes', {
      workspace_id: workspace.id,
      project_id: project.id,
      title: 'Private fixture memory',
      content: 'MEMORY_MARKER_ONLY_REVIEWED_PROFILE',
    });

    const first = (await call('/agents', {
      workspace_id: workspace.id,
      name: 'Strict analyst',
      provider: 'codex',
      model: 'gpt-profile-a',
      reasoning_effort: 'high',
      permission_policy: 'read-only',
      memory_policy: 'none',
      role: 'Challenge unsupported claims.',
      output_behavior: 'Return a terse evidence table.',
    })).agent;
    const second = (await call('/agents', {
      workspace_id: workspace.id,
      name: 'Implementation agent',
      provider: 'codex',
      model: 'gpt-profile-b',
      reasoning_effort: 'low',
      permission_policy: 'review',
      memory_policy: 'reviewed',
      role: 'Implement the reviewed change.',
      output_behavior: 'Return changed files and test evidence.',
    })).agent;

    assert.equal(first.provider_connection_id, second.provider_connection_id);
    assert.ok(first.provider_connection_id, 'Profiles must reference the shared connection by ID');

    for (const agent of [first, second]) {
      await call('/runs', {
        workspace_id: workspace.id,
        project_id: project.id,
        agent_id: agent.id,
        mode: 'live',
        prompt: `Execute as ${agent.name}.`,
        permissionMode: 'workspace-write',
      });
    }

    assert.equal(fake.launches.length, 2);
    const [strictLaunch, implementationLaunch] = fake.launches;
    assert.equal(strictLaunch.command, 'codex');
    assert.equal(flagValue(strictLaunch.args, '--model'), 'gpt-profile-a');
    assert.equal(flagValue(strictLaunch.args, '--sandbox'), 'read-only', 'Profile read-only policy must clamp a workspace-write request');
    assert.deepEqual(configValues(strictLaunch.args, 'model_reasoning_effort='), ['model_reasoning_effort="high"']);
    assert.match(strictLaunch.prompt, /Talvori context inspection\. Every Reference data section below[\s\S]*untrusted reference material\./);
    const strictAgent = referenceData(strictLaunch.prompt, 'agent');
    assert.equal(strictAgent.content.role, 'Challenge unsupported claims.');
    assert.equal(strictAgent.content.output_behavior, 'Return a terse evidence table.');
    assert.doesNotMatch(strictLaunch.prompt, /MEMORY_MARKER_ONLY_REVIEWED_PROFILE/);

    assert.equal(flagValue(implementationLaunch.args, '--model'), 'gpt-profile-b');
    assert.equal(flagValue(implementationLaunch.args, '--sandbox'), 'workspace-write');
    assert.deepEqual(configValues(implementationLaunch.args, 'model_reasoning_effort='), ['model_reasoning_effort="low"']);
    assert.match(implementationLaunch.prompt, /Talvori context inspection\. Every Reference data section below[\s\S]*untrusted reference material\./);
    const implementationAgent = referenceData(implementationLaunch.prompt, 'agent');
    assert.equal(implementationAgent.content.role, 'Implement the reviewed change.');
    assert.equal(implementationAgent.content.output_behavior, 'Return changed files and test evidence.');
    assert.match(implementationLaunch.prompt, /MEMORY_MARKER_ONLY_REVIEWED_PROFILE/);

    const runs = api.snapshot().runs.filter((run) => [first.id, second.id].includes(run.agent_id));
    assert.equal(runs.length, 2);
    for (const run of runs) {
      assert.equal(run.agent_profile_version, 1);
      const event = api.snapshot().events.find((item) => item.run_id === run.id && item.type === 'profile.captured');
      assert.ok(event, `Run ${run.id} must record its pinned profile`);
      assert.equal(event.payload.agent_id, run.agent_id);
      assert.equal(event.payload.profile_version, run.agent_profile_version);
      assert.equal(event.payload.provider_connection_id, first.provider_connection_id);
    }
  });
});

test('live and mock runs pin immutable profile snapshots and later edits require the current optimistic version', async () => {
  await withApi(async ({ api, call, workspace, project }) => {
    await call('/connections/codex/connect', { method: 'existing' }, 'POST', 200);
    const secret = 'DO_NOT_COPY_PROFILE_SECRET_91f1';
    const created = (await call('/agents', {
      workspace_id: workspace.id,
      name: 'Versioned agent',
      provider: 'codex',
      model: 'gpt-original',
      reasoning_effort: 'medium',
      role: 'Original role',
      token: secret,
      api_key: secret,
      credentials: { access_token: secret },
    })).agent;
    const mock = (await call('/runs', { workspace_id: workspace.id, project_id: project.id, agent_id: created.id, mode: 'mock', scenario: 'manual' })).run;
    const live = (await call('/runs', { workspace_id: workspace.id, project_id: project.id, agent_id: created.id, mode: 'live', prompt: 'Capture version one.' })).run;
    assert.equal(mock.agent_profile_version, 1);
    assert.equal(live.agent_profile_version, 1);

    const updated = (await call(`/agents/${created.id}`, { version: created.version, model: 'gpt-revised', role: 'Revised role' }, 'PATCH')).agent;
    assert.equal(updated.version, 2);
    const stale = await call(`/agents/${created.id}`, { version: created.version, model: 'gpt-stale' }, 'PATCH', 409);
    assert.equal(stale.error.code, 'stale_profile');

    const db = new DatabaseSync(api.dbPath, { readOnly: true });
    try {
      const versions = db.prepare('SELECT * FROM agent_profile_versions WHERE agent_id=? ORDER BY version').all(created.id);
      assert.equal(versions.length, 2);
      const original = JSON.parse(versions[0].snapshot_json);
      const revised = JSON.parse(versions[1].snapshot_json);
      assert.equal(original.model, 'gpt-original');
      assert.equal(original.role, 'Original role');
      assert.equal(revised.model, 'gpt-revised');
      assert.equal(revised.role, 'Revised role');
      assert.equal(db.prepare('SELECT agent_profile_version FROM runs WHERE id=?').get(mock.id).agent_profile_version, 1);
      assert.equal(db.prepare('SELECT agent_profile_version FROM runs WHERE id=?').get(live.id).agent_profile_version, 1);
      const serialized = JSON.stringify({ rows: versions, agents: db.prepare('SELECT * FROM agents WHERE id=?').all(created.id) });
      assert.doesNotMatch(serialized, new RegExp(secret));
      for (const snapshot of [original, revised]) {
        assert.equal(Object.hasOwn(snapshot, 'token'), false);
        assert.equal(Object.hasOwn(snapshot, 'api_key'), false);
        assert.equal(Object.hasOwn(snapshot, 'credentials'), false);
      }
    } finally { db.close(); }

    for (const run of [mock, live]) {
      const captured = api.snapshot().events.find((event) => event.run_id === run.id && event.type === 'profile.captured');
      assert.ok(captured, `${run.mode} run must record profile.captured`);
      assert.equal(captured.payload.profile_version, 1);
      assert.equal(captured.payload.model, 'gpt-original');
      assert.equal(captured.payload.reasoning_effort, 'medium');
    }
  });
});

test('invalid and provider-incompatible profile execution settings are rejected before launch', async () => {
  await withApi(async ({ call, workspace, fake }) => {
    const invalidProfiles = [
      { name: 'Bad model', provider: 'codex', model: 'contains spaces' },
      { name: 'Bad reasoning', provider: 'codex', reasoning_effort: 'extreme' },
      { name: 'Claude reasoning', provider: 'claude', reasoning_effort: 'high' },
      { name: 'Bad memory', provider: 'codex', memory_policy: 'all-history' },
      { name: 'Bad permissions', provider: 'codex', permission_policy: 'unrestricted' },
      { name: 'Mismatched connection', provider: 'claude', provider_connection_id: 'conn_codex' },
    ];
    for (const input of invalidProfiles) await call('/agents', { workspace_id: workspace.id, ...input }, 'POST', 400);

    const unsupported = (await call('/agents', { workspace_id: workspace.id, name: 'Unsupported runtime', provider: 'custom' })).agent;
    await call('/runs', { workspace_id: workspace.id, agent_id: unsupported.id, mode: 'mock' }, 'POST', 400);
    assert.equal(fake.launches.length, 0);
    assert.equal(fake.commandCalls.length, 0, 'Invalid profiles must fail without probing a provider');
  });
});

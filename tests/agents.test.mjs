import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createLocalApi } from '../server/local-api.mjs';
import { AGENT_PROVIDERS, agentReadiness, agentVisibleInSidebar, runsForAgent, summarizeAgent } from '../src/lib/agents.js';

const agent = { id: 'agent_a', name: 'Reviewer', provider: 'codex', workspace_id: 'ws_a', status: 'available' };

test('readiness distinguishes provider setup from account authentication', () => {
  for (const state of ['not_connected', 'available_not_authenticated', 'probe_failed', 'demo', 'not_configured']) {
    const result = agentReadiness(agent, { provider: 'codex', state });
    assert.equal(result.canStartLive, false, state);
    assert.equal(result.canSimulate, true, state);
  }
  const ready = agentReadiness(agent, { provider: 'codex', state: 'connected', metadata: { liveAccountChecked: true } });
  assert.equal(ready.state, 'ready');
  assert.equal(ready.canStartLive, true);
  assert.match(ready.description, /General chat needs no folder; project-file work requires one/);
  assert.equal(agentReadiness(agent, { provider: 'claude', state: 'connected' }).canStartLive, false);
  assert.equal(agentReadiness(agent, { provider: 'codex', state: 'connected', mode: 'demo' }).canStartLive, false);
  assert.equal(agentReadiness(agent, { provider: 'codex', state: 'connected', metadata: { liveAccountChecked: false } }).canStartLive, false);
  assert.equal(agentReadiness(agent, { provider: 'codex', state: 'connecting' }).state, 'connecting');
  assert.equal(agentReadiness(agent, { provider: 'codex', state: 'not_installed' }).state, 'not_installed');
});

test('paused, archived, and unsupported agents cannot launch either type of session', () => {
  for (const record of [{ ...agent, status: 'paused' }, { ...agent, archived_at: '2026-09-18' }, { ...agent, provider: 'custom' }]) {
    const result = agentReadiness(record, { provider: record.provider, state: 'connected' });
    assert.equal(result.canStartLive, false);
    assert.equal(result.canSimulate, false);
  }
  assert.match(agentReadiness({ ...agent, status: 'paused' }).description, /already running are not stopped/);
  assert.deepEqual(AGENT_PROVIDERS.claude.capabilities, ['Read and search']);
});

test('Your Agents sidebar excludes personal Talvori and shows connected working profiles', () => {
  const connected = { id: 'conn_codex', provider: 'codex', state: 'connected', metadata: { liveAccountChecked: true } };
  assert.equal(agentVisibleInSidebar({ ...agent, provider_connection_id: connected.id }, [connected]), true);
  assert.equal(agentVisibleInSidebar({ ...agent, provider_connection_id: connected.id }, []), false);
  assert.equal(agentVisibleInSidebar({ ...agent, status: 'paused', provider_connection_id: connected.id }, [connected]), false);
  assert.equal(agentVisibleInSidebar({ ...agent, id: 'rumbo_agent_a', personal_agent: true, provider_connection_id: connected.id }, [connected]), false);
  assert.equal(agentVisibleInSidebar({ ...agent, name: 'Talvori', provider_connection_id: connected.id }, [connected]), true, 'A user-chosen name is not personal-agent identity');
  assert.equal(agentVisibleInSidebar({ ...agent, id: 'rumbo_agent_a', archived_at: 'now' }, [connected]), false);
});

test('browser AI readiness follows this actor’s workspace account state', () => {
  const apiAgent = { ...agent, provider: 'openrouter', provider_connection_id: 'conn_openrouter' };
  const connection = { id: 'conn_openrouter', provider: 'openrouter', mode: 'browser-api', state: 'not_connected', metadata: { liveAccountChecked: false }, workspace_states: { ws_a: 'connected', ws_b: 'not_connected' } };
  assert.equal(agentReadiness(apiAgent, connection).canStartLive, true);
  assert.equal(agentReadiness({ ...apiAgent, workspace_id: 'ws_b' }, connection).canStartLive, false);
  assert.equal(agentReadiness({ ...apiAgent, workspace_id: 'ws_other' }, connection).canStartLive, false);
});

test('run attribution survives agent renames and never guesses from a duplicate name', () => {
  const runs = [
    { id: 'own', agent_id: agent.id, workspace_id: 'ws_a', agent_name: 'Old name', updated_at: '2026-09-18' },
    { id: 'duplicate', agent_id: 'different_agent', workspace_id: 'ws_a', agent_name: agent.name },
    { id: 'legacy', workspace_id: 'ws_a', agent_name: agent.name, provider: 'codex' },
    { id: 'other_workspace', agent_id: agent.id, workspace_id: 'ws_b' },
  ];
  assert.deepEqual(runsForAgent({ ...agent, name: 'Renamed' }, runs).map((run) => run.id), ['own']);
  assert.equal(runs.length, 4, 'Derivation must not mutate store data');
});

test('agent summary separates simulation from live work and derives linked context by identity', () => {
  const data = {
    connections: [{ provider: 'codex', state: 'not_connected' }],
    runs: [
      { id: 'live', agent_id: agent.id, workspace_id: 'ws_a', mode: 'live', status: 'running', updated_at: '2026-09-18' },
      { id: 'simulation', agent_id: agent.id, workspace_id: 'ws_a', mode: 'mock', status: 'needs_input', project_id: 'p2', updated_at: '2026-09-17' },
      { id: 'finished', agent_id: agent.id, workspace_id: 'ws_a', mode: 'live', status: 'completed', updated_at: '2026-09-16' },
    ],
    tasks: [{ id: 't1', workspace_id: 'ws_a', project_id: 'p1', assignee_agent_ids: [agent.id] }, { id: 't2', workspace_id: 'ws_b', assignee_agent_ids: [agent.id] }],
    chats: [{ id: 'c1', workspace_id: 'ws_a', project_id: 'p1', participant_agent_ids: [agent.id] }, { id: 'c2', workspace_id: 'ws_a', archived_at: '2026-09-18', participant_agent_ids: [agent.id] }],
    projects: [{ id: 'p1', workspace_id: 'ws_a' }, { id: 'p2', workspace_id: 'ws_a' }],
  };
  const result = summarizeAgent(agent, data);
  assert.equal(result.runs.length, 3);
  assert.equal(result.activeRuns.length, 2);
  assert.equal(result.liveRuns.length, 1);
  assert.equal(result.latestRun.id, 'live');
  assert.deepEqual(result.projects.map((item) => item.id), ['p1', 'p2']);
  assert.deepEqual(result.assignedTasks.map((item) => item.id), ['t1']);
  assert.deepEqual(result.chats.map((item) => item.id), ['c1']);
});

async function withApi(callback, { integrationOptions = {} } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'rumbo-agent-test-'));
  let calls = 0;
  const api = createLocalApi({ dataDir, integrationOptions: {
    env: {},
    execute: async () => { calls += 1; throw new Error('Real account commands are forbidden in this test'); },
    spawnProcess: () => { calls += 1; throw new Error('Real agent processes are forbidden in this test'); },
    fetchImpl: () => { calls += 1; throw new Error('External requests are forbidden in this test'); },
    ...integrationOptions,
  } });
  const server = createServer((req, res) => api.middleware(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function call(path, body, method = body === undefined ? 'GET' : 'POST', expected = 200) {
    const response = await fetch(`${origin}/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  }
  try {
    const workspace = (await call('/workspaces', { name: 'Agent test workspace' }, 'POST', 201)).workspace;
    await callback({ api, call, workspace, dataDir });
    assert.equal(calls, 0, 'No non-injected provider operation was invoked');
  } finally {
    api.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
}

test('session creation stores selected agent identity and display name through rename and reload', async () => {
  await withApi(async ({ api, call, workspace, dataDir }) => {
    const input = { workspace_id: workspace.id, name: 'Same name', provider: 'codex', description: 'Careful code review', instructions: 'Cite files.' };
    const first = (await call('/agents', input, 'POST', 201)).agent;
    const second = (await call('/agents', input, 'POST', 201)).agent;
    const { run } = await call('/runs', { workspace_id: workspace.id, agent_id: first.id, mode: 'mock', scenario: 'manual' }, 'POST', 201);
    assert.equal(run.agent_id, first.id);
    assert.equal(run.agent_name, 'Same name');
    const renamed = (await call(`/agents/${first.id}`, { name: 'Renamed agent' }, 'PATCH')).agent;
    assert.equal(runsForAgent(renamed, api.snapshot().runs).length, 1);
    assert.equal(runsForAgent(second, api.snapshot().runs).length, 0);
    await call(`/runs/${run.id}/stop`, {});
    const reopened = createLocalApi({ dataDir });
    try { assert.equal(reopened.snapshot().runs.find((item) => item.id === run.id).agent_id, first.id); }
    finally { reopened.close(); }
  });
});

test('pausing blocks new work without stopping current work; active agents cannot be archived or retargeted', async () => {
  await withApi(async ({ api, call, workspace }) => {
    const agent = (await call('/agents', { workspace_id: workspace.id, name: 'Working agent', provider: 'codex' }, 'POST', 201)).agent;
    const payload = { workspace_id: workspace.id, agent_id: agent.id, mode: 'mock', scenario: 'manual' };
    const { run } = await call('/runs', payload, 'POST', 201);
    await call(`/agents/${agent.id}`, { archived_at: new Date().toISOString() }, 'PATCH', 409);
    await call(`/agents/${agent.id}`, undefined, 'DELETE', 409);
    await call(`/agents/${agent.id}`, { provider: 'claude' }, 'PATCH', 409);
    await call(`/agents/${agent.id}`, { status: 'paused' }, 'PATCH');
    assert.equal(api.snapshot().runs.find((item) => item.id === run.id).status, 'running');
    await call('/runs', payload, 'POST', 400);
    await call(`/runs/${run.id}/stop`, {});
    await call(`/agents/${agent.id}`, { status: 'available' }, 'PATCH');
    await call(`/agents/${agent.id}`, { archived_at: new Date().toISOString() }, 'PATCH');
    await call('/runs', payload, 'POST', 400);
  });
});

test('agent launch rejects cross-workspace profiles, mismatched providers and disconnected real work', async () => {
  await withApi(async ({ call, workspace }) => {
    const other = (await call('/workspaces', { name: 'Other workspace' }, 'POST', 201)).workspace;
    const agent = (await call('/agents', { workspace_id: workspace.id, name: 'Private agent', provider: 'codex' }, 'POST', 201)).agent;
    await call(`/agents/${agent.id}`, { workspace_id: other.id }, 'PATCH', 400);
    await call('/runs', { workspace_id: other.id, agent_id: agent.id, mode: 'mock' }, 'POST', 400);
    await call('/runs', { workspace_id: workspace.id, agent_id: agent.id, provider: 'claude', mode: 'mock' }, 'POST', 400);
    await call('/runs', { workspace_id: workspace.id, agent_id: agent.id, mode: 'live', prompt: 'Do not run.' }, 'POST', 409);
  });
});

test('live session stores stable agent identity using only injected providers', async () => {
  let received = '';
  await withApi(async ({ api, call, workspace, dataDir }) => {
    const agent = (await call('/agents', { workspace_id: workspace.id, name: 'Live test agent', provider: 'codex', working_directory: dataDir, instructions: 'Read carefully.' }, 'POST', 201)).agent;
    await call('/connections/codex/connect', { method: 'existing' });
    const { run } = await call('/runs', { workspace_id: workspace.id, agent_id: agent.id, mode: 'live', prompt: 'Explain the test fixture.' }, 'POST', 201);
    assert.equal(run.agent_id, agent.id);
    assert.equal(run.agent_name, agent.name);
    assert.match(received, /Read carefully/);
    assert.equal(api.snapshot().runs.find((item) => item.id === run.id).status, 'completed');
  }, { integrationOptions: {
    execute: async (_command, args) => ({ stdout: args.includes('mcp') ? '[]' : 'Logged in', stderr: '', code: 0 }),
    spawnProcess: () => {
      const child = new EventEmitter();
      child.stdin = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
      child.stdin.end = (prompt) => { received = prompt; queueMicrotask(() => child.emit('close', 0)); };
      return child;
    },
  } });
});

test('existing databases gain nullable agent IDs without attributing historical runs by name', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'rumbo-agent-migration-'));
  let api;
  try {
    const db = new DatabaseSync(join(dataDir, 'talvori.sqlite'));
    db.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
    const stamp = '2026-09-18T00:00:00.000Z';
    db.prepare('INSERT INTO workspaces (id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)').run('legacy_ws', 'Legacy', 'legacy', stamp, stamp);
    db.prepare('INSERT INTO agents (id,name,provider,workspace_id,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('legacy_agent', 'Reviewer', 'codex', 'legacy_ws', stamp, stamp);
    db.prepare('INSERT INTO runs (id,workspace_id,provider,agent_name,status,title,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('legacy_run', 'legacy_ws', 'codex', 'Reviewer', 'completed', 'Old session', stamp, stamp);
    db.close();
    api = createLocalApi({ dataDir });
    const snapshot = api.snapshot();
    assert.equal(snapshot.runs.find((item) => item.id === 'legacy_run').agent_id, null);
    assert.equal(runsForAgent(snapshot.agents.find((item) => item.id === 'legacy_agent'), snapshot.runs).length, 0);
  } finally {
    api?.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

async function sessionContext(call, workspace) {
  const project = (await call('/projects', { workspace_id: workspace.id, name: 'Linked project', goal: 'Preserve the complete project context.' }, 'POST', 201)).project;
  const task = (await call('/tasks', { workspace_id: workspace.id, project_id: project.id, title: 'Linked route' }, 'POST', 201)).task;
  const chat = (await call('/chats', { workspace_id: workspace.id, project_id: project.id, task_id: task.id, title: 'Linked chat' }, 'POST', 201)).chat;
  return { project, task, chat };
}

test('session context derives route, project and workspace when callers omit parent IDs', async () => {
  await withApi(async ({ call, workspace }) => {
    const { project, task, chat } = await sessionContext(call, workspace);
    for (const input of [{ task_id: task.id }, { chat_id: chat.id }, { chatId: chat.id }]) {
      const { run } = await call('/runs', { ...input, mode: 'mock', scenario: 'manual' }, 'POST', 201);
      assert.equal(run.workspace_id, workspace.id);
      assert.equal(run.project_id, project.id);
      assert.equal(run.task_id, task.id);
      assert.equal(run.title, task.title);
      await call(`/runs/${run.id}/stop`, {});
    }
    const projectChat = (await call('/chats', { workspace_id: workspace.id, project_id: project.id, title: 'Project conversation' }, 'POST', 201)).chat;
    const { run } = await call('/runs', { chat_id: projectChat.id, mode: 'mock', scenario: 'manual' }, 'POST', 201);
    assert.equal(run.project_id, project.id);
    assert.equal(run.task_id, null);
  });
});

test('explicit null, conflicting aliases and conflicting context cannot bypass linked parents', async () => {
  await withApi(async ({ api, call, workspace }) => {
    const { project, task, chat } = await sessionContext(call, workspace);
    const otherProject = (await call('/projects', { workspace_id: workspace.id, name: 'Other project' }, 'POST', 201)).project;
    const otherTask = (await call('/tasks', { workspace_id: workspace.id, project_id: project.id, title: 'Other route' }, 'POST', 201)).task;
    for (const overrides of [
      { task_id: null }, { task_id: '' }, { task_id: otherTask.id },
      { project_id: null }, { projectId: null }, { project_id: otherProject.id },
      { workspace_id: null }, { task_id: task.id, taskId: otherTask.id },
      { project_id: project.id, projectId: null },
    ]) {
      await call('/runs', { workspace_id: workspace.id, chat_id: chat.id, mode: 'mock', ...overrides }, 'POST', 400);
    }
    await call(`/tasks/${task.id}/runs`, { task_id: otherTask.id, mode: 'mock' }, 'POST', 400);
    await call(`/tasks/${task.id}/runs`, { task_id: null, mode: 'mock' }, 'POST', 400);
    await call(`/tasks/${otherTask.id}/runs`, { chat_id: chat.id, mode: 'mock' }, 'POST', 400);
    assert.equal(api.snapshot().runs.length, 0, 'Invalid context must not create any sessions');
  });
});

test('derived session context still enforces workspace isolation and archive state', async () => {
  await withApi(async ({ call, workspace }) => {
    const { task, chat } = await sessionContext(call, workspace);
    const other = (await call('/workspaces', { name: 'Isolated workspace' }, 'POST', 201)).workspace;
    await call('/runs', { workspace_id: other.id, chat_id: chat.id, mode: 'mock' }, 'POST', 400);
    await call(`/tasks/${task.id}`, { archived_at: new Date().toISOString() }, 'PATCH');
    await call('/runs', { chat_id: chat.id, mode: 'mock' }, 'POST', 400);
  });
});

test('an unlinked chat can participate in explicit project and route context', async () => {
  await withApi(async ({ call, workspace }) => {
    const { project, task } = await sessionContext(call, workspace);
    const chat = (await call('/chats', { workspace_id: workspace.id, title: 'General chat' }, 'POST', 201)).chat;
    const { run } = await call('/runs', { chat_id: chat.id, task_id: task.id, mode: 'mock', scenario: 'manual' }, 'POST', 201);
    assert.equal(run.project_id, project.id);
    assert.equal(run.task_id, task.id);
    assert.equal(run.chat_id, chat.id);
  });
});

test('live derived context uses project folder and rejects arbitrary working-folder overrides', async () => {
  const launches = [];
  await withApi(async ({ api, call, workspace, dataDir }) => {
    const { project, task, chat } = await sessionContext(call, workspace);
    const projectPath = join(dataDir, 'project');
    const otherPath = join(dataDir, 'other');
    const aliasPath = join(dataDir, 'project-alias');
    await mkdir(projectPath); await mkdir(otherPath); await symlink(projectPath, aliasPath);
    await call(`/projects/${project.id}`, { local_path: projectPath }, 'PATCH');
    const agent = (await call('/agents', { workspace_id: workspace.id, name: 'Folder test agent', provider: 'codex', working_directory: otherPath }, 'POST', 201)).agent;
    await call('/memory-notes', { workspace_id: workspace.id, project_id: project.id, title: 'Project decision', content: 'Use the project-specific convention.' }, 'POST', 201);
    await call('/connections/codex/connect', { method: 'existing' });
    const input = { agent_id: agent.id, chat_id: chat.id, mode: 'live', prompt: 'Read the context.' };
    await call('/runs', { ...input, cwd: otherPath }, 'POST', 400);
    await call('/runs', { ...input, cwd: 123 }, 'POST', 400);
    assert.equal(api.snapshot().runs.length, 0, 'A folder conflict must fail before creating or launching a session');
    for (const override of [{}, { cwd: `${projectPath}/.` }, { cwd: aliasPath }]) {
      const { run } = await call('/runs', { ...input, ...override }, 'POST', 201);
      assert.equal(run.task_id, task.id);
      assert.equal(run.project_id, project.id);
      const last = launches.at(-1);
      assert.equal(last.cwd, await realpath(projectPath));
      assert.match(last.prompt, /Preserve the complete project context/);
      assert.match(last.prompt, /Use the project-specific convention/);
      assert.match(last.prompt, /Linked route/);
    }
    await call(`/projects/${project.id}`, { local_path: null }, 'PATCH');
    await call('/runs', input, 'POST', 201);
    assert.equal(launches.at(-1).cwd, await realpath(otherPath), 'Agent folder applies only without a linked project folder');
    await call('/runs', { ...input, cwd: projectPath }, 'POST', 201);
    assert.equal(launches.at(-1).cwd, await realpath(projectPath), 'Explicit folder is supported when project has no folder');
  }, { integrationOptions: {
    execute: async (_command, args) => ({ stdout: args.includes('mcp') ? '[]' : 'Logged in', stderr: '', code: 0 }),
    spawnProcess: (_provider, _args, options) => {
      const child = new EventEmitter();
      child.stdin = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
      child.stdin.end = (prompt) => { launches.push({ cwd: options.cwd, prompt }); queueMicrotask(() => child.emit('close', 0)); };
      return child;
    },
  } });
});

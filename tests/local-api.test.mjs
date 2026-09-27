import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createLocalApi } from "../server/local-api.mjs";

let api;
let server;
let baseUrl;
let dataDir;

async function request(path, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  assert.ok(response.ok, `${method} ${path} returned ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function rawRequest(path, options = {}) {
  return fetch(`${baseUrl}${path}`, options);
}

test('team icons and independent colors validate and round-trip through workspace archives', async () => {
  const created = await request('/api/teams', { method: 'POST', body: { workspace_id: 'ws_personal', name: 'Identity QA', icon: 'icon:rocket', color: '#FF0000', icon_color: '#00FF00' } });
  const team = created.team;
  assert.equal(team.icon, 'icon:rocket'); assert.equal(team.color, '#ff0000'); assert.equal(team.icon_color, '#00ff00');
  for (const patch of [{ tab_icon_color: '' }, { empty_icon_color: 'url(x)' }, { tab_label_color: null }, { tab_label_color: 'team' }, { icon: '😀' }, { icon: 'custom:upload' }, { icon: '<svg />' }, { icon_color: 'red' }, { color: 'url(x)' }, { icon_color: null }]) {
    const response = await rawRequest(`/api/teams/${team.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    assert.equal(response.status, 400, JSON.stringify(patch));
  }
  await request(`/api/teams/${team.id}`, { method: 'PATCH', body: { tab_icon_color: 'global', empty_icon_color: '#AA00FF', tab_label_color: 'icon' } });
  const archive = await request('/api/export?workspace_id=ws_personal');
  const imported = await request('/api/import', { method: 'POST', body: archive });
  const copy = imported.bootstrap.teams.find(t => t.workspace_id === imported.result.id && t.name === 'Identity QA');
  assert.equal(copy.icon, team.icon); assert.equal(copy.color, team.color); assert.equal(copy.icon_color, team.icon_color);
  assert.equal(copy.tab_icon_color, 'global'); assert.equal(copy.empty_icon_color, '#aa00ff'); assert.equal(copy.tab_label_color, 'icon');
  const legacy = await request('/api/teams', { method: 'POST', body: { workspace_id: 'ws_personal', name: 'Legacy identity', icon: 'users' } });
  assert.equal(legacy.team.icon_color, '');
  assert.equal(legacy.team.color, ''); assert.equal(legacy.team.tab_icon_color, 'team'); assert.equal(legacy.team.tab_label_color, 'global');
  const reset = await request(`/api/teams/${team.id}`, { method: 'PATCH', body: { icon_color: '', color: '' } });
  assert.equal(reset.team.icon_color, ''); assert.equal(reset.team.color, '');
});

test('an existing database gains icon colors without changing legacy team identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-team-migration-'));
  let local = createLocalApi({ dataDir: directory, seedMode: 'demo' });
  try {
    const path = local.dbPath; local.close();
    const db = new DatabaseSync(path);
    db.exec("ALTER TABLE teams DROP COLUMN icon_color; ALTER TABLE teams DROP COLUMN tab_icon_color; ALTER TABLE teams DROP COLUMN empty_icon_color; ALTER TABLE teams DROP COLUMN tab_label_color; INSERT INTO teams(id,workspace_id,name,icon,color,created_at,updated_at) VALUES('old-team','ws_personal','Original','users','#aabbcc','2026-09-01','2026-09-01'),('gray-team','ws_personal','Untouched','users','#8b95a5','2026-09-01','2026-09-01')");
    db.close();
    local = createLocalApi({ dataDir: directory });
    const team = local.snapshot().teams.find(t => t.id === 'old-team');
    assert.equal(team.icon, 'users'); assert.equal(team.color, '#aabbcc'); assert.equal(team.icon_color, '');
    assert.equal(team.tab_icon_color, 'team');
    assert.equal(local.snapshot().teams.find(t => t.id === 'gray-team').color, '');
    local.close();
    const updated = new DatabaseSync(path); updated.prepare("UPDATE teams SET color='#8b95a5' WHERE id='gray-team'").run(); updated.close();
    local = createLocalApi({ dataDir: directory });
    assert.equal(local.snapshot().teams.find(t => t.id === 'gray-team').color, '#8b95a5', 'deliberately chosen gray survives later starts');
  } finally { local.close(); await rm(directory, { recursive: true, force: true }); }
});

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "rumbo-api-test-"));
  api = createLocalApi({ dataDir, seedMode: "demo" });
  server = createServer((req, res) => api.middleware(req, res, () => {
    res.statusCode = 404;
    res.end();
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  api.close();
  await rm(dataDir, { recursive: true, force: true });
});

test("health and bootstrap expose local-only seeded data", async () => {
  const health = await request("/api/health");
  assert.deepEqual(health, { ok: true, localOnly: true, database: "ready" });

  const bootstrap = await request("/api/bootstrap");
  assert.equal(bootstrap.meta.localOnly, true);
  assert.equal(bootstrap.workspaces[0].name, "Northstar");
  assert.ok(bootstrap.projects.some((project) => project.name === "SourceLens"));
  assert.ok(Array.isArray(bootstrap.events));
});

test('project pictures persist and reject executable or malformed images', async () => {
  const bootstrap = await request('/api/bootstrap');
  const project = bootstrap.projects[0];
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5ioAAAAASUVORK5CYII=';
  await request(`/api/projects/${project.id}`, { method: 'PATCH', body: { image_url: image } });
  assert.equal((await request('/api/bootstrap')).projects.find(p => p.id === project.id).image_url, image);
  const invalid = await rawRequest(`/api/projects/${project.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url: 'javascript:alert(1)' }) });
  assert.equal(invalid.status, 400);
  await request(`/api/projects/${project.id}`, { method: 'PATCH', body: { image_url: null } });
});

test("a default install starts as a clean disconnected user", async () => {
  const cleanDir = await mkdtemp(join(tmpdir(), "rumbo-clean-test-"));
  const cleanApi = createLocalApi({ dataDir: cleanDir });
  try {
    const snapshot = cleanApi.snapshot();
    assert.equal(snapshot.profile.name, "You");
    assert.deepEqual(snapshot.workspaces, []);
    assert.deepEqual(snapshot.projects, []);
    assert.deepEqual(snapshot.tasks, []);
    assert.deepEqual(snapshot.chats, []);
    assert.deepEqual(snapshot.runs, []);
    assert.deepEqual(snapshot.approvals, []);
    assert.equal(snapshot.meta.demoData, false);
    assert.equal(snapshot.connections.length, 4);
    assert.equal(snapshot.connections.every((connection) => connection.state === "not_connected"), true);
  } finally {
    cleanApi.close();
    await rm(cleanDir, { recursive: true, force: true });
  }
});

test("workspace, project, task, chat, and message mutations persist", async () => {
  const workspace = (await request("/api/workspaces", {
    method: "POST",
    body: { name: "QA Workspace", description: "Local smoke data" },
  })).workspace;
  const project = (await request("/api/projects", {
    method: "POST",
    body: { workspace_id: workspace.id, name: "QA Project", identifier: "QA", status: "active" },
  })).project;
  const task = (await request("/api/tasks", {
    method: "POST",
    body: { workspace_id: workspace.id, project_id: project.id, title: "Persistent local task", status: "ready", priority: "medium" },
  })).task;
  const chat = (await request("/api/chats", {
    method: "POST",
    body: { workspace_id: workspace.id, project_id: project.id, task_id: task.id, title: "QA task chat", kind: "task" },
  })).chat;
  const message = (await request(`/api/chats/${chat.id}/messages`, {
    method: "POST",
    body: { content: "Stored locally", sender_type: "user", sender_name: "QA" },
  })).message;

  const snapshot = await request("/api/bootstrap");
  assert.ok(snapshot.workspaces.some((item) => item.id === workspace.id));
  assert.ok(snapshot.projects.some((item) => item.id === project.id));
  assert.ok(snapshot.tasks.some((item) => item.id === task.id));
  assert.equal(snapshot.chats.find((item) => item.id === chat.id).task_id, task.id);
  assert.equal(snapshot.messages.find((item) => item.id === message.id).content, "Stored locally");
});

test("task-linked mock run requests and resolves approval without a provider", async () => {
  const bootstrap = await request("/api/bootstrap");
  const task = bootstrap.tasks.find((item) => item.id === "task_popup");
  const started = await request(`/api/tasks/${task.id}/runs`, {
    method: "POST",
    body: { scenario: "approval", provider: "codex", requiresApproval: true },
  });
  assert.equal(started.demo, true);
  assert.equal(started.run.mode, "mock");
  assert.equal(started.run.task_id, task.id);
  assert.equal(started.run.status, "needs_input");

  const detail = await request(`/api/runs/${started.run.id}`);
  const approval = detail.approvals.find((item) => item.status === "pending");
  assert.ok(approval);

  const resolved = await request(`/api/runs/${started.run.id}/approvals/${approval.id}`, {
    method: "POST",
    body: { decision: "approve" },
  });
  assert.equal(resolved.approval.status, "approved");
  assert.equal(resolved.run.status, "running");

  const events = await request("/api/events");
  assert.ok(events.events.some((event) => event.run_id === started.run.id && event.type === "approval.resolved"));
  assert.equal(events.bootstrap.meta.localOnly, true);
});

test("AI provider probes are account-safe while external probes are paused", async () => {
  for (const provider of ["github", "google-drive"]) {
    const response = await rawRequest(`/api/connections/${provider}/probe`);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'coming_soon');
  }
  for (const provider of ["codex", "claude"]) {
    const payload = await request(`/api/connections/${provider}/probe`);
    assert.equal(payload.safe, true);
    assert.equal(payload.probe.liveAccountChecked, false);
    assert.match(payload.probe.note, /No OAuth request|did not start login/i);
  }
});

test("connection setup descriptors expose requirements without secrets", async () => {
  const payload = await request("/api/connections/setup");
  assert.equal(payload.accountSafe, true);
  assert.equal(payload.setups.length, 4);
  const github = payload.setups.find((item) => item.provider === "github");
  const drive = payload.setups.find((item) => item.provider === "google-drive");
  const codex = payload.setups.find((item) => item.provider === "codex");
  const claude = payload.setups.find((item) => item.provider === "claude");
  assert.equal(github.callbackUrl, null);
  assert.equal(github.authKind, 'cli_or_token');
  assert.match(drive.callbackUrl, /\/api\/auth\/google-drive\/callback$/);
  assert.equal(codex.authKind, "provider_managed");
  assert.equal(claude.authKind, "provider_managed");
  assert.equal(payload.setups.every((item) => item.liveAccountChecked === false), true);
  assert.equal(codex.startAllowed, true);
  assert.equal(JSON.stringify(payload).includes("CLIENT_SECRET="), false);
});

test("local API rejects hostile browser origins", async () => {
  const response = await rawRequest("/api/bootstrap", { headers: { Origin: "https://attacker.example" } });
  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.equal(payload.error.code, "invalid_origin");
});

test("CRUD rejects invalid input and links across workspaces", async () => {
  const workspace = (await request('/api/workspaces', { method: 'POST', body: { name: 'Validation workspace' } })).workspace;
  for (const body of [[], { name: '   ' }, { name: 42 }]) {
    const response = await rawRequest('/api/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 400);
  }
  const invalidLinks = await rawRequest('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: workspace.id, project_id: 'proj_sourcelens', title: 'Invalid workspace link' }) });
  assert.equal(invalidLinks.status, 400);
  const invalidStatus = await rawRequest('/api/tasks/task_popup', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'random' }) });
  assert.equal(invalidStatus.status, 400);
  const blankPatch = await rawRequest(`/api/workspaces/${workspace.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: ' ' }) });
  assert.equal(blankPatch.status, 400);
  assert.ok((await request('/api/workspaces?project_id=ignored')).workspaces.length);
  const missingWorkspace = await rawRequest('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'No workspace' }) });
  assert.equal(missingWorkspace.status, 400);
});

test('automatic slugs and project identifiers allow similar names', async () => {
  const first = (await request('/api/workspaces', { method: 'POST', body: { name: 'Repeated name' } })).workspace;
  const second = (await request('/api/workspaces', { method: 'POST', body: { name: 'Repeated name' } })).workspace;
  assert.notEqual(first.slug, second.slug);
  const project1 = (await request('/api/projects', { method: 'POST', body: { workspace_id: first.id, name: 'Project one' } })).project;
  const project2 = (await request('/api/projects', { method: 'POST', body: { workspace_id: first.id, name: 'Project two' } })).project;
  assert.notEqual(project1.identifier, project2.identifier);
});

test("nested message routes cannot read, edit, or delete another chat's message", async () => {
  for (const method of ['GET', 'PATCH', 'DELETE']) {
    const response = await rawRequest('/api/chats/chat_project/messages/msg_1', { method, ...(method === 'PATCH' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'wrong chat' }) } : {}) });
    assert.equal(response.status, 404);
  }
  assert.equal((await request('/api/messages/msg_1')).message.chat_id, 'chat_popup');
});

test("agents and project memory persist and can be archived and restored", async () => {
  const agent = (await request('/api/agents', { method: 'POST', body: { workspace_id: 'ws_personal', name: 'Reviewer', provider: 'claude', instructions: 'Review changed code.', working_directory: '/tmp' } })).agent;
  const note = (await request('/api/memory-notes', { method: 'POST', body: { workspace_id: 'ws_personal', project_id: 'proj_sourcelens', title: 'Privacy decision', content: 'Store only user-selected page data.' } })).memory_note;
  assert.equal(agent.working_directory, '/tmp');
  assert.equal((await request('/api/bootstrap')).memory_notes.find((item) => item.id === note.id).content, note.content);
  const stamp = new Date().toISOString();
  await request(`/api/memory-notes/${note.id}`, { method: 'PATCH', body: { archived_at: stamp } });
  assert.ok((await request('/api/memory-notes?archived=true')).memory_notes.some((item) => item.id === note.id));
  assert.ok(!(await request('/api/memory-notes?archived=false')).memory_notes.some((item) => item.id === note.id));
  await request(`/api/memory-notes/${note.id}`, { method: 'PATCH', body: { archived_at: null } });
  assert.equal((await request(`/api/memory-notes/${note.id}`)).memory_note.archived_at, null);
});

test("settings updates merge section fields and reject invalid values atomically", async () => {
  const before = (await request('/api/settings')).settings;
  const changed = (await request('/api/settings', { method: 'PATCH', body: { appearance: { reduceMotion: true }, inbox: { readIds: ['evt_demo_1'] } } })).settings;
  assert.equal(changed.appearance.theme, before.appearance.theme);
  assert.equal(changed.appearance.density, before.appearance.density);
  assert.equal(changed.appearance.reduceMotion, true);
  assert.deepEqual(changed.inbox.readIds, ['evt_demo_1']);
  const response = await rawRequest('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appearance: { theme: 'invalid' }, agentDefaults: { concurrentRuns: 99 } }) });
  assert.equal(response.status, 400);
  assert.deepEqual((await request('/api/settings')).settings, changed);
});

test("stopping a waiting run cancels approvals and cannot restart a stopped run", async () => {
  const { run } = await request('/api/tasks/task_popup/runs', { method: 'POST', body: { scenario: 'approval', provider: 'codex' } });
  await request(`/api/runs/${run.id}/stop`, { method: 'POST' });
  const detail = await request(`/api/runs/${run.id}`);
  assert.equal(detail.run.status, 'stopped');
  assert.equal(detail.run.requires_approval, false);
  assert.ok(detail.approvals.every((item) => item.status === 'cancelled'));
  const approval = await rawRequest(`/api/runs/${run.id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'approve' }) });
  assert.equal(approval.status, 409);
  const repeated = await request(`/api/runs/${run.id}/stop`, { method: 'POST' });
  assert.equal(repeated.run.status, 'stopped');
  assert.equal((await request(`/api/runs/${run.id}`)).events.filter((event) => event.type === 'run.stopped').length, 1);
});

test("exports are scoped to a workspace and chat markdown includes saved messages", async () => {
  const exported = await request('/api/export?workspace_id=ws_personal');
  assert.equal(exported.format, 'rumbo.workspace');
  assert.equal(exported.data.workspaces.length, 1);
  assert.ok(exported.data.projects.every((item) => item.workspace_id === 'ws_personal'));
  assert.ok(exported.data.chats.every((item) => item.workspace_id === 'ws_personal'));
  assert.ok(exported.data.connections.every((item) => !('metadata' in item)));
  const chat = await request('/api/chats/chat_popup/export');
  assert.equal(chat.filename, 'popup-implementation.md');
  assert.match(chat.markdown, /# Popup implementation/);
  assert.match(chat.markdown, /Build the popup UI/);
});

test("same-machine cross-origin pages cannot mutate local data", async () => {
  const response = await rawRequest('/api/settings', { method: 'PATCH', headers: { Origin: 'http://127.0.0.1:1234', 'Content-Type': 'application/json' }, body: JSON.stringify({ appearance: { theme: 'light' } }) });
  assert.equal(response.status, 403);
  const crossSite = await rawRequest('/api/bootstrap', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(crossSite.status, 403);
  const insecureOrigin = await rawRequest('/api/bootstrap', { headers: { Origin: baseUrl.replace('http:', 'https:') } });
  assert.equal(insecureOrigin.status, 403);
  const formPost = await rawRequest('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ appearance: { theme: 'light' } }) });
  assert.equal(formPost.status, 415);
});

test('profile uploads accept bounded raster avatars and reject disguised or oversized files', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII=';
  const profile = (await request('/api/profile', { method: 'PATCH', body: { avatar_url: png } })).profile;
  assert.equal(profile.avatar_url, png);
  const badValues = ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:image/png;base64,PHN2Zz48L3N2Zz4=', `data:image/png;base64,${Buffer.alloc(250_001).toString('base64')}`, 'javascript:alert(1)'];
  for (const value of badValues) {
    const response = await rawRequest('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar_url: value }) });
    assert.equal(response.status, 400);
  }
  assert.equal((await request('/api/profile')).profile.avatar_url, png);
  await request('/api/profile', { method: 'PATCH', body: { avatar_url: null } });
});

test('active session context cannot be hidden by archiving or deleting its entities', async () => {
  const workspace = (await request('/api/workspaces', { method: 'POST', body: { name: 'Active context' } })).workspace;
  const project = (await request('/api/projects', { method: 'POST', body: { workspace_id: workspace.id, name: 'Context project' } })).project;
  const task = (await request('/api/tasks', { method: 'POST', body: { workspace_id: workspace.id, project_id: project.id, title: 'Active route' } })).task;
  const chat = (await request('/api/chats', { method: 'POST', body: { workspace_id: workspace.id, project_id: project.id, task_id: task.id, title: 'Active chat' } })).chat;
  const { run } = await request('/api/runs', { method: 'POST', body: { workspace_id: workspace.id, project_id: project.id, task_id: task.id, chat_id: chat.id, scenario: 'approval', mode: 'mock' } });
  for (const [resource, entity] of [['workspaces', workspace], ['projects', project], ['tasks', task], ['chats', chat]]) {
    for (const method of ['PATCH', 'DELETE']) {
      const response = await rawRequest(`/api/${resource}/${entity.id}`, { method, ...(method === 'PATCH' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived_at: new Date().toISOString() }) } : {}) });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error.code, 'active_sessions');
    }
  }
  await request(`/api/runs/${run.id}/stop`, { method: 'POST' });
  await request(`/api/projects/${project.id}`, { method: 'PATCH', body: { archived_at: new Date().toISOString() } });
  await request(`/api/workspaces/${workspace.id}`, { method: 'DELETE' });
  assert.ok(!(await request('/api/bootstrap')).runs.some((item) => item.id === run.id));
});

test("database reopen preserves records and settings", async () => {
  const reopened = createLocalApi({ dataDir });
  try {
    const data = reopened.snapshot();
    assert.ok(data.agents.some((item) => item.name === 'Reviewer'));
    assert.ok(data.memory_notes.some((item) => item.title === 'Privacy decision'));
    assert.equal(data.settings.appearance.reduceMotion, true);
    assert.deepEqual(data.settings.inbox.readIds, ['evt_demo_1']);
  } finally { reopened.close(); }
});

test('live session pipeline uses injected providers, includes context, and saves replies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-live-pipeline-'));
  const commands = [];
  let receivedPrompt = '';
  let receivedCwd = '';
  const local = createLocalApi({ dataDir: directory, integrationOptions: {
    env: {},
    execute: async (command, args) => { commands.push([command, args]); return { stdout: args.includes('mcp') ? '[]' : 'Logged in', stderr: '', code: 0 }; },
    spawnProcess: (command, args, options) => {
      commands.push([command, args]);
      receivedCwd = options.cwd;
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
      child.kill = () => {};
      child.stdin.end = (prompt) => {
        receivedPrompt = prompt;
        queueMicrotask(() => {
          child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'The saved project context is available.' } }) + '\n'));
          child.emit('close', 0);
        });
      };
      return child;
    },
    fetchImpl: () => { throw new Error('This test must not make provider network requests.'); },
  } });
  const localServer = createServer((req, res) => local.middleware(req, res));
  await new Promise((resolve) => localServer.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${localServer.address().port}`;
  const call = async (path, body) => {
    const response = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json(); assert.equal(response.ok, true, JSON.stringify(payload)); return payload;
  };
  try {
    assert.deepEqual(commands, [], 'Starting the app must not inspect live accounts');
    const workspace = (await call('/api/workspaces', { name: 'Isolated session' })).workspace;
    const project = (await call('/api/projects', { workspace_id: workspace.id, name: 'Test project', local_path: directory, goal: 'Keep data local.' })).project;
    const chat = (await call('/api/chats', { workspace_id: workspace.id, project_id: project.id, title: 'Agent conversation' })).chat;
    const agent = (await call('/api/agents', { workspace_id: workspace.id, provider: 'codex', name: 'Project helper', working_directory: tmpdir(), instructions: 'Use evidence.' })).agent;
    await call(`/api/chats/${chat.id}/messages`, { content: 'Remember the chat decisions.', attachments: [{ name: 'notes.txt', type: 'text/plain', content: 'Attached text evidence.' }, { name: 'photo.png', type: 'image/png', content: 'data:image/png;base64,DO_NOT_SEND' }] });
    await call('/api/memory-notes', { workspace_id: workspace.id, project_id: project.id, title: 'Decision', content: 'Use the smallest permissions.' });
    await call('/api/connections/codex/connect', { method: 'existing' });
    const result = await call('/api/runs', { workspace_id: workspace.id, project_id: project.id, chat_id: chat.id, agent_id: agent.id, mode: 'live', prompt: 'Summarize the context.', permissionMode: 'read-only' });
    assert.equal(result.demo, false);
    assert.equal(result.run.mode, 'live');
    assert.match(receivedPrompt, /Use the smallest permissions/);
    assert.match(receivedPrompt, /Summarize the context/);
    assert.match(receivedPrompt, /Keep data local/);
    assert.match(receivedPrompt, /Attached text evidence/);
    assert.match(receivedPrompt, /Remember the chat decisions/);
    assert.equal(receivedPrompt.includes('DO_NOT_SEND'), false);
    assert.ok(receivedCwd.endsWith(directory), 'Project folder takes precedence over agent folder');
    const data = await call('/api/bootstrap');
    assert.equal(data.runs.find((item) => item.id === result.run.id).status, 'completed');
    assert.ok(data.messages.some((item) => item.chat_id === chat.id && item.sender_type === 'agent' && item.content.includes('saved project context')));
    assert.ok(data.events.some((item) => item.run_id === result.run.id && item.type === 'run.completed'));
    await call('/api/runs', { workspace_id: workspace.id, project_id: project.id, chat_id: chat.id, agent_id: agent.id, mode: 'live', prompt: 'Only this instruction.', permissionMode: 'read-only', include_memory: false, include_chat: false });
    assert.equal(receivedPrompt.includes('Use the smallest permissions'), false);
    assert.equal(receivedPrompt.includes('Remember the chat decisions'), false);
    assert.equal(receivedPrompt.includes('Attached text evidence'), false);
    assert.match(receivedPrompt, /Use evidence/);
    assert.equal(commands.length, 5);
  } finally {
    local.close();
    await new Promise((resolve) => localServer.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('stopping during provider startup prevents spawning and keeps exported credentials private', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-cancel-pipeline-'));
  let releasePreflight;
  let preflightBegan;
  const preflightStarted = new Promise((resolve) => { preflightBegan = resolve; });
  const preflightResult = new Promise((resolve) => { releasePreflight = resolve; });
  let spawns = 0;
  const token = 'github_pat_only_a_local_test_fixture';
  const local = createLocalApi({ dataDir: directory, integrationOptions: {
    externalConnectionsPaused: false,
    env: { RUMBO_GOOGLE_CLIENT_SECRET: 'private-google-test-fixture' },
    execute: async (_command, args) => {
      if (args.includes('mcp')) { preflightBegan(); await preflightResult; return { code: 0, stdout: '[]', stderr: '' }; }
      return { code: 0, stdout: 'Logged in', stderr: '' };
    },
    spawnProcess: () => { spawns += 1; throw new Error('Cancelled sessions must not launch a process.'); },
    fetchImpl: async (url) => {
      assert.equal(url, 'https://api.github.com/user');
      return { ok: true, json: async () => ({ login: 'test-fixture' }) };
    },
  } });
  const localServer = createServer((req, res) => local.middleware(req, res));
  await new Promise((resolve) => localServer.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${localServer.address().port}`;
  const raw = (path, body, method) => fetch(origin + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const call = async (path, body, method) => { const response = await raw(path, body, method); const payload = await response.json(); assert.equal(response.ok, true, JSON.stringify(payload)); return payload; };
  try {
    const workspace = (await call('/api/workspaces', { name: 'Cancellation workspace' })).workspace;
    await call('/api/settings', { agentDefaults: { concurrentRuns: 1 } }, 'PATCH');
    await call('/api/connections/codex/connect', { method: 'existing' });
    await call('/api/connections/github/connect', { method: 'token', token });
    const exportJson = JSON.stringify(await call('/api/export'));
    const snapshotJson = JSON.stringify(await call('/api/bootstrap'));
    assert.equal(exportJson.includes(token), false);
    assert.equal(snapshotJson.includes(token), false);
    assert.equal(exportJson.includes('private-google-test-fixture'), false);
    const body = { workspace_id: workspace.id, mode: 'live', provider: 'codex', prompt: 'Wait for cancellation.', cwd: directory };
    const starting = raw('/api/runs', body);
    await preflightStarted;
    const running = (await call('/api/bootstrap')).runs[0];
    assert.equal(running.status, 'running');
    const competing = await raw('/api/runs', body);
    assert.equal(competing.status, 409);
    assert.equal((await competing.json()).error.code, 'concurrency_limit');
    await call(`/api/runs/${running.id}/stop`, {});
    releasePreflight();
    const cancelled = await starting;
    assert.equal(cancelled.status, 409);
    assert.equal((await cancelled.json()).error.code, 'session_cancelled');
    const detail = await call(`/api/runs/${running.id}`);
    assert.equal(detail.run.status, 'stopped');
    assert.equal(detail.events.some((event) => event.type === 'run.failed'), false);
    assert.equal(spawns, 0);
  } finally {
    releasePreflight();
    local.close();
    await new Promise((resolve) => localServer.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
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

test("all provider probes are account-safe", async () => {
  for (const provider of ["github", "google-drive", "codex", "claude"]) {
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
  assert.match(github.callbackUrl, /^http:\/\/127\.0\.0\.1:\d+\/api\/auth\/github\/callback$/);
  assert.match(drive.callbackUrl, /\/api\/auth\/google-drive\/callback$/);
  assert.equal(codex.authKind, "provider_managed");
  assert.equal(claude.authKind, "api_or_cloud");
  assert.equal(payload.setups.every((item) => item.liveAccountChecked === false && item.startAllowed === false), true);
  assert.equal(JSON.stringify(payload).includes("CLIENT_SECRET="), false);
});

test("local API rejects hostile browser origins", async () => {
  const response = await rawRequest("/api/bootstrap", { headers: { Origin: "https://attacker.example" } });
  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.equal(payload.error.code, "invalid_origin");
});

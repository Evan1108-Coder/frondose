import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apiRequest, rumboApi, RumboApiError } from "../src/data/api.js";
import { createRumboStore } from "../src/data/rumboStore.js";
import { createLocalApi } from "../server/local-api.mjs";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const initialData = () => ({
  tasks: [{ id: "task_one", status: "ready", title: "A real task" }],
  projects: [], chats: [], runs: [], events: [], meta: {},
  profile: { name: "User" },
  settings: { notifications: { approvals: true, runFailed: true } },
});
const response = (result, bootstrap) => ({ result, bootstrap, source: "server" });

test("API failures surface the server's nested validation message", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    error: { code: "validation_error", message: "Choose a project from this workspace.", details: ["project_id"] },
  }), { status: 400, headers: { "Content-Type": "application/json" } }));
  await assert.rejects(apiRequest("/api/tasks", { method: "POST", body: {} }), (error) => {
    assert.ok(error instanceof RumboApiError);
    assert.equal(error.message, "Choose a project from this workspace.");
    assert.equal(error.code, "validation_error");
    assert.deepEqual(error.details, ["project_id"]);
    return true;
  });
});

test("a failed real write never falls through to a successful browser demo", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Network unavailable"); });
  await assert.rejects(rumboApi.createWorkspace({ name: "Keep this real" }), { code: "network_error" });
});

test("timed-out writes report uncertainty instead of claiming they were not saved", async (t) => {
  t.mock.method(globalThis, "fetch", async (_, { signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  await assert.rejects(apiRequest("/api/tasks", { method: "POST", body: {}, timeoutMs: 1 }), (error) => {
    assert.equal(error.code, "timeout");
    assert.match(error.message, /Check the current state before retrying/);
    return true;
  });
});

test("a signal cancelled before a request does not send the mutation", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Must not run"); });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(apiRequest("/api/workspaces", { signal: controller.signal }), { name: "AbortError" });
  assert.equal(fetch.mock.callCount(), 0);
});

test("CRUD helpers return the created entity so navigation can use its id", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ project: { id: "project_new", name: "New" } }), {
    status: 201, headers: { "Content-Type": "application/json" },
  }));
  const created = await rumboApi.createProject({ name: "New" });
  assert.equal(created.result.id, "project_new");
  assert.equal(created.source, "server");
});

test("connection helpers use the integration contracts without invoking an account", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, options) => {
    calls.push({ path, method: options.method, body: options.body && JSON.parse(options.body) });
    return new Response(JSON.stringify({ connection: { provider: "github", state: "connected" }, resources: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  });
  await rumboApi.connectConnection("github", { method: "existing" });
  await rumboApi.connectionStatus("github");
  await rumboApi.checkConnection("github");
  await rumboApi.connectionResources("google-drive", { pageToken: "next/page+2" });
  await rumboApi.disconnectConnection("github");
  assert.deepEqual(calls, [
    { path: "/api/connections/github/connect", method: "POST", body: { method: "existing" } },
    { path: "/api/connections/github/status", method: "GET", body: undefined },
    { path: "/api/connections/github/check", method: "POST", body: {} },
    { path: "/api/connections/google-drive/resources?pageToken=next%2Fpage%2B2", method: "GET", body: undefined },
    { path: "/api/connections/github/disconnect", method: "POST", body: {} },
  ]);
});

test("optimistic task updates roll back on a rejected write", async () => {
  const pending = deferred();
  const store = createRumboStore({ bootstrap: async () => response(initialData()), updateTask: () => pending.promise });
  await store.actions.refresh();
  const operation = store.actions.updateTask("task_one", { status: "done" });
  assert.equal(store.getSnapshot().data.tasks[0].status, "done");
  assert.equal(store.getSnapshot().pendingMutations, 1);
  pending.reject(new Error("Cannot update archived project"));
  await assert.rejects(operation, /archived project/);
  assert.equal(store.getSnapshot().data.tasks[0].status, "ready");
  assert.equal(store.getSnapshot().pendingMutations, 0);
  assert.equal(store.getSnapshot().error.message, "Cannot update archived project");
});

test("queued edits preserve the latest optimistic value while earlier writes settle", async () => {
  let persisted = initialData();
  const firstWrite = deferred();
  const calls = [];
  const store = createRumboStore({
    bootstrap: async () => response(structuredClone(persisted)),
    updateTask: async (id, input) => {
      calls.push(input.status);
      if (calls.length === 1) await firstWrite.promise;
      persisted.tasks[0] = { ...persisted.tasks[0], ...input };
      return response(structuredClone(persisted.tasks[0]));
    },
  });
  await store.actions.refresh();
  const first = store.actions.updateTask("task_one", { status: "in_progress" });
  const second = store.actions.updateTask("task_one", { status: "done" });
  await Promise.resolve();
  assert.deepEqual(calls, ["in_progress"]);
  assert.equal(store.getSnapshot().data.tasks[0].status, "done");
  firstWrite.resolve();
  await first;
  assert.equal(store.getSnapshot().data.tasks[0].status, "done");
  await second;
  assert.deepEqual(calls, ["in_progress", "done"]);
  assert.equal(store.getSnapshot().pendingMutations, 0);
});

test("a stale event poll cannot replace a newly saved task", async () => {
  const old = initialData();
  const poll = deferred();
  const saved = { ...old, tasks: [{ ...old.tasks[0], status: "done" }] };
  const store = createRumboStore({
    bootstrap: async () => response(old), events: () => poll.promise,
    updateTask: async () => response(saved.tasks[0], saved),
  });
  await store.actions.refresh();
  const polling = store.actions.refreshEvents();
  await store.actions.updateTask("task_one", { status: "done" });
  poll.resolve(response({ events: [] }, old));
  await polling;
  assert.equal(store.getSnapshot().data.tasks[0].status, "done");
});

test("a delayed poll cannot undo a newer manual refresh from another tab", async () => {
  let canonical = initialData();
  const old = structuredClone(canonical);
  const poll = deferred();
  const store = createRumboStore({
    bootstrap: async () => response(canonical), events: () => poll.promise,
  });
  await store.actions.refresh();
  const polling = store.actions.refreshEvents();
  canonical = { ...canonical, tasks: [{ ...canonical.tasks[0], status: "review" }] };
  await store.actions.refresh({ quiet: true });
  poll.resolve(response({ events: [] }, old));
  await polling;
  assert.equal(store.getSnapshot().data.tasks[0].status, "review");
});

test("a saved write remains successful when its follow-up refresh fails", async () => {
  let reads = 0;
  const saved = { id: "project_new", name: "Saved locally" };
  const store = createRumboStore({
    bootstrap: async () => {
      if (++reads > 1) throw new Error("Server disconnected after saving");
      return response(initialData());
    },
    createProject: async () => response(saved),
  });
  await store.actions.refresh();
  const result = await store.actions.createProject({ name: saved.name });
  assert.equal(result.id, saved.id);
  assert.equal(store.getSnapshot().data.projects[0].id, saved.id);
  assert.equal(store.getSnapshot().error, null);
  assert.match(store.getSnapshot().syncError.message, /disconnected/);
});

test("optimistic settings preserve sibling preferences and recover after failure", async () => {
  const pending = deferred();
  const store = createRumboStore({ bootstrap: async () => response(initialData()), updateSettings: () => pending.promise });
  await store.actions.refresh();
  const operation = store.actions.updateSettings({ notifications: { approvals: false } });
  assert.deepEqual(store.getSnapshot().data.settings.notifications, { approvals: false, runFailed: true });
  pending.reject(new Error("Could not save preference"));
  await assert.rejects(operation);
  assert.deepEqual(store.getSnapshot().data.settings.notifications, { approvals: true, runFailed: true });
});

test("a failed queued edit does not prevent later changes from saving", async () => {
  let calls = 0;
  const saved = initialData();
  saved.tasks[0].status = "done";
  const store = createRumboStore({
    bootstrap: async () => response(initialData()),
    updateTask: async () => {
      if (++calls === 1) throw new Error("First edit rejected");
      return response(saved.tasks[0], saved);
    },
  });
  await store.actions.refresh();
  const first = store.actions.updateTask("task_one", { status: "invalid" });
  const second = store.actions.updateTask("task_one", { status: "done" });
  await assert.rejects(first);
  await second;
  assert.equal(store.getSnapshot().data.tasks[0].status, "done");
  assert.equal(store.getSnapshot().pendingMutations, 0);
  assert.equal(store.getSnapshot().error, null);
});

test("client actions preserve API contracts for workspace, agents, memory, settings, and exports", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "rumbo-client-contract-"));
  const localApi = createLocalApi({ dataDir });
  const server = createServer((request, response) => localApi.middleware(request, response));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const originalFetch = globalThis.fetch;
  const base = `http://127.0.0.1:${server.address().port}`;
  t.mock.method(globalThis, "fetch", (path, options) => originalFetch(`${base}${path}`, options));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    localApi.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const store = createRumboStore(rumboApi);
  await store.actions.refresh();
  assert.ok(Array.isArray(store.getSnapshot().data.agents));
  assert.ok(Array.isArray(store.getSnapshot().data.memory_notes));
  const workspace = await store.actions.createWorkspace({ name: "Contract QA" });
  assert.ok(workspace.id);
  const project = await store.actions.createProject({ workspace_id: workspace.id, name: "Client persistence" });
  const task = await store.actions.createTask({ workspace_id: workspace.id, project_id: project.id, title: "Validate local writes" });
  const chat = await store.actions.createChat({ workspace_id: workspace.id, project_id: project.id, task_id: task.id, title: "QA planning" });
  const message = await store.actions.createMessage(chat.id, { content: "Saved to the local database." });
  assert.equal(store.getSnapshot().data.messages.find((item) => item.id === message.id).content, message.content);

  const agent = await store.actions.createAgent({ workspace_id: workspace.id, name: "Reviewer", provider: "custom", description: "Local configuration only" });
  const note = await store.actions.createMemoryNote({ workspace_id: workspace.id, project_id: project.id, title: "Acceptance criteria", content: "Preserve every saved value." });
  assert.equal(store.getSnapshot().data.agents.find((item) => item.id === agent.id).name, "Reviewer");
  assert.equal(store.getSnapshot().data.memory_notes.find((item) => item.id === note.id).content, note.content);

  const notificationSave = store.actions.updateSettings({ notifications: { approvals: false } });
  const inboxSave = store.actions.updateSettings({ inbox: { readIds: ["event_qa"] } });
  assert.equal(store.getSnapshot().data.settings.notifications.approvals, false);
  assert.deepEqual(store.getSnapshot().data.settings.inbox.readIds, ["event_qa"]);
  await Promise.all([notificationSave, inboxSave]);
  assert.equal(store.getSnapshot().data.settings.notifications.approvals, false);
  assert.deepEqual(store.getSnapshot().data.settings.inbox.readIds, ["event_qa"]);

  await store.actions.updateTask(task.id, { archived_at: new Date().toISOString() });
  assert.ok(store.getSnapshot().data.tasks.find((item) => item.id === task.id).archived_at);
  await store.actions.updateTask(task.id, { archived_at: null, status: "done" });
  assert.equal(store.getSnapshot().data.tasks.find((item) => item.id === task.id).status, "done");
  const exportedWorkspace = (await rumboApi.exportWorkspace(workspace.id)).result;
  assert.equal(exportedWorkspace.format, "rumbo.workspace");
  assert.ok(exportedWorkspace.data.memory_notes.some((item) => item.id === note.id));
  const exportedChat = (await rumboApi.exportChat(chat.id)).result;
  assert.match(exportedChat.markdown, /Saved to the local database/);
  assert.ok(exportedChat.filename.endsWith(".md"));

  const independentChat = await store.actions.createChat({ workspace_id: workspace.id, title: "Workspace discussion" });
  const session = await store.actions.startSession({ workspace_id: workspace.id, chat_id: independentChat.id, title: "Test session", prompt: "Simulated request", mode: "mock", provider: "codex", scenario: "approval" });
  assert.equal(session.run.chat_id, independentChat.id);
  assert.equal(session.run.task_id, null);
  assert.equal(session.demo, true);
  const approval = store.getSnapshot().data.approvals.find((item) => item.run_id === session.run.id);
  const resolved = await store.actions.resolveApproval(session.run.id, approval.id, "deny");
  assert.equal(resolved.approval.status, "denied");
  assert.equal(store.getSnapshot().data.runs.find((item) => item.id === session.run.id).status, "stopped");
});

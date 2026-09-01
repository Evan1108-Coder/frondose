export const DEMO_SCHEMA_VERSION = 1;
export const DEMO_STORAGE_KEY = `rumbo.demo.v${DEMO_SCHEMA_VERSION}`;

const ACTIVE_RUN_STATUSES = new Set(["queued", "starting", "running", "needs_input"]);

const clone = (value) => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const nowIso = () => new Date().toISOString();
const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const inSeconds = (seconds) => new Date(Date.now() + seconds * 1_000).toISOString();

const createId = (prefix) => {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}_${random}`;
};

const defaultSettings = {
  theme: "dark",
  density: "comfortable",
  defaultHome: "inbox",
  reduceMotion: false,
  showAgentEventsInChat: true,
  notifications: {
    approvals: true,
    runCompleted: true,
    runFailed: true,
    mentions: true,
  },
};

export function createDemoState() {
  return {
    meta: {
      schemaVersion: DEMO_SCHEMA_VERSION,
      revision: 1,
      updatedAt: nowIso(),
      lastEventAt: ago(2),
      mode: "demo",
    },
    profile: {
      id: "profile_local",
      name: "Evan Lu",
      email: "Local profile",
      avatarUrl: null,
    },
    settings: clone(defaultSettings),
    workspaces: [
      {
        id: "ws_personal",
        name: "Northstar",
        icon: "N",
        description: "Local projects and AI collaborators.",
        createdAt: ago(1440),
        updatedAt: ago(8),
      },
    ],
    projects: [
      {
        id: "project_sourcelens",
        workspaceId: "ws_personal",
        name: "SourceLens",
        icon: "SL",
        summary: "A browser extension for useful, trustworthy page summaries.",
        status: "in_progress",
        priority: "high",
        progress: 42,
        localPath: null,
        repositoryUrl: null,
        createdAt: ago(1200),
        updatedAt: ago(8),
      },
    ],
    tasks: [
      {
        id: "task_popup",
        workspaceId: "ws_personal",
        projectId: "project_sourcelens",
        chatId: "chat_popup",
        identifier: "SOU-14",
        title: "Build Chrome extension popup UI",
        description: "Implement the popup states using the shared project context.",
        status: "in_progress",
        priority: "high",
        assigneeIds: ["agent_codex"],
        acceptanceCriteria: [
          "Show loading, result, and error states",
          "Keep extension permissions unchanged",
          "Pass the existing test suite",
        ],
        createdAt: ago(190),
        updatedAt: ago(2),
      },
      {
        id: "task_citations",
        workspaceId: "ws_personal",
        projectId: "project_sourcelens",
        chatId: null,
        identifier: "SOU-15",
        title: "Define citation extraction rules",
        description: "Document the MVP extraction behavior and edge cases.",
        status: "ready",
        priority: "medium",
        assigneeIds: [],
        acceptanceCriteria: [],
        createdAt: ago(150),
        updatedAt: ago(80),
      },
    ],
    chats: [
      {
        id: "chat_popup",
        workspaceId: "ws_personal",
        projectId: "project_sourcelens",
        taskId: "task_popup",
        title: "Popup implementation",
        type: "task",
        participantIds: ["profile_local", "agent_codex", "agent_claude"],
        pinned: true,
        createdAt: ago(195),
        updatedAt: ago(2),
      },
      {
        id: "chat_project",
        workspaceId: "ws_personal",
        projectId: "project_sourcelens",
        taskId: null,
        title: "SourceLens project",
        type: "project",
        participantIds: ["profile_local", "agent_codex"],
        pinned: false,
        createdAt: ago(500),
        updatedAt: ago(55),
      },
    ],
    messages: [
      {
        id: "message_1",
        chatId: "chat_popup",
        senderId: "profile_local",
        senderType: "user",
        body: "@codex implement the popup states and keep permissions unchanged.",
        attachments: [],
        createdAt: ago(24),
        updatedAt: ago(24),
      },
      {
        id: "message_2",
        chatId: "chat_popup",
        senderId: "agent_codex",
        senderType: "agent",
        body: "I inspected the popup structure and prepared the component changes. I need approval before running the full test command in this demo.",
        attachments: [],
        createdAt: ago(3),
        updatedAt: ago(3),
      },
    ],
    agents: [
      {
        id: "agent_codex",
        connectionId: "connection_codex",
        name: "Codex",
        provider: "codex",
        status: "needs_input",
        color: "#7d89ff",
        capabilities: ["code", "terminal", "review"],
      },
      {
        id: "agent_claude",
        connectionId: "connection_claude",
        name: "Claude",
        provider: "claude",
        status: "offline",
        color: "#d69a72",
        capabilities: ["code", "analysis", "review"],
      },
    ],
    connections: [
      {
        id: "connection_codex",
        provider: "codex",
        name: "Codex",
        category: "agent",
        status: "available",
        detail: "Detected locally — not connected in demo mode",
        demo: true,
        updatedAt: ago(4),
      },
      {
        id: "connection_claude",
        provider: "claude",
        name: "Claude",
        category: "agent",
        status: "setup_required",
        detail: "Install or sign in when you are ready",
        demo: true,
        updatedAt: ago(4),
      },
      {
        id: "connection_github",
        provider: "github",
        name: "GitHub",
        category: "source_control",
        status: "disconnected",
        detail: "Connect later to choose repositories",
        demo: true,
        updatedAt: ago(4),
      },
      {
        id: "connection_drive",
        provider: "google_drive",
        name: "Google Drive",
        category: "files",
        status: "disconnected",
        detail: "Connect later to choose files and folders",
        demo: true,
        updatedAt: ago(4),
      },
    ],
    runs: [
      {
        id: "run_popup_1",
        workspaceId: "ws_personal",
        projectId: "project_sourcelens",
        taskId: "task_popup",
        chatId: "chat_popup",
        agentId: "agent_codex",
        status: "needs_input",
        title: "Implement popup interface",
        summary: "Prepared UI changes; waiting for permission to run the full test command.",
        currentAction: "Waiting for approval",
        filesChanged: ["src/popup/Popup.jsx", "src/popup/popup.css"],
        startedAt: ago(18),
        completedAt: null,
        nextEventAt: null,
        demoStep: 2,
      },
    ],
    approvals: [
      {
        id: "approval_test_1",
        runId: "run_popup_1",
        type: "command",
        title: "Run the project test suite?",
        detail: "npm test",
        status: "pending",
        requestedAt: ago(3),
        resolvedAt: null,
      },
    ],
    events: [
      {
        id: "event_1",
        runId: "run_popup_1",
        type: "run.started",
        summary: "Codex started work",
        createdAt: ago(18),
      },
      {
        id: "event_2",
        runId: "run_popup_1",
        type: "file.changed",
        summary: "Updated Popup.jsx and popup.css",
        createdAt: ago(7),
      },
      {
        id: "event_3",
        runId: "run_popup_1",
        type: "approval.requested",
        summary: "Approval required to run npm test",
        createdAt: ago(3),
      },
    ],
  };
}

let memoryState;

function getStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function migrateState(value) {
  if (!value || value.meta?.schemaVersion !== DEMO_SCHEMA_VERSION) {
    return createDemoState();
  }

  return {
    ...createDemoState(),
    ...value,
    settings: { ...defaultSettings, ...value.settings },
    meta: { ...value.meta, schemaVersion: DEMO_SCHEMA_VERSION, mode: "demo" },
  };
}

export function loadDemoState() {
  const storage = getStorage();
  if (storage) {
    try {
      return migrateState(JSON.parse(storage.getItem(DEMO_STORAGE_KEY)));
    } catch {
      // A corrupt local demo should recover rather than make the app unusable.
    }
  }

  memoryState ??= createDemoState();
  return clone(memoryState);
}

export function saveDemoState(nextState) {
  const state = {
    ...nextState,
    meta: {
      ...nextState.meta,
      schemaVersion: DEMO_SCHEMA_VERSION,
      revision: (nextState.meta?.revision ?? 0) + 1,
      updatedAt: nowIso(),
      mode: "demo",
    },
  };

  memoryState = clone(state);
  try {
    getStorage()?.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Safari private mode and storage quotas can fail; the in-memory copy still works.
  }
  return clone(state);
}

export function resetDemoState() {
  const next = createDemoState();
  memoryState = clone(next);
  try {
    getStorage()?.removeItem(DEMO_STORAGE_KEY);
  } catch {
    // Best-effort reset.
  }
  return clone(next);
}

function withMeta(state, eventAt = null) {
  return {
    ...state,
    meta: {
      ...state.meta,
      lastEventAt: eventAt ?? state.meta.lastEventAt,
    },
  };
}

function addEvent(state, input) {
  const event = {
    id: createId("event"),
    createdAt: nowIso(),
    ...input,
  };
  return withMeta({ ...state, events: [...state.events, event] }, event.createdAt);
}

function advanceDemoRuns(inputState) {
  let state = clone(inputState);
  const timestamp = Date.now();

  for (const run of state.runs) {
    if (run.status !== "running" || !run.nextEventAt || Date.parse(run.nextEventAt) > timestamp) continue;

    if (run.demoStep === 0) {
      run.demoStep = 1;
      run.currentAction = "Inspecting project context";
      run.nextEventAt = inSeconds(3);
      state = addEvent(state, {
        runId: run.id,
        type: "tool.completed",
        summary: "Read task context and relevant files",
      });
    } else if (run.demoStep === 1) {
      run.demoStep = 2;
      run.currentAction = "Waiting for approval";
      run.status = "needs_input";
      run.nextEventAt = null;
      const approval = {
        id: createId("approval"),
        runId: run.id,
        type: "command",
        title: "Run the project test suite?",
        detail: "npm test",
        status: "pending",
        requestedAt: nowIso(),
        resolvedAt: null,
      };
      state.approvals.push(approval);
      state = addEvent(state, {
        runId: run.id,
        type: "approval.requested",
        summary: approval.title,
      });
    } else {
      run.demoStep = 4;
      run.status = "completed";
      run.currentAction = "Finished";
      run.summary = "Finished the demo run and recorded a reviewable result.";
      run.completedAt = nowIso();
      run.nextEventAt = null;
      const task = state.tasks.find((item) => item.id === run.taskId);
      if (task) {
        task.status = "review";
        task.updatedAt = nowIso();
      }
      state = addEvent(state, {
        runId: run.id,
        type: "run.completed",
        summary: "Run completed and is ready for review",
      });
    }
  }

  return state;
}

function parseRequestPath(path) {
  const url = new URL(path, "http://rumbo.local");
  return {
    pathname: url.pathname.replace(/\/$/, "") || "/",
    searchParams: url.searchParams,
  };
}

function requireEntity(collection, id, label) {
  const entity = collection.find((item) => item.id === id);
  if (!entity) throw new Error(`${label} not found`);
  return entity;
}

function removeById(collection, id) {
  return collection.filter((item) => item.id !== id);
}

function buildEntity(prefix, input) {
  const timestamp = nowIso();
  return {
    id: createId(prefix),
    ...input,
    createdAt: input.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

function removeOrphans(state) {
  const chatIds = new Set(state.chats.map((chat) => chat.id));
  const runIds = new Set(state.runs.map((run) => run.id));
  return {
    ...state,
    messages: state.messages.filter((message) => chatIds.has(message.chatId)),
    approvals: state.approvals.filter((approval) => runIds.has(approval.runId)),
    events: state.events.filter((event) => runIds.has(event.runId)),
  };
}

/**
 * In-memory/localStorage implementation of the same-origin API contract.
 * Mutations return both `result` (the changed entity) and `bootstrap` (the
 * canonical flat client snapshot). A future server may return only `result`;
 * useRumbo will then refresh `/api/bootstrap`.
 */
export async function demoRequest(path, { method = "GET", body } = {}) {
  let state = advanceDemoRuns(loadDemoState());
  const { pathname, searchParams } = parseRequestPath(path);
  const verb = method.toUpperCase();
  let result;

  if (pathname === "/api/bootstrap" && verb === "GET") {
    state = saveDemoState(state);
    return { result: clone(state), bootstrap: clone(state), source: "demo" };
  }

  if (pathname === "/api/events" && verb === "GET") {
    const since = searchParams.get("since");
    const events = since
      ? state.events.filter((event) => Date.parse(event.createdAt) > Date.parse(since))
      : state.events;
    state = saveDemoState(state);
    return {
      result: { events: clone(events), cursor: state.meta.lastEventAt },
      bootstrap: clone(state),
      source: "demo",
    };
  }

  const entityMatch = pathname.match(/^\/api\/(workspaces|projects|tasks|chats|messages)\/([^/]+)$/);
  const collectionMatch = pathname.match(/^\/api\/(workspaces|projects|tasks|chats)$/);

  if (collectionMatch && verb === "POST") {
    const collection = collectionMatch[1];
    const prefix = collection.slice(0, -1);
    result = buildEntity(prefix, body ?? {});
    state[collection].push(result);
  } else if (entityMatch && ["PATCH", "PUT"].includes(verb)) {
    const [, collection, id] = entityMatch;
    const entity = requireEntity(state[collection], id, collection.slice(0, -1));
    Object.assign(entity, body ?? {}, { updatedAt: nowIso() });
    result = entity;
  } else if (entityMatch && verb === "DELETE") {
    const [, collection, id] = entityMatch;
    requireEntity(state[collection], id, collection.slice(0, -1));
    state[collection] = removeById(state[collection], id);
    result = { id, deleted: true };

    if (collection === "workspaces") {
      state.projects = state.projects.filter((item) => item.workspaceId !== id);
      state.tasks = state.tasks.filter((item) => item.workspaceId !== id);
      state.chats = state.chats.filter((item) => item.workspaceId !== id);
      state.runs = state.runs.filter((item) => item.workspaceId !== id);
    } else if (collection === "projects") {
      state.tasks = state.tasks.filter((item) => item.projectId !== id);
      state.chats = state.chats.filter((item) => item.projectId !== id);
      state.runs = state.runs.filter((item) => item.projectId !== id);
    } else if (collection === "tasks") {
      state.runs = state.runs.filter((item) => item.taskId !== id);
      state.chats = state.chats.map((chat) => (chat.taskId === id ? { ...chat, taskId: null } : chat));
    } else if (collection === "chats") {
      state.messages = state.messages.filter((message) => message.chatId !== id);
      state.tasks = state.tasks.map((task) => (task.chatId === id ? { ...task, chatId: null } : task));
    }
  } else {
    const messageCreate = pathname.match(/^\/api\/chats\/([^/]+)\/messages$/);
    const runStart = pathname.match(/^\/api\/tasks\/([^/]+)\/runs$/);
    const runStop = pathname.match(/^\/api\/runs\/([^/]+)\/stop$/);
    const runApproval = pathname.match(/^\/api\/runs\/([^/]+)\/approvals\/([^/]+)$/);
    const connectionUpdate = pathname.match(/^\/api\/connections\/([^/]+)$/);

    if (messageCreate && verb === "POST") {
      const chat = requireEntity(state.chats, messageCreate[1], "chat");
      result = buildEntity("message", { chatId: chat.id, senderType: "user", attachments: [], ...body });
      state.messages.push(result);
      chat.updatedAt = result.createdAt;
    } else if (runStart && verb === "POST") {
      const task = requireEntity(state.tasks, runStart[1], "task");
      result = buildEntity("run", {
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        taskId: task.id,
        chatId: body?.chatId ?? task.chatId,
        agentId: body?.agentId ?? task.assigneeIds?.[0] ?? "agent_codex",
        status: "running",
        title: body?.title ?? task.title,
        summary: "",
        currentAction: "Starting",
        filesChanged: [],
        startedAt: nowIso(),
        completedAt: null,
        nextEventAt: inSeconds(2),
        demoStep: 0,
      });
      state.runs.push(result);
      task.status = "in_progress";
      task.updatedAt = nowIso();
      state = addEvent(state, {
        runId: result.id,
        type: "run.started",
        summary: `${result.agentId === "agent_claude" ? "Claude" : "Codex"} started work`,
      });
    } else if (runStop && verb === "POST") {
      const run = requireEntity(state.runs, runStop[1], "run");
      run.status = "stopped";
      run.currentAction = "Stopped by user";
      run.completedAt = nowIso();
      run.nextEventAt = null;
      state = addEvent(state, {
        runId: run.id,
        type: "run.stopped",
        summary: "Run stopped by user",
      });
      result = run;
    } else if (runApproval && verb === "POST") {
      const run = requireEntity(state.runs, runApproval[1], "run");
      const approval = requireEntity(state.approvals, runApproval[2], "approval");
      const approved = ["approve", "approved"].includes(body?.decision) || body?.approved === true;
      approval.status = approved ? "approved" : "rejected";
      approval.resolvedAt = nowIso();
      run.status = approved ? "running" : "stopped";
      run.currentAction = approved ? "Running approved command" : "Approval rejected";
      run.completedAt = approved ? null : nowIso();
      run.demoStep = approved ? 3 : run.demoStep;
      run.nextEventAt = approved ? inSeconds(4) : null;
      state = addEvent(state, {
        runId: run.id,
        type: "approval.resolved",
        summary: approved ? "Command approved" : "Command rejected",
      });
      result = approval;
    } else if (connectionUpdate && verb === "PATCH") {
      const connection = requireEntity(state.connections, connectionUpdate[1], "connection");
      Object.assign(connection, body ?? {}, { demo: true, updatedAt: nowIso() });
      result = connection;
    } else if (pathname === "/api/profile" && verb === "PATCH") {
      state.profile = { ...state.profile, ...body };
      result = state.profile;
    } else if (pathname === "/api/settings" && verb === "PATCH") {
      state.settings = {
        ...state.settings,
        ...body,
        notifications: {
          ...state.settings.notifications,
          ...(body?.notifications ?? {}),
        },
      };
      result = state.settings;
    } else {
      throw new Error(`Demo API does not implement ${verb} ${pathname}`);
    }
  }

  state = saveDemoState(removeOrphans(state));
  return { result: clone(result), bootstrap: clone(state), source: "demo" };
}

export function hasActiveDemoRuns(state = loadDemoState()) {
  return state.runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status));
}

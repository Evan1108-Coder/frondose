const API_ROOT = "/api";
const DEFAULT_TIMEOUT_MS = 12_000;

export class RumboApiError extends Error {
  constructor(message, { status = 0, code = "request_failed", details, cause } = {}) {
    super(message, { cause });
    this.name = "RumboApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function pathFor(resource, id = "") {
  return `${API_ROOT}/${resource}${id ? `/${encodeURIComponent(id)}` : ""}`;
}

async function parseResponse(response) {
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new RumboApiError("The Rumbo API is not available.", {
      status: response.status,
      code: "api_unavailable",
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new RumboApiError("Rumbo received an unreadable response. Try refreshing.", {
      status: response.status, code: "invalid_response", cause,
    });
  }
  if (!response.ok) {
    const problem = payload?.error ?? payload;
    throw new RumboApiError(problem?.message ?? `Request failed (${response.status})`, {
      status: response.status,
      code: problem?.code,
      details: problem?.details,
    });
  }
  return payload;
}

/**
 * Schema contract: `/api/bootstrap` returns the flat snapshot used by
 * demoFallback (workspaces, projects, tasks, chats, messages, agents,
 * connections, runs, approvals and events). Mutation routes may return either
 * `{ result, bootstrap }` or a bare changed entity; the hook refreshes when a
 * canonical bootstrap is absent.
 */
export async function apiRequest(path, options = {}) {
  const {
    method = "GET",
    body,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    demo = false,
  } = options;
  if (signal?.aborted) throw signal.reason ?? new DOMException("Request cancelled.", "AbortError");
  // A server failure must never turn a real write into a successful demo write.
  // The isolated browser demo is available only through an explicit request.
  if (demo) {
    const { demoRequest } = await import("./demoFallback.js");
    return demoRequest(path, { method, body });
  }
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? { Accept: "application/json" } : {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await parseResponse(response);
    return {
      result: payload && Object.hasOwn(payload, "result") ? payload.result : payload,
      bootstrap: payload?.bootstrap,
      source: "server",
    };
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    if (error instanceof RumboApiError) throw error;
    throw new RumboApiError(timedOut
      ? "The server took too long to respond. Check the current state before retrying."
      : "Rumbo could not reach the server. Your existing workspace has not been changed.", {
      code: timedOut ? "timeout" : "network_error", cause: error,
    });
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

const get = (path, options) => apiRequest(path, options);
const post = (path, body, options) => apiRequest(path, { ...options, method: "POST", body });
const patch = (path, body, options) => apiRequest(path, { ...options, method: "PATCH", body });
const remove = (path, options) => apiRequest(path, { ...options, method: "DELETE" });
const entity = async (request, key) => {
  const response = await request;
  return { ...response, result: response.result?.[key] ?? response.result };
};

export const rumboApi = {
  subRoutes: (id, workspaceId, options) => get(`${API_ROOT}/sub-routes/${encodeURIComponent(id)}?workspace_id=${encodeURIComponent(workspaceId)}`, options),
  mutateSubRoutes: (id, action, input, options) => post(`${API_ROOT}/sub-routes/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, input, options),
  listActivity: ({ workspaceId, targetType, targetId, includeArchived = false }, options) => get(`${API_ROOT}/activity?workspace_id=${encodeURIComponent(workspaceId)}&target_type=${encodeURIComponent(targetType)}&target_id=${encodeURIComponent(targetId)}${includeArchived ? '&include_archived=true' : ''}`, options),
  createActivity: (input, options) => post(`${API_ROOT}/activity`, input, options),
  updateActivity: (id, input, options) => patch(`${API_ROOT}/activity/${encodeURIComponent(id)}`, input, options),
  getActivity: (id, { workspaceId }, options) => get(`${API_ROOT}/activity/${encodeURIComponent(id)}?workspace_id=${encodeURIComponent(workspaceId)}`, options),
  activityHistory: (id, { workspaceId }, options) => get(`${API_ROOT}/activity/${encodeURIComponent(id)}/history?workspace_id=${encodeURIComponent(workspaceId)}`, options),
  reactActivity: (id, input, options) => post(`${API_ROOT}/activity/${encodeURIComponent(id)}/reactions`, input, options),
  archiveActivity: (id, input, options) => apiRequest(`${API_ROOT}/activity/${encodeURIComponent(id)}`, { ...options, method: 'DELETE', body: input }),
  listActivityFeed: ({ workspaceId, publicationState = 'published', targetType, updateType, health, projectId, search, includeArchived = false, cursor, limit = 30 }, options) => {
    const query = new URLSearchParams({ workspace_id: workspaceId, publication_state: publicationState, limit: String(limit) });
    for (const [key, value] of Object.entries({ target_type: targetType, update_type: updateType, health, project_id: projectId, search, cursor })) if (value) query.set(key, value);
    if (includeArchived) query.set('include_archived', 'true');
    return get(`${API_ROOT}/activity/feed?${query}`, options);
  },
  createWorkspaceItem: input => post(pathFor('workspace-items'), input),
  importWorkspace: input => post(`${API_ROOT}/import`, input),
  updateWorkspaceItem: (id, input) => patch(pathFor('workspace-items', id), input),
  workspaceItemAction: (id, input) => post(`${pathFor('workspace-items', id)}/action`, input),
  history: (id, workspaceId) => get(`${pathFor('history', id)}?workspace_id=${encodeURIComponent(workspaceId)}`),
  bootstrap: (options) => get(`${API_ROOT}/bootstrap`, options),
  events: (since, options) => {
    const query = since ? `?since=${encodeURIComponent(since)}` : "";
    return get(`${API_ROOT}/events${query}`, options);
  },

  createWorkspace: (input, options) => entity(post(pathFor("workspaces"), input, options), "workspace"),
  updateWorkspace: (id, input, options) => entity(patch(pathFor("workspaces", id), input, options), "workspace"),
  deleteWorkspace: (id, options) => remove(pathFor("workspaces", id), options),

  createTeam: (input, options) => entity(post(pathFor("teams"), input, options), "team"),
  updateTeam: (id, input, options) => entity(patch(pathFor("teams", id), input, options), "team"),
  deleteTeam: (id, options) => remove(pathFor("teams", id), options),
  createTeamMember: (input, options) => entity(post(pathFor("team-members"), input, options), "team_member"),
  updateTeamMember: (id, input, options) => entity(patch(pathFor("team-members", id), input, options), "team_member"),
  deleteTeamMember: (id, options) => remove(pathFor("team-members", id), options),
  createDocument: (input, options) => entity(post(pathFor("documents"), input, options), "document"),
  updateDocument: (id, input, options) => entity(patch(pathFor("documents", id), input, options), "document"),
  deleteDocument: (id, options) => remove(pathFor("documents", id), options),
  createMilestone: (input, options) => entity(post(pathFor("milestones"), input, options), "milestone"),
  updateMilestone: (id, input, options) => entity(patch(pathFor("milestones", id), input, options), "milestone"),
  deleteMilestone: (id, options) => remove(pathFor("milestones", id), options),

  createProject: (input, options) => entity(post(pathFor("projects"), input, options), "project"),
  updateProject: (id, input, options) => entity(patch(pathFor("projects", id), input, options), "project"),
  deleteProject: (id, options) => remove(pathFor("projects", id), options),

  createTask: (input, options) => entity(post(pathFor("tasks"), input, options), "task"),
  updateTask: (id, input, options) => entity(patch(pathFor("tasks", id), input, options), "task"),
  deleteTask: (id, options) => remove(pathFor("tasks", id), options),

  createChat: (input, options) => entity(post(pathFor("chats"), input, options), "chat"),
  updateChat: (id, input, options) => entity(patch(pathFor("chats", id), input, options), "chat"),
  deleteChat: (id, options) => remove(pathFor("chats", id), options),

  createMessage: (chatId, input, options) => entity(post(`${pathFor("chats", chatId)}/messages`, input, options), "message"),
  updateMessage: (id, input, options) => entity(patch(pathFor("messages", id), input, options), "message"),
  deleteMessage: (id, options) => remove(pathFor("messages", id), options),
  sendChatTurn: (chatId, input, options) => post(`${pathFor("chats", chatId)}/turns`, input, { timeoutMs: 30_000, ...options }),

  startRun: (taskId, input = {}, options) => post(`${pathFor("tasks", taskId)}/runs`, input, options),
  startSession: (input, options) => post(`${API_ROOT}/runs`, input, options),
  stopRun: (runId, options) => post(`${pathFor("runs", runId)}/stop`, {}, options),
  resolveApproval: (runId, approvalId, decision, options) =>
    post(`${pathFor("runs", runId)}/approvals/${encodeURIComponent(approvalId)}`, { decision }, options),

  updateProfile: (input, options) => entity(patch(`${API_ROOT}/profile`, input, options), "profile"),
  updateSettings: (input, options) => entity(patch(`${API_ROOT}/settings`, input, options), "settings"),

  createAgent: (input, options) => entity(post(pathFor("agents"), input, options), "agent"),
  updateAgent: (id, input, options) => entity(patch(pathFor("agents", id), input, options), "agent"),
  deleteAgent: (id, options) => remove(pathFor("agents", id), options),
  createMemoryNote: (input, options) => entity(post(pathFor("memory-notes"), input, options), "memory_note"),
  updateMemoryNote: (id, input, options) => entity(patch(pathFor("memory-notes", id), input, options), "memory_note"),
  deleteMemoryNote: (id, options) => remove(pathFor("memory-notes", id), options),
  probeConnection: (provider, options) => get(`${pathFor("connections", provider)}/probe`, options),
  connectionSetup: (provider, options) => get(`${pathFor("connections", provider)}/setup`, options),
  connectionSetups: (options) => get(`${API_ROOT}/connections/setup`, options),
  connectionStatus: (provider, options) => get(`${pathFor("connections", provider)}/status`, options),
  checkConnection: (provider, options) => post(`${pathFor("connections", provider)}/check`, {}, { timeoutMs: 30_000, ...options }),
  connectConnection: (provider, input = {}, options) => post(`${pathFor("connections", provider)}/connect`, input, { timeoutMs: 30_000, ...options }),
  disconnectConnection: (provider, options) => post(`${pathFor("connections", provider)}/disconnect`, {}, options),
  connectionResources: (provider, { pageToken, ...options } = {}) => get(`${pathFor("connections", provider)}/resources${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ""}`, { timeoutMs: 30_000, ...options }),
  exportWorkspace: (workspaceId, options) => get(`${API_ROOT}/export${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ""}`, options),
  exportChat: (chatId, options) => get(`${pathFor("chats", chatId)}/export`, options),
};

export function createMutation(request, { onSuccess, onError } = {}) {
  return async (...args) => {
    try {
      const response = await request(...args);
      await onSuccess?.(response, args);
      return response;
    } catch (error) {
      await onError?.(error, args);
      throw error;
    }
  };
}

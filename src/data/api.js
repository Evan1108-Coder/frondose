import { demoRequest } from "./demoFallback.js";

const API_ROOT = "/api";
const DEFAULT_TIMEOUT_MS = 6_000;

export class RumboApiError extends Error {
  constructor(message, { status = 0, code = "request_failed", cause } = {}) {
    super(message, { cause });
    this.name = "RumboApiError";
    this.status = status;
    this.code = code;
  }
}

function pathFor(resource, id = "") {
  return `${API_ROOT}/${resource}${id ? `/${encodeURIComponent(id)}` : ""}`;
}

function shouldUseDemoFallback(error) {
  if (!(error instanceof RumboApiError)) return true;
  return error.status === 0 || [404, 405, 406, 415, 501, 502, 503, 504].includes(error.status);
}

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new RumboApiError("The local Rumbo API is not available.", {
      status: response.status,
      code: "api_unavailable",
    });
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new RumboApiError(payload?.message ?? `Request failed (${response.status})`, {
      status: response.status,
      code: payload?.code,
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
    allowDemoFallback = true,
  } = options;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = globalThis.setTimeout(() => controller.abort("timeout"), timeoutMs);

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
      result: payload?.result ?? payload,
      bootstrap: payload?.bootstrap,
      source: "server",
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (!allowDemoFallback || !shouldUseDemoFallback(error)) throw error;
    return demoRequest(path, { method, body });
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

const get = (path, options) => apiRequest(path, options);
const post = (path, body, options) => apiRequest(path, { ...options, method: "POST", body });
const patch = (path, body, options) => apiRequest(path, { ...options, method: "PATCH", body });
const remove = (path, options) => apiRequest(path, { ...options, method: "DELETE" });

export const rumboApi = {
  bootstrap: (options) => get(`${API_ROOT}/bootstrap`, options),
  events: (since, options) => {
    const query = since ? `?since=${encodeURIComponent(since)}` : "";
    return get(`${API_ROOT}/events${query}`, options);
  },

  createWorkspace: (input, options) => post(pathFor("workspaces"), input, options),
  updateWorkspace: (id, input, options) => patch(pathFor("workspaces", id), input, options),
  deleteWorkspace: (id, options) => remove(pathFor("workspaces", id), options),

  createProject: (input, options) => post(pathFor("projects"), input, options),
  updateProject: (id, input, options) => patch(pathFor("projects", id), input, options),
  deleteProject: (id, options) => remove(pathFor("projects", id), options),

  createTask: (input, options) => post(pathFor("tasks"), input, options),
  updateTask: (id, input, options) => patch(pathFor("tasks", id), input, options),
  deleteTask: (id, options) => remove(pathFor("tasks", id), options),

  createChat: (input, options) => post(pathFor("chats"), input, options),
  updateChat: (id, input, options) => patch(pathFor("chats", id), input, options),
  deleteChat: (id, options) => remove(pathFor("chats", id), options),

  createMessage: (chatId, input, options) => post(`${pathFor("chats", chatId)}/messages`, input, options),
  updateMessage: (id, input, options) => patch(pathFor("messages", id), input, options),
  deleteMessage: (id, options) => remove(pathFor("messages", id), options),

  startRun: (taskId, input = {}, options) => post(`${pathFor("tasks", taskId)}/runs`, input, options),
  stopRun: (runId, options) => post(`${pathFor("runs", runId)}/stop`, {}, options),
  resolveApproval: (runId, approvalId, decision, options) =>
    post(`${pathFor("runs", runId)}/approvals/${encodeURIComponent(approvalId)}`, { decision }, options),

  updateConnection: (id, input, options) => patch(pathFor("connections", id), input, options),
  updateProfile: (input, options) => patch(`${API_ROOT}/profile`, input, options),
  updateSettings: (input, options) => patch(`${API_ROOT}/settings`, input, options),
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

const ACTIVE_RUN_STATUSES = new Set(["queued", "starting", "running", "needs_input"]);
const COLLECTION_ACTIONS = {
  Workspace: "workspaces", Project: "projects", Task: "tasks", Chat: "chats",
  Message: "messages", Agent: "agents", MemoryNote: "memory_notes",
  Team: "teams", TeamMember: "team_members", Document: "documents", Milestone: "milestones",
  WorkspaceItem: "workspace_items",
};

function mergeSettings(current, changes) {
  const merged = { ...current };
  for (const [key, value] of Object.entries(changes ?? {})) {
    merged[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergeSettings(current?.[key], value) : value;
  }
  return merged;
}

function putEntity(data, collection, item) {
  if (!data || !item?.id) return data;
  const list = data[collection] ?? [];
  return { ...data, [collection]: list.some((row) => row.id === item.id)
    ? list.map((row) => row.id === item.id ? { ...row, ...item } : row)
    : [...list, item] };
}

/** An isolated store makes persistence and race behavior testable without React. */
export function createTalvoriStore(api) {
  let canonicalData = null;
  let snapshot = {
    data: null, loading: true, refreshing: false, error: null, syncError: null,
    source: "unknown", pendingMutations: 0, lastUpdatedAt: null,
  };
  let revision = 0;
  let readRequestId = 0;
  let appliedReadId = 0;
  let operationId = 0;
  let bootstrapPromise = null;
  let eventsPromise = null;
  let mutationQueue = Promise.resolve();
  let pollTimer = null;
  const listeners = new Set();
  const optimistic = new Map();

  function emit(changes = {}) {
    let data = canonicalData;
    for (const apply of optimistic.values()) if (data) data = apply(data);
    snapshot = { ...snapshot, ...changes, data };
    for (const listener of listeners) listener();
  }

  function clearPoll() {
    if (pollTimer) globalThis.clearTimeout(pollTimer);
    pollTimer = null;
  }

  function schedulePoll() {
    clearPoll();
    if (!listeners.size || !canonicalData || globalThis.document?.hidden) return;
    const active = canonicalData.runs?.some((run) => ACTIVE_RUN_STATUSES.has(run.status));
    pollTimer = globalThis.setTimeout(async () => {
      await refreshEvents();
      schedulePoll();
    }, active ? 2_500 : 20_000);
    pollTimer.unref?.();
  }

  async function readBootstrap({ quiet = false, authoritative = false } = {}) {
    const requestedRevision = revision;
    const requestedReadId = ++readRequestId;
    emit(quiet ? { refreshing: true } : { loading: !canonicalData, error: null });
    try {
      const response = await api.bootstrap();
      const data = response.bootstrap ?? response.result;
      if ((authoritative || requestedRevision === revision) && requestedReadId >= appliedReadId) {
        appliedReadId = requestedReadId;
        canonicalData = data;
        emit({ source: response.source, syncError: null, lastUpdatedAt: new Date().toISOString() });
      }
      return canonicalData;
    } catch (error) {
      if ((authoritative || requestedRevision === revision) && requestedReadId >= appliedReadId) {
        emit(canonicalData ? { syncError: error } : { error });
      }
      throw error;
    } finally {
      emit({ loading: false, refreshing: false });
      schedulePoll();
    }
  }

  async function refresh({ quiet = false } = {}) {
    // A user refresh joins pending writes so it sees their committed values.
    while (snapshot.pendingMutations) await mutationQueue;
    if (bootstrapPromise) return bootstrapPromise;
    bootstrapPromise = readBootstrap({ quiet }).finally(() => { bootstrapPromise = null; });
    return bootstrapPromise;
  }

  async function refreshEvents() {
    if (!canonicalData || snapshot.pendingMutations) return null;
    if (eventsPromise) return eventsPromise;
    const requestedRevision = revision;
    const requestedReadId = ++readRequestId;
    eventsPromise = (async () => {
      try {
        const response = await api.events(canonicalData.meta?.lastEventAt);
        // A poll started before a write is not allowed to undo that write.
        if (requestedRevision !== revision || requestedReadId < appliedReadId) return response.result;
        appliedReadId = requestedReadId;
        if (response.bootstrap) canonicalData = response.bootstrap;
        else {
          const known = new Set((canonicalData.events ?? []).map((event) => event.id));
          const incoming = (response.result?.events ?? []).filter((event) => !known.has(event.id));
          canonicalData = {
            ...canonicalData,
            events: [...(canonicalData.events ?? []), ...incoming],
            meta: { ...canonicalData.meta, lastEventAt: response.result?.cursor ?? canonicalData.meta?.lastEventAt },
          };
        }
        emit({ source: response.source, syncError: null, lastUpdatedAt: new Date().toISOString() });
        return response.result;
      } catch (error) {
        if (requestedRevision === revision && requestedReadId >= appliedReadId) emit({ syncError: error });
        return null;
      } finally {
        eventsPromise = null;
      }
    })();
    return eventsPromise;
  }

  function optimisticChange(name, args, collection) {
    if (name === "updateSettings") return (data) => ({ ...data, settings: mergeSettings(data.settings, args[0]?.settings ?? args[0]) });
    if (name === "updateProfile") return (data) => ({ ...data, profile: { ...data.profile, ...args[0] } });
    if (name.startsWith("update") && collection) {
      return (data) => ({ ...data, [collection]: (data[collection] ?? []).map((row) => row.id === args[0] ? { ...row, ...args[1] } : row) });
    }
    return null;
  }

  function commitResult(name, result, args, collection) {
    if (!canonicalData) return;
    if (collection) {
      canonicalData = name.startsWith("delete")
        ? { ...canonicalData, [collection]: (canonicalData[collection] ?? []).filter((row) => row.id !== args[0]) }
        : putEntity(canonicalData, collection, result);
    } else if (name === "updateSettings") {
      canonicalData = { ...canonicalData, settings: mergeSettings(canonicalData.settings, result) };
    } else if (name === "updateProfile") {
      canonicalData = { ...canonicalData, profile: { ...canonicalData.profile, ...result } };
    } else {
      for (const [key, target] of [["run", "runs"], ["message", "messages"], ["approval", "approvals"], ["connection", "connections"]]) {
        if (!result?.[key]) continue;
        const item = key === "connection" && !result.connection.id
          ? { ...canonicalData.connections?.find((row) => row.provider === result.connection.provider), ...result.connection }
          : result[key];
        canonicalData = putEntity(canonicalData, target, item);
      }
    }
  }

  function mutation(name, collection) {
    return (...args) => {
      const id = ++operationId;
      revision += 1;
      const preview = optimisticChange(name, args, collection);
      if (preview) optimistic.set(id, preview);
      emit({ pendingMutations: snapshot.pendingMutations + 1, error: null });
      const operation = mutationQueue.then(async () => {
        try {
          const response = await api[name](...args);
          optimistic.delete(id);
          if (response.bootstrap) canonicalData = response.bootstrap;
          else commitResult(name, response.result, args, collection);
          emit({ source: response.source, error: null, lastUpdatedAt: new Date().toISOString() });
          if (!response.bootstrap) {
            // A saved write must not be reported as failed when its follow-up
            // read fails: retrying it could otherwise create a duplicate.
            await readBootstrap({ quiet: true, authoritative: true }).catch(() => {});
          }
          return response.result;
        } catch (error) {
          optimistic.delete(id);
          emit({ error });
          throw error;
        } finally {
          revision += 1;
          emit({ pendingMutations: Math.max(0, snapshot.pendingMutations - 1) });
          schedulePoll();
        }
      });
      mutationQueue = operation.catch(() => {});
      return operation;
    };
  }

  function resume() {
    if (globalThis.document?.hidden) clearPoll();
    else {
      if (canonicalData) void refreshEvents();
      else void refresh().catch(() => {});
      schedulePoll();
    }
  }

  function subscribe(listener) {
    listeners.add(listener);
    if (listeners.size === 1) {
      globalThis.window?.addEventListener("online", resume);
      globalThis.window?.addEventListener("focus", resume);
      globalThis.document?.addEventListener("visibilitychange", resume);
      schedulePoll();
    }
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        clearPoll();
        globalThis.window?.removeEventListener("online", resume);
        globalThis.window?.removeEventListener("focus", resume);
        globalThis.document?.removeEventListener("visibilitychange", resume);
      }
    };
  }

  const actions = { refresh, refreshEvents, clearError: () => emit({ error: null, syncError: null }) };
  for (const [singular, collection] of Object.entries(COLLECTION_ACTIONS)) {
    for (const verb of ["create", "update", "delete"]) {
      const name = `${verb}${singular}`;
      if (api[name]) actions[name] = mutation(name, collection);
    }
  }
  for (const name of ["workspaceItemAction", "startRun", "startSession", "sendChatTurn", "stopRun", "updateRun", "resolveApproval", "updateProfile", "updateSettings", "probeConnection", "connectConnection", "checkConnection", "disconnectConnection"]) {
    if (api[name]) actions[name] = mutation(name);
  }
  return { getSnapshot: () => snapshot, subscribe, actions: Object.freeze(actions) };
}

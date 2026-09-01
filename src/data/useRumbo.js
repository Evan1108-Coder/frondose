import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { createMutation, rumboApi } from "./api.js";

const ACTIVE_RUN_STATUSES = new Set(["queued", "starting", "running", "needs_input"]);
const ACTIVE_POLL_MS = 2_500;
const IDLE_POLL_MS = 20_000;

let snapshot = {
  data: null,
  loading: true,
  refreshing: false,
  error: null,
  source: "unknown",
  pendingMutations: 0,
  lastUpdatedAt: null,
};

let bootstrapPromise = null;
let pollTimer = null;
let polling = false;
const listeners = new Set();

function emit(next) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot() {
  return snapshot;
}

function hasActiveRuns(data) {
  return data?.runs?.some((run) => ACTIVE_RUN_STATUSES.has(run.status)) ?? false;
}

function clearPoll() {
  if (pollTimer) globalThis.clearTimeout(pollTimer);
  pollTimer = null;
}

function schedulePoll() {
  clearPoll();
  if (listeners.size === 0 || !snapshot.data) return;
  const delay = hasActiveRuns(snapshot.data) ? ACTIVE_POLL_MS : IDLE_POLL_MS;
  pollTimer = globalThis.setTimeout(async () => {
    await refreshEvents();
    schedulePoll();
  }, delay);
}

function applyResponse(response) {
  if (response.bootstrap) {
    emit({
      data: response.bootstrap,
      source: response.source,
      error: null,
      lastUpdatedAt: new Date().toISOString(),
    });
    return true;
  }
  return false;
}

export async function refreshRumbo({ quiet = false } = {}) {
  if (bootstrapPromise) return bootstrapPromise;
  emit(quiet ? { refreshing: true } : { loading: true, error: null });

  bootstrapPromise = rumboApi.bootstrap()
    .then((response) => {
      const data = response.bootstrap ?? response.result;
      emit({
        data,
        loading: false,
        refreshing: false,
        error: null,
        source: response.source,
        lastUpdatedAt: new Date().toISOString(),
      });
      schedulePoll();
      return data;
    })
    .catch((error) => {
      emit({ loading: false, refreshing: false, error });
      throw error;
    })
    .finally(() => {
      bootstrapPromise = null;
    });

  return bootstrapPromise;
}

export async function refreshEvents() {
  if (polling || !snapshot.data) return null;
  polling = true;
  try {
    const since = snapshot.data.meta?.lastEventAt ?? null;
    const response = await rumboApi.events(since);
    if (!applyResponse(response) && response.result?.events?.length) {
      const known = new Set(snapshot.data.events.map((event) => event.id));
      const incoming = response.result.events.filter((event) => !known.has(event.id));
      emit({
        data: {
          ...snapshot.data,
          events: [...snapshot.data.events, ...incoming],
          meta: {
            ...snapshot.data.meta,
            lastEventAt: response.result.cursor ?? snapshot.data.meta.lastEventAt,
          },
        },
        source: response.source,
        lastUpdatedAt: new Date().toISOString(),
      });
    }
    return response.result;
  } catch (error) {
    // Polling errors are non-blocking; the explicit refresh path surfaces them.
    return null;
  } finally {
    polling = false;
  }
}

async function runMutation(request) {
  emit({ pendingMutations: snapshot.pendingMutations + 1, error: null });
  try {
    const response = await request();
    if (!applyResponse(response)) await refreshRumbo({ quiet: true });
    schedulePoll();
    return response.result;
  } catch (error) {
    emit({ error });
    throw error;
  } finally {
    emit({ pendingMutations: Math.max(0, snapshot.pendingMutations - 1) });
  }
}

const mutate = (request) => createMutation((...args) => runMutation(() => request(...args)));

// Stable action references prevent rerenders in components that only consume actions.
export const rumboActions = Object.freeze({
  refresh: refreshRumbo,
  refreshEvents,

  createWorkspace: mutate(rumboApi.createWorkspace),
  updateWorkspace: mutate(rumboApi.updateWorkspace),
  deleteWorkspace: mutate(rumboApi.deleteWorkspace),

  createProject: mutate(rumboApi.createProject),
  updateProject: mutate(rumboApi.updateProject),
  deleteProject: mutate(rumboApi.deleteProject),

  createTask: mutate(rumboApi.createTask),
  updateTask: mutate(rumboApi.updateTask),
  deleteTask: mutate(rumboApi.deleteTask),

  createChat: mutate(rumboApi.createChat),
  updateChat: mutate(rumboApi.updateChat),
  deleteChat: mutate(rumboApi.deleteChat),

  createMessage: mutate(rumboApi.createMessage),
  updateMessage: mutate(rumboApi.updateMessage),
  deleteMessage: mutate(rumboApi.deleteMessage),

  startRun: mutate(rumboApi.startRun),
  stopRun: mutate(rumboApi.stopRun),
  resolveApproval: mutate(rumboApi.resolveApproval),

  updateConnection: mutate(rumboApi.updateConnection),
  updateProfile: mutate(rumboApi.updateProfile),
  updateSettings: mutate(rumboApi.updateSettings),
});

const identitySelector = (state) => state;
const dataSelector = (state) => state.data;
const statusSelector = ({ loading, refreshing, error, source, pendingMutations, lastUpdatedAt }) => ({
  loading,
  refreshing,
  error,
  source,
  isDemo: source === "demo",
  pendingMutations,
  lastUpdatedAt,
});

function shallowEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.is(left[key], right[key]));
}

/**
 * Main application hook. Consumers can pass a selector to subscribe to a
 * smaller data slice; selector results should retain stable references when
 * possible (for example `data => data.tasks`).
 */
export function useRumbo(selector = identitySelector, isEqual = Object.is) {
  const selectorRef = useRef(selector);
  const equalityRef = useRef(isEqual);
  const cacheRef = useRef({ hasValue: false, storeSnapshot: null, selector: null, selected: null });
  selectorRef.current = selector;
  equalityRef.current = isEqual;

  const getSelectedSnapshot = useCallback(() => {
    const storeSnapshot = getSnapshot();
    const cache = cacheRef.current;
    const activeSelector = selectorRef.current;
    if (cache.hasValue && cache.storeSnapshot === storeSnapshot && cache.selector === activeSelector) {
      return cache.selected;
    }

    const selected = activeSelector(storeSnapshot);
    if (cache.hasValue && equalityRef.current(cache.selected, selected)) {
      cache.storeSnapshot = storeSnapshot;
      cache.selector = activeSelector;
      return cache.selected;
    }

    cacheRef.current = { hasValue: true, storeSnapshot, selector: activeSelector, selected };
    return selected;
  }, []);

  const selected = useSyncExternalStore(subscribe, getSelectedSnapshot, getSelectedSnapshot);

  useEffect(() => {
    if (!snapshot.data && !bootstrapPromise) void refreshRumbo().catch(() => {});
    else schedulePoll();
    return () => {
      if (listeners.size === 0) clearPoll();
    };
  }, []);

  return selected;
}

export function useRumboData() {
  return useRumbo(dataSelector);
}

export function useRumboStatus() {
  return useRumbo(statusSelector, shallowEqual);
}

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { talvoriApi } from "./api.js";
import { createTalvoriStore } from "./talvoriStore.js";

const store = createTalvoriStore(talvoriApi);

export const talvoriActions = store.actions;
export const refreshTalvori = talvoriActions.refresh;
export const refreshEvents = talvoriActions.refreshEvents;

const identitySelector = (state) => state;
const dataSelector = (state) => state.data;
const statusSelector = ({ loading, refreshing, error, syncError, source, pendingMutations, lastUpdatedAt }) => ({
  loading, refreshing, error, syncError, source, isDemo: source === "demo", pendingMutations, lastUpdatedAt,
});

function shallowEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.is(left[key], right[key]));
}

/** Subscribe to the complete store or a stable selected slice. */
export function useTalvori(selector = identitySelector, isEqual = Object.is) {
  const selectorRef = useRef(selector);
  const equalityRef = useRef(isEqual);
  const cacheRef = useRef({ hasValue: false, storeSnapshot: null, selector: null, selected: null });
  selectorRef.current = selector;
  equalityRef.current = isEqual;

  const getSelectedSnapshot = useCallback(() => {
    const storeSnapshot = store.getSnapshot();
    const cache = cacheRef.current;
    const activeSelector = selectorRef.current;
    if (cache.hasValue && cache.storeSnapshot === storeSnapshot && cache.selector === activeSelector) return cache.selected;
    const selected = activeSelector(storeSnapshot);
    if (cache.hasValue && equalityRef.current(cache.selected, selected)) {
      cache.storeSnapshot = storeSnapshot;
      cache.selector = activeSelector;
      return cache.selected;
    }
    cacheRef.current = { hasValue: true, storeSnapshot, selector: activeSelector, selected };
    return selected;
  }, []);

  const selected = useSyncExternalStore(store.subscribe, getSelectedSnapshot, getSelectedSnapshot);
  useEffect(() => {
    if (!store.getSnapshot().data) void refreshTalvori().catch(() => {});
  }, []);
  return selected;
}

export function useTalvoriData() { return useTalvori(dataSelector); }
export function useTalvoriStatus() { return useTalvori(statusSelector, shallowEqual); }

import { useSyncExternalStore } from 'react';

const unavailable = Object.freeze({ phase: 'unsupported', currentVersion: null, release: null, reason: 'App installation is managed by the Frondose desktop app, not this browser.' });
let state = unavailable, started = false, detach;
const listeners = new Set(), guards = new Set();
const emit = value => { state = value; for (const listener of listeners) listener(); };
function start() {
  const api = globalThis.frondoseDesktop?.updates;
  if (started || !api) return;
  started = true;
  detach = api.onState(emit);
  api.command({ operation: 'status' }).then(emit).catch(() => { /* native startup publishes its initial status */ });
}
const subscribe = listener => { listeners.add(listener); start(); return () => { listeners.delete(listener); if (!listeners.size) { detach?.(); detach = null; started = false; } }; };
export const useDesktopUpdates = () => useSyncExternalStore(subscribe, () => state, () => unavailable);
export function displayDesktopUpdateError(error) {
  const prefix = /^Error invoking remote method 'frondose-desktop:update': (?:Error: )?/;
  if (typeof error?.message !== 'string' || !prefix.test(error.message)) return error;
  return new Error(error.message.replace(prefix, '') || 'The update could not complete.', { cause: error });
}
export async function desktopUpdateCommand(payload) {
  const api = globalThis.frondoseDesktop?.updates;
  if (!api) return unavailable;
  let value;
  try { value = await api.command(payload); }
  catch (error) { throw displayDesktopUpdateError(error); }
  if (value?.phase) emit(value);
  return value;
}
export function registerDesktopUpdateGuard(reader) { guards.add(reader); return () => guards.delete(reader); }
export function desktopUpdateDraftBlockers() {
  return [...guards].flatMap(reader => {
    try {
      const result = reader();
      return result === true ? [] : Array.isArray(result) ? result : [{ kind: 'draft-check' }];
    } catch { return [{ kind: 'draft-check' }]; }
  });
}
export const nativeUpdateCritical = phase => ['preparing', 'installing'].includes(phase);

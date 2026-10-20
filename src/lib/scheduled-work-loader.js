// A controller belongs to one mounted workspace. Reads never authorize work.
// Generation checks still protect state when a transport ignores cancellation.
export function createScheduledWorkLoader(read) {
  let snapshot = { items: [], loading: true, error: null, busy: false };
  let active = false, generation = 0, flight = null;
  const listeners = new Set();
  const publish = patch => {
    if (!active) return;
    snapshot = { ...snapshot, ...patch };
    listeners.forEach(listener => listener());
  };
  function invalidate() {
    generation += 1;
    flight?.controller.abort();
    flight = null;
  }
  function load() {
    if (!active || snapshot.busy) return Promise.resolve(null);
    if (flight) return flight.promise;
    const controller = new AbortController(), current = generation;
    const request = { controller, promise: null };
    flight = request;
    request.promise = Promise.resolve().then(() => read(controller.signal)).then(items => {
      if (!active || current !== generation || controller.signal.aborted) return null;
      if (!Array.isArray(items)) throw new Error('Talvori received an unreadable schedule list.');
      publish({ items, error: null, loading: false });
      return items;
    }).catch(error => {
      if (active && current === generation && !controller.signal.aborted) {
        // A failed refresh may mean revoked source access. Never retain a
        // previously readable prompt behind a permission/network error.
        // Preserve identical failures so a background poll does not repeatedly
        // announce the same notice while the persistent error view is visible.
        const previous = snapshot.error;
        const same = previous && previous.message === error?.message && previous.code === error?.code && previous.status === error?.status;
        publish({ items: [], loading: false, error: same ? previous : error });
      }
      return null;
    }).finally(() => { if (flight === request) flight = null; });
    return request.promise;
  }
  function accept(item) {
    if (!active) return false;
    invalidate();
    publish({ items: snapshot.items.map(current => current.id === item.id ? item : current), error: null });
    return true;
  }
  async function mutate(operation) {
    if (!active || snapshot.busy) return null;
    invalidate();
    const current = generation;
    publish({ busy: true, error: null });
    try {
      const item = await operation();
      if (!active || current !== generation) return null;
      accept(item);
      publish({ busy: false });
      void load();
      return item;
    } catch (error) {
      if (active && current === generation) publish({ items: [], busy: false, loading: false, error });
      return null;
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    start() { active = true; return load(); },
    load, accept, mutate,
    dispose() { active = false; invalidate(); },
  };
}

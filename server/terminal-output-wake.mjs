/** Short waits avoid occupying all HTTP/1 sockets when eight panes are visible. */
export function createTerminalOutputWake() {
  const pending = new Map(); let total = 0;
  function wake(id) { for (const finish of [...(pending.get(id) || [])]) finish(); }
  return {
    wait(id, milliseconds, changed) {
      if (!milliseconds || changed() || total >= 128 || (pending.get(id)?.size || 0) >= 16) return Promise.resolve();
      return new Promise(resolve => {
        let done = false;
        const finish = () => { if (done) return; done = true; clearTimeout(timer); pending.get(id)?.delete(finish); if (!pending.get(id)?.size) pending.delete(id); total--; resolve(); };
        const timer = setTimeout(finish, Math.min(80, Math.max(1, milliseconds)));
        if (!pending.has(id)) pending.set(id, new Set());
        pending.get(id).add(finish); total++;
        if (changed()) finish();
      });
    },
    wake,
    close() { for (const id of [...pending.keys()]) wake(id); },
  };
}

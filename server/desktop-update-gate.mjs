import { randomBytes, timingSafeEqual } from 'node:crypto';

const problem = message => Object.assign(new Error(message), { statusCode: 423, code: 'desktop_update_busy' });

// Installation-wide, in-memory and expiring. It grants no filesystem/process
// authority and never stops work. Every mutating request participates, including
// requests already awaiting body/native setup when preparation starts.
export function createDesktopUpdateGate({ inspect = () => ({}), now = Date.now, ttlMs = 45000 } = {}) {
  let lease = null, writes = 0;
  const current = () => { if (lease && lease.expiresAt <= now()) lease = null; return lease; };
  const equal = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) && current() && timingSafeEqual(Buffer.from(token), Buffer.from(lease.token));
  const blockers = () => {
    const state = inspect();
    return { activeWork: Number(state.activeWork) || 0, otherWindows: Math.max(0, (Number(state.clients) || 0) - 1), pendingWrites: writes, work: Array.isArray(state.work) ? state.work.slice(0, 24) : [] };
  };
  return {
    beginMutation() {
      if (current()) throw problem('An app update is preparing to restart. Try again after the update finishes.');
      writes++;
      let ended = false;
      return () => { if (!ended) { ended = true; writes--; } };
    },
    status() { return { ...blockers(), preparing: Boolean(current()) }; },
    isPreparing() { return Boolean(current()); },
    acquire() {
      if (current()) throw problem('Another update is already preparing.');
      const state = blockers();
      if (state.activeWork || state.otherWindows || state.pendingWrites) return { allowed: false, ...state };
      lease = { token: randomBytes(32).toString('hex'), expiresAt: now() + ttlMs };
      return { allowed: true, ...lease };
    },
    renew(token) {
      if (!equal(token)) throw problem('The update safety reservation expired. Check again before installing.');
      const state = blockers();
      if (state.activeWork || state.otherWindows || state.pendingWrites) { lease = null; return { allowed: false, ...state }; }
      lease.expiresAt = now() + ttlMs;
      return { allowed: true, expiresAt: lease.expiresAt };
    },
    release(token) { if (equal(token)) lease = null; return { released: !current() }; },
    close() { lease = null; },
  };
}

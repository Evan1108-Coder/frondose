'use strict';
const { randomUUID } = require('node:crypto');
const { cleanBlockers } = require('./update-blockers.cjs');

// Reviewed targets and their actual native identities never leave this process.
function createUpdateCleanup({ targets, now = Date.now, ttl = 90_000 }) {
  let review;
  const read = () => targets().map(target => ({ ...target, item: cleanBlockers([target.item])[0] })).filter(target => target.item);
  function preview(version) {
    review = null;
    const entries = read();
    if (!entries.length) return { items: [] };
    const token = randomUUID();
    review = { version, entries, token, through: now() + ttl };
    return { token, items: entries.map(entry => entry.item) };
  }
  async function confirm(version, token) {
    const selected = review;
    if (!selected || token !== selected.token || version !== selected.version) throw Error('This cleanup review is no longer valid. Review the list again.');
    review = null;
    if (now() >= selected.through) throw Error('This cleanup review expired. Review the list again.');
    const current = read();
    if (current.length !== selected.entries.length || selected.entries.some((item, index) => {
      const row = current[index];
      return item.key !== row.key || item.identity !== row.identity || item.generation !== row.generation || JSON.stringify(item.item) !== JSON.stringify(row.item);
    })) throw Error('The items changed since you reviewed them. Nothing was closed. Review the list again.');
    const results = await Promise.all(current.map(async row => {
      try { return await row.stop() === true; } catch { return false; }
    }));
    const closed = results.filter(Boolean).length;
    return { closed, unconfirmed: results.length - closed };
  }
  return { preview, confirm, clear() { review = null; } };
}
module.exports = { createUpdateCleanup };

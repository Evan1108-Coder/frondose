export const UPDATE_TYPES = Object.freeze([
  ['progress', 'Progress'],
  ['decision', 'Decision'],
  ['blocker', 'Blocker'],
  ['risk', 'Risk'],
  ['release', 'Release'],
  ['outcome', 'Outcome'],
  ['comment', 'Comment'],
]);

export const UPDATE_HEALTH = Object.freeze([['none', 'No health signal'], ['on_track', 'On track'], ['at_risk', 'At risk'], ['blocked', 'Blocked']]);
export const activityAnchor = id => `update-${encodeURIComponent(id)}`;
export const activityLink = entry => `#/updates/${encodeURIComponent(entry.id)}`;
// Store only a digest and request key, never private update text. Re-entering
// the exact uncertain save after navigation reuses its key instead of posting twice.
export async function activityRetryKey(payload, operation, storage = globalThis.sessionStorage) {
  const source = JSON.stringify([operation, payload]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  const slot = `rumbo:update-retry:v1:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  let key;
  try { key = storage?.getItem(slot); } catch { /* Storage is optional. */ }
  if (!key || !/^[a-z0-9-]{36}$/i.test(key)) key = crypto.randomUUID();
  try { storage?.setItem(slot, key); } catch { /* In-memory retries still retain the key. */ }
  return { key, clear() { try { storage?.removeItem(slot); } catch { /* No private content is retained. */ } } };
}
export function activityCapabilities(entry = {}) {
  return Object.fromEntries(['edit', 'archive', 'restore', 'reply', 'react'].map(action => [action, entry[`can_${action}`] === true]));
}
export function filterActivity(entries, { state = 'published', type = '', health = '', search = '' } = {}) {
  const query = search.trim().toLowerCase();
  return entries.filter(entry => (state === 'archived' ? Boolean(entry.archived_at) : !entry.archived_at && (entry.publication_state || 'published') === state)
    && (!type || entry.update_type === type) && (!health || entry.health === health)
    && (!query || `${entry.title || ''} ${entry.content || ''} ${entry.actor_name || ''}`.toLowerCase().includes(query)));
}
export function filteredActivityThreads(entries = [], filters = {}) {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const selected = new Set();
  for (const entry of filterActivity(entries, filters)) {
    const chain = [entry];
    const seen = new Set([entry.id]);
    let parent = byId.get(entry.parent_id);
    while (parent && !seen.has(parent.id)) { seen.add(parent.id); chain.push(parent); parent = byId.get(parent.parent_id); }
    if (filters.state !== 'archived' && chain.some(item => item.archived_at)) continue;
    for (const item of chain) selected.add(item.id);
  }
  return activityThreads(entries.filter(entry => selected.has(entry.id)), { includeArchived: true });
}
export function evidenceMarkdown(label, url) {
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || /[\s()]/.test(url)) return null;
  return `[${String(label || parsed.hostname).replace(/[\[\]\n\r]/g, '')}](${parsed.href})`;
}

const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function mentionedAgents(content, agents = []) {
  if (typeof content !== 'string' || !content.includes('@')) return [];
  const matches = new Map();
  const candidates = agents.flatMap(agent => {
    const values = [agent.name];
    if (['codex', 'claude'].includes(agent.provider)) values.push(agent.provider);
    return values.filter(Boolean).map(value => ({ agent, value }));
  }).toSorted((left, right) => right.value.length - left.value.length);
  for (const { agent, value } of candidates) {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])@${escapePattern(value)}(?=$|[^\\p{L}\\p{N}_])`, 'iu');
    const match = pattern.exec(content);
    if (match && (!matches.has(agent.id) || match.index < matches.get(agent.id).index)) {
      matches.set(agent.id, { agent, index: match.index });
    }
  }
  return [...matches.values()].toSorted((left, right) => left.index - right.index).map(match => match.agent);
}

export function activityThreads(entries = [], { includeArchived = false } = {}) {
  const active = entries.filter(entry => includeArchived || !entry.archived_at);
  const byId = new Map(active.map(entry => [entry.id, { ...entry, replies: [] }]));
  const roots = [];
  for (const entry of active) {
    const node = byId.get(entry.id);
    const parent = entry.parent_id && byId.get(entry.parent_id);
    const ancestors = new Set([entry.id]);
    let cursor = parent;
    while (cursor && !ancestors.has(cursor.id)) { ancestors.add(cursor.id); cursor = byId.get(cursor.parent_id); }
    if (parent && !cursor) parent.replies.push(node);
    else roots.push(node);
  }
  return roots;
}

// Browser-local presentation only. Receipts never contain names or article text.
const PREFIX = 'frondose.release-reads.v1.';
const MAX_READS = 64;
export function productUpdateScope(actorId, workspaceId) {
  if (typeof actorId !== 'string' || !actorId || typeof workspaceId !== 'string' || !workspaceId) return null;
  return `${PREFIX}${encodeURIComponent(JSON.stringify([actorId, workspaceId]))}`;
}
export function normalizeProductUpdateReads(value) {
  return { version: 1, read: value?.version === 1 && Array.isArray(value.read)
    ? [...new Set(value.read.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 128))].slice(-MAX_READS) : [] };
}
export function readProductUpdateReads(storage, key) {
  try { return normalizeProductUpdateReads(key ? JSON.parse(storage.getItem(key)) : null); }
  catch { return normalizeProductUpdateReads(null); }
}
export function recordProductUpdateRead(storage, key, updateId) {
  const current = readProductUpdateReads(storage, key);
  const next = normalizeProductUpdateReads({ version: 1, read: [...current.read, updateId] });
  try { if (key) storage.setItem(key, JSON.stringify(next)); } catch { /* Reading remains usable with blocked storage. */ }
  return next;
}
// Only announce the newest release, not a queue of old unread announcements.
export function unreadProductUpdate(updates, receipts, articles) {
  const newest = updates.find(update => articles.some(article => article.id === update.articleId && article.group === 'updates'));
  return newest && !normalizeProductUpdateReads(receipts).read.includes(newest.id) ? newest : null;
}

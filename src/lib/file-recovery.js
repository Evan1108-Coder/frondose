/** Bounded local IndexedDB recovery. Records contain text, never write authority. */
export const RECOVERY_LIMITS = Object.freeze({ count: 20, perFile: 4, bytes: 12 * 1024 * 1024, contentBytes: 512000 });
const size = value => new TextEncoder().encode(value).length;
export function recoveryRetention(records) {
  const perFile = new Map(); let bytes = 0;
  return [...records].sort((a, b) => b.at - a.at).filter(item => {
    const count = perFile.get(item.scope) || 0;
    if (count >= RECOVERY_LIMITS.perFile || bytes + item.bytes > RECOVERY_LIMITS.bytes) return false;
    perFile.set(item.scope, count + 1); bytes += item.bytes; return true;
  }).slice(0, RECOVERY_LIMITS.count);
}
let opening;
function database() {
  return opening ||= new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(Error('Local recovery storage is unavailable. Download your draft before replacing it.')); return; }
    const request = indexedDB.open('frondose-file-recovery-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('copies', { keyPath: 'id' });
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opening = undefined; }; resolve(request.result); };
    request.onerror = () => { opening = undefined; reject(Error('Local recovery storage could not be opened. Your draft is still here.')); };
  });
}
export async function storeRecovery(scope, draft, reason = 'draft', disk) {
  const baseline = draft.baseline || '', content = draft.content || '', diskContent = typeof disk?.content === 'string' ? disk.content : null;
  if ([baseline, content, diskContent].some(text => text !== null && size(text) > RECOVERY_LIMITS.contentBytes)) throw Error('This recovery copy is too large. Download your draft first.');
  const bytes = size(baseline) + size(content) + size(diskContent || '');
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('copies', 'readwrite'), store = transaction.objectStore('copies'), request = store.getAll();
    request.onsuccess = () => {
      const records = request.result;
      const previous = records.filter(item => item.scope === scope).sort((a, b) => b.at - a.at)[0];
      // Do not consume another slot for a poll/retry of identical content.
      const record = { id: previous?.content === content && previous?.baseline === baseline && previous?.diskContent === diskContent ? previous.id : crypto.randomUUID(), scope, baseline, content, diskContent, reason, bytes, at: Date.now() };
      const all = [...records.filter(item => item.id !== record.id), record], keep = recoveryRetention(all), ids = new Set(keep.map(item => item.id));
      for (const item of records) if (!ids.has(item.id)) store.delete(item.id);
      if (ids.has(record.id)) store.put(record);
      else { transaction.abort(); }
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(Error('Recovery copy could not be stored (storage may be full). Your draft is unchanged. Download it before continuing.'));
  });
}
export async function listRecovery(scope) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('copies'), request = transaction.objectStore('copies').getAll();
    request.onsuccess = () => resolve(request.result.filter(item => item.scope === scope).sort((a, b) => b.at - a.at));
    request.onerror = () => reject(Error('Recovery copies could not be read.'));
  });
}

import { parsePage, pageHash } from './navigation.js';
const canonical = hash => { const page = parsePage(hash); return pageHash(page.view, page.id, page); };
export function visitPage(history, hash) {
  const next = canonical(hash);
  if (history?.entries[history.index] === next) return history;
  const entries = [...(history?.entries.slice(0, history.index + 1) ?? []), next].slice(-100);
  return { entries, index: entries.length - 1 };
}
export function stepHistory(history, direction) {
  const index = history.index + Math.sign(direction);
  return index < 0 || index >= history.entries.length ? history : { ...history, index };
}

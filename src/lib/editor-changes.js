import { useEffect, useState } from 'react';

const KEY = 'frondose.editorChanges.v1';
export const EDITOR_CHANGE_DEFAULTS = Object.freeze({ recentMinutes: 10 });
export function normalizeEditorChanges(value) {
  const minutes = Number(value?.recentMinutes);
  return { recentMinutes: Number.isFinite(minutes) ? Math.min(1440, Math.max(1, Math.round(minutes))) : 10 };
}
export function readEditorChanges() {
  try { return normalizeEditorChanges(JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch { return { ...EDITOR_CHANGE_DEFAULTS }; }
}
export function useEditorChanges() {
  const [settings, setSettings] = useState(readEditorChanges);
  useEffect(() => {
    const update = () => setSettings(readEditorChanges());
    window.addEventListener('frondose-editor-changes', update); window.addEventListener('storage', update);
    return () => { window.removeEventListener('frondose-editor-changes', update); window.removeEventListener('storage', update); };
  }, []);
  return [settings, patch => {
    const next = normalizeEditorChanges({ ...readEditorChanges(), ...patch });
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Still applies for this open Settings view. */ }
    setSettings(next); window.dispatchEvent(new Event('frondose-editor-changes'));
  }];
}

// Private, bounded app-memory observations, not a promise of OS file history.
// File content is never put in localStorage or sent to a service by this module.
const observations = new Map();
const MAX_FILES = 12, MAX_SNAPSHOTS = 40, MAX_CHARACTERS = 2 * 1024 * 1024;
export function editorObservationKey(workspaceId, rootVersion, entityId) { return JSON.stringify([workspaceId, rootVersion, entityId]); }
export function observeEditorContent(key, content, now = Date.now()) {
  if (typeof content !== 'string' || content.length > MAX_CHARACTERS || !Number.isFinite(now)) return false;
  const entry = observations.get(key) || { began: now, snapshots: [] };
  const previous = entry.snapshots.at(-1);
  if (previous?.content === content) return false;
  // Coalesce quick typing, while keeping the first observation as an honest
  // baseline. This avoids losing a whole interval after a few seconds of typing.
  if (entry.snapshots.length > 1 && now - previous.at < 5000) entry.snapshots[entry.snapshots.length - 1] = { at: previous.at, content };
  else entry.snapshots.push({ at: now, content });
  let characters = entry.snapshots.reduce((sum, item) => sum + item.content.length, 0);
  while (entry.snapshots.length > 1 && (entry.snapshots.length > MAX_SNAPSHOTS || characters > MAX_CHARACTERS)) characters -= entry.snapshots.shift().content.length;
  observations.delete(key); observations.set(key, entry);
  while (observations.size > MAX_FILES) observations.delete(observations.keys().next().value);
  return true;
}
export function recentEditorObservation(key, content, recentMinutes = 10, now = Date.now()) {
  const entry = observations.get(key);
  if (!entry?.snapshots.length) return null;
  const cutoff = now - normalizeEditorChanges({ recentMinutes }).recentMinutes * 60_000;
  const before = entry.snapshots.filter(item => item.at <= cutoff).at(-1);
  const baseline = before || entry.snapshots[0];
  // If the last known version is older than the interval and nothing changed,
  // that is a valid baseline, not evidence of changes outside the interval.
  return { before: baseline.content, after: content, baselineAt: baseline.at, began: entry.began, partial: !before, changed: baseline.content !== content };
}

/** A bounded, truthful single-hunk diff. No quadratic LCS on large source files. */
export function observedContentDiff(before, after, maxLines = 1200) {
  if (before === after) return { content: '', limited: false };
  const oldLines = String(before).split('\n'), newLines = String(after).split('\n');
  let start = 0, end = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
  while (end < oldLines.length - start && end < newLines.length - start && oldLines[oldLines.length - 1 - end] === newLines[newLines.length - 1 - end]) end++;
  const contextStart = Math.max(0, start - 3), oldEnd = oldLines.length - end, newEnd = newLines.length - end;
  const tail = Math.min(3, end), rows = [];
  for (let index = contextStart; index < start; index++) rows.push(` ${oldLines[index]}`);
  for (let index = start; index < oldEnd; index++) rows.push(`-${oldLines[index]}`);
  for (let index = start; index < newEnd; index++) rows.push(`+${newLines[index]}`);
  for (let index = 0; index < tail; index++) rows.push(` ${newLines[newEnd + index]}`);
  const limited = rows.length > maxLines;
  return { content: [`@@ -${contextStart + 1},${oldEnd - contextStart + tail} +${contextStart + 1},${newEnd - contextStart + tail} @@`, ...rows.slice(0, maxLines)].join('\n'), limited };
}

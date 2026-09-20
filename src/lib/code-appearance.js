import { useEffect, useState } from 'react';
import { CODE_FONTS } from './code-fonts.js';
import { CODE_THEMES } from './code-themes.js';
const KEY = 'rumbo.codeAppearance.v1';
export const CODE_DEFAULTS = Object.freeze({ theme: 'app', font: 'system', fontSize: 13, lineHeight: 1.65, tabSize: 2, wrap: false, lineNumbers: true, syntax: true, diffLayout: 'unified', diffMarkers: true });
export function normalizeCodeAppearance(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
  const result = { ...CODE_DEFAULTS };
  for (const [key, choices] of Object.entries({ theme: CODE_THEMES.map(item => item.id), font: CODE_FONTS.map(item => item.id), diffLayout: ['unified', 'split'] })) if (choices.includes(input[key])) result[key] = input[key];
  for (const [key, min, max] of [['fontSize', 10, 24], ['lineHeight', 1.2, 2.2], ['tabSize', 2, 8]]) if (Number.isFinite(input[key])) result[key] = Math.min(max, Math.max(min, input[key]));
  for (const key of ['wrap', 'lineNumbers', 'syntax', 'diffMarkers']) if (typeof input[key] === 'boolean') result[key] = input[key];
  return result;
}
export function readCodeAppearance() { try { return normalizeCodeAppearance(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return { ...CODE_DEFAULTS }; } }
export function useCodeAppearance() {
  const [settings, setSettings] = useState(readCodeAppearance);
  useEffect(() => { const update = () => setSettings(readCodeAppearance()); window.addEventListener('rumbo-code-appearance', update); window.addEventListener('storage', update); return () => { window.removeEventListener('rumbo-code-appearance', update); window.removeEventListener('storage', update); }; }, []);
  const save = patch => { const next = normalizeCodeAppearance({ ...readCodeAppearance(), ...patch }); localStorage.setItem(KEY, JSON.stringify(next)); setSettings(next); window.dispatchEvent(new Event('rumbo-code-appearance')); };
  return [settings, save];
}

export function diffRows(source) {
  let oldLine = 0, newLine = 0;
  return String(source).split('\n').map(text => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); return { text, type: 'hunk' }; }
    if (/^(diff |index |--- |\+\+\+ |\\)/.test(text)) return { text, type: 'meta' };
    if (text.startsWith('+')) return { text, type: 'addition', newLine: newLine++ };
    if (text.startsWith('-')) return { text, type: 'deletion', oldLine: oldLine++ };
    return { text, type: 'context', oldLine: oldLine++, newLine: newLine++ };
  });
}
export function splitDiffRows(rows) {
  const result = []; let removed = [], added = [];
  const flush = () => { for (let i = 0; i < Math.max(removed.length, added.length); i++) result.push({ left: removed[i], right: added[i] }); removed = []; added = []; };
  for (const row of rows) {
    if (row.type === 'deletion') removed.push(row);
    else if (row.type === 'addition') added.push(row);
    else { flush(); result.push({ left: row, right: row }); }
  }
  flush(); return result;
}

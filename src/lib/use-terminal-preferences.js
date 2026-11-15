import { useEffect, useState } from 'react';
import { normalizeTerminalPreferences } from './terminal-preferences.js';
const KEY = 'frondose.terminal-appearance.v2', EVENT = 'frondose:terminal-preferences';
export function readTerminalPreferences() { try { return normalizeTerminalPreferences(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return normalizeTerminalPreferences(); } }
export function useTerminalPreferences() {
  const [value, setValue] = useState(readTerminalPreferences);
  useEffect(() => { const update = () => setValue(readTerminalPreferences()); window.addEventListener(EVENT, update); window.addEventListener('storage', update); return () => { window.removeEventListener(EVENT, update); window.removeEventListener('storage', update); }; }, []);
  return [value, patch => { const next = normalizeTerminalPreferences({ ...readTerminalPreferences(), ...patch }); localStorage.setItem(KEY, JSON.stringify(next)); setValue(next); window.dispatchEvent(new Event(EVENT)); return next; }];
}

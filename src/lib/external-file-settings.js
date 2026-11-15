import { useEffect, useState } from 'react';
import { normalizeExternalFileSettings } from './external-file-policy.js';
const KEY = 'frondose.externalFiles.v1', EVENT = 'frondose-external-files';
let sessionSettings;
export function readExternalFileSettings() {
  if (sessionSettings) return sessionSettings;
  try { return normalizeExternalFileSettings(JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch { return normalizeExternalFileSettings(); }
}
export function useExternalFileSettings() {
  const [settings, setSettings] = useState(readExternalFileSettings);
  useEffect(() => {
    const read = () => setSettings(readExternalFileSettings());
    const storage = event => { if (event.key === KEY || event.key === null) { sessionSettings = undefined; read(); } };
    window.addEventListener(EVENT, read); window.addEventListener('storage', storage);
    return () => { window.removeEventListener(EVENT, read); window.removeEventListener('storage', storage); };
  }, []);
  return [settings, patch => {
    const next = normalizeExternalFileSettings({ ...readExternalFileSettings(), ...patch });
    localStorage.setItem(KEY, JSON.stringify(next)); // Surface quota/permissions errors to Settings.
    sessionSettings = next; setSettings(next); window.dispatchEvent(new Event(EVENT));
  }];
}

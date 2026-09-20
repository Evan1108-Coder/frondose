import { useEffect, useState } from 'react';
import { normalizeReactionColor } from './reaction-catalog.js';
import { colorPolicy, normalizeTabColors } from './icon-colors.js';
export const DISPLAY_KEY = 'rumbo.displayPreferences.v1';
export function normalizeDisplayPreferences(input) {
  return { emptyIconColor: normalizeReactionColor(input?.emptyIconColor) || '', tabIconColor: normalizeReactionColor(input?.tabIconColor) || '', tabLabelColor: colorPolicy(input?.tabLabelColor, ['icon', 'neutral'], 'neutral'), tabColors: normalizeTabColors(input?.tabColors), smoothChatScroll: typeof input?.smoothChatScroll === 'boolean' ? input.smoothChatScroll : true };
}
export function readDisplayPreferences() {
  try { return normalizeDisplayPreferences(JSON.parse(localStorage.getItem(DISPLAY_KEY) || '{}')); } catch { return normalizeDisplayPreferences(); }
}
export function useDisplayPreferences() {
  const [settings, setSettings] = useState(readDisplayPreferences);
  useEffect(() => {
    const update = () => setSettings(readDisplayPreferences());
    window.addEventListener('rumbo-display-preferences', update); window.addEventListener('storage', update);
    return () => { window.removeEventListener('rumbo-display-preferences', update); window.removeEventListener('storage', update); };
  }, []);
  function save(patch) {
    const next = normalizeDisplayPreferences({ ...readDisplayPreferences(), ...patch });
    localStorage.setItem(DISPLAY_KEY, JSON.stringify(next));
    setSettings(next); window.dispatchEvent(new Event('rumbo-display-preferences'));
  }
  return [settings, save];
}
export function useGlobalDisplayPreferences() {
  const [settings] = useDisplayPreferences();
  useEffect(() => {
    const style = document.documentElement.style;
    if (settings.emptyIconColor) style.setProperty('--empty-icon-color', settings.emptyIconColor);
    else style.removeProperty('--empty-icon-color');
    return () => style.removeProperty('--empty-icon-color');
  }, [settings.emptyIconColor]);
}

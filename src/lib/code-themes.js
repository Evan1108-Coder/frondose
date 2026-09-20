import palettes from './code-themes.json' with { type: 'json' };
export const CODE_THEMES = [
  { id: 'app', label: 'Match Rumbo', tone: 'automatic' },
  { id: 'light', label: 'Rumbo Light', tone: 'light' },
  { id: 'dark', label: 'Rumbo Dark', tone: 'dark' },
  { id: 'contrast', label: 'Rumbo High Contrast', tone: 'dark' },
  ...palettes,
];
const themes = new Map(CODE_THEMES.map(theme => [theme.id, theme]));
export function codeThemeStyle(id) {
  const colors = themes.get(id)?.colors;
  return colors ? Object.fromEntries(Object.entries(colors).map(([key, value]) => [`--cv-${key}`, value])) : {};
}
export function filterCodeChoices(choices, query = '', tone = 'all') {
  const text = query.trim().toLowerCase();
  return choices.filter(item => (tone === 'all' || item.tone === tone || item.tone === 'automatic') && `${item.label} ${item.id}`.toLowerCase().includes(text));
}

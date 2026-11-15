// Personal display preferences, never executable commands or permission grants.
export const TERMINAL_THEMES = Object.freeze([
  { id: 'frondose', name: 'Frondose Dark', background: '#101113', foreground: '#dedee4', cursor: '#c4b5fd', selectionBackground: '#51477a' },
  { id: 'tokyo-night', name: 'Tokyo Night', background: '#1a1b26', foreground: '#c0caf5', cursor: '#c0caf5', selectionBackground: '#33467c', black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6' },
  { id: 'solarized-dark', name: 'Solarized Dark', background: '#002b36', foreground: '#839496', cursor: '#93a1a1', selectionBackground: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198' },
  { id: 'solarized-light', name: 'Solarized Light', background: '#fdf6e3', foreground: '#657b83', cursor: '#586e75', selectionBackground: '#eee8d5', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198' },
  { id: 'paper', name: 'Paper Light', background: '#fafafa', foreground: '#242424', cursor: '#5348ad', selectionBackground: '#d8d5f1' },
]);
export const TERMINAL_DEFAULTS = Object.freeze({ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: null, lineHeight: 1.15, cursorStyle: 'block', cursorBlink: true, gpu: 'auto', contrast: 4.5, inlineImages: false, scroll: 1.15, fastScroll: 5, tuiScroll: 1, rightClickPaste: false, focusFollowsMouse: false, scrollback: 10000, wordSeparator: ' ()[]{}\'"`', optionAsAlt: 'auto', jisYen: false, darkTheme: 'frondose', lightTheme: 'paper', darkDivider: '#3f3f46', lightDivider: '#d4d4d8', customTheme: null });
const colors = ['background', 'foreground', 'cursor', 'selectionBackground', 'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];
const color = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : null;
export function normalizeTerminalPreferences(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
  const result = { ...TERMINAL_DEFAULTS };
  for (const [key, min, max] of [['fontSize', 10, 32], ['lineHeight', 1, 2], ['contrast', 1, 21], ['scroll', .5, 3], ['fastScroll', 1, 10], ['tuiScroll', 1, 10], ['scrollback', 1000, 50000]]) if (Number.isFinite(input[key])) result[key] = Math.max(min, Math.min(max, key === 'scrollback' ? Math.round(input[key]) : input[key]));
  for (const key of ['cursorBlink', 'inlineImages', 'rightClickPaste', 'focusFollowsMouse', 'jisYen']) if (typeof input[key] === 'boolean') result[key] = input[key];
  for (const [key, values] of Object.entries({ gpu: ['auto', 'on', 'off'], cursorStyle: ['block', 'bar', 'underline'], optionAsAlt: ['auto', 'both', 'left', 'right', 'off'] })) if (values.includes(input[key])) result[key] = input[key];
  for (const key of ['darkTheme', 'lightTheme']) if ([...TERMINAL_THEMES.map(theme => theme.id), 'custom'].includes(input[key])) result[key] = input[key];
  for (const key of ['darkDivider', 'lightDivider']) result[key] = color(input[key]) || result[key];
  if (typeof input.fontFamily === 'string' && input.fontFamily.length <= 160 && /^[\w\s,'".-]+$/.test(input.fontFamily)) result.fontFamily = input.fontFamily;
  if (typeof input.wordSeparator === 'string' && input.wordSeparator.length <= 100 && !/[\x00-\x1f]/.test(input.wordSeparator)) result.wordSeparator = input.wordSeparator;
  if (input.customTheme && typeof input.customTheme === 'object' && !Array.isArray(input.customTheme)) {
    const safe = Object.fromEntries(colors.flatMap(key => color(input.customTheme[key]) ? [[key, color(input.customTheme[key])]] : []));
    if (safe.background && safe.foreground) result.customTheme = safe;
  }
  return result;
}
export function terminalTheme(settings, light = false) {
  const id = settings[light ? 'lightTheme' : 'darkTheme'];
  const theme = id === 'custom' && settings.customTheme ? settings.customTheme : TERMINAL_THEMES.find(item => item.id === id) || TERMINAL_THEMES[light ? 4 : 0];
  return Object.fromEntries(colors.filter(key => theme[key]).map(key => [key, theme[key]]));
}
export function terminalOptions(settings, { light = false, platform = '', fallbackSize = 14 } = {}) {
  return { fontFamily: settings.fontFamily, fontSize: settings.fontSize ?? fallbackSize, lineHeight: settings.lineHeight, cursorStyle: settings.cursorStyle, cursorBlink: settings.cursorBlink, scrollback: settings.scrollback, wordSeparator: settings.wordSeparator, minimumContrastRatio: settings.contrast, scrollSensitivity: settings.scroll, fastScrollSensitivity: settings.fastScroll, macOptionIsMeta: /Mac|darwin/.test(platform) && ['auto', 'both'].includes(settings.optionAsAlt), theme: terminalTheme(settings, light) };
}
// Deliberately a bounded color/font importer, not a general YAML/config loader.
// Includes, shell commands, aliases, tags and source text are never evaluated or saved.
export function importTerminalAppearance(text, format = 'yaml') {
  if (typeof text !== 'string' || text.length > 131072 || text.includes('\0')) throw Error('Choose a theme/config file under 128 KiB.');
  if (/^\s*(?:---|!!|&|\*|!include)/m.test(text)) throw Error('Theme imports do not support YAML documents, tags, aliases or includes.');
  const theme = {}, patch = {}, palette = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
  let section = '';
  for (const line of text.split(/\r?\n/).slice(0, 4096)) {
    const match = /^\s*([\w-]+)\s*[:=]\s*(.*?)\s*$/.exec(line); if (!match) continue;
    let [, key, value] = match; value = value.replace(/^['"]|['"]$/g, '');
    if (!value && ['normal', 'bright', 'primary', 'colors'].includes(key)) { section = key; continue; }
    if (format === 'ghostty' && key === 'palette') { const p = /^(\d{1,2})\s*=\s*(#[\da-f]{6})$/i.exec(value); if (p && Number(p[1]) < 16) { const index = Number(p[1]); theme[index < 8 ? palette[index] : `bright${palette[index - 8][0].toUpperCase()}${palette[index - 8].slice(1)}`] = p[2]; } continue; }
    if (key === 'font-size' && /^\d+(?:\.\d+)?$/.test(value)) patch.fontSize = Number(value);
    if (key === 'font-family' && value.length <= 160 && /^[\w\s,'".-]+$/.test(value)) patch.fontFamily = value;
    key = ({ 'cursor-color': 'cursor', 'selection-background': 'selectionBackground', 'accent': 'cursor' })[key] || key;
    if (section === 'bright' && palette.includes(key)) key = `bright${key[0].toUpperCase()}${key.slice(1)}`;
    if (colors.includes(key) && color(value)) theme[key] = color(value);
  }
  if (theme.background && theme.foreground) { patch.customTheme = theme; patch.darkTheme = 'custom'; patch.lightTheme = 'custom'; }
  if (!Object.keys(patch).length) throw Error('No supported font settings or six-digit background/foreground colors were found.');
  return patch;
}

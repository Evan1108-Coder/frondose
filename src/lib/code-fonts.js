const fallback = 'ui-monospace, SFMono-Regular, Menlo, monospace';
export const BUNDLED_CODE_FONTS = [
  ['anonymous-pro', 'Anonymous Pro'], ['azeret-mono', 'Azeret Mono'],
  ['chivo-mono', 'Chivo Mono'], ['cousine', 'Cousine'], ['dm-mono', 'DM Mono'],
  ['fira-code', 'Fira Code'], ['ibm-plex-mono', 'IBM Plex Mono'], ['inconsolata', 'Inconsolata'],
  ['jetbrains-mono', 'JetBrains Mono'], ['martian-mono', 'Martian Mono'],
  ['nanum-gothic-coding', 'Nanum Gothic Coding'], ['noto-sans-mono', 'Noto Sans Mono'],
  ['overpass-mono', 'Overpass Mono'], ['pt-mono', 'PT Mono'], ['red-hat-mono', 'Red Hat Mono'],
  ['roboto-mono', 'Roboto Mono'], ['share-tech-mono', 'Share Tech Mono'],
  ['source-code-pro', 'Source Code Pro'], ['space-mono', 'Space Mono'], ['ubuntu-mono', 'Ubuntu Mono'],
].map(([id, label]) => ({ id, label, bundled: true, family: `"${label}", ${fallback}` }));
export const CODE_FONTS = [
  { id: 'system', label: 'System monospace', family: fallback },
  ...BUNDLED_CODE_FONTS,
  ...['Menlo', 'Monaco', 'Consolas'].map(id => ({ id, label: `${id} (if installed)`, family: `"${id}", ${fallback}` })),
];
export const codeFontFamily = id => (CODE_FONTS.find(font => font.id === id) ?? CODE_FONTS[0]).family;

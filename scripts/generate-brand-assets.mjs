import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../public/brand/', import.meta.url);
const symbol = readFileSync(new URL('talvori-symbol.webp', root)).toString('base64');
for (const [theme, color] of [['dark', '#f7f8f8'], ['light', '#18191b']]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="160" viewBox="0 0 560 160" role="img" aria-labelledby="title"><title id="title">Talvori</title><image href="data:image/webp;base64,${symbol}" x="8" y="16" width="128" height="128"/><text x="150" y="106" fill="${color}" font-family="Inter,Arial,sans-serif" font-size="76" font-weight="600" letter-spacing="-2">Talvori</text></svg>\n`;
  writeFileSync(new URL(`talvori-wordmark-${theme}.svg`, root), svg);
}
// Cached/pre-rebrand client URLs receive the new mark, never an old R logo.
copyFileSync(new URL('talvori-symbol.png', root), new URL('rumbo-symbol.png', root));
copyFileSync(new URL('talvori-app-icon.png', root), new URL('rumbo-app-icon.png', root));
// The PNG wordmark is exported from the live-typed component by visual QA.
try { copyFileSync(new URL('talvori-wordmark-dark.png', root), new URL('rumbo-wordmark-dark.png', root)); } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
console.log(`Generated Talvori wordmarks and compatibility icons in ${fileURLToPath(root)}`);

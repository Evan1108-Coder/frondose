import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = new URL('../public/brand/', import.meta.url);
// One authored vector is shared by UI, install and provider-consent artwork.
// sharp is available in the bundled workspace runtime, or via NODE_PATH.
const sharp = createRequire(import.meta.url)('sharp');
const mark = readFileSync(new URL('frondose-symbol.svg', root), 'utf8');
const path = /<path[^>]+\/>/.exec(mark)[0];
await sharp(Buffer.from(mark)).resize(512, 512).png().toFile(fileURLToPath(new URL('frondose-symbol.png', root)));
await sharp(Buffer.from(mark)).resize(160, 160).webp({ lossless: true }).toFile(fileURLToPath(new URL('frondose-symbol.webp', root)));
const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 96 96"><rect x="3" y="3" width="90" height="90" rx="22" fill="#f7f8f8"/><g transform="translate(8 8) scale(.833333)">${path}</g></svg>`;
await sharp(Buffer.from(badge)).png().toFile(fileURLToPath(new URL('frondose-app-icon.png', root)));
for (const [theme, color] of [['dark', '#f7f8f8'], ['light', '#18191b']]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160" viewBox="0 0 640 160" role="img" aria-labelledby="title"><title id="title">Frondose</title><g transform="translate(8 16) scale(1.333333)">${path}</g><text x="150" y="106" fill="${color}" font-family="Inter,Arial,sans-serif" font-size="76" font-weight="600" letter-spacing="-2">Frondose</text></svg>\n`;
  writeFileSync(new URL(`frondose-wordmark-${theme}.svg`, root), svg);
  await sharp(Buffer.from(svg)).png().toFile(fileURLToPath(new URL(`frondose-wordmark-${theme}.png`, root)));
}
// Old bookmarked assets and cached clients receive the current F mark too.
for (const legacy of ['talvori', 'rumbo']) {
  for (const suffix of ['symbol.png', 'app-icon.png', 'wordmark-dark.png']) copyFileSync(new URL(`frondose-${suffix}`, root), new URL(`${legacy}-${suffix}`, root));
}
for (const suffix of ['symbol.webp', 'wordmark-dark.svg', 'wordmark-light.svg', 'wordmark-light.png']) copyFileSync(new URL(`frondose-${suffix}`, root), new URL(`talvori-${suffix}`, root));
copyFileSync(new URL('../public/empty-art/talvori-welcome.webp', import.meta.url), new URL('../public/empty-art/frondose-welcome.webp', import.meta.url));
console.log(`Generated Frondose assets and legacy aliases in ${fileURLToPath(root)}`);

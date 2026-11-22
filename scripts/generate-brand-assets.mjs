import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = new URL('../public/brand/', import.meta.url);
// Keep the approved frond bytes as the single source of truth. SVG exports
// embed the small transparent image so they also work as standalone files.
// sharp is available in the bundled workspace runtime, or via NODE_PATH.
const sharp = createRequire(import.meta.url)('sharp');
const original = readFileSync(new URL('frondose-frond.png', root));
const compact = readFileSync(new URL('frondose-frond-icon.png', root));
const source = `data:image/png;base64,${compact.toString('base64')}`;
const image = (x, y, size) => `<image x="${x}" y="${y}" width="${size}" height="${size}" href="${source}"/>`;
const svg = (width, height, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title"><title id="title">Frondose</title>${body}</svg>\n`;
writeFileSync(new URL('frondose-symbol.svg', root), svg(128, 128, image(0, 0, 128)));
await sharp(original).resize(512, 512).png().toFile(fileURLToPath(new URL('frondose-symbol.png', root)));
await sharp(original).resize(160, 160).webp({ lossless: true }).toFile(fileURLToPath(new URL('frondose-symbol.webp', root)));
copyFileSync(new URL('frondose-frond-icon.png', root), new URL('frondose-app-icon.png', root));
for (const [theme, color] of [['dark', '#f7f8f8'], ['light', '#18191b']]) {
  const wordmark = svg(640, 160, image(12, 16, 128) + `<text x="148" y="106" fill="${color}" font-family="Inter,Arial,sans-serif" font-size="76" font-weight="650" letter-spacing="-2">Frondose</text>`);
  writeFileSync(new URL(`frondose-wordmark-${theme}.svg`, root), wordmark);
  await sharp(Buffer.from(wordmark)).png().toFile(fileURLToPath(new URL(`frondose-wordmark-${theme}.png`, root)));
}
// Old bookmarked asset URLs and cached clients also receive the flower.
for (const legacy of ['talvori', 'rumbo']) {
  for (const suffix of ['symbol.png', 'app-icon.png', 'wordmark-dark.png']) copyFileSync(new URL(`frondose-${suffix}`, root), new URL(`${legacy}-${suffix}`, root));
}
for (const suffix of ['symbol.webp', 'wordmark-dark.svg', 'wordmark-light.svg', 'wordmark-light.png']) copyFileSync(new URL(`frondose-${suffix}`, root), new URL(`talvori-${suffix}`, root));
console.log(`Generated Frondose assets and legacy aliases in ${fileURLToPath(root)}`);

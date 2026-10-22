// Downloads only reviewed, revision-pinned artwork. Never used at runtime.
// Paseo: Apache-2.0; see third-party/paseo/LICENSE and NOTICE.md.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { RUNNER_PROVIDER_CATALOG, PASEO_SOURCE } from '../src/lib/runner-provider-catalog.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = `${root}public/brand/runners`;
const nativeAssets = {
  claude: 'assets/acp-provider-icons/claude-acp.svg',
  codex: 'assets/acp-provider-icons/codex-acp.svg',
  copilot: 'assets/acp-provider-icons/github-copilot-cli.svg',
  opencode: 'assets/acp-provider-icons/opencode.svg',
  pi: 'components/icons/pi-icon.tsx',
  omp: 'components/icons/omp-icon.tsx',
  antigravity: 'components/icons/antigravity-icon.tsx',
  muse: '../../../../../plugins/muse-provider/icon.svg',
};
const codewhaleRevision = '0ab0d4ac297249ad379192074a250c792d312beb';
const digest = value => createHash('sha256').update(value).digest('hex');

// Intentionally narrow: the reviewed native components contain only Svg/Path.
// Do not eval a downloaded module or accept arbitrary JSX.
export function nativeSvg(source) {
  const jsx = source.match(/<Svg\s[\s\S]*?<\/Svg>/)?.[0];
  if (!jsx) throw new Error('Missing native SVG');
  return jsx.replace(/\bSvg\b/g, 'svg').replace(/\bPath\b/g, 'path')
    .replace(/\{size\}/g, '"24"').replace(/\{color\}/g, '"currentColor"')
    .replace(/fillRule=/g, 'fill-rule=')
    .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
    .replace(/(<svg[^>]*>)/, '$1\n<!-- Modified for Frondose: static SVG extracted from Paseo Svg/Path JSX; dimensions fixed; currentColor retained. Apache-2.0; see third-party/paseo/NOTICE.md. -->') + '\n';
}

export function assertSafeBrandSvg(svg) {
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg\s/i.test(svg) || !/<\/svg>\s*$/.test(svg)) throw new Error('Not an SVG document');
  svg = svg.replace(/^\s*<\?xml[^>]*>\s*/, '');
  if (svg.length > 200_000) throw new Error('Oversized SVG');
  if (/<!DOCTYPE|<!ENTITY|<\?|<\s*(?:script|foreignObject|iframe|image|use|a|style|animate|set|audio|video)\b|\bon[a-z]+\s*=|\b(?:href|src)\s*=|url\(\s*(?!#)|(?:javascript|data|https?):\s*(?!\/\/www\.w3\.org\/2000\/svg)/i.test(svg)) throw new Error('Active content or external reference in SVG');
  const tags = [...svg.matchAll(/<\/?\s*([\w:-]+)/g)].map(match => match[1]);
  const allowed = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line', 'defs', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop', 'title', 'desc', 'text', 'filter', 'feFlood', 'feBlend', 'feGaussianBlur']);
  if (tags.some(tag => !allowed.has(tag))) throw new Error('Unreviewed SVG element');
  if (!/\bviewBox="[^"]+"/.test(svg)) throw new Error('Missing viewBox');
  if (/[{}]/.test(svg)) throw new Error('Unconverted JSX/CSS');
}

async function vendor() {
  await mkdir(directory, { recursive: true });
  const assets = await Promise.all(RUNNER_PROVIDER_CATALOG.map(async provider => {
    let sourcePath = nativeAssets[provider.id]
      ? `packages/app/src/${nativeAssets[provider.id]}`
      : `packages/app/src/assets/acp-provider-icons/${provider.id}.svg`;
    if (provider.id === 'muse') sourcePath = 'plugins/muse-provider/icon.svg';
    let sourceRevision = PASEO_SOURCE.revision;
    let sourceUrl = `https://raw.githubusercontent.com/getpaseo/paseo/${sourceRevision}/${sourcePath}`;
    let license = 'Apache-2.0';
    if (provider.id === 'codewhale') {
      // Paseo's old 深 text badge is not CodeWhale's current whale mark.
      sourceRevision = codewhaleRevision;
      sourcePath = 'web/app/icon.svg';
      sourceUrl = `https://raw.githubusercontent.com/codewhale-hq/CodeWhale/${sourceRevision}/${sourcePath}`;
      license = 'MIT';
    }
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`${provider.id}: HTTP ${response.status}`);
    const source = await response.text();
    const svg = sourcePath.endsWith('.tsx') ? nativeSvg(source) : source;
    try { assertSafeBrandSvg(svg); } catch (error) { throw new Error(`${provider.id}: ${error.message}`); }
    // CSS masks preserve currentColor artwork in both themes; multicolor artwork
    // remains an ordinary image so original colors and gradients survive.
    const paints = [...svg.matchAll(/(?:fill|stroke|stop-color)="([^"]+)"/g)].map(match => match[1]);
    const monochrome = paints.every(paint => ['none', 'currentColor'].includes(paint));
    const entry = {
      id: provider.id, title: provider.title,
      src: `/brand/runners/${provider.id}.svg`,
      rendering: monochrome ? 'mask' : 'image',
      sourceUrl, sourceRevision, sourcePath,
      sourceSha256: digest(source), sha256: digest(svg), license,
      modification: sourcePath.endsWith('.tsx') ? 'Static SVG extracted from reviewed Svg/Path JSX; dimensions fixed at 24; color becomes currentColor; geometry unchanged.' : 'None; byte-for-byte upstream SVG.',
      nameSourceUrl: provider.nameSourceUrl,
    };
    await writeFile(`${directory}/${provider.id}.svg`, svg);
    return entry;
  }));
  await mkdir(`${root}third-party/codewhale`, { recursive: true });
  const licenseResponse = await fetch(`https://raw.githubusercontent.com/codewhale-hq/CodeWhale/${codewhaleRevision}/LICENSE`);
  if (!licenseResponse.ok) throw new Error('Missing CodeWhale license');
  await writeFile(`${root}third-party/codewhale/LICENSE`, await licenseResponse.text());
  await writeFile(`${root}src/lib/runner-brand-assets.json`, JSON.stringify({
    source: PASEO_SOURCE, reviewedAt: '2026-10-22',
    notice: 'Third-party identification artwork; Apache-2.0 is not a trademark license or provider endorsement. See docs/ai-provider-branding.md.',
    assets,
  }, null, 2) + '\n');
  console.log(`Vendored ${assets.length} reviewed SVG documents (${assets.filter(asset => asset.rendering === 'mask').length} theme-aware masks).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await vendor();

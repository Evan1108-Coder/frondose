// Offline evidence for the exact API artwork resolved by the shared registry.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { API_PROVIDERS } from '../src/lib/ai-provider-catalog.js';
import { serviceBrand } from '../src/lib/service-brands.js';
import { assertSafeBrandSvg } from './vendor-runner-brand-assets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
const iconify = {
  openai: 'openai-icon', anthropic: 'anthropic-icon', gemini: 'google-gemini-icon',
  xai: 'grok-icon', mistral: 'mistral-ai-icon', deepseek: 'deepseek-icon',
  perplexity: 'perplexity-icon', qwen: 'qwen-icon', huggingface: 'hugging-face-icon',
  codex: 'codex', claude: 'claude-icon', copilot: 'github-copilot',
};
const productMarks = [
  { id: 'codex', name: 'Codex', docs: 'https://developers.openai.com/codex/cli/' },
  { id: 'claude', name: 'Claude Code', docs: 'https://code.claude.com/docs/en/setup' },
  { id: 'copilot', name: 'GitHub Copilot CLI', docs: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli' },
];
const lobeRevision = 'ab8cbcc6ce806b923c547628132957c8a8b61509';
const simpleIconsRevision = 'c71c69e3a27e4436936b831c72643e6513b9f49b';
const records = await Promise.all([...API_PROVIDERS, ...productMarks].map(async provider => {
  const brand = serviceBrand(provider.id);
  const svg = brand.src.startsWith('data:') ? decodeURIComponent(brand.src.split(',')[1]) : await readFile(`${root}public${brand.src}`, 'utf8');
  assertSafeBrandSvg(svg);
  let sourceUrl, sourceRevision, sourceSha256, license, modification;
  if (iconify[provider.id]) {
    const icon = iconify[provider.id];
    const distribution = await readFile(fileURLToPath(import.meta.resolve(`@iconify-icons/logos/${icon}`)), 'utf8');
    sourceRevision = '@iconify-icons/logos@2.0.1';
    sourceUrl = `https://unpkg.com/@iconify-icons/logos@2.0.1/data/${icon[0]}/${icon}.js`;
    sourceSha256 = digest(distribution);
    license = 'CC0-1.0';
    modification = 'Trusted package icon body wrapped in an SVG element with original dimensions/viewBox; no geometry or palette changes.';
  } else if (provider.id === 'openrouter') {
    sourceRevision = simpleIconsRevision;
    sourceUrl = `https://raw.githubusercontent.com/simple-icons/simple-icons/${sourceRevision}/icons/openrouter.svg`;
    sourceSha256 = '9148696e3a06d23e8fe2b743ebd3ee1173354dbd7b58d33d1ca6a40ee0018d53';
    // Existing path geometry is preserved; the exact rendered document is hashed.
    license = 'CC0-1.0';
    modification = 'Existing Simple Icons path retained; wrapper normalized in service-brands.js.';
  } else {
    sourceRevision = lobeRevision;
    sourceUrl = `https://raw.githubusercontent.com/lobehub/lobe-icons/${sourceRevision}/packages/static-svg/icons/${brand.id}.svg`;
    sourceSha256 = digest(svg.trim());
    license = 'MIT';
    modification = 'Upstream SVG retained; source comparison ignores only trailing newline.';
  }
  if (process.argv.includes('--verify-upstream')) {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`${provider.id}: source HTTP ${response.status}`);
    const original = await response.text();
    const expected = provider.id === 'openrouter' || iconify[provider.id] ? digest(original) : digest(original.trim());
    if (expected !== sourceSha256) throw new Error(`${provider.id}: source hash differs`);
    if (provider.id === 'openrouter' && original.match(/<path d="([^"]+)"/)?.[1] !== svg.match(/<path d="([^"]+)"/)?.[1]) throw new Error('OpenRouter geometry differs');
  }
  return { id: provider.id, name: provider.name, brandId: brand.id, sourceUrl, sourceRevision, sourceSha256, sha256: digest(svg), license, modification, nameSourceUrl: provider.docs };
}));
await mkdir(`${root}third-party/ai-brands`, { recursive: true });
await writeFile(`${root}third-party/ai-brands/api-assets.json`, JSON.stringify({ reviewedAt: '2026-10-22', assets: records.slice(0, API_PROVIDERS.length), productMarks: records.slice(API_PROVIDERS.length) }, null, 2) + '\n');
console.log(`Audited ${API_PROVIDERS.length} passive API marks and ${productMarks.length} CLI product marks.`);

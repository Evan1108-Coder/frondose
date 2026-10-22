import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assets from '../src/lib/runner-brand-assets.json' with { type: 'json' };
import { RUNNER_PROVIDER_CATALOG, getRunnerProvider } from '../src/lib/runner-provider-catalog.js';
import { VERIFIED_RUNNER_NAMES } from '../src/lib/runner-provider-names.js';
import { EXECUTION_PROVIDERS } from '../src/lib/ai-providers.js';
import { API_PROVIDERS } from '../src/lib/ai-provider-catalog.js';
import { serviceBrand } from '../src/lib/service-brands.js';
import { assertSafeBrandSvg } from '../scripts/vendor-runner-brand-assets.mjs';

test('every execution identity has bundled artwork, not a generated letter fallback', async () => {
  assert.equal(assets.assets.length, 47);
  assert.equal(new Set(assets.assets.map(asset => asset.id)).size, 47);
  for (const provider of RUNNER_PROVIDER_CATALOG) {
    assert.ok(assets.assets.find(asset => asset.id === provider.id), provider.id);
    assert.equal(serviceBrand(provider.title)?.id, serviceBrand(provider.id)?.id, provider.title);
  }
  for (const id of EXECUTION_PROVIDERS) {
    const brand = serviceBrand(id);
    assert.ok(brand, id);
    assert.match(brand.src, /^(?:data:image\/svg\+xml,|\/brand\/(?:services|runners)\/[a-z0-9-]+\.svg$)/, id);
  }
  const component = await readFile(new URL('../src/components/AgentIdentity.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(component, /monogram|\.split\(|dangerouslySetInnerHTML/);
});

test('runner artwork is pinned, hash-verified and passive local SVG', async () => {
  const files = await readdir(new URL('../public/brand/runners/', import.meta.url));
  assert.equal(files.length, 47);
  for (const asset of assets.assets) {
    assert.match(asset.sourceRevision, /^[a-f0-9]{40}$/);
    assert.match(asset.sourceSha256, /^[a-f0-9]{64}$/);
    assert.ok(['Apache-2.0', 'MIT'].includes(asset.license));
    assert.match(asset.sourceUrl, /^https:\/\/raw\.githubusercontent\.com\//);
    assert.ok(asset.sourceUrl.includes(asset.sourceRevision));
    assert.equal(asset.title, getRunnerProvider(asset.id).title);
    const svg = await readFile(new URL(`../public${asset.src}`, import.meta.url), 'utf8');
    assert.equal(createHash('sha256').update(svg).digest('hex'), asset.sha256, asset.id);
    assert.doesNotThrow(() => assertSafeBrandSvg(svg), asset.id);
    if (asset.modification.startsWith('None')) assert.equal(asset.sha256, asset.sourceSha256, asset.id);
    if (asset.rendering === 'mask') assert.doesNotMatch(svg, /(?:fill|stroke|stop-color)="(?!none"|currentColor")[^"]+"/, asset.id);
  }
  assert.equal(assets.assets.find(asset => asset.id === 'kiro').rendering, 'image');
  assert.equal(assets.assets.find(asset => asset.id === 'codewhale').rendering, 'image');
  const license = await readFile(new URL('../third-party/codewhale/LICENSE', import.meta.url), 'utf8');
  assert.match(license, /MIT License/);
  assert.match(license, /DeepSeek-TUI Contributors/);
});

test('SVG review rejects active content, external references and unexpected markup', () => {
  for (const body of ['<script>alert(1)</script>', '<foreignObject />', '<image href="https://example.com/pixel"/>', '<path onload="alert(1)"/>', '<use href="#mark"/>', '<path fill="url(https://example.com/mark)"/>', '<style>path{fill:red}</style>', '<animate attributeName="href"/>', '<iframe />']) {
    assert.throws(() => assertSafeBrandSvg(`<svg viewBox="0 0 24 24">${body}</svg>`), body);
  }
  assert.throws(() => assertSafeBrandSvg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///private/x">]><svg viewBox="0 0 24 24"></svg>'));
});

test('all 16 API marks retain hash-checked versioned source evidence and passive artwork', async () => {
  const manifest = JSON.parse(await readFile(new URL('../third-party/ai-brands/api-assets.json', import.meta.url), 'utf8'));
  assert.equal(manifest.assets.length, API_PROVIDERS.length);
  for (const provider of API_PROVIDERS) {
    const record = manifest.assets.find(asset => asset.id === provider.id);
    assert.ok(record, provider.id);
    assert.equal(record.name, provider.name);
    assert.match(record.sourceSha256, /^[a-f0-9]{64}$/);
    assert.ok(record.sourceRevision);
    assert.match(record.sourceUrl, /^https:\/\/(?:unpkg.com|raw.githubuser)\S+/);
    const brand = serviceBrand(provider.id);
    assert.equal(serviceBrand(provider.brand).id, brand.id);
    assert.equal(serviceBrand(provider.name).id, brand.id);
    const svg = brand.src.startsWith('data:') ? decodeURIComponent(brand.src.split(',')[1]) : await readFile(new URL(`../public${brand.src}`, import.meta.url), 'utf8');
    assert.equal(createHash('sha256').update(svg).digest('hex'), record.sha256, provider.id);
    assert.doesNotThrow(() => assertSafeBrandSvg(svg), provider.id);
  }
  assert.notEqual(serviceBrand('codex').src, serviceBrand('openai').src);
  assert.notEqual(serviceBrand('anthropic').src, serviceBrand('claude').src);
  assert.equal(manifest.productMarks.length, 3);
  for (const record of manifest.productMarks) {
    const svg = decodeURIComponent(serviceBrand(record.id).src.split(',')[1]);
    assert.equal(createHash('sha256').update(svg).digest('hex'), record.sha256, record.id);
    assert.match(record.sourceSha256, /^[a-f0-9]{64}$/);
    assert.doesNotThrow(() => assertSafeBrandSvg(svg), record.id);
  }
});

test('official display corrections preserve intentional lowercase brands and runtime identities', () => {
  for (const [id, evidence] of Object.entries(VERIFIED_RUNNER_NAMES)) {
    assert.equal(getRunnerProvider(id).title, evidence.title);
    assert.equal(getRunnerProvider(id).nameSourceUrl, evidence.source);
  }
  assert.equal(getRunnerProvider('crow-cli').title, 'crow-cli');
  assert.equal(getRunnerProvider('goose').title, 'goose');
  assert.equal(getRunnerProvider('fast-agent').title, 'fast-agent');
  assert.equal(getRunnerProvider('codebuddy-code').upstreamTitle, 'Codebuddy Code');
  assert.deepEqual(getRunnerProvider('grok').launchTemplate, ['grok', 'agent', 'stdio']);
});

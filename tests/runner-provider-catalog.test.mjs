import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { RUNNER_PROVIDER_CATALOG, PASEO_SOURCE, getRunnerProvider } from '../src/lib/runner-provider-catalog.js';

test('catalog preserves every provider from the pinned Paseo ACP source', async () => {
  const upstream = await readFile(new URL('../third-party/paseo/acp-provider-catalog.upstream.ts.txt', import.meta.url), 'utf8');
  const literal = upstream.slice(upstream.indexOf('const CATALOG_DATA = ') + 'const CATALOG_DATA = '.length, upstream.indexOf('] as const;') + 1);
  const entries = vm.runInNewContext(literal, {}, { timeout: 1000 });
  assert.equal(entries.length, 39);
  for (const upstreamProvider of entries) {
    const provider = getRunnerProvider(upstreamProvider.id);
    assert.ok(provider, upstreamProvider.id);
    assert.equal(provider.title, upstreamProvider.title);
    assert.equal(provider.upstreamVersion, upstreamProvider.version);
    assert.equal(provider.installLink, upstreamProvider.installLink);
    assert.equal(JSON.stringify(provider.launchTemplate), JSON.stringify(upstreamProvider.command));
    assert.equal(provider.sourceRevision, PASEO_SOURCE.revision);
  }
});

test('47 unique provider identities include all native providers and bundled provider plugins', () => {
  assert.equal(RUNNER_PROVIDER_CATALOG.length, 47);
  assert.equal(new Set(RUNNER_PROVIDER_CATALOG.map((provider) => provider.id)).size, 47);
  for (const id of ['claude', 'codex', 'copilot', 'opencode', 'pi', 'omp', 'antigravity', 'muse', 'hoplite']) {
    assert.ok(getRunnerProvider(id), id);
  }
  assert.equal(RUNNER_PROVIDER_CATALOG.filter((provider) => provider.id === 'hoplite').length, 1);
  assert.equal(getRunnerProvider('antigravity').requiresFullAccess, true);
  assert.equal(getRunnerProvider('omp').enabledByDefault, false);
  assert.equal(getRunnerProvider('not-a-provider'), null);
});

test('catalog never claims authentication, live compatibility or OS certification', () => {
  for (const provider of RUNNER_PROVIDER_CATALOG) {
    assert.equal(provider.method, 'computer');
    assert.equal(provider.support.liveVerified, false);
    assert.deepEqual(provider.support.platformVerified, []);
    assert.deepEqual(provider.platforms, { darwin: 'unverified', win32: 'unverified', linux: 'unverified', other: 'unsupported' });
    assert.match(provider.installLink, /^https:\/\//u);
    assert.equal(typeof provider.protocol, 'string');
    assert.ok(provider.launchTemplate.every((value) => typeof value === 'string'));
  }
});

test('download-capable upstream templates always require a separate installation approval', () => {
  const downloaders = RUNNER_PROVIDER_CATALOG.filter((provider) => ['npx', 'uvx'].includes(provider.launchTemplate[0]));
  assert.ok(downloaders.length > 10);
  for (const provider of downloaders) {
    assert.equal(provider.requiresInstallApproval, true);
    assert.equal(provider.support.install, 'requires-install-approval');
  }
});

test('catalog and nested provenance metadata cannot be modified by consumers', () => {
  const provider = getRunnerProvider('codex');
  assert.throws(() => provider.launchTemplate.push('--unsafe'));
  assert.throws(() => { provider.platforms.win32 = 'verified'; });
  assert.throws(() => { PASEO_SOURCE.revision = 'other'; });
});

test('license and attribution preserve upstream copyright, pinned revision and modified-file notice', async () => {
  const license = await readFile(new URL('../third-party/paseo/LICENSE', import.meta.url), 'utf8');
  const notice = await readFile(new URL('../third-party/paseo/NOTICE.md', import.meta.url), 'utf8');
  assert.match(license, /Copyright \(c\) 2025-present Mohamed Boudra/u);
  assert.match(license, /Apache License/u);
  assert.ok(notice.includes(PASEO_SOURCE.revision));
  assert.match(notice, /Frondose modifications/u);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import service from '../desktop/update-service.cjs';
import build from '../desktop/release-build.cjs';
import { reviewTarget } from '../scripts/publish-desktop-release.mjs';

const configured = { FRONDOSE_RELEASE_BUILD: '1', FRONDOSE_RELEASE_FEED_URL: 'https://updates.example.com/stable/linux-x64/', FRONDOSE_RELEASE_DOWNLOADS_URL: 'https://example.com/download', FRONDOSE_DESKTOP_BUILD_VERSION: '0.1.20' };
test('public packaging is explicit, HTTPS only, and gated on platform signing', () => {
  assert.equal(build.releaseBuild({}, 'darwin'), null);
  assert.equal(build.releaseBuild({ FRONDOSE_RELEASE_FEED_URL: 'https://updates.example.com' }, 'linux'), null);
  assert.equal(build.releaseBuild(configured, 'linux').feedUrl, configured.FRONDOSE_RELEASE_FEED_URL);
  assert.throws(() => build.releaseBuild(configured, 'darwin'), /Developer ID/);
  assert.throws(() => build.releaseBuild(configured, 'win32'), /Artifact Signing/);
  assert.throws(() => build.releaseBuild(configured, 'linux', ['--dir']), /installer/);
  assert.throws(() => build.releaseBuild({ ...configured, FRONDOSE_RELEASE_FEED_URL: 'http://updates.example.com' }, 'linux'), /HTTPS/);
});
test('background checks offer a release without installing or losing the offer when offline', async () => {
  let offline = false, calls = 0;
  const updater = service.createDesktopUpdateService({ version: '0.1.18', configured: true, adapter: {
    check() { calls++; if (offline) throw Error('offline'); return { version: '0.1.20' }; },
    download() { assert.fail('A discovery must never download an update'); },
    install() { assert.fail('A discovery must never install an update'); },
  } });
  await updater.init();
  const phases = [];
  updater.onState(value => phases.push(value.phase));
  assert.equal((await updater.check({ background: true })).phase, 'available');
  assert.deepEqual(phases, ['available']);
  offline = true;
  assert.equal((await updater.check({ background: true })).release.version, '0.1.20');
  assert.deepEqual(phases, ['available']);
  assert.equal((await updater.check()).phase, 'error');
  assert.equal(calls, 3);
});
test('quiet checks preserve a reviewed scheduled update instead of refreshing it', async () => {
  let calls = 0;
  const updater = service.createDesktopUpdateService({ version: '0.1.18', configured: true, adapter: {
    check() { calls++; return { version: '0.1.20' }; },
  } });
  await updater.check();
  assert.equal((await updater.choose('tonight', '0.1.20')).phase, 'scheduled');
  assert.equal((await updater.check({ background: true })).phase, 'scheduled');
  assert.equal(calls, 1);
});
test('release manifest must match the exact binary and cannot reference third-party URLs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'release-manifest-'));
  const binary = 'Frondose-0.1.20.AppImage', deb = 'frondose_0.1.20_amd64.deb';
  const data = 'mock distribution binary';
  const hash = createHash('sha512').update(data).digest('base64');
  const manifest = { version: '0.1.20', files: [{ url: binary, size: Buffer.byteLength(data), sha512: hash }], path: binary, sha512: hash };
  const save = value => writeFile(join(dir, 'latest-linux.yml'), JSON.stringify(value));
  try {
    await writeFile(join(dir, binary), data);
    await writeFile(join(dir, deb), 'fake deb');
    await save(manifest);
    assert.equal((await reviewTarget(dir, 'linux-x64', '0.1.20', JSON.parse)).entries.length, 2);
    await writeFile(join(dir, binary), data.replace('binary', 'forged'));
    await assert.rejects(reviewTarget(dir, 'linux-x64', '0.1.20', JSON.parse), /size\/hash/);
    await save({ ...manifest, files: [{ ...manifest.files[0], url: 'https://elsewhere.example/' + binary }] });
    await assert.rejects(reviewTarget(dir, 'linux-x64', '0.1.20', JSON.parse), /relative file/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

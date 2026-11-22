import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import service from '../desktop/update-service.cjs';
import build from '../desktop/release-build.cjs';
import signature from '../desktop/release-signature.cjs';
import { reviewTarget, signLinuxManifest } from '../scripts/publish-desktop-release.mjs';

function makeKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64') };
}
const keys = makeKeys();
const configured = { FRONDOSE_RELEASE_BUILD: '1', FRONDOSE_RELEASE_FEED_URL: 'https://updates.example.com/stable/linux-x64/', FRONDOSE_RELEASE_DOWNLOADS_URL: 'https://example.com/download', FRONDOSE_DESKTOP_BUILD_VERSION: '0.1.20', FRONDOSE_RELEASE_LINUX_PUBLIC_KEY: keys.publicKey };
test('public packaging is explicit, HTTPS only, and gated on platform signing', () => {
  assert.equal(build.releaseBuild({}, 'darwin'), null);
  assert.equal(build.releaseBuild({ FRONDOSE_RELEASE_FEED_URL: 'https://updates.example.com' }, 'linux'), null);
  assert.equal(build.releaseBuild(configured, 'linux').feedUrl, configured.FRONDOSE_RELEASE_FEED_URL);
  assert.equal(build.releaseBuild(configured, 'linux').linuxUpdatePublicKey, keys.publicKey);
  assert.throws(() => build.releaseBuild({ ...configured, FRONDOSE_RELEASE_LINUX_PUBLIC_KEY: '' }, 'linux'), /verification key/);
  assert.throws(() => build.releaseBuild(configured, 'darwin'), /Developer ID/);
  assert.throws(() => build.releaseBuild(configured, 'win32'), /Artifact Signing/);
  assert.throws(() => build.releaseBuild(configured, 'linux', ['--dir']), /installer/);
  assert.throws(() => build.releaseBuild({ ...configured, FRONDOSE_RELEASE_FEED_URL: 'http://updates.example.com' }, 'linux'), /HTTPS/);
});
test('AppImage feed requires the packaged Ed25519 key and authenticates the artifact fields', () => {
  const pinned = signature.verificationKey(keys.publicKey);
  const other = makeKeys();
  const hash = createHash('sha512').update('fixture bytes').digest('base64');
  const file = { url: 'Frondose-0.1.20.AppImage', size: 13, sha512: hash };
  const info = { version: '0.1.20', files: [file], path: file.url, sha512: hash };
  const signed = signature.signLinuxRelease(info, keys);
  assert.equal(signature.verifyLinuxRelease(signed, pinned), true);
  assert.equal(signature.verifyLinuxRelease(info, pinned), false);
  assert.equal(signature.verifyLinuxRelease(signed, signature.verificationKey(other.publicKey)), false);
  assert.throws(() => signature.signLinuxRelease(info, { ...keys, publicKey: other.publicKey }), /do not match/);
  for (const update of [
    { ...signed, files: [{ ...file, size: 14 }] },
    { ...signed, files: [{ ...file, sha512: createHash('sha512').update('changed').digest('base64') }] },
    { ...signed, path: 'another-package.AppImage' },
    { ...signed, stagingPercentage: 100 },
    { ...signed, packages: {} },
  ]) assert.equal(signature.verifyLinuxRelease(update, pinned), false);
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

test('the publisher accepts a verified combined Linux manifest but signs only the AppImage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'release-linux-multi-target-'));
  const version = '0.1.20';
  const record = (url, bytes) => ({ url, size: Buffer.byteLength(bytes), sha512: createHash('sha512').update(bytes).digest('base64') });
  const image = record('Frondose-0.1.20.AppImage', 'image fixture');
  const deb = record('frondose_0.1.20_amd64.deb', 'deb fixture');
  try {
    await writeFile(join(dir, image.url), 'image fixture');
    await writeFile(join(dir, deb.url), 'deb fixture');
    await writeFile(join(dir, 'latest-linux.yml'), JSON.stringify({ version, files: [deb, image], path: deb.url, sha512: deb.sha512 }));
    const plan = await reviewTarget(dir, 'linux-x64', version, JSON.parse);
    assert.equal(plan.entries.length, 2, 'both manual downloads remain reviewed');
    await signLinuxManifest(plan, JSON.stringify, { FRONDOSE_RELEASE_LINUX_SIGNING_KEY: keys.privateKey, FRONDOSE_RELEASE_LINUX_PUBLIC_KEY: keys.publicKey });
    const signed = JSON.parse(await readFile(plan.meta, 'utf8'));
    assert.deepEqual(signed.files, [image]);
    assert.equal(signed.path, image.url);
    assert.equal(signed.sha512, image.sha512);
    assert.equal(signature.verifyLinuxRelease(signed, signature.verificationKey(keys.publicKey)), true);
    assert.equal((await reviewTarget(dir, 'linux-x64', version, JSON.parse)).entries.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, lstat, symlink, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { updateFormFingerprint } from '../src/lib/update-form-safety.js';
const require = createRequire(import.meta.url);
const { createDesktopUpdateService, releaseConfiguration, nextTonight, publicRelease, newerStableVersion } = require('../desktop/update-service.cjs');
const { createUpdateStorage } = require('../desktop/update-storage.cjs');
const { blocked, cleanBlockers, leaseBlockers, rendererKinds } = require('../desktop/update-blockers.cjs');
const release = { version: '1.1.0', releaseName: 'Local workstation improvements', releaseNotes: '<p>Safer updates</p>', releaseDate: '2026-10-27T00:00:00Z' };
function fixture(options = {}) {
  const calls = [], receipts = []; let timestamp = new Date(2026, 9, 27, 18).getTime(), preparation = 0;
  const service = createDesktopUpdateService({ configured: true, version: '1.0.0', now: () => timestamp,
    adapter: { async check() { calls.push('check'); return release; }, async download(progress) { calls.push('download'); progress(25); progress(100); }, async install() { calls.push('install'); } },
    load: async () => null, save: async value => receipts.push(value),
    prepare: async () => { preparation++; calls.push('prepare'); return { recheck: async () => { calls.push('recheck'); }, release: async () => { calls.push('release'); } }; }, ...options });
  return { service, calls, receipts, setTime: value => { timestamp = value; }, preparations: () => preparation };
}
test('a local/unconfigured build never probes a feed, creates a fake release or installs', async () => {
  const service = createDesktopUpdateService({ adapter: { check() { throw Error('Network forbidden'); } } });
  await service.init(); await service.check(); await service.choose('now', '1.1.0'); await service.tick();
  assert.equal(service.snapshot().phase, 'unconfigured'); assert.equal(service.snapshot().release, null); service.close();
});
test('release configuration permits only fixed HTTPS release sources and valid publisher identities', () => {
  assert.equal(releaseConfiguration().feedUrl, null);
  assert.equal(releaseConfiguration({ feedUrl: 'https://updates.example.com/frondose', macTeamId: 'ABC1234567' }).macTeamId, 'ABC1234567');
  for (const feedUrl of ['http://updates.example.com', 'file:///tmp/build', 'javascript:alert(1)', 'https://a:b@example.com/', 'https://example.com/?token=private', 'https://localhost/feed', 'https://127.0.0.1/feed']) assert.throws(() => releaseConfiguration({ feedUrl }));
});
test('stable channels reject stale/downgrade/prerelease manifests rather than offering them', async () => {
  for (const candidate of ['1.0.0', '0.9.0', '1.0.0-beta.1', '01.2.0', '1.00.1']) assert.equal(newerStableVersion(candidate, '1.0.0'), false, candidate);
  assert.equal(newerStableVersion('1.0.1', '1.0.0'), true); assert.equal(newerStableVersion('1.0.0', '1.0.0-beta.1'), true);
  const { service } = fixture({ adapter: { check: async () => ({ ...release, version: '0.9.0' }) } });
  await service.check(); assert.equal(service.snapshot().release, null); service.close();
});
test('untrusted release notes are bounded plain text, never HTML or a renderer-selected download', () => {
  const info = publicRelease({ ...release, releaseNotes: '<script>not executable</script>'.repeat(5000), url: 'https://evil.invalid/update.exe' });
  assert.ok(info.notes.length <= 24000); assert.doesNotMatch(info.notes, /<script>/); assert.equal(info.url, undefined);
  assert.throws(() => publicRelease({ version: '../run' }));
});
test('Not now is durable and release-specific; a new release may prompt again', async () => {
  const { service, calls, receipts } = fixture(); await service.init(); await service.check();
  assert.equal(service.snapshot().phase, 'available'); await service.choose('later', '1.1.0');
  assert.equal(service.snapshot().dismissed, true); assert.equal(receipts.length, 1); assert.equal(calls.includes('download'), false);
  await service.check(); assert.equal(service.snapshot().dismissed, true); service.close();
  const restored = fixture({ load: async () => receipts[0] }).service; await restored.init(); await restored.check(); assert.equal(restored.snapshot().dismissed, true); restored.close();
});
test('Install tonight persists a visible future local-time choice and can be cancelled', async () => {
  const { service, receipts, calls } = fixture(); await service.check(); await service.choose('tonight', '1.1.0');
  assert.equal(new Date(service.snapshot().scheduledAt).getHours(), 22); assert.equal(receipts.at(-1).choice, 'tonight');
  assert.equal(calls.includes('download'), false); await service.choose('cancel', '1.1.0'); assert.equal(service.snapshot().scheduledAt, null); service.close();
  const late = new Date(2026, 9, 27, 23, 30).getTime(); assert.ok(nextTonight(late) > late); assert.equal(new Date(nextTonight(late)).getHours(), 2);
});
test('a due schedule performs two fresh readiness checks, not a stop or a discard', async () => {
  const item = fixture(); await item.service.check(); await item.service.choose('tonight', '1.1.0'); item.setTime(item.service.snapshot().scheduledAt);
  await item.service.tick(); assert.deepEqual(item.calls, ['check', 'prepare', 'release', 'check', 'download', 'prepare', 'recheck', 'install']);
  assert.equal(item.service.snapshot().phase, 'installing'); item.service.close();
});
test('sleep/resume or a missed schedule asks again; startup never replays an installation', async () => {
  for (const resumed of [false, true]) {
    const item = fixture(); await item.service.check(); await item.service.choose('tonight', '1.1.0'); item.setTime(item.service.snapshot().scheduledAt + 120000);
    await item.service.tick({ resumed }); assert.equal(item.service.snapshot().phase, 'blocked'); assert.equal(item.calls.includes('download'), false); item.service.close();
  }
  const item = fixture({ load: async () => ({ version: '1.1.0', choice: 'tonight', scheduledAt: 1 }) }); await item.service.init(); await item.service.check(); await item.service.tick(); assert.equal(item.calls.includes('install'), false); item.service.close();
});
test('active/unknown work blocks Install now without download or session termination', async () => {
  const item = fixture({ prepare: async () => { throw Error('Running terminals'); } }); await item.service.check(); await item.service.choose('now', '1.1.0');
  assert.equal(item.service.snapshot().phase, 'blocked'); assert.deepEqual(item.calls, ['check']); item.service.close();
});
test('a named blocker reaches the UI, remains advisory, and is refreshed on retry', async () => {
  let blockedByWork = true;
  const item = fixture({ prepare: async () => {
    if (blockedByWork) throw blocked(leaseBlockers({ activeWork: 2, otherWindows: 1, pendingWrites: 1, work: [{kind:'terminal', label:'Background shell', workspace:'Other workspace'}] }));
    return { recheck: async () => {}, release: async () => {} };
  } });
  await item.service.check(); await item.service.choose('now', '1.1.0');
  assert.deepEqual(item.service.snapshot().blockers.map(({ kind, label, workspace }) => [kind, label, workspace]), [
    ['terminal', 'Background shell', 'Other workspace'], ['active-work', '', ''], ['other-window', '', ''], ['pending-write', '', ''],
  ]);
  assert(!item.calls.includes('install'));
  blockedByWork = false; await item.service.choose('now', '1.1.0');
  assert.equal(item.service.snapshot().phase, 'installing');
  assert.deepEqual(item.service.snapshot().blockers, []); item.service.close();
});
test('renderer cannot send native blocker types, control characters or unbounded details', () => {
  const rows = cleanBlockers([{ kind:'terminal', label:'forged' }, { kind:'file-draft', label:`a\u202eb${'c'.repeat(200)}`, content:'never forward', count:Infinity }], rendererKinds);
  assert.equal(rows.length, 1); assert.equal(rows[0].label.length, 160); assert.match(rows[0].label, /^a b/);
  assert.equal(rows[0].count, 1); assert.equal(rows[0].content, undefined);
});
test('work that appears during downloading blocks restart after the fresh check', async () => {
  let checks = 0; const item = fixture({ prepare: async () => { if (++checks === 2) throw Error('Unsaved work appeared'); return { release: async () => {} }; } });
  await item.service.check(); await item.service.choose('now', '1.1.0');
  assert.equal(item.service.snapshot().phase, 'blocked'); assert.equal(item.calls.includes('download'), true); assert.equal(item.calls.includes('install'), false); item.service.close();
});
test('changed release identity, failed downloads and invalid checks cannot install', async () => {
  for (const mode of ['changed', 'download']) {
    let checks = 0, installs = 0;
    const item = fixture({ adapter: { check: async () => ({ ...release, version: mode === 'changed' && ++checks > 1 ? '1.2.0' : '1.1.0' }), download: async () => { throw Error('Download failed'); }, install: async () => { installs++; } } });
    await item.service.check(); await item.service.choose('now', '1.1.0'); assert.equal(item.service.snapshot().phase, 'error'); assert.equal(installs, 0); item.service.close();
  }
});
test('double Install now and stale release clicks do not create parallel installers', async () => {
  const item = fixture(); await item.service.check(); await item.service.choose('now', '1.0.9'); assert.equal(item.calls.includes('download'), false);
  await Promise.all([item.service.choose('now', '1.1.0'), item.service.choose('now', '1.1.0')]); assert.equal(item.calls.filter(call => call === 'install').length, 1); item.service.close();
});
test('same-version replacement cannot reuse review or a persisted schedule', async () => {
  const first = { ...release, files: [{ url: 'Frondose-1.1.0.zip', sha512: 'first reviewed digest', size: 300 }] };
  const changed = { ...first, files: [{ ...first.files[0], sha512: 'different digest' }] };
  let metadata = first, persisted;
  const rejectDownload = async () => assert.fail('changed package must not download');
  const { service } = fixture({ save: async value => { persisted = value; }, adapter: { check: async () => metadata, download: rejectDownload } });
  await service.check();
  await service.choose('tonight', '1.1.0');
  metadata = changed;
  await service.choose('now', '1.1.0');
  assert.equal(service.snapshot().phase, 'error');
  assert.match(service.snapshot().error, /selected release changed/i);
  service.close();
  const restarted = fixture({ load: async () => persisted, adapter: { check: async () => changed, download: rejectDownload } });
  await restarted.service.init();
  assert.equal((await restarted.service.check()).phase, 'available');
  assert.equal(restarted.service.snapshot().scheduledAt, null);
  restarted.service.close();
});
test('private preferences are atomic, installation-scoped, and reject linked or oversized files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'frondose-update-storage-'));
  try {
    const storage = createUpdateStorage(dir); assert.equal(await storage.load(), null);
    const receipt = { version: '1.1.0', choice: 'tonight', scheduledAt: 1234 }; await storage.save(receipt); assert.deepEqual(await storage.load(), receipt);
    const path = join(dir, 'app-updates', 'choices.json'); if (process.platform !== 'win32') assert.equal((await lstat(path)).mode & 0o077, 0);
    await writeFile(path, 'x'.repeat(17000)); await assert.rejects(storage.load());
    if (process.platform !== 'win32') { await rm(path); await symlink(join(dir, 'secret'), path); await assert.rejects(storage.load()); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('dirty form proof excludes searches and never captures password text', () => {
  const form = { elements: [{ id: 'name', type: 'text', value: 'before' }, { id: 'find', type: 'search', value: 'ignored' }, { id: 'password', type: 'password', value: 'must-not-leave-renderer' }] };
  const before = updateFormFingerprint(form); assert.doesNotMatch(before, /must-not|ignored/); form.elements[1].value = 'other'; assert.equal(updateFormFingerprint(form), before);
  form.elements[0].value = 'after'; assert.notEqual(updateFormFingerprint(form), before);
});
test('native bridge and frontend expose a narrow update flow, never feed URLs or shutdown commands', async () => {
  const [preload, main, ui, app] = await Promise.all(['desktop/preload.cjs', 'desktop/main.cjs', 'src/components/DesktopUpdates.jsx', 'src/App.jsx'].map(path => readFile(new URL('../' + path, import.meta.url), 'utf8')));
  assert.match(preload, /respondSafety/); assert.match(main, /trusted\(event\)/); assert.doesNotMatch(preload, /setFeedURL|quitAndInstall|feedUrl/);
  for (const label of ['Install tonight', 'Install now', 'Not now', 'Minimize', 'Go to Docs']) assert.ok(ui.includes(label));
  assert.match(app, /inert=\{nativeUpdateCritical/); assert.match(ui, /desktopUpdateDraftBlockers\(\)/);
});

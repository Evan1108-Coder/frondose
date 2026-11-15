import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import updater from '../desktop/local-update.cjs';

const run = promisify(execFile);
async function bundle(root, folder, version, identifier = 'app.frondose.desktop') {
  const app = join(root, folder, 'Frondose.app'), contents = join(app, 'Contents');
  await mkdir(join(contents, 'MacOS'), { recursive: true });
  await copyFile('/bin/echo', join(contents, 'MacOS/Frondose'));
  await chmod(join(contents, 'MacOS/Frondose'), 0o700);
  await writeFile(join(contents, 'Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleExecutable</key><string>Frondose</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`);
  await run('/usr/bin/codesign', ['--force', '--sign', '-', app]);
  return app;
}

test('owner-staged macOS offer is private, versioned, pinned and reverified before installation', { skip: process.platform !== 'darwin' }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'frondose-local-update-test-')));
  try {
    const current = await bundle(root, 'current', '1.0.0');
    const candidate = await bundle(root, 'next', '1.0.1');
    const wrong = await bundle(root, 'wrong', '1.0.2', 'invalid.other');
    const profile = join(root, 'profile'); await mkdir(profile, { mode: 0o700 });
    const app = { isPackaged: true, getVersion: () => '1.0.0', getPath: () => profile };
    const options = { app, execPath: join(current, 'Contents/MacOS/Frondose'), origin: 'http://127.0.0.1:4174', env: {} };
    const adapter = await updater.createLocalAdapter(options);
    assert(adapter);
    assert.equal(await updater.createLocalAdapter({ ...options, env: { FRONDOSE_DATA_DIR: profile } }), null);
    assert.equal(await adapter.check(), null);
    await assert.rejects(updater.stageLocalUpdate({ source: wrong, userData: profile }));
    await updater.stageLocalUpdate({ source: current, userData: profile });
    assert.equal(await adapter.check(), null);
    assert.equal(await updater.stageLocalUpdate({ source: candidate, userData: profile }), '1.0.1');
    assert.equal((await adapter.check()).version, '1.0.1');
    const progress = [];
    await adapter.download(value => progress.push(value));
    assert.deepEqual(progress, [10, 65, 100]);
    const path = join(profile, 'app-updates/local-offer.json');
    const offer = JSON.parse(await readFile(path, 'utf8'));
    const staged = join(profile, 'app-updates/local-candidates', offer.id, 'Frondose.app');
    await writeFile(join(staged, 'Contents/Info.plist'), (await readFile(join(staged, 'Contents/Info.plist'), 'utf8')) + '\n');
    await assert.rejects(adapter.check());
    await rm(path);
    await symlink(join(staged, 'Contents/Info.plist'), path);
    await assert.rejects(adapter.check(), /owner-only file/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { desktopBuildArguments } from '../scripts/desktop-package.mjs';

const require = createRequire(import.meta.url);
const targets = [
  { platform: 'darwin', branch: 'master-mac', flag: '--mac', runner: 'macos-latest', key: 'mac', installers: ['dmg', 'zip'] },
  { platform: 'win32', branch: 'master-windows', flag: '--win', runner: 'windows-latest', key: 'win', installers: ['nsis', 'zip'] },
  { platform: 'linux', branch: 'master-linux', flag: '--linux', runner: 'ubuntu-22.04', key: 'linux', installers: ['AppImage', 'deb'] },
];
test('desktop packaging injects its own target and rejects different hosts and target overrides', () => {
  for (const target of targets) {
    assert.deepEqual(desktopBuildArguments(['--dir', '--x64'], target, target.platform), ['--dir', '--x64', target.flag]);
    assert.deepEqual(desktopBuildArguments([target.flag], target, target.platform), [target.flag]);
    for (const other of targets.filter(item => item.platform !== target.platform)) {
      assert.throws(() => desktopBuildArguments([], target, other.platform), /branch builds on/);
      assert.throws(() => desktopBuildArguments([other.flag], target, target.platform), /matching platform branch/);
    }
    if (target.platform !== 'darwin') assert.throws(() => desktopBuildArguments(['--universal'], target, target.platform), /macOS only/);
  }
  for (const target of [{}, { platform: 'constructor', branch: 'master-mac' }, { platform: 'linux', branch: 'master-mac' }])
    assert.throws(() => desktopBuildArguments([], target, 'linux'), /target configuration/);
});
test('branch target, installer formats and native CI runner agree', async () => {
  const target = require('../config/desktop-target.json');
  const selection = targets.find(item => item.branch === target.branch && item.platform === target.platform);
  assert.ok(selection, 'known branch target');
  const config = require('../config/electron-builder.cjs');
  assert.deepEqual(config[selection.key].target, selection.installers);
  const workflow = await readFile(new URL('../.github/workflows/local-desktop.yml', import.meta.url), 'utf8');
  assert.ok(workflow.includes('runs-on: ' + selection.runner));
  assert.equal(workflow.split('branches: [' + selection.branch + ']').length, 3);
  assert.equal(workflow.includes('xvfb-run'), selection.platform === 'linux');
});

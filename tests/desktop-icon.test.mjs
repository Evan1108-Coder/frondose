import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyPackageInput, DESKTOP_PACKAGE_INPUTS } from '../scripts/desktop-package.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const native = join(root, 'desktop/assets/mac');
const require = createRequire(import.meta.url);

test('native Mac icon pins the approved exports without replacing website assets', async () => {
  const manifest = JSON.parse(await readFile(join(native, 'assets.json'), 'utf8'));
  assert.equal(manifest.scope, 'Native macOS app icon only');
  for (const asset of manifest.assets) {
    const bytes = await readFile(join(native, asset.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
    if (asset.file.endsWith('.png')) {
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      assert.equal(bytes.readUInt32BE(16), 1024); assert.equal(bytes.readUInt32BE(20), 1024);
      assert.equal(bytes[25], 6, 'PNG retains RGBA transparency');
    } else {
      assert.equal(bytes.subarray(0, 4).toString(), 'icns');
      assert.equal(bytes.readUInt32BE(4), bytes.length);
      let offset = 8, representations = 0;
      while (offset < bytes.length) {
        const length = bytes.readUInt32BE(offset + 4);
        assert(length >= 8 && offset + length <= bytes.length);
        if (/^ic(?:p[456]|0[45789]|1[0-4])$/.test(bytes.subarray(offset, offset + 4).toString())) representations++;
        offset += length;
      }
      assert.equal(offset, bytes.length); assert.equal(representations, 10);
    }
  }
});

test('Mac-only packaging uses ICNS while non-Mac and website artwork stay unchanged', () => {
  const config = require('../config/electron-builder.cjs');
  assert.equal(config.mac.icon, 'desktop/assets/mac/Frondose.icns');
  assert.equal(config.icon, 'public/brand/frondose-frond.png');
  assert.equal(config.appId, 'app.frondose.desktop');
  assert(config.files.includes('desktop/**'));
});

test('runtime sets the Mac Dock icon only after readiness and keeps other platforms separate', async () => {
  const source = await readFile(join(root, 'desktop/main.cjs'), 'utf8');
  assert.match(source, /process\.platform === 'darwin' \? join\(__dirname, 'assets\/mac\/Frondose\.png'\) : join\(root, 'public\/brand\/frondose-frond-icon\.png'\)/);
  assert.match(source, /icon: appIcon/);
  assert.match(source, /app\.whenReady\(\)\.then\(async \(\) => \{\s*if \(process\.platform === 'darwin'\) app\.dock\.setIcon\(appIcon\)/);
});

test('private staging carries native ICNS and PNG assets into future builds', async () => {
  assert(DESKTOP_PACKAGE_INPUTS.includes('desktop'));
  const temp = await mkdtemp(join(tmpdir(), 'frondose-native-icon-'));
  try {
    await copyPackageInput(native, join(temp, 'mac'));
    const names = await readdir(join(temp, 'mac'));
    assert(names.includes('Frondose.icns')); assert(names.includes('Frondose.png'));
  } finally { await rm(temp, { recursive: true, force: true }); }
});

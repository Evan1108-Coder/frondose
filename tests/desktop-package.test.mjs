import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { createRequire } from 'node:module';
import { DESKTOP_PACKAGE_INPUTS, packageArguments, stagingRoot, packagingEnvironment, copyPackageInput, desktopOutputDirectory } from '../scripts/desktop-package.mjs';
import { desktopBuildArchitecture, desktopProductionInstallArgs } from '../scripts/desktop-package.mjs';

test('Linux deb packaging has a project homepage and a maintainer address', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const config = createRequire(import.meta.url)('../config/electron-builder.cjs');
  assert.equal(new URL(manifest.homepage).protocol, 'https:');
  assert.ok(config.linux.target.includes('deb'));
  assert.match(config.linux.maintainer, /^[^<>]+ <[^@<>\s]+@[^<>\s]+>$/);
});

test('desktop packaging whitelist excludes private storage and does not source checkout node_modules', () => {
  assert.ok(DESKTOP_PACKAGE_INPUTS.includes('desktop'));
  assert.ok(DESKTOP_PACKAGE_INPUTS.includes('src/lib'));
  assert.ok(DESKTOP_PACKAGE_INPUTS.includes('package-lock.json'));
  for (const input of DESKTOP_PACKAGE_INPUTS) assert.doesNotMatch(input, /\.rumbo|\.frondose|\.env|^node_modules|^\.git|test-artifacts/);
});
test('packaging accepts one explicit target and architecture and never a publish command', () => {
  assert.deepEqual(packageArguments(['--dir', '--mac', '--arm64']), ['--dir', '--mac', '--arm64']);
  for (const input of [['--publish'], ['--dir', '--dir'], ['--win', '--linux'], ['--x64', '--arm64'], [';rm'], ['--config']]) assert.throws(() => packageArguments(input));
});
test('staging avoids whitespace without requiring the original project directory to move', () => {
  assert.throws(() => stagingRoot('/tmp/a directory'), /checkout does not need to move/);
  assert.equal(typeof stagingRoot('/private/tmp'), 'string');
});
test('a single-architecture package installs optional dependencies for its target CPU, not the build host', () => {
  assert.equal(desktopBuildArchitecture([], 'arm64'), 'arm64');
  assert.equal(desktopBuildArchitecture(['--arm64'], 'x64'), 'arm64');
  assert.equal(desktopBuildArchitecture(['--x64'], 'arm64'), 'x64');
  assert.ok(desktopProductionInstallArgs(desktopBuildArchitecture(['--arm64'], 'x64')).includes('--cpu=arm64'));
  assert.ok(desktopProductionInstallArgs(desktopBuildArchitecture(['--x64'], 'arm64')).includes('--cpu=x64'));
  assert.ok(!desktopProductionInstallArgs('universal').some(arg => arg.startsWith('--cpu=')));
});
test('a running application can be preserved with a separate bounded output directory', () => {
  const root = join(tmpdir(), 'frondose-output-test');
  assert.equal(desktopOutputDirectory(root), join(root, 'dist-desktop'));
  assert.equal(desktopOutputDirectory(root, 'dist-desktop-next'), join(root, 'dist-desktop-next'));
  for (const value of ['.', '..', '/', '../dist-desktop', 'src', 'dist-desktop/child']) assert.throws(() => desktopOutputDirectory(root, value), /dedicated/);
});
test('native build PATH explicitly contains the current Node pair and preserves Windows Path spelling', () => {
  const env = packagingEnvironment({ Path: 'original', OTHER: 'preserved' }, '/runtime/bin/node', '/tmp/private-tools');
  assert.equal(env.PATH, undefined); assert.equal(env.Path.split(delimiter)[0], '/tmp/private-tools');
  assert.equal(env.npm_node_execpath, '/runtime/bin/node'); assert.equal(env.OTHER, 'preserved'); assert.equal(env.CSC_IDENTITY_AUTO_DISCOVERY, 'false');
});
test('packaging copies only regular allowed inputs and refuses credential-link escapes', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'frondose-package-test-'));
  try {
    const source = join(temporary, 'source'), destination = join(temporary, 'staged');
    await mkdir(source); await writeFile(join(source, 'main.cjs'), 'source'); await writeFile(join(source, 'unit.test.mjs'), 'not included');
    await writeFile(join(source, 'manifest.webmanifest'), '{"name":"Frondose"}');
    await writeFile(join(source, '.env'), 'PRIVATE_TOKEN=not-a-real-token'); await writeFile(join(source, 'private.sqlite'), 'not a database');
    await copyPackageInput(source, destination);
    assert.deepEqual((await readdir(destination)).sort(), ['main.cjs', 'manifest.webmanifest']); assert.equal(await readFile(join(destination, 'main.cjs'), 'utf8'), 'source');
    assert.equal(await readFile(join(destination, 'manifest.webmanifest'), 'utf8'), '{"name":"Frondose"}');
    await symlink(join(source, 'main.cjs'), join(temporary, 'credential-link'));
    await assert.rejects(copyPackageInput(join(temporary, 'credential-link'), join(temporary, 'bad-copy')), /symbolic-link/);
    assert.equal(await readFile(join(source, 'main.cjs'), 'utf8'), 'source');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('the packaged client retains PDF decoders, font data, profiles and their licenses only from the built asset tree', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'frondose-package-pdf-'));
  try {
    const source = join(temporary, 'client'), destination = join(temporary, 'staged');
    const assets = {
      cmaps: ['Identity-H.bcmap'],
      standard_fonts: ['FoxitSerif.pfb', 'LICENSE_FOXIT'],
      wasm: ['openjpeg.wasm', 'LICENSE_OPENJPEG'],
      iccs: ['sRGB.icc', 'LICENSE'],
    };
    for (const [folder, files] of Object.entries(assets)) {
      const path = join(source, 'pdfjs', folder);
      await mkdir(path, { recursive: true });
      for (const file of files) await writeFile(join(path, file), file);
    }
    await writeFile(join(source, 'unrelated.wasm'), 'excluded');
    await writeFile(join(source, 'pdfjs', 'cmaps', 'private.sqlite'), 'excluded');
    await copyPackageInput(source, destination, { clientBuild:true });
    for (const [folder, files] of Object.entries(assets)) {
      assert.deepEqual((await readdir(join(destination, 'pdfjs', folder))).sort(), [...files].sort());
      for (const file of files) assert.equal(await readFile(join(destination, 'pdfjs', folder, file), 'utf8'), file);
    }
    assert.deepEqual(await readdir(destination), ['pdfjs']);
    const nonClient = join(temporary, 'non-client');
    await copyPackageInput(source, nonClient);
    assert.deepEqual(await readdir(join(nonClient, 'pdfjs', 'wasm')), []);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { DESKTOP_PACKAGE_INPUTS, packageArguments, stagingRoot, packagingEnvironment, copyPackageInput, desktopOutputDirectory } from '../scripts/desktop-package.mjs';

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

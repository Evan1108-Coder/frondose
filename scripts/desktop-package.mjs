// Native ABI rebuilds belong to an isolated staging application, never to the
// checkout whose node-pty is serving ordinary Node-based local workspaces.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildNativeTools } from './build-native-tools.mjs';
import releaseTools from '../desktop/release-build.cjs';

export const DESKTOP_PACKAGE_INPUTS = Object.freeze([
  'desktop', 'server', 'src/lib', 'scripts', 'third-party', 'config/electron-builder.cjs',
  'dist/client', 'public/brand/frondose-frond-icon.png', 'public/brand/frondose-frond.png', 'package.json', 'package-lock.json',
]);
const SOURCE_OR_ASSET = /\.(?:mjs|cjs|js|jsx|ts|tsx|swift|json|sql|css|txt|md|html|webmanifest|svg|png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf)$/i;
const LICENSE_NAME = /^(?:LICENSE(?:-[A-Za-z0-9.-]+)?|UNLICENSE|NOTICE|COPYING)$/i;
export function packageArguments(input = []) {
  const allowed = new Set(['--dir', '--mac', '--win', '--linux', '--x64', '--arm64', '--universal']);
  if (input.some(arg => !allowed.has(arg)) || new Set(input).size !== input.length) throw Error('Desktop packaging accepts --dir, one platform and one architecture only; publishing is not supported.');
  if (input.filter(arg => ['--mac', '--win', '--linux'].includes(arg)).length > 1 || input.filter(arg => ['--x64', '--arm64', '--universal'].includes(arg)).length > 1) throw Error('Build one target platform and architecture at a time.');
  return [...input];
}
const desktopTargets = Object.freeze({
  darwin: { branch: 'master-mac', flag: '--mac', name: 'macOS' },
  win32: { branch: 'master-windows', flag: '--win', name: 'Windows' },
  linux: { branch: 'master-linux', flag: '--linux', name: 'Linux' },
});
export function desktopBuildArguments(input, target, host = process.platform) {
  const args = packageArguments(input);
  const platform = target?.platform;
  const selected = typeof platform === 'string' && Object.hasOwn(desktopTargets, platform) ? desktopTargets[platform] : null;
  if (!selected || selected.branch !== target?.branch) throw Error('The desktop target configuration is invalid.');
  if (host !== platform) throw Error(`The ${selected.branch} branch builds on ${selected.name} only. Use the branch for your operating system.`);
  const requested = args.find(flag => ['--mac', '--win', '--linux'].includes(flag));
  if (requested && requested !== selected.flag) throw Error(`The ${selected.branch} branch cannot package ${requested}; use the matching platform branch.`);
  if (args.includes('--universal') && platform !== 'darwin') throw Error('Universal desktop packages are supported on macOS only.');
  return requested ? args : [...args, selected.flag];
}
export function stagingRoot(value = tmpdir()) {
  const directory = resolve(value);
  if (/\s/.test(directory)) throw Error('Native packaging needs a private writable staging path without spaces. Set FRONDOSE_DESKTOP_STAGING_ROOT to such a directory. Your checkout does not need to move.');
  return directory;
}
// Build beside an app that is currently running instead of replacing its
// executable/frameworks. Restrict output to a dedicated checkout child.
export function desktopOutputDirectory(root, requested) {
  const output = resolve(root, requested || 'dist-desktop');
  if (dirname(output) !== resolve(root) || !/^dist-desktop(?:-[a-z0-9]+)*$/.test(basename(output))) throw Error('Desktop output must be a dedicated dist-desktop directory inside the checkout.');
  return output;
}
export function desktopClientDirectory(root, requested) {
  if (!requested) return join(root, 'dist/client');
  const directory = resolve(root, requested);
  if (dirname(directory) !== resolve(root) || !/^dist-[a-z0-9]+(?:-[a-z0-9]+)*-client$/.test(basename(directory))) throw Error('Desktop client input must be a dedicated dist-*-client build inside the checkout.');
  return directory;
}
export function packagingEnvironment(env, executable, binaryDirectory) {
  const key = Object.keys(env).find(name => name.toLowerCase() === 'path') || 'PATH';
  return { ...env, [key]: [binaryDirectory, dirname(executable), env[key] || ''].filter(Boolean).join(delimiter), npm_node_execpath: executable, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
}
export async function copyPackageInput(source, destination) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw Error(`Packaging refuses a symbolic-link source: ${basename(source)}`);
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true, mode: 0o700 });
    for (const name of (await readdir(source)).sort()) {
      if (name.startsWith('.') || /\.test\.[^.]+$/.test(name)) continue;
      const info = await lstat(join(source, name));
      if (info.isFile() && !SOURCE_OR_ASSET.test(name) && !LICENSE_NAME.test(name)) continue;
      await copyPackageInput(join(source, name), join(destination, name));
    }
  } else if (info.isFile()) {
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await copyFile(source, destination, constants.COPYFILE_EXCL);
  } else throw Error('Only regular source files and directories can be packaged.');
}
async function nativeFingerprint(root) {
  const entries = [];
  async function visit(directory) {
    let names; try { names = await readdir(directory); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const name of names.sort()) {
      const path = join(directory, name), info = await lstat(path);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) await visit(path);
      else if (/\.(?:node|dll)$/i.test(name) || name === 'spawn-helper') entries.push([path.slice(root.length), createHash('sha256').update(await readFile(path)).digest('hex')]);
    }
  }
  await visit(root);
  return JSON.stringify(entries);
}
function run(executable, args, options) {
  return new Promise((yes, no) => {
    const child = spawn(executable, args, { ...options, stdio: 'inherit', shell: false, windowsHide: true });
    child.once('error', no);
    child.once('exit', (code, signal) => code === 0 ? yes() : no(Error(`Packaging command failed (${code ?? signal}): ${basename(args[0] || executable)}`)));
  });
}
async function npmCli(env, require) {
  let candidate = env.FRONDOSE_NPM_CLI || env.npm_execpath;
  if (!candidate) { try { candidate = require.resolve('npm/bin/npm-cli.js'); } catch {} }
  if (!candidate) throw Error('Run packaging through npm run desktop:pack, or provide FRONDOSE_NPM_CLI pointing to your npm CLI.');
  const path = await realpath(candidate);
  if (!/^npm-cli\.(?:js|cjs)$/.test(basename(path)) || !(await lstat(path)).isFile()) throw Error('Packaging requires the npm CLI JavaScript entry point.');
  return path;
}
async function writeNpmShims(directory, executable, npm) {
  await mkdir(directory, { mode: 0o700 });
  // Tools such as electron-builder may spawn npm by name. These private shims
  // resolve the same npm/Node pair even when the surrounding shell lacks PATH.
  const javascript = `#!/usr/bin/env node\nprocess.argv[1]=${JSON.stringify(npm)};import(${JSON.stringify(pathToFileURL(npm).href)}).catch(error=>{console.error(error);process.exitCode=1});\n`;
  await writeFile(join(directory, 'npm'), javascript, { mode: 0o700, flag: 'wx' });
  const quote = value => String(value).replaceAll('"', '""');
  await writeFile(join(directory, 'npm.cmd'), `@"${quote(executable)}" "${quote(npm)}" %*\r\n`, { flag: 'wx' });
}

export async function packageDesktop({ root = fileURLToPath(new URL('../', import.meta.url)), args = process.argv.slice(2), env = process.env } = {}) {
  root = await realpath(root);
  const desktopTarget = JSON.parse(await readFile(join(root, 'config/desktop-target.json'), 'utf8'));
  args = desktopBuildArguments(args, desktopTarget);
  const releaseConfig = releaseTools.releaseBuild(env, desktopTarget.platform, args);
  const output = desktopOutputDirectory(root, env.FRONDOSE_DESKTOP_OUTPUT_DIR);
  const clientDirectory = desktopClientDirectory(root, env.FRONDOSE_DESKTOP_CLIENT_DIR);
  if ((await lstat(clientDirectory)).isSymbolicLink()) throw Error('Desktop client input must not be a symbolic link.');
  try { if ((await lstat(output)).isSymbolicLink()) throw Error('Desktop output must not be a symbolic link.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await access(join(clientDirectory, 'index.html'));
  const require = createRequire(join(root, 'package.json'));
  const cli = require.resolve('electron-builder/cli.js');
  const npm = await npmCli(env, require);
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const buildVersion = env.FRONDOSE_DESKTOP_BUILD_VERSION;
  if (buildVersion != null && (buildVersion.length > 60 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(buildVersion))) throw Error('A local desktop build version must be a stable major.minor.patch version.');
  const electronVersion = packageJson.devDependencies?.electron;
  if (!/^\d+\.\d+\.\d+$/.test(electronVersion || '')) throw Error('Pin an exact Electron version before packaging.');
  const parent = stagingRoot(env.FRONDOSE_DESKTOP_STAGING_ROOT || tmpdir());
  await access(parent, constants.W_OK);
  const sourceNativeRoot = join(root, 'node_modules/node-pty');
  const before = await nativeFingerprint(sourceNativeRoot);
  const stage = await mkdtemp(join(parent, 'frondose-desktop-build-'));
  let failure;
  try {
    console.log('Preparing a private desktop staging application. The checkout and local database are not packaging inputs.');
    for (const input of DESKTOP_PACKAGE_INPUTS) await copyPackageInput(input === 'dist/client' ? clientDirectory : join(root, input), join(stage, input));
    if (releaseConfig) await writeFile(join(stage, 'desktop/release-config.json'), JSON.stringify(releaseConfig, null, 2) + '\n');
    if (buildVersion) {
      const lockPath = join(stage, 'package-lock.json');
      const lock = JSON.parse(await readFile(lockPath, 'utf8'));
      lock.version = lock.packages[''].version = buildVersion;
      await writeFile(lockPath, JSON.stringify(lock));
      await writeFile(join(stage, 'package.json'), JSON.stringify({ ...packageJson, version: buildVersion }));
    }
    if (process.platform === 'darwin' && !args.some(arg => ['--win','--linux'].includes(arg))) await buildNativeTools(join(stage,'desktop/bin/frondose-tools'),{architecture:args.includes('--universal')?'universal':args.includes('--arm64')?'arm64':args.includes('--x64')?'x64':process.arch});
    const tools = join(stage, '.frondose-build-bin');
    await writeNpmShims(tools, process.execPath, npm);
    const childEnv = packagingEnvironment(env, process.execPath, tools);
    childEnv.npm_execpath = npm;
    await run(process.execPath, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, env: childEnv });
    // This wrapper never publishes. Only the separately approved CI job has R2 permissions.
    await run(process.execPath, [cli, '--projectDir', stage, '--config', join(stage, 'config/electron-builder.cjs'), '--config.directories.output', output, '--config.electronVersion', electronVersion, '--publish', 'never', ...args], { cwd: stage, env: childEnv });
    await writeFile(join(output, 'frondose-build.json'), JSON.stringify({ version: buildVersion || packageJson.version, platform: desktopTarget.platform, targetBranch: desktopTarget.branch, architecture: process.arch, electronVersion, nodeVersion: process.version, nativeRebuild: 'isolated-staging-only', inputs: [...DESKTOP_PACKAGE_INPUTS], lockSha256: createHash('sha256').update(await readFile(join(stage, 'package-lock.json'))).digest('hex') }, null, 2) + '\n');
    console.log('Desktop package built. Root Node-native dependencies and local workspace data were not rebuilt or copied.');
  } catch (error) { failure = error; }
  finally { await rm(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  if (await nativeFingerprint(sourceNativeRoot) !== before) throw Error('The checkout node-pty binaries changed during packaging. The staging builder does not write there; inspect concurrent dependency operations before using the local server.');
  if (failure) throw failure;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await packageDesktop();
}

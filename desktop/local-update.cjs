'use strict';
const { execFile, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { constants } = require('node:fs');
const { access, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } = require('node:fs/promises');
const { basename, dirname, join, resolve } = require('node:path');
const { promisify } = require('node:util');
const { newerStableVersion } = require('./update-service.cjs');

const run = promisify(execFile);
const bundleName = 'Frondose.app';
const executable = 'Contents/MacOS/Frondose';
const plist = 'Contents/Info.plist';
const bundleId = 'app.frondose.desktop';
const manifest = 'local-offer.json';
const isVersion = value => typeof value === 'string' && value.length <= 60 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
const isHash = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const isId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const updateRoot = userData => join(userData, 'app-updates');
const candidatePath = (root, id) => join(root, 'local-candidates', id, bundleName);

async function ownedDirectory(path, create = false) {
  if (create) await mkdir(path, { mode: 0o700, recursive: true });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o022) || await realpath(path) !== path) throw Error('Local updates require a real, owner-controlled staging folder.');
}

async function bundleIdentity(path) {
  if (basename(path) !== bundleName || !(await lstat(path)).isDirectory() || await realpath(path) !== path) throw Error('Select a real Frondose.app bundle.');
  const metadata = field => run('/usr/libexec/PlistBuddy', ['-c', `Print ${field}`, join(path, plist)], { timeout: 5000 }).then(({ stdout }) => stdout.trim());
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  const [id, name, version, display] = await Promise.all([
    metadata('CFBundleIdentifier'), metadata('CFBundleExecutable'), metadata('CFBundleShortVersionString'),
    run('/usr/bin/codesign', ['-d', '--verbose=4', '-a', arch, path], { timeout: 10000, maxBuffer: 32768 }),
  ]);
  const hash = /^CDHash=([a-f0-9]{40})$/m.exec(display.stderr)?.[1];
  if (id !== bundleId || name !== 'Frondose' || !isVersion(version) || !isHash(hash)) throw Error('The local bundle is not a compatible, signed Frondose build.');
  return { version, hash };
}

async function verifyBundle(path, pin) {
  const identity = await bundleIdentity(path);
  if (pin && (identity.hash !== pin.hash || identity.version !== pin.version)) throw Error('The local build no longer matches the staged version and signature. Stage it again to review it.');
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--all-architectures', path], { timeout: 90000, maxBuffer: 32768 });
  return identity;
}

async function copyBundle(from, to) {
  await run('/usr/bin/ditto', [from, to], { timeout: 120000, maxBuffer: 32768 });
}

// This is invoked by the owner from the checkout, never by IPC or the browser.
async function stageLocalUpdate({ source, userData }) {
  if (process.platform !== 'darwin') throw Error('Owner-staged local updates currently support macOS only.');
  const root = updateRoot(await realpath(resolve(userData)));
  const pin = await verifyBundle(resolve(source));
  const id = randomUUID(), target = candidatePath(root, id), directory = dirname(target);
  await ownedDirectory(root, true);
  await ownedDirectory(dirname(directory), true);
  await mkdir(directory, { mode: 0o700 });
  const pending = join(root, `${id}.tmp`);
  try {
    await copyBundle(resolve(source), target);
    await verifyBundle(target, pin);
    await writeFile(pending, JSON.stringify({ id, ...pin }) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(pending, join(root, manifest));
    return pin.version;
  } catch (error) {
    await rm(pending, { force: true });
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
}

async function readOffer(root) {
  const path = join(root, manifest);
  const stat = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (!stat) return null;
  await ownedDirectory(root);
  if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size > 2048) throw Error('The local update offer is not an owner-only file.');
  const offer = JSON.parse(await readFile(path, 'utf8'));
  if (!isId(offer?.id) || !isVersion(offer.version) || !isHash(offer.hash)) throw Error('The local update offer is invalid. Stage the build again.');
  return { id: offer.id, version: offer.version, hash: offer.hash };
}

// The trusted, installed app supplies this code and the pinned identities. It
// does not execute anything from the candidate until verification and the swap.
const installScript = String.raw`
set -eu
pid=$1 target=$2 stage=$3 store=$4 old=$5 next=$6 arch=$7 profile=$8 origin=$9
shift 9
noAccounts=$1
ready=$2
candidate="$stage/Frondose.app"
previous="$stage/previous/Frondose.app"
exec >>"$stage/install.log" 2>&1
same_code() {
  [ -d "$1" ] && [ ! -L "$1" ] &&
    /usr/bin/codesign -d --verbose=4 -a "$arch" "$1" 2>&1 | /usr/bin/grep -Fxq "CDHash=$2"
}
reopen() {
  if [ "$noAccounts" = 1 ]; then
    /usr/bin/open -n -a "$target" --env "FRONDOSE_DESKTOP_USER_DATA=$profile" --env "FRONDOSE_DESKTOP_URL=$origin" --env FRONDOSE_DESKTOP_NO_ACCOUNT_READS=1
  else
    /usr/bin/open -n -a "$target"
  fi
}
swapped=0
recover() {
  code=$?
  trap - EXIT
  if [ "$code" -ne 0 ]; then
    echo "Update interrupted (step $swapped; exit $code)."
    if [ "$swapped" -eq 2 ]; then /bin/mv "$target" "$stage/failed.app" || exit "$code"; fi
    if [ "$swapped" -ge 1 ]; then /bin/mv "$previous" "$target" || exit "$code"; fi
    if [ "$swapped" -ne 0 ] || [ "$code" -ne 75 ]; then reopen || true; fi
  fi
  exit "$code"
}
trap recover EXIT
i=0
while /bin/kill -0 "$pid" 2>/dev/null; do
  i=$((i+1)); [ "$i" -lt 180 ] || exit 75
  /bin/sleep 1
done
[ -f "$ready" ] || exit 75
same_code "$target" "$old" || exit 75
if /bin/ps -axo comm= | /usr/bin/grep -Fxq "$target/Contents/MacOS/Frondose"; then exit 75; fi
same_code "$candidate" "$next"
/usr/bin/codesign --verify --deep --strict --all-architectures "$candidate"
/bin/mkdir "$stage/previous"
if [ -e "$store" ] || [ -L "$store" ]; then
  [ -d "$store" ] && [ ! -L "$store" ]
  /usr/bin/ditto "$store" "$stage/workspace-store"
fi
/bin/mv "$target" "$previous"
swapped=1
/bin/mv "$candidate" "$target"
swapped=2
reopen
echo 'Installed verified local build; previous app and workspace backup retained.'
`;

async function createLocalAdapter({ app, origin, execPath = process.execPath, env = process.env }) {
  if (process.platform !== 'darwin' || !app.isPackaged || !isVersion(app.getVersion())) return null;
  if (env.FRONDOSE_DATA_DIR || env.TALVORI_DATA_DIR || env.RUMBO_DATA_DIR) return null;
  const fixture = env.FRONDOSE_DESKTOP_NO_ACCOUNT_READS === '1' && Boolean(env.FRONDOSE_DESKTOP_USER_DATA);
  if (!fixture && (env.FRONDOSE_DESKTOP_USER_DATA || env.FRONDOSE_DESKTOP_URL)) return null;
  const target = dirname(dirname(dirname(execPath)));
  if (execPath !== join(target, executable) || target.includes('/AppTranslocation/')) return null;
  const profile = app.getPath('userData'), root = updateRoot(profile);
  let installed;
  try {
    await access(dirname(target), constants.W_OK);
    installed = await bundleIdentity(target);
    if (installed.version !== app.getVersion()) return null;
  } catch { return null; }
  let offered, checked, staged, preparing, handoff = false;
  async function removeStage() {
    if (staged && !handoff) { const directory = staged.directory; staged = null; await rm(directory, { force: true, recursive: true }); }
  }
  return {
    async fingerprint() {
      const stat = await lstat(join(root, manifest)).catch(() => null);
      return stat ? `${stat.ino}:${stat.mtimeMs}:${stat.size}` : null;
    },
    async check() {
      const offer = await readOffer(root);
      if (!offer || !newerStableVersion(offer.version, installed.version)) { offered = checked = null; return null; }
      // The Update button authorizes the staged build shown, not any new build
      // someone registers under the same version before the button is pressed.
      if (offered?.version === offer.version && offered.hash !== offer.hash) throw Error('A different build is already staged for this version. Stage it with a newer version to offer it safely.');
      const path = candidatePath(root, offer.id);
      await ownedDirectory(dirname(path));
      await verifyBundle(path, offer);
      offered = checked = { ...offer, path };
      return { version: offer.version, artifactIdentity: offer.hash, releaseName: `Frondose ${offer.version} (Local Build)`, releaseNotes: 'This owner-staged Mac build will replace this copy of Frondose and reopen it. Save your drafts and close running terminals first. This is not a public release.' };
    },
    async download(progress) {
      if (!checked) throw Error('No verified local build is available.');
      await removeStage();
      const offer = checked;
      preparing = await mkdtemp(join(dirname(target), '.frondose-local-update-'));
      try {
        const copy = join(preparing, bundleName);
        progress(10);
        await copyBundle(offer.path, copy);
        progress(65);
        await verifyBundle(copy, offer);
        staged = { directory: preparing, offer };
        progress(100);
      } catch (error) { await rm(preparing, { force: true, recursive: true }); throw error; }
      finally { preparing = null; }
    },
    async install() {
      if (!staged) throw Error('The local build was not prepared.');
      const { directory, offer } = staged;
      const ready = join(directory, 'ready');
      const child = spawn('/bin/sh', ['-c', installScript, 'frondose-local-update', String(process.pid), target, directory,
        join(profile, 'workspace-store'), installed.hash, offer.hash, process.arch === 'arm64' ? 'arm64' : 'x86_64', profile, origin, fixture ? '1' : '0', ready],
      { detached: true, stdio: 'ignore', shell: false, env: { PATH: '/usr/bin:/bin' } });
      await new Promise((yes, no) => { child.once('spawn', yes); child.once('error', no); });
      child.unref();
      await writeFile(ready, '', { flag: 'wx', mode: 0o600 });
      handoff = true;
      app.quit();
      return new Promise(() => {});
    },
    cancel() { if (!preparing) void removeStage().catch(() => {}); },
  };
}

module.exports = { createLocalAdapter, stageLocalUpdate };

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import updater from '../desktop/update-service.cjs';
import releaseSignature from '../desktop/release-signature.cjs';

export const targets = {
  'mac-arm64': { manifest: 'latest-mac.yml', update: ['.zip'], download: '.dmg' },
  'mac-x64': { manifest: 'latest-mac.yml', update: ['.zip'], download: '.dmg' },
  'windows-x64': { manifest: 'latest.yml', update: ['.exe'], download: '.exe' },
  'linux-x64': { manifest: 'latest-linux.yml', update: ['.AppImage'], download: '.AppImage', alternate: '.deb' },
};
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const filenamePattern = /^Frondose[- _A-Za-z0-9.]*\.(?:dmg|zip|exe|AppImage|blockmap)$|^frondose[-_A-Za-z0-9.]*\.deb$/;
const hashFile = async (path, algorithm, encoding) => {
  const hash = createHash(algorithm);
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest(encoding);
};

export async function reviewTarget(dir, target, version, parse) {
  if (!Object.hasOwn(targets, target) || !versionPattern.test(version) || version === '0.0.0') throw Error('Invalid release target or version.');
  const contract = targets[target];
  const meta = join(dir, contract.manifest);
  const metaInfo = await lstat(meta);
  if (!metaInfo.isFile() || metaInfo.size > 65536) throw Error('Expected a small regular update manifest.');
  const manifest = parse(await readFile(meta, 'utf8'));
  if (manifest?.version !== version || manifest.stagingPercentage != null || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 12) throw Error('Manifest has the wrong version, unsupported rollout settings, or no files.');
  const entries = new Map();
  for (const name of await readdir(dir)) {
    if (name === contract.manifest) continue;
    if (!filenamePattern.test(name) || !name.match(/(?:^|[-_ ])(\d+\.\d+\.\d+)(?=[-_. ])/)?.[1] || name.match(/(?:^|[-_ ])(\d+\.\d+\.\d+)(?=[-_. ])/)[1] !== version) throw Error('Unexpected release artifact: ' + name);
    const file = join(dir, name);
    const info = await lstat(file);
    if (!info.isFile() || info.size < 1) throw Error('Expected a nonempty regular release artifact.');
    entries.set(name, { name, file, size: info.size, sha256: await hashFile(file, 'sha256', 'hex') });
  }
  function fileFor(url) {
    if (typeof url !== 'string' || /[\/\\?#:]/.test(url)) throw Error('An update asset must be a relative file in its target directory.');
    const key = decodeURIComponent(url);
    const entry = entries.get(key);
    if (!entry) throw Error('Missing local update asset: ' + key);
    return entry;
  }
  const seen = new Set();
  for (const file of manifest.files) {
    const asset = fileFor(file.url);
    if (seen.has(asset.name) || file.size !== asset.size || file.sha512 !== await hashFile(asset.file, 'sha512', 'base64')) throw Error('Duplicate asset or invalid manifest size/hash: ' + asset.name);
    seen.add(asset.name);
  }
  if (manifest.path != null) {
    const top = fileFor(manifest.path);
    if (!seen.has(top.name) || manifest.sha512 !== await hashFile(top.file, 'sha512', 'base64')) throw Error('Legacy update path and hash must match the verified manifest.');
  }
  for (const ext of contract.update) if (![...seen].some(name => name.endsWith(ext))) throw Error('No supported update binary in the manifest: ' + ext);
  for (const ext of [contract.download, contract.alternate].filter(Boolean)) {
    if ([...entries.keys()].filter(name => name.endsWith(ext)).length !== 1) throw Error('Expected exactly one downloadable package: ' + ext);
  }
  return { entries: [...entries.values()], meta, manifest: contract.manifest, info: manifest };
}

async function signLinuxManifest(plan, dump, env = process.env) {
  const signed = releaseSignature.signLinuxRelease(plan.info, {
    privateKey: env.FRONDOSE_RELEASE_LINUX_SIGNING_KEY,
    publicKey: env.FRONDOSE_RELEASE_LINUX_PUBLIC_KEY,
  });
  await writeFile(plan.meta, dump(signed));
}

async function publish({ root, version, endpoint, bucket, publicRoot, parse, dump }) {
  const httpsRoot = updater.releaseConfiguration({ feedUrl: publicRoot }).feedUrl;
  if (!httpsRoot || new URL(httpsRoot).pathname !== '/' || !/^https:\/\/[0-9a-f]{32}\.r2\.cloudflarestorage\.com\/?$/i.test(endpoint) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw Error('Invalid R2 bucket, S3 endpoint, or public origin.');
  const aws = async (command, key, extra = []) => {
    const r = await promisify(execFile)('aws', ['s3api', command, '--endpoint-url', endpoint, '--bucket', bucket, '--key', key, ...extra], { timeout: 8 * 60 * 1000, maxBuffer: 1024 * 1024 });
    return JSON.parse(r.stdout || '{}');
  };
  const readCurrent = async (key) => {
    try { return await aws('head-object', key); }
    catch (e) { if (/\(404\)|Not Found|NoSuchKey/.test(e.stderr ?? '')) return null; throw e; }
  };
  const verified = [];
  for (const target of Object.keys(targets)) {
    const plan = await reviewTarget(join(root, target), target, version, parse);
    if (target === 'linux-x64') await signLinuxManifest(plan, dump);
    const prefix = 'stable/' + target + '/';
    const key = prefix + plan.manifest;
    const old = await readCurrent(key);
    const manifestHash = await hashFile(plan.meta, 'sha256', 'hex');
    const identical = old?.Metadata?.version === version && old.Metadata.sha256 === manifestHash;
    if (old && !identical && (!old.Metadata?.version || !updater.newerStableVersion(version, old.Metadata.version))) throw Error('Target ' + target + ' already has this version or a newer/unknown release.');
    verified.push({ ...plan, prefix, key, old, manifestHash, identical });
  }
  // Stage every package before announcing a single new version.
  for (const plan of verified) {
    for (const file of plan.entries) {
      const key = plan.prefix + file.name;
      const old = await readCurrent(key);
      if (old) {
        if (old.Metadata?.sha256 !== file.sha256 || old.ContentLength !== file.size) throw Error('Refusing to replace a versioned artifact: ' + key);
      } else {
        await aws('put-object', key, ['--if-none-match', '*', '--body', file.file, '--metadata', 'sha256=' + file.sha256, '--cache-control', 'public, max-age=31536000, immutable', '--content-type', 'application/octet-stream']);
      }
      const url = new URL(plan.prefix + encodeURIComponent(file.name), httpsRoot);
      const response = await fetch(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok || Number(response.headers.get('content-length')) !== file.size) throw Error('Public artifact not reachable with expected size: ' + key);
    }
  }
  // Targets have independent manifest objects; each transition is safe even
  // if the run is interrupted while updating a later platform.
  for (const plan of verified) {
    if (!plan.identical) await aws('put-object', plan.key, [plan.old ? '--if-match' : '--if-none-match', plan.old?.ETag ?? '*', '--body', plan.meta, '--metadata', 'version=' + version + ',sha256=' + plan.manifestHash, '--cache-control', 'no-store, max-age=0', '--content-type', 'application/yaml; charset=utf-8']);
    const response = await fetch(new URL(plan.key, httpsRoot), { redirect: 'error', signal: AbortSignal.timeout(15000), cache: 'no-store' });
    if (!response.ok || createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex') !== plan.manifestHash) throw Error('The deployed manifest is stale or inaccessible: ' + plan.key);
    console.log('Published and verified ' + plan.key + ' at ' + version);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const require = createRequire(import.meta.url);
  const { load: parse, dump } = createRequire(require.resolve('electron-updater/package.json'))('js-yaml');
  const [operation, directory, targetOrVersion, version] = process.argv.slice(2);
  if (operation === 'review') {
    const plan = await reviewTarget(directory, targetOrVersion, version, parse);
    console.log('Verified release manifest and hashes for ' + plan.entries.length + ' files.');
  } else if (operation === 'sign-linux-qa') {
    const plan = await reviewTarget(directory, 'linux-x64', targetOrVersion, parse);
    await signLinuxManifest(plan, dump);
  } else if (operation === 'publish' && process.env.GITHUB_ACTIONS === 'true') {
    await publish({ root: directory, version: targetOrVersion, endpoint: process.env.R2_ENDPOINT || '', bucket: process.env.R2_BUCKET || '', publicRoot: process.env.FRONDOSE_UPDATES_ORIGIN, parse, dump });
  } else {
    throw Error('Use review <dir> <target> <version>, or publish from protected GitHub Actions.');
  }
}

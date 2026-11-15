import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
export async function buildNativeTools(destination = join(root, 'desktop/bin/frondose-tools'), { architecture = process.arch } = {}) {
  if (process.platform !== 'darwin') return null;
  if (!['x64','arm64','universal'].includes(architecture)) throw Error('Unsupported native helper architecture.');
  await mkdir(dirname(destination), { recursive: true });
  const temporary = await mkdtemp(join(tmpdir(), 'frondose-native-build-')), run = promisify(execFile);
  try {
    for (const arch of architecture === 'universal' ? ['x64','arm64'] : [architecture]) await run('/usr/bin/xcrun', ['swiftc', '-O', '-target', (arch === 'x64' ? 'x86_64' : 'arm64') + '-apple-macos13.0', '-module-cache-path', join(temporary,'modules'), join(root, 'desktop/native/FrondoseTools.swift'), '-o', architecture === 'universal' ? join(temporary,arch) : destination, '-framework', 'AppKit', '-framework', 'ApplicationServices', '-framework', 'AVFoundation', '-framework', 'Speech'], { timeout: 240_000, maxBuffer: 1_000_000 });
    if (architecture === 'universal') await run('/usr/bin/lipo',['-create',join(temporary,'x64'),join(temporary,'arm64'),'-output',destination]);
    await run('/usr/bin/codesign',['--force','--sign','-',destination]);
  } finally { await rm(temporary,{recursive:true,force:true}); }
  return destination;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(await buildNativeTools(process.argv[2]));

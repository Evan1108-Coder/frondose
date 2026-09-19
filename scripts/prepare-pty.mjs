// node-pty's macOS prebuilt spawn-helper can be published without its executable
// bit. Repair only the package-owned helper paths, never user executables.
import { chmod, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
if (process.platform === 'darwin') {
  const packageRoot = dirname(require.resolve('node-pty/package.json'));
  for (const directory of ['build/Release', 'build/Debug', 'prebuilds/darwin-arm64', 'prebuilds/darwin-x64']) {
    const helper = join(packageRoot, directory, 'spawn-helper');
    try {
      const info = await stat(helper);
      if (info.isFile() && !(info.mode & 0o111)) await chmod(helper, 0o755);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

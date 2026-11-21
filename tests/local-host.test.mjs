import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { build, createServer } from 'vite';
import config from '../vite.config.mjs';

const secret = 'FRONDOSE_TEST_SENTINEL_DO_NOT_SERVE_91be4d30';
const execFileAsync = promisify(execFile);
async function makeFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rumbo-private-host-test-')));
  await mkdir(join(root, '.rumbo'));
  await mkdir(join(root, '.git'));
  await writeFile(join(root, '.rumbo', 'integrations.private.json'), JSON.stringify({ test: secret }), { mode: 0o600 });
  await writeFile(join(root, '.rumbo', 'frondose.sqlite'), secret);
  await writeFile(join(root, '.env'), `FRONDOSE_TEST_SECRET=${secret}`);
  await writeFile(join(root, '.env.local'), `FRONDOSE_TEST_SECRET=${secret}`);
  await writeFile(join(root, '.git', 'config'), secret);
  await writeFile(join(root, 'test.pem'), secret);
  await writeFile(join(root, 'index.html'), '<!doctype html><html><body><main>Public Frondose fixture</main><script type="module" src="/app.js"></script></body></html>');
  await writeFile(join(root, 'app.js'), 'document.querySelector("main").dataset.ready = "true";');
  return root;
}

test('local host binds loopback and blocks private data through direct and transformed Vite routes', { timeout: 20000 }, async (t) => {
  const root = await makeFixture();
  assert.equal(config.server.host, '127.0.0.1');
  // This fixture has no imports. Do not prebundle the app's React dependencies
  // against a temporary root or share an optimizer cache with parallel UI runs.
  const server = await createServer({ ...config, root, cacheDir: join(root, '.vite-test-cache'), optimizeDeps: { include: [], noDiscovery: true }, configFile: false, appType: 'custom', plugins: [], logLevel: 'silent', server: { ...config.server, port: 0, strictPort: false, warmup: { clientFiles: [] }, fs: { ...config.server.fs, allow: [root] } } });
  t.after(async () => { server.httpServer?.closeAllConnections(); await server.close(); await rm(root, { recursive: true, force: true }); });
  await server.listen();
  const address = server.httpServer.address();
  assert.equal(address.address, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  const publicResponse = await fetch(`${base}/app.js`, { signal: AbortSignal.timeout(5000) });
  assert.equal(publicResponse.status, 200);
  assert.match(await publicResponse.text(), /dataset.ready/);
  const paths = [
    '/.rumbo/integrations.private.json', '/.rumbo/frondose.sqlite', '/%2Erumbo/integrations.private.json',
    '/.rumbo%2Fintegrations.private.json', '/.env', '/.env.local', '/.git/config', '/test.pem',
    `/@fs/${root}/.rumbo/integrations.private.json`, `/@fs/${root}/.rumbo/frondose.sqlite`,
  ];
  for (const path of paths) {
    for (const query of ['', '?raw', '?url', '?import', '?raw&import']) {
      const response = await fetch(`${base}${path}${query}`, { signal: AbortSignal.timeout(5000) });
      const text = await response.text();
      assert.equal(text.includes(secret), false, `Secret exposed at ${path}${query}`);
      assert.ok(response.status === 403 || response.status === 404, `${path}${query}: expected denied access, received ${response.status}`);
    }
  }
});

test('production build includes referenced public code but excludes credentials and local data', { timeout: 20000 }, async (t) => {
  const root = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const outDir = join(root, 'dist', 'client');
  await build({ ...config, root, configFile: false, plugins: [], logLevel: 'silent', build: { ...config.build, outDir, emptyOutDir: true } });
  // Exercise the actual Sites packager in the isolated fixture. It must copy only
  // the worker and hosting config beside public assets, not the local server/data.
  await mkdir(join(root, 'scripts')); await mkdir(join(root, 'worker')); await mkdir(join(root, '.openai'));
  await writeFile(join(root, 'scripts', 'prepare-sites-build.mjs'), await readFile(resolve('scripts/prepare-sites-build.mjs'), 'utf8'));
  await writeFile(join(root, 'worker', 'index.js'), 'export default { fetch() { return new Response("Public worker fixture"); } };');
  await writeFile(join(root, '.openai', 'hosting.json'), '{"d1":null,"r2":null}');
  await execFileAsync(process.execPath, [join(root, 'scripts', 'prepare-sites-build.mjs')], { cwd: root });
  const outputRoot = join(root, 'dist');
  const entries = (await readdir(outputRoot, { recursive: true })).map(entry => entry.split(sep).join('/'));
  assert.ok(entries.includes('client/index.html'));
  assert.ok(entries.includes('server/index.js'));
  assert.ok(entries.includes('.openai/hosting.json'));
  assert.equal(entries.some((entry) => /(?:\.rumbo|\.env|\.sqlite|integrations\.private|\.pem|\.git)/.test(entry)), false);
  for (const entry of entries) {
    if (!/\.(?:html|js|css|json|map)$/.test(entry)) continue;
    assert.equal((await readFile(join(outputRoot, entry), 'utf8')).includes(secret), false, `Private sentinel was bundled into ${entry}`);
  }
});

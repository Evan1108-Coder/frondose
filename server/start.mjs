import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { realpath, realpathSync } from 'node:fs';
import { promisify } from 'node:util';
import { resolve, relative, isAbsolute, sep, extname, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createLocalApi } from './local-api.mjs';
import { frondoseEnvironment, frondoseDataDirectory } from './brand-config.mjs';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm':'application/wasm', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
// Use the same OS canonicalization for the startup boundary and each read.
// Windows temporary paths can otherwise differ as RUNNER~1 vs the long name.
const canonicalPath = promisify(realpath.native);
export function containsPath(root, candidate, path = { relative, isAbsolute, sep }) {
  const rel = path.relative(root, candidate);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

export function createFrondoseServer({ env = process.env, apiOptions = {}, clientDirectory = fileURLToPath(new URL('../dist/client/', import.meta.url)) } = {}) {
  env = frondoseEnvironment(env);
  const root = realpathSync.native(clientDirectory);
  const dataDirectory = frondoseDataDirectory(apiOptions.dataDir || env.FRONDOSE_DATA_DIR);
  if (containsPath(root, dataDirectory)) throw Error('Private Frondose data must not be stored in the public client directory.');
  const api = createLocalApi({ ...apiOptions, productMode: 'local', dataDir: dataDirectory, integrationOptions: { ...apiOptions.integrationOptions, env } });
  if (containsPath(root, realpathSync.native(dirname(api.dbPath)))) { api.close(); throw Error('Private Frondose data cannot resolve inside public client assets.'); }
  const server = createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; worker-src 'self'; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    api.middleware(req, res, () => { void (async () => {
      if (!['GET', 'HEAD'].includes(req.method)) { res.statusCode = 405; res.end(); return; }
      let path; try { path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.statusCode = 400; res.end(); return; }
      if (path.split('/').some(part => part.startsWith('.')) || path.includes('\\')) { res.statusCode = 404; res.end(); return; }
      const inside = value => containsPath(root, value);
      let candidate = resolve(root, `.${path}`);
      if (!inside(candidate)) { res.statusCode = 404; res.end(); return; }
      try { candidate = await canonicalPath(candidate); if (!inside(candidate) || !(await stat(candidate)).isFile()) throw Error('not a static asset'); }
      catch {
        if (extname(path) || path === '/api' || path.startsWith('/api/')) { res.statusCode = 404; res.end(); return; }
        candidate = await canonicalPath(resolve(root, 'index.html'));
        if (!inside(candidate)) { res.statusCode = 404; res.end(); return; }
      }
      // Only this pinned decoder worker needs WebAssembly compilation. The
      // application document retains its stricter no-eval policy.
      if(/^assets\/pdf\.worker(?:\.min)?-[A-Za-z0-9_-]+\.(?:mjs|js)$/.test(relative(root,candidate).replaceAll('\\','/')))res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'");
      res.setHeader('Content-Type', types[extname(candidate)] || 'application/octet-stream');
      res.setHeader('Cache-Control', extname(candidate) === '.html' ? 'no-store' : 'public, max-age=3600');
      if (req.method === 'HEAD') { res.end(); return; }
      res.end(await readFile(candidate));
    })().catch(() => { res.statusCode = 500; res.end('Frondose could not serve this file. Build the client before starting.'); }); });
  });
  server.once('close', () => api.close());
  return { server, api };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 4174);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw Error('PORT must be between 1 and 65535.');
  const { server } = createFrondoseServer();
  server.listen(port, '127.0.0.1', () => console.log(`Frondose local edition listening on 127.0.0.1:${port}. Single owner; public hosting disabled.`));
  const close = () => { server.close(); setTimeout(() => process.exit(1), 5000).unref(); };
  process.once('SIGTERM', close); process.once('SIGINT', close);
}

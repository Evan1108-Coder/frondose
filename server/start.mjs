import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, extname, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createLocalApi } from './local-api.mjs';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
export function createRumboServer({ env = process.env, apiOptions = {}, clientDirectory = fileURLToPath(new URL('../dist/client/', import.meta.url)) } = {}) {
  const root = realpathSync(clientDirectory);
  const dataDirectory = resolve(apiOptions.dataDir || env.RUMBO_DATA_DIR || resolve(process.cwd(), '.rumbo'));
  const dataRelative = relative(root, dataDirectory);
  if (!dataRelative || dataRelative !== '..' && !dataRelative.startsWith('../') && !isAbsolute(dataRelative)) throw Error('Private Rumbo data must not be stored in the public client directory.');
  const api = createLocalApi({ ...apiOptions, dataDir: apiOptions.dataDir || env.RUMBO_DATA_DIR, integrationOptions: { ...apiOptions.integrationOptions, env } });
  const actualRelative = relative(root, realpathSync(dirname(api.dbPath)));
  if (!actualRelative || actualRelative !== '..' && !actualRelative.startsWith('../') && !isAbsolute(actualRelative)) { api.close(); throw Error('Private Rumbo data cannot resolve inside public client assets.'); }
  const server = createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    api.middleware(req, res, () => { void (async () => {
      if (!['GET', 'HEAD'].includes(req.method)) { res.statusCode = 405; res.end(); return; }
      let path; try { path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.statusCode = 400; res.end(); return; }
      if (path.split('/').some(part => part.startsWith('.')) || path.includes('\\')) { res.statusCode = 404; res.end(); return; }
      const inside = value => { const rel = relative(root, value); return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel); };
      let candidate = resolve(root, `.${path}`);
      if (!inside(candidate)) { res.statusCode = 404; res.end(); return; }
      try { candidate = await realpath(candidate); if (!inside(candidate) || !(await stat(candidate)).isFile()) throw Error('not a static asset'); }
      catch {
        if (extname(path) || path === '/api' || path.startsWith('/api/')) { res.statusCode = 404; res.end(); return; }
        candidate = await realpath(resolve(root, 'index.html'));
        if (!inside(candidate)) { res.statusCode = 404; res.end(); return; }
      }
      res.setHeader('Content-Type', types[extname(candidate)] || 'application/octet-stream');
      res.setHeader('Cache-Control', extname(candidate) === '.html' ? 'no-store' : 'public, max-age=3600');
      if (req.method === 'HEAD') { res.end(); return; }
      res.end(await readFile(candidate));
    })().catch(() => { res.statusCode = 500; res.end('Rumbo could not serve this file. Build the client before starting.'); }); });
  });
  server.once('close', () => api.close());
  return { server, api };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 4174);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw Error('PORT must be between 1 and 65535.');
  const { server } = createRumboServer();
  server.listen(port, '127.0.0.1', () => console.log(`Rumbo backend listening on 127.0.0.1:${port}. Public mode requires an HTTPS reverse proxy.`));
  const close = () => { server.close(); setTimeout(() => process.exit(1), 5000).unref(); };
  process.once('SIGTERM', close); process.once('SIGINT', close);
}

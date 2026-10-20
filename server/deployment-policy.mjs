import { isIP } from 'node:net';
import { frondoseEnvironment } from './brand-config.mjs';

const loopback = value => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(value);
const fail = (code, message) => Object.assign(new Error(message), { code, statusCode: 403 });
export function createDeploymentPolicy(env = {}) {
  env = frondoseEnvironment(env);
  const mode = env.FRONDOSE_DEPLOYMENT_MODE || 'local';
  if (!['local', 'public'].includes(mode)) throw new Error('FRONDOSE_DEPLOYMENT_MODE must be local or public.');
  const hosted = mode === 'public'; let origin;
  if (hosted) {
    try { origin = new URL(env.FRONDOSE_PUBLIC_BASE_URL); } catch { throw new Error('Public mode requires an exact HTTPS FRONDOSE_PUBLIC_BASE_URL.'); }
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('Public mode requires a public HTTPS origin with no path or credentials.');
    if (!/^[A-Za-z0-9+/]{43}=$/.test(env.FRONDOSE_CONNECTION_ENCRYPTION_KEY || '') || Buffer.from(env.FRONDOSE_CONNECTION_ENCRYPTION_KEY, 'base64').length !== 32) throw new Error('Public mode requires a stable server-only 32-byte base64 FRONDOSE_CONNECTION_ENCRYPTION_KEY.');
  }
  const authAttempts = new Map();
  function checkRequest(req) {
    if (!hosted) return;
    if (req.headers.host !== origin.host) throw fail('invalid_host', 'This request does not match the configured public Frondose origin.');
    const proxied = env.FRONDOSE_TRUST_LOOPBACK_PROXY === '1' && loopback(req.socket?.remoteAddress) && req.headers['x-forwarded-proto'] === 'https';
    if (!req.socket?.encrypted && !proxied) throw fail('https_required', 'Public Frondose requires HTTPS through its configured trusted proxy.');
    const requestOrigin = req.headers.origin;
    if (requestOrigin && requestOrigin !== origin.origin || !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && requestOrigin !== origin.origin) throw fail('invalid_origin', 'Public API changes require the exact same HTTPS origin.');
  }
  function throttleIdentity(req, path) {
    if (!hosted || req.method !== 'POST' || !['/identity/login', '/identity/accept'].includes(path)) return;
    const forwarded = req.headers['x-forwarded-for'];
    const address = env.FRONDOSE_TRUST_LOOPBACK_PROXY === '1' && loopback(req.socket?.remoteAddress) && typeof forwarded === 'string' && isIP(forwarded) ? forwarded : req.socket?.remoteAddress || 'unknown';
    const now = Date.now(); for (const [key, entry] of authAttempts) if (entry.until < now) authAttempts.delete(key);
    const key = `${address}:${path}`, entry = authAttempts.get(key) || { attempts: 0, until: now + 900000 };
    if (entry.attempts >= 30 || authAttempts.size > 10000) throw Object.assign(fail('rate_limited', 'Too many sign-in attempts. Try again later.'), { statusCode: 429 });
    entry.attempts++; authAttempts.set(key, entry);
  }
  function assertConfigured(identity, seedMode) {
    if (hosted && (seedMode === 'demo' || !identity.configured())) throw new Error('Before public mode, provision the owner account in local mode. Public mode is invite-only and never grants development-owner access.');
  }
  return { hosted, origin: origin?.origin || null, checkRequest, throttleIdentity, assertConfigured };
}

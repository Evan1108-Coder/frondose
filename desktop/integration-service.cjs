'use strict';
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const https = require('node:https');
const dns = require('node:dns/promises');
const net = require('node:net');
const { createUpdateStorage } = require('./update-storage.cjs');
const { CATALOG, credentials, createProviderClient } = require('./integration-providers.cjs');
function publicAddress(address) {
  if (net.isIP(address) === 4) { const [a,b,c] = address.split('.').map(Number); return a !== 0 && a !== 10 && a !== 127 && a < 224 && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0)) && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) && !(a === 203 && b === 0 && c === 113); }
  // Fail closed for mapped/transition/private IPv6; globally routed unicast only.
  return net.isIP(address) === 6 && /^[23][\da-f]{0,3}:/i.test(address) && !/^200[12]:(?:db8|0|10|20)?/i.test(address);
}
async function providerRequest(address, options = {}) {
  const url = new URL(address);
  if (url.protocol !== 'https:' || url.port && url.port !== '443' || url.username || url.password || url.hash || net.isIP(url.hostname)) throw Error('Provider requests require a public HTTPS hostname.');
  const records = await dns.lookup(url.hostname, { all: true });
  if (!records.length || records.some(record => !publicAddress(record.address))) throw Error('This provider resolves to a private or unsupported network address. Use a public HTTPS provider host.');
  const record = records[0];
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: options.method || 'GET', headers: options.headers, timeout: 10000, lookup(_host, _options, callback) { if (_options?.all) callback(null, [record]); else callback(null, record.address, record.family); } }, response => {
      if (response.statusCode < 200 || response.statusCode >= 300) { response.resume(); reject(Error(`Provider request failed (${response.statusCode}). Check token scopes, account access and provider availability.`)); return; }
      let bytes = 0, chunks = [];
      response.on('data', chunk => { bytes += chunk.length; if (bytes > 524288) { response.destroy(); reject(Error('Provider response exceeded the 512 KiB safety limit. Narrow access at the provider.')); } else chunks.push(chunk); });
      response.once('error', () => reject(Error('Provider response was interrupted.')));
      response.once('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Error('Provider returned invalid JSON.')); } });
    });
    request.on('timeout', () => request.destroy(Error('Provider request timed out. No action was retried.')));
    request.on('error', () => reject(Error('Provider request could not complete. Check your network and account access.')));
    request.end(options.body);
  });
}
function createLocalIntegrations({ userData, safeStorage, authorizeWorkspace, platform = process.platform, request = providerRequest, storageFor = key => createUpdateStorage(join(userData, 'integrations', key)) }) {
  let busy = false;
  // Use the non-blocking OS key store where available. Keep Linux's existing
  // backend verification: the async API does not expose its fallback provider.
  const asyncStorage = platform !== 'linux' && ['isAsyncEncryptionAvailable', 'encryptStringAsync', 'decryptStringAsync'].every(method => typeof safeStorage[method] === 'function');
  const secure = async () => asyncStorage ? safeStorage.isAsyncEncryptionAvailable() : safeStorage.isEncryptionAvailable() && (platform !== 'linux' || ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(safeStorage.getSelectedStorageBackend?.()));
  const encrypt = text => asyncStorage ? safeStorage.encryptStringAsync(text) : safeStorage.encryptString(text);
  const decrypt = async bytes => {
    if (!asyncStorage) return safeStorage.decryptString(bytes);
    const decoded = await safeStorage.decryptStringAsync(bytes);
    if (decoded.isTemporarilyUnavailable || typeof decoded.result !== 'string') throw Error('The OS credential store is unavailable. Unlock it and retry.');
    return decoded.result;
  };
  const storage = (workspaceId, providerId) => storageFor(createHash('sha256').update(JSON.stringify([workspaceId, providerId])).digest('hex'));
  const decode = record => {
    if (!record || record.disconnected === true) throw Error('Connect this provider before using its resources.');
    if (record.version !== 1 || typeof record.encrypted !== 'string' || !record.encrypted.length || record.encrypted.length > 12000 || !Array.isArray(record.resources) || record.resources.length > 100 || record.resources.some(id => typeof id !== 'string' || id.length > 500)) throw Error('Saved integration is invalid. Clear its saved connection before reconnecting.');
    return record;
  };
  async function status(workspaceId, provider) {
    const empty = { ...provider, connected: false, account: null, selected: [] };
    try {
      const record = await storage(workspaceId, provider.id).load();
      if (!record || record.disconnected === true) return empty;
      decode(record);
      return { ...provider, connected: true, account: typeof record.account === 'string' ? record.account.slice(0, 300) : null, selected: record.resources };
    } catch {
      // A broken record is not a healthy connection and must never take down
      // the entire catalog. Do not include disk paths or parser diagnostics.
      return { ...empty, needsRepair: true };
    }
  }
  async function command(payload = {}) {
    if (busy) throw Error('Another integration operation is in progress.');
    if (typeof payload.workspaceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(payload.workspaceId)) throw Error('Choose a valid workspace.');
    busy = true;
    try {
      await authorizeWorkspace(payload.workspaceId);
      if (payload.operation === 'catalog') {
        const statuses = await Promise.all(CATALOG.map(provider => status(payload.workspaceId, provider)));
        // Metadata only: even a synchronous availability probe can request
        // Keychain permission and stall the desktop server on first open.
        return { providers: statuses, native: true };
      }
      if (!CATALOG.some(item => item.id === payload.providerId)) throw Error('Choose a supported integration.');
      const store = storage(payload.workspaceId, payload.providerId);
      if (payload.operation === 'disconnect') { await store.save({ disconnected: true }); return { disconnected: true }; }
      if (payload.operation === 'connect') {
        if (payload.confirmed !== true) throw Error('Confirm the provider and token permissions first.');
        const account = credentials(payload.providerId, payload.credentials);
        if (!await secure()) throw Error('Secure OS credential storage is unavailable. Unlock your system keychain or credential service and try again.');
        const provider = createProviderClient(payload.providerId, account, request), identity = await provider.identity();
        const encrypted = (await encrypt(JSON.stringify(account))).toString('base64');
        await store.save({ version: 1, encrypted, account: identity, resources: [] });
        return { connected: true, account: identity };
      }
      if (!['resources', 'select', 'read'].includes(payload.operation)) throw Error('Unsupported integration operation. Remote writes and automatic syncing are not enabled.');
      const record = decode(await store.load());
      if (!await secure()) throw Error('Secure OS credential storage is unavailable. Unlock your system keychain or credential service and try again.');
      let account; try { account = credentials(payload.providerId, JSON.parse(await decrypt(Buffer.from(record.encrypted, 'base64')))); } catch { throw Error('The OS could not unlock this provider credential. Unlock your system credential store and try again.'); }
      const provider = createProviderClient(payload.providerId, account, request);
      if (payload.operation === 'resources') return { resources: (await provider.resources()).slice(0, 100), selected: record.resources };
      if (payload.operation === 'select') {
        if (!Array.isArray(payload.resourceIds) || payload.resourceIds.length > 100 || payload.resourceIds.some(id => typeof id !== 'string' || id.length > 500) || new Set(payload.resourceIds).size !== payload.resourceIds.length) throw Error('Choose up to 100 unique resources.');
        const available = await provider.resources(); if (payload.resourceIds.some(id => !available.some(item => item.id === id))) throw Error('Some resources are no longer accessible. Refresh before selecting.');
        await store.save({ ...record, resources: payload.resourceIds }); return { selected: payload.resourceIds };
      }
      if (payload.operation === 'read') {
        if (typeof payload.resourceId !== 'string' || !record.resources.includes(payload.resourceId) || !['issues', 'pulls'].includes(payload.kind)) throw Error('Select this resource before reading its items.');
        return { items: await provider.items(payload.resourceId, payload.kind), limited: true, maxItems: 50 };
      }
    } finally { busy = false; }
  }
  return { command };
}
module.exports = { createLocalIntegrations, publicAddress, providerRequest };

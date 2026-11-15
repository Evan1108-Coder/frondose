'use strict';
const { spawn } = require('node:child_process');
const { access } = require('node:fs/promises');
const { constants } = require('node:fs');
const { join } = require('node:path');
const { homedir } = require('node:os');
const { randomUUID } = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const AI_APPLICATIONS = Object.freeze([
  { id: 'codex', name: 'Codex', path: '/Applications/Codex.app' },
  { id: 'claude', name: 'Claude', path: '/Applications/Claude.app' },
  { id: 'chatgpt', name: 'ChatGPT', path: '/Applications/ChatGPT.app' },
  { id: 'cursor', name: 'Cursor', path: '/Applications/Cursor.app' },
  { id: 'windsurf', name: 'Windsurf', path: '/Applications/Windsurf.app' },
  { id: 'antigravity', name: 'Antigravity', path: '/Applications/Antigravity.app' },
]);
function createDesktopWorkstationTools({ platform = process.platform, helper = join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'bin/frondose-tools'), authorizeWorkspace, spawnProcess = spawn, accessible = path => access(path, constants.X_OK), now = Date.now } = {}) {
  async function installedApp(row) {
    for (const path of [row.path,join(homedir(),row.path)]) {
      try { await accessible(path); return path; } catch {}
    }
    return null;
  }
  const grants = new Map(), speech = new Map(), children = new Set(), busy = new Set(); let closed = false;
  function launch(command, args, request, { streaming = false, onRecord = () => {} } = {}) {
    if (closed) throw Error('Native tools are shutting down.');
    const child = spawnProcess(command, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } }); children.add(child);
    let bytes = 0, buffer = '', last, settled = false; const decoder = new StringDecoder('utf8');
    let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    // A stopped helper owns no arbitrary OS processes. Retain it until close.
    const stop = () => { if (!settled) { child.kill('SIGTERM'); const force=setTimeout(()=>{if(!settled)child.kill('SIGKILL');},1500);force.unref?.();child.once('close',()=>clearTimeout(force)); } };
    const timer = setTimeout(() => { stop(); reject(Error(streaming ? 'Dictation reached its five-minute limit.' : 'The native helper timed out.')); }, streaming ? 300_000 : 15_000); timer.unref?.();
    const consume = line => { if (!line.trim()) return; try { last = JSON.parse(line); onRecord(last); } catch { stop(); reject(Error('The native helper returned invalid output.')); } };
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 18_000_000) { stop(); reject(Error('Native output exceeded its limit.')); return; } buffer += decoder.write(chunk); let index; while ((index = buffer.indexOf('\n')) !== -1) { consume(buffer.slice(0, index)); buffer = buffer.slice(index + 1); } });
    child.stderr.on('data', () => {}); child.stdin.on('error', () => {});
    child.once('error', () => { clearTimeout(timer); children.delete(child); settled = true; reject(Error('The native helper could not start.')); });
    child.once('close', code => { settled = true; clearTimeout(timer); children.delete(child); buffer += decoder.end(); consume(buffer); if (last?.error) reject(Error(last.error)); else if (code && code !== 0) reject(Error('The native helper failed.')); else resolve(last || {}); });
    child.stdin.end(request ? JSON.stringify(request) : '');
    return { child, promise, stop };
  }
  async function native(request) { return launch(helper, [], request).promise; }
  async function command(payload, release = false) {
    const p = payload || {}, workspaceId = p.workspaceId;
    if (typeof workspaceId !== 'string' || workspaceId.length > 100) throw Error('Choose a local workspace.');
    if(p.scopeId!==undefined&&(typeof p.scopeId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(p.scopeId)))throw Error('Choose a valid control scope.');
    if(release&&!['capabilities','ai/open','computer/revoke','dictation/stop'].includes(p.operation)) {
      if(typeof p.operation==='string' && /^(computer|dictation)\//.test(p.operation)) throw Error('Computer Use and Dictation are coming soon.');
      throw Error('Unsupported native tool action.');
    }
    const grantKey=workspaceId+':'+(p.scopeId||'manual');
    // Revocation and stopping an owned microphone remain possible while locked;
    // they do not grant access or return private transcripts without auth.
    if(p.operation==='computer/revoke'){grants.delete(grantKey);return {revoked:true};}
    if(p.operation==='dictation/stop'){
      const current=speech.get(workspaceId);if(current){current.state.phase='stopping';current.handle.stop();await current.handle.promise.catch(()=>{});current.state.phase='stopped';}
      if(release)return {phase:'stopped'};
      try{await authorizeWorkspace(workspaceId);return current?.state||{phase:'idle',text:''};}catch{return {phase:'stopped'};}
    }
    try{await authorizeWorkspace(workspaceId);}catch(cause){for(const key of grants.keys())if(key.startsWith(workspaceId+':'))grants.delete(key);speech.get(workspaceId)?.handle.stop();throw cause;}
    if (p.operation === 'capabilities') {
      const apps = await Promise.all(AI_APPLICATIONS.map(async row => ({ id:row.id,name:row.name,installed:platform==='darwin'&&Boolean(await installedApp(row)) })));
      if(release)return {platform,computer:'coming-soon',dictation:'coming-soon',apps};
      let installed = false; try { await accessible(helper); installed = platform === 'darwin'; } catch {}
      return { platform, computer: installed ? 'available' : platform === 'darwin' ? 'setup-required' : 'unsupported', dictation: installed ? 'available' : platform === 'darwin' ? 'setup-required' : 'unsupported', apps };
    }
    if (p.operation === 'dictation/state') return speech.get(workspaceId)?.state || { phase: 'idle', text: '' };
    if (platform !== 'darwin') throw Error('This native backend currently supports macOS only.');
    if (p.operation === 'computer/permissions') return native({ operation: 'permissions' });
    if (p.operation === 'computer/apps') return native({ operation: 'apps' });
    if (p.confirmed !== true) throw Error('Confirm this exact native action.');
    if (busy.has(workspaceId)) throw Error('Another native action is still in progress.');
    busy.add(workspaceId);
    try {
      if (p.operation === 'ai/open') {
        const app = AI_APPLICATIONS.find(row => row.id === p.appId); if (!app) throw Error('Choose a supported AI application.');
        const path=await installedApp(app);if(!path)throw Error('The selected desktop application is not installed.');
        await launch('/usr/bin/open', ['-a', path], null).promise;
        return { opened: true, name: app.name };
      }
      if (p.operation === 'computer/request-permission') return native({ operation: 'requestAccessibility' });
      if (p.operation === 'computer/grant') {
        if (!Number.isSafeInteger(p.pid) || p.pid <= 0 || typeof p.bundleId !== 'string') throw Error('Choose a running application.');
        const apps = await native({ operation: 'apps' });
        if (!apps.apps?.some(row => row.pid === p.pid && row.bundleId === p.bundleId)) throw Error('This app is no longer available.');
        const permissions = await native({ operation: 'permissions' }); if (!permissions.accessibility) throw Error('Allow Accessibility access first.');
        if(permissions.screenLocked===true||permissions.interactiveSession===false)throw Error('Unlock and activate this Mac before authorizing an application.');
        if(grants.size>=64&&!grants.has(grantKey))throw Error('Revoke an unused app-control grant before authorizing another.');
        grants.set(grantKey, { pid: p.pid, bundleId: p.bundleId, expires: now() + 300_000 }); return { granted: true };
      }
      if (p.operation?.startsWith('computer/')) {
        const grant = grants.get(grantKey); if (!grant || grant.expires < now()) { grants.delete(grantKey); throw Error('Select and authorize this application again.'); }
        if (p.operation === 'computer/snapshot') {
          const snapshot = await native({ operation: 'snapshot', pid: grant.pid, bundleId: grant.bundleId });
          if(grants.get(grantKey)!==grant||grant.expires<now())throw Error('The app-control grant expired or was revoked.');
          grant.snapshot = snapshot; grant.snapshotId = randomUUID(); grant.snapshotAt = now();
          return { ...snapshot, snapshotId: grant.snapshotId };
        }
        if (!['computer/press', 'computer/set-value', 'computer/scroll', 'computer/screenshot'].includes(p.operation) || p.snapshotId !== grant.snapshotId || now() - grant.snapshotAt > 15_000) throw Error('Refresh the application snapshot before acting.');
        if (p.operation === 'computer/screenshot') {
          if (!Number.isSafeInteger(p.windowId) || !grant.snapshot?.windows?.some(row => row.id === p.windowId)) throw Error('Choose a window from this app snapshot.');
          grant.snapshotId = null;
          return native({ operation: 'screenshot', pid: grant.pid, bundleId: grant.bundleId, windowId: p.windowId });
        }
        const element = grant.snapshot?.elements?.[p.index];
        if (!Number.isSafeInteger(p.index) || !element || (p.operation === 'computer/press' ? !element.press : p.operation === 'computer/scroll' ? !['up','down'].includes(p.direction) || !element.scroll?.includes(p.direction === 'up' ? 'AXScrollUpByPage' : 'AXScrollDownByPage') : !element.editable)) throw Error('This element does not support that action.');
        if (p.operation === 'computer/set-value' && (typeof p.text !== 'string' || p.text.length > 20000 || p.text.includes('\0'))) throw Error('Enter bounded text.');
        const fresh = await native({ operation: 'snapshot', pid: grant.pid, bundleId: grant.bundleId });
        const target=fresh.elements?.find(row=>JSON.stringify(row.path)===JSON.stringify(element.path));
        const identity=row=>row&&JSON.stringify([row.path,row.role,row.title,row.value,row.valueHash,row.windowTitle,row.editable,row.press,row.scroll]);
        if (grants.get(grantKey) !== grant || grant.expires<now() || identity(target) !== identity(element)) { grant.snapshotId = null; throw Error('The selected control changed. Refresh its snapshot before acting.'); }
        grant.snapshotId = null; // The review is single use, even after a failure.
        return native({ operation: p.operation === 'computer/press' ? 'press' : p.operation === 'computer/scroll' ? 'scroll' : 'setValue', pid: grant.pid, bundleId: grant.bundleId, path: element.path, role: element.role, title: element.title, expectedWindow:element.windowTitle, direction: p.direction, ...(p.operation === 'computer/set-value' ? { text: p.text, expectedValueHash: element.valueHash } : {}) });
      }
      if (p.operation === 'dictation/start') {
        const existing = speech.get(workspaceId);
        if (existing && ['starting', 'recording', 'stopping'].includes(existing.state.phase)) throw Error('Dictation is already active.');
        if ([...speech.values()].some(value => ['starting', 'recording', 'stopping'].includes(value.state.phase))) throw Error('Another workspace is using the microphone.');
        if (speech.size >= 32 && !speech.has(workspaceId)) throw Error('Restart Frondose before starting dictation in more workspaces.');
        if (!['en-US', 'en-GB', 'zh-HK', 'zh-TW', 'zh-CN', 'ja-JP', 'ko-KR', 'es-ES', 'fr-FR', 'de-DE'].includes(p.locale)) throw Error('Choose a supported dictation language.');
        const entry = { state: { phase: 'starting', text: '' }, handle: null };
        const handle = launch(helper, [], { operation: 'dictate', locale: p.locale }, { streaming: true, onRecord: record => { if (record.ready) entry.state.phase = 'recording'; if (typeof record.text === 'string') entry.state.text = record.text.slice(0, 50_000); if (record.error) { entry.state.error = record.error; entry.state.phase = 'failed'; } } });
        entry.handle = handle; speech.set(workspaceId, entry);
        void handle.promise.then(() => { entry.state.phase = 'stopped'; }, cause => { entry.state.error = cause.message; entry.state.phase = 'failed'; });
        return { ...entry.state };
      }
      throw Error('Unsupported native tool action.');
    } finally { busy.delete(workspaceId); }
  }
  function close() { closed = true; grants.clear(); for (const child of children) child.kill('SIGTERM'); }
  return { command, releaseCommand: payload => command(payload, true), close };
}
module.exports = { createDesktopWorkstationTools, AI_APPLICATIONS };

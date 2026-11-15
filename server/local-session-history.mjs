// Parser record selection adapted from stablyai/orca, Copyright (c) 2026
// Lovecast Inc. MIT, revision 51dcef8258230ffea85a907130450b0ad676e22b.
// See third-party/orca/NOTICE.md. Frondose owns consent, bounds and root guards.
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, opendir, realpath, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITS = Object.freeze({ entries: 8000, files: 600, fileBytes: 8_000_000, scanBytes: 64_000_000, indexText: 8_000_000, sessionText: 96_000, records: 300, results: 40 });
export const LOCAL_SESSION_HISTORY_PROVIDERS = Object.freeze([{ id: 'codex', name: 'Codex', supported: true }, { id: 'claude', name: 'Claude Code', supported: true }]);
const problem = (message, code = 'session_history_error', statusCode = 400) => Object.assign(new Error(message), { code, errorCode: code, statusCode });
const hash = value => createHash('sha256').update(value).digest('hex');
const inside = (root, target) => { const part = relative(root, target); return part === '' || part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part); };
const stamp = info => `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
const plain = (value, max = 200) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const text = value => typeof value === 'string' ? value : Array.isArray(value) ? value.filter(block => ['text', 'input_text', 'output_text'].includes(block?.type) && typeof block.text === 'string').map(block => block.text).join('\n') : '';
const nonUserCodex = meta => ['subagent', 'internal'].some(tag => meta.source === tag || meta.source && typeof meta.source === 'object' && Object.hasOwn(meta.source, tag)) || ['subagent', 'guardian_review', 'memory_consolidation'].includes(meta.thread_source || meta.threadSource);

/** Only user/assistant plain text is searchable. Never decode tools, system
 * prompts, thinking/reasoning blocks, API blobs, images or credential files. */
export function parseLocalSessionJsonl(providerId, content, { headerOnly = false } = {}) {
  if (!['codex', 'claude'].includes(providerId) || typeof content !== 'string') return null;
  let sessionId = null, cwd = null, title = '', firstAt = null, lastAt = null, metaSeen = false, paginated = false, rejected = false;
  const response = [], events = [], completed = [], claude = []; let textBytes = 0;
  const add = (target, role, value) => { const valueText = text(value); if (!valueText.trim() || !['user', 'assistant'].includes(role)) return; const clipped = valueText.slice(0, Math.max(0, LIMITS.sessionText - textBytes)); textBytes += clipped.length; target.push({ role, text: clipped }); };
  for (const line of content.split(/\r?\n/).slice(0, 12000)) {
    if (!line || line.length > 128_000) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const at = date(row.timestamp); if (at) { firstAt ||= at; if (!lastAt || at > lastAt) lastAt = at; }
    if (providerId === 'codex') {
      const payload = row.payload;
      if (row.type === 'session_meta' && !metaSeen && payload && typeof payload === 'object') {
        metaSeen = true; sessionId = payload.id; cwd = payload.cwd; title = plain(payload.title || payload.thread_name || payload.threadName, 160); paginated = payload.history_mode === 'paginated'; rejected = nonUserCodex(payload);
      }
      if (headerOnly || rejected || !payload) continue;
      if (row.type === 'response_item' && payload.type === 'message' && payload.channel !== 'analysis') add(response, payload.role, payload.content);
      if (row.type === 'event_msg' && ['user_message', 'agent_message'].includes(payload.type)) add(events, payload.type === 'user_message' ? 'user' : 'assistant', payload.message);
      if (row.type === 'event_msg' && payload.type === 'item_completed') {
        const item = payload.item; if (['UserMessage', 'user_message', 'AgentMessage', 'agent_message'].includes(item?.type)) add(completed, ['UserMessage', 'user_message'].includes(item.type) ? 'user' : 'assistant', item.content);
      }
    } else {
      if (row.isSidechain === true) rejected = true;
      if (typeof row.sessionId === 'string') { if (sessionId && sessionId !== row.sessionId) rejected = true; sessionId ||= row.sessionId; }
      if (!cwd && typeof row.cwd === 'string') cwd = row.cwd; // Preserve origin, not later cwd drift.
      if (row.type === 'custom-title') title = plain(row.customTitle, 160);
      if (!title && row.type === 'ai-title') title = plain(row.aiTitle, 160);
      if (!headerOnly && ['user', 'assistant'].includes(row.type) && row.isMeta !== true) add(claude, row.type, row.message?.content);
    }
  }
  if (rejected || !UUID.test(sessionId || '') || typeof cwd !== 'string' || !isAbsolute(cwd) || /[\0\r\n]/.test(cwd) || cwd.length > 4096) return null;
  const messages = providerId === 'claude' ? claude : paginated ? completed : response.length ? response : events;
  // Event user text is a better fallback title than injected AGENTS/context
  // response items, when both event and response channels are recorded.
  title ||= plain((providerId === 'codex' ? events.find(item => item.role === 'user') : null)?.text || messages.find(item => item.role === 'user')?.text, 160) || `${providerId === 'claude' ? 'Claude Code' : 'Codex'} session`;
  return { providerId, sessionId: sessionId.toLowerCase(), cwd: resolve(cwd), title, firstAt, lastAt, messageCount: messages.length, content: messages.map(item => item.text).join('\n').slice(0, LIMITS.sessionText), truncated: textBytes >= LIMITS.sessionText || content.split(/\r?\n/).length > 12000 };
}

export function createLocalSessionHistoryService({ dataDir, roots, env = process.env, homeDir = env.HOME || env.USERPROFILE || homedir(), historyRoots, now = () => Date.now() } = {}) {
  const indexes = new Map(), scanning = new Set(), resumes = new Set(); let closed = false, preferenceQueue = Promise.resolve();
  const codexHome=env.CODEX_HOME&&isAbsolute(env.CODEX_HOME)?env.CODEX_HOME:join(homeDir,'.codex');
  const codexArchive=historyRoots?historyRoots.codexArchive:join(codexHome,'archived_sessions');
  const providerRoots = historyRoots || { codex: join(env.CODEX_HOME && isAbsolute(env.CODEX_HOME) ? env.CODEX_HOME : join(homeDir, '.codex'), 'sessions'), claude: join(env.CLAUDE_CONFIG_DIR && isAbsolute(env.CLAUDE_CONFIG_DIR) ? env.CLAUDE_CONFIG_DIR : join(homeDir, '.claude'), 'projects') };
  const defaults = () => ({ version: 1, enabled: false, allowAll: false, epoch: randomUUID() });
  async function privateFile() { return join(await realpath(resolve(dataDir)), 'local-session-history-settings.json'); }
  async function safeRead(file, maximum, prefix = false) {
    const before = await lstat(file, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(maximum) && !prefix) throw problem('This session source is unavailable or exceeds the read limit.', 'history_source_unavailable', 409);
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const info = await handle.stat({ bigint: true });
      if (stamp(before) !== stamp(info) || !info.isFile() || info.nlink !== 1n) throw problem('The session source changed.', 'history_source_changed', 409);
      const bytes = Buffer.alloc(Math.min(Number(info.size), maximum)); let offset = 0;
      while (offset < bytes.length) { const read = await handle.read(bytes, offset, bytes.length - offset, offset); if (!read.bytesRead) break; offset += read.bytesRead; }
      const after = await handle.stat({ bigint: true }), visible = await lstat(file, { bigint: true });
      if (stamp(info) !== stamp(after) || stamp(after) !== stamp(visible) || visible.isSymbolicLink()) throw problem('The session source changed.', 'history_source_changed', 409);
      return { content: bytes.subarray(0, offset).toString('utf8'), stamp: stamp(info), bytes: offset, size: Number(info.size) };
    } finally { await handle.close(); }
  }
  async function preferences() {
    try {
      const file = await privateFile(), info = await lstat(file, { bigint: true });
      if (process.platform !== 'win32' && ((info.mode & 0o077n) !== 0n || typeof process.getuid === 'function' && info.uid !== BigInt(process.getuid()))) throw problem('History settings must remain private to the installation owner.', 'history_settings_unsafe', 409);
      const value = JSON.parse((await safeRead(file, 8192)).content);
      if (value.version !== 1 || typeof value.enabled !== 'boolean' || typeof value.allowAll !== 'boolean' || !UUID.test(value.epoch || '')) throw Error('Invalid settings');
      for (const [key, index] of indexes) if (!value.enabled || index.epoch !== value.epoch) indexes.delete(key);
      return { version: 1, enabled: value.enabled, allowAll: value.allowAll, epoch: value.epoch };
    } catch (error) { indexes.clear(); if (error.code === 'ENOENT') return defaults(); if (error.statusCode) throw error; throw problem('Local history settings cannot be read safely.', 'history_settings_unsafe', 409); }
  }
  async function authorize(workspaceId, actor) { if (closed) throw problem('History search is closed.', 'history_closed', 503); if (actor?.id !== 'local-owner') throw problem('Local history belongs to this computer’s owner.', 'access_denied', 403); return roots.get(workspaceId, actor); }
  async function scopeFor(workspaceId, actor, input, settings) {
    const summary = await authorize(workspaceId, actor), scope = input.scope || 'workspace';
    if (!['workspace', 'project', 'all'].includes(scope)) throw problem('Choose Workspace, Project or All local sessions.');
    if (scope === 'all' && !settings.allowAll) throw problem('Enable searching all local session directories separately first.', 'history_all_not_allowed', 403);
    let root = null, projectId = null, version = summary.binding?.version || null;
    if (scope === 'workspace') { const context = await roots.rootFor(workspaceId, actor); root = context.root; projectId = context.row.project_id; version = context.row.version; }
    if (scope === 'project') {
      const project = summary.projects.find(item => item.id === input.project_id);
      if (!project?.path || !isAbsolute(project.path)) throw problem('Choose a local project directory.');
      root = await realpath(project.path); if (root !== resolve(project.path)) throw problem('Choose the project directory again; its path changed.', 'history_scope_changed', 409); projectId = project.id;
    }
    return { scope, root, projectId, version, summary, key: `${workspaceId}:${scope}:${projectId || ''}` };
  }
  async function snapshot(workspaceId, actor) {
    const summary = await authorize(workspaceId, actor), settings = await preferences();
    return { enabled: settings.enabled, allowAll: settings.allowAll, generation: settings.epoch, providers: LOCAL_SESSION_HISTORY_PROVIDERS, root: summary.ready ? summary.binding?.path : null, projectId: summary.binding?.projectId || null, projects: summary.projects.filter(item => item.path).map(({ id, name }) => ({ id, name })), limits: LIMITS, indexed: [...indexes.values()].filter(index => index.workspaceId === workspaceId && index.epoch === settings.epoch).reduce((sum, index) => sum + index.records.length, 0), scanning: scanning.has(workspaceId) };
  }
  function clearMemory() { indexes.clear(); }
  async function updateSettings(workspaceId, actor, input, clearOnly = false) {
    await authorize(workspaceId, actor);
    if (input.confirmed !== true) throw problem('Confirm changing local session history access.');
    const task = preferenceQueue.catch(() => {}).then(async () => {
      const current = await preferences(), next = { ...current, epoch: randomUUID() };
      if (!clearOnly) {
        if (typeof input.enabled !== 'boolean' || typeof input.allow_all !== 'boolean') throw problem('Choose history search and all-directory access explicitly.');
        next.enabled = input.enabled; next.allowAll = input.enabled && input.allow_all;
      }
      const file = await privateFile(), temporary = `${file}.${randomUUID()}.tmp`; let handle;
      try { handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0), 0o600); await handle.writeFile(JSON.stringify(next) + '\n'); await handle.sync(); await handle.close(); handle = null; await rename(temporary, file); clearMemory(); }
      finally { await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    }); preferenceQueue = task; await task; return snapshot(workspaceId, actor);
  }
  async function candidateFiles(providerId, root, budget) {
    if (typeof root !== 'string' || !isAbsolute(root)) return [];
    try { if (await realpath(root) !== resolve(root) || !(await lstat(root)).isDirectory()) return []; } catch { return []; }
    const files = [];
    async function walk(folder, depth) {
      if (budget.entries >= LIMITS.entries || files.length >= LIMITS.files) { budget.limited = true; return; }
      let directory; try { directory = await opendir(folder); } catch { return; }
      const entries = [];
      try { for await (const item of directory) { budget.entries++; if (budget.entries > LIMITS.entries) { budget.limited = true; break; } entries.push(item); } } catch { return; }
      entries.sort((a, b) => b.name.localeCompare(a.name));
      for (const item of entries) {
        if (files.length >= LIMITS.files) { budget.limited = true; break; }
        if (item.isSymbolicLink()) continue;
        const file = join(folder, item.name);
        if (item.isDirectory() && (providerId === 'codex' ? depth < 3 && (depth === 0 ? /^\d{4}$/ : /^\d{2}$/).test(item.name) : depth === 0 && !item.name.startsWith('.'))) await walk(file, depth + 1);
        if (!item.isFile()) continue;
        const match = providerId === 'codex' ? /^rollout-[A-Za-z0-9_.:-]*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(item.name) : /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(item.name);
        if (match && (providerId === 'codex' || depth === 1)) files.push({ file, sessionId: match[1].toLowerCase() });
      }
    }
    await walk(root, 0); return files;
  }
  async function sourceSafe(root, file) { if (!inside(root, file) || await realpath(root) !== resolve(root) || await realpath(file) !== resolve(file)) throw problem('The session source path changed.', 'history_source_changed', 409); }
  async function refresh(workspaceId, actor, input = {}) {
    const settings = await preferences(), scope = await scopeFor(workspaceId, actor, input, settings);
    if (!settings.enabled) throw problem('Enable local history search first.', 'history_disabled', 409);
    if (scanning.has(workspaceId)) throw problem('This workspace is already indexing session history.', 'history_busy', 409);
    scanning.add(workspaceId); const budget = { entries: 0, bytes: 0, text: 0, limited: false }, records = [], seen = new Set(), unavailable = [];
    try {
      for (const provider of LOCAL_SESSION_HISTORY_PROVIDERS) {
        const liveRoot=providerRoots[provider.id];
        const candidates=(await candidateFiles(provider.id,liveRoot,budget)).map(candidate=>({...candidate,sourceRoot:liveRoot,archived:false}));
        if(provider.id==='codex'&&scope.scope==='all'&&codexArchive){
          candidates.push(...(await candidateFiles(provider.id,codexArchive,budget)).map(candidate=>({...candidate,sourceRoot:codexArchive,archived:true})));
        }
        if (!candidates.length) unavailable.push(provider.id);
        for (const candidate of candidates) {
          const {sourceRoot,archived}=candidate;
          if (closed) throw problem('History search closed while indexing.', 'history_closed', 503);
          const currentSettings = await preferences();
          if (!currentSettings.enabled || currentSettings.epoch !== settings.epoch) throw problem('History access changed while indexing. No index was published.', 'history_scope_changed', 409);
          if (budget.bytes >= LIMITS.scanBytes || budget.text >= LIMITS.indexText || records.length >= LIMITS.records) { budget.limited = true; break; }
          try {
            await sourceSafe(sourceRoot, candidate.file);
            const header = await safeRead(candidate.file, 64_000, true); budget.bytes += header.bytes;
            const metadata = parseLocalSessionJsonl(provider.id, header.content, { headerOnly: true });
            if (!metadata || metadata.sessionId !== candidate.sessionId || scope.root && !inside(scope.root, metadata.cwd)) continue;
            if (header.size > LIMITS.fileBytes || budget.bytes + header.size > LIMITS.scanBytes) { budget.limited = true; continue; }
            const source = await safeRead(candidate.file, LIMITS.fileBytes); budget.bytes += source.bytes; await sourceSafe(sourceRoot, candidate.file);
            const parsed = parseLocalSessionJsonl(provider.id, source.content);
            if (!parsed || parsed.sessionId !== candidate.sessionId || parsed.cwd !== metadata.cwd || !parsed.messageCount) continue;
            const identity = `${provider.id}:${parsed.sessionId}`; if (seen.has(identity)) continue; seen.add(identity);
            parsed.content = parsed.content.slice(0, Math.max(0, LIMITS.indexText - budget.text)); budget.text += parsed.content.length; if (parsed.truncated) budget.limited = true;
            records.push({ ...parsed, resultId: randomUUID(), file: candidate.file, sourceRoot, archived, stamp: source.stamp, hash: hash(source.content), updatedAt: parsed.lastAt || new Date(now()).toISOString() });
          } catch { /* Changed, linked, partial or unsupported sources are excluded. */ }
        }
      }
      const fresh = await preferences(), freshScope = await scopeFor(workspaceId, actor, input, fresh);
      if (!fresh.enabled || fresh.epoch !== settings.epoch || freshScope.version !== scope.version || freshScope.root !== scope.root) throw problem('History access or the directory changed. Search again.', 'history_scope_changed', 409);
      if (indexes.size >= 8 && !indexes.has(scope.key)) indexes.delete(indexes.keys().next().value);
      indexes.set(scope.key, { workspaceId, epoch: settings.epoch, scope, records, limited: budget.limited, updatedAt: new Date(now()).toISOString(), unavailable });
      return { ...await snapshot(workspaceId, actor), scope: scope.scope, indexed: records.length, limited: budget.limited, unavailable, updatedAt: new Date(now()).toISOString() };
    } finally { scanning.delete(workspaceId); }
  }
  async function search(workspaceId, actor, input = {}) {
    const settings = await preferences(), scope = await scopeFor(workspaceId, actor, input, settings);
    if (!settings.enabled) throw problem('Enable local history search first.', 'history_disabled', 409);
    if (input.provider && !LOCAL_SESSION_HISTORY_PROVIDERS.some(provider => provider.id === input.provider)) throw problem('Search history currently supports Codex and Claude Code only.', 'history_provider_unavailable', 409);
    if (typeof input.q !== 'undefined' && (typeof input.q !== 'string' || input.q.length > 180)) throw problem('Use a search of at most 180 characters.');
    const query = (input.q || '').trim().toLowerCase(), terms = query.split(/\s+/).filter(Boolean).slice(0, 8), offset = Number(input.offset || 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > LIMITS.records) throw problem('Invalid history page.');
    const index = indexes.get(scope.key);
    if (!index || index.epoch !== settings.epoch || index.scope.version !== scope.version || index.scope.root !== scope.root) return { items: [], needsRefresh: true, limited: false, total: 0 };
    const items = []; let changed = false;
    for (const record of [...index.records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      if (input.provider && record.providerId !== input.provider || !terms.every(term => `${record.title}\n${record.content}`.toLowerCase().includes(term))) continue;
      try { await sourceSafe(record.sourceRoot, record.file); const info = await lstat(record.file, { bigint: true }); if (!info.isFile() || info.nlink !== 1n || stamp(info) !== record.stamp) { changed = true; continue; } } catch { changed = true; continue; }
      const lower = record.content.toLowerCase(), match = terms.length ? Math.max(0, lower.indexOf(terms[0])) : 0, start = Math.max(0, match - 70);
      const resumeReady = !record.archived&&scope.summary.ready&&record.cwd===scope.summary.binding?.path;
      items.push({ id: record.resultId, providerId: record.providerId, title: record.title, directory: record.cwd, messageCount: record.messageCount, startedAt: record.firstAt, updatedAt: record.updatedAt, snippet: plain(record.content.slice(start, start + 240), 240), archived:record.archived, canResume:Boolean(resumeReady), resumeReason:resumeReady?null:record.archived?'Restore this archived session in Codex before resuming.':'Link the session’s original directory to this workspace before resuming.' });
    }
    const fresh = await preferences(), freshScope = await scopeFor(workspaceId, actor, input, fresh);
    if (!fresh.enabled || fresh.epoch !== settings.epoch || freshScope.root !== scope.root || freshScope.version !== scope.version) throw problem('History access or the directory changed. Search again.', 'history_scope_changed', 409);
    return { items: items.slice(offset, offset + LIMITS.results), total: items.length, nextOffset: items.length > offset + LIMITS.results ? offset + LIMITS.results : null, needsRefresh: changed, limited: index.limited, updatedAt: index.updatedAt };
  }
  async function resolveResume({ workspaceId, projectId = null, providerId, historyResultId, actor }) {
    const settings = await preferences(), summary = await authorize(workspaceId, actor);
    if (!settings.enabled || !UUID.test(historyResultId || '')) throw problem('This local history result is unavailable. Search again.', 'history_result_unavailable', 409);
    const index = [...indexes.values()].find(index => index.workspaceId === workspaceId && index.epoch === settings.epoch && (index.scope.scope !== 'all' || settings.allowAll) && index.records.some(record => record.resultId === historyResultId));
    const record = index?.records.find(record => record.resultId === historyResultId);
    if(record?.archived)throw problem('Restore this archived session in Codex before resuming.','history_session_archived',409);
    if (!record || providerId !== record.providerId || !summary.ready || record.cwd !== summary.binding?.path || projectId && projectId !== summary.binding.projectId || index.scope.version !== summary.binding.version) throw problem('Link the session’s original directory and search again before resuming.', 'history_scope_changed', 409);
    const context = await roots.rootFor(workspaceId, actor, 'workbench.execute');
    if (context.root !== record.cwd) throw problem('The terminal directory no longer matches this session.', 'history_scope_changed', 409);
    let source;
    try{await sourceSafe(record.sourceRoot,record.file);source=await safeRead(record.file,LIMITS.fileBytes);}
    catch{throw problem('Codex or the CLI no longer has the saved session file in this location. Refresh session history.','history_source_changed',409);}
    if (source.stamp !== record.stamp || hash(source.content) !== record.hash) throw problem('This session changed outside Frondose. Refresh its history first.', 'history_source_changed', 409);
    const fresh = await preferences(), freshRoot = await roots.rootFor(workspaceId, actor, 'workbench.execute');
    if (!fresh.enabled || fresh.epoch !== settings.epoch || freshRoot.root !== record.cwd || freshRoot.row.version !== summary.binding.version) throw problem('History access or the directory changed before resume.', 'history_scope_changed', 409);
    const key = `${providerId}:${record.sessionId}`;
    if (resumes.has(key)) throw problem('This native session is already open from history search. Close it before resuming again.', 'history_session_busy', 409);
    resumes.add(key); let released = false;
    return { sessionId: record.sessionId, providerId, release: () => { if (!released) { released = true; resumes.delete(key); } } };
  }
  async function dispatch({ workspaceId, actor, action = '', method = 'GET', input = {}, query = new URLSearchParams() }) {
    if (!action && method === 'GET') return snapshot(workspaceId, actor);
    if (action === 'settings' && method === 'POST') return updateSettings(workspaceId, actor, input);
    if (action === 'clear' && method === 'POST') return updateSettings(workspaceId, actor, input, true);
    if (action === 'refresh' && method === 'POST') return refresh(workspaceId, actor, input);
    if (action === 'search' && method === 'GET') return search(workspaceId, actor, Object.fromEntries(query));
    throw problem('This local history action is unavailable.', 'not_found', 404);
  }
  return { status: snapshot, configure: (workspaceId, actor, input) => updateSettings(workspaceId, actor, input), clear: (workspaceId, actor, input) => updateSettings(workspaceId, actor, input, true), refresh, search, resolveResume, dispatch, close: () => { closed = true; clearMemory(); resumes.clear(); } };
}

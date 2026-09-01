import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { listProviderSetups, providerSetup } from './provider-adapters.mjs';

const API_PREFIX = '/api';
const JSON_FIELDS = new Set([
  'assignee_agent_ids_json', 'labels_json', 'participant_agent_ids_json',
  'attachments_json', 'metadata_json', 'capabilities_json', 'constraints_json',
  'payload_json', 'value_json',
]);

const TABLE_CONFIG = {
  workspaces: {
    fields: ['name', 'slug', 'description', 'icon', 'color'],
    required: ['name'],
  },
  projects: {
    fields: ['workspace_id', 'name', 'identifier', 'description', 'goal', 'status', 'icon', 'color', 'local_path', 'github_url'],
    required: ['workspace_id', 'name'],
  },
  tasks: {
    fields: ['workspace_id', 'project_id', 'number', 'title', 'description', 'status', 'priority', 'assignee_agent_ids_json', 'labels_json', 'due_at'],
    required: ['workspace_id', 'title'],
  },
  chats: {
    fields: ['workspace_id', 'project_id', 'task_id', 'title', 'kind', 'participant_agent_ids_json', 'pinned'],
    required: ['workspace_id', 'title'],
  },
  messages: {
    fields: ['chat_id', 'sender_type', 'sender_id', 'sender_name', 'content', 'kind', 'attachments_json', 'metadata_json'],
    required: ['chat_id', 'content'],
  },
};

const PROVIDERS = {
  github: {
    executable: 'gh',
    args: ['--version'],
    category: 'source_control',
    displayName: 'GitHub',
    description: 'Repositories, issues, pull requests, and checks.',
    authMethod: 'github_app_or_cli',
    capabilities: ['repositories', 'issues', 'pull_requests', 'checks'],
    constraints: ['Probe checks the local GitHub CLI only.', 'No login, token validation, or network request is performed.'],
  },
  'google-drive': {
    category: 'files',
    displayName: 'Google Drive',
    description: 'User-selected Drive files as project context.',
    authMethod: 'oauth_pkce',
    capabilities: ['selected_files', 'file_metadata', 'file_import'],
    constraints: ['Live access requires a Google OAuth client.', 'Rumbo should request drive.file and use Google Picker.', 'Probe never opens Google sign-in.'],
  },
  codex: {
    executable: 'codex',
    args: ['--version'],
    category: 'agent',
    displayName: 'Codex',
    description: 'Coding agent sessions through Codex App Server.',
    authMethod: 'provider_managed_chatgpt',
    capabilities: ['chat', 'coding', 'structured_events', 'approvals'],
    constraints: ['Probe checks the executable only.', 'Codex App Server owns login; Rumbo must not collect ChatGPT credentials.'],
  },
  claude: {
    executable: 'claude',
    args: ['--version'],
    category: 'agent',
    displayName: 'Claude',
    description: 'Claude-powered agent sessions with explicit permissions.',
    authMethod: 'anthropic_api_or_cloud',
    capabilities: ['chat', 'coding', 'structured_events', 'approvals'],
    constraints: ['Third-party products must use Anthropic API or supported cloud credentials unless Anthropic grants approval.', 'Rumbo does not offer or reuse Claude subscription OAuth.', 'Probe checks the executable only.'],
  },
};

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 18)}`; }
function bool(value) { return value ? 1 : 0; }
function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}
function dbValue(field, value) {
  if (JSON_FIELDS.has(field)) return JSON.stringify(value ?? (field.endsWith('_json') ? [] : {}));
  if (field === 'pinned') return bool(value);
  return value;
}
function normalizeInput(resource, body) {
  const record = { ...body };
  const aliases = {
    workspace_id: 'workspaceId', project_id: 'projectId', task_id: 'taskId', chat_id: 'chatId',
    local_path: 'localPath', github_url: 'githubUrl', due_at: 'dueAt', sender_type: 'senderType',
    sender_id: 'senderId', sender_name: 'senderName', avatar_url: 'avatarUrl',
  };
  for (const [field, alias] of Object.entries(aliases)) if (record[field] === undefined && record[alias] !== undefined) record[field] = record[alias];
  if (resource === 'tasks') {
    record.assignee_agent_ids_json ??= record.assignee_agent_ids ?? record.assigneeAgentIds;
    record.labels_json ??= record.labels;
  }
  if (resource === 'chats') record.participant_agent_ids_json ??= record.participant_agent_ids ?? record.participantAgentIds;
  if (resource === 'messages') {
    record.attachments_json ??= record.attachments;
    record.metadata_json ??= record.metadata;
  }
  return record;
}
function present(row) {
  if (!row) return null;
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.endsWith('_json')) result[key.slice(0, -5)] = parseJson(value, key.includes('metadata') || key.includes('payload') ? {} : []);
    else if (key === 'pinned' || key === 'requires_approval') result[key] = Boolean(value);
    else result[key] = value;
  }
  return result;
}
function rows(statement, ...params) { return statement.all(...params).map(present); }

function send(res, status, data, headers = {}) {
  if (res.writableEnded) return;
  const body = data == null ? '' : JSON.stringify(data);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(body);
}
function fail(res, status, code, message, details) {
  send(res, status, { error: { code, message, ...(details ? { details } : {}) } });
}
function allowedLoopbackHost(value) {
  if (!value) return false;
  try {
    const hostname = new URL(`http://${value}`).hostname;
    return ['127.0.0.1', 'localhost', '[::1]', '::1', 'terminal.local'].includes(hostname);
  } catch { return false; }
}
function allowedOrigin(origin, host) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return allowedLoopbackHost(url.host) && (!host || url.host === host || ['terminal.local', '127.0.0.1', 'localhost'].includes(url.hostname));
  } catch { return false; }
}
async function readBody(req, limit = 1_000_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw); }
  catch { throw Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 }); }
}

function slugify(value) {
  return String(value || 'workspace').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'workspace';
}
function cleanVersion(output) {
  return String(output || '').split('\n')[0].trim().slice(0, 180);
}
function safeExecutableProbe(provider) {
  const definition = PROVIDERS[provider];
  const checkedAt = now();
  if (!definition) return { provider, state: 'unsupported', checkedAt, liveAccountChecked: false };
  if (!definition.executable) {
    return {
      provider,
      state: 'not_configured',
      installed: null,
      checkedAt,
      liveAccountChecked: false,
      probeMode: 'local_configuration_only',
      note: 'No OAuth request was started and no Google account was contacted.',
    };
  }
  try {
    const output = execFileSync(definition.executable, definition.args, {
      encoding: 'utf8', timeout: 2_000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME || tmpdir() },
    });
    return {
      provider, state: 'available_not_authenticated', installed: true,
      executable: definition.executable, version: cleanVersion(output), checkedAt,
      liveAccountChecked: false, probeMode: 'executable_version_only',
      note: 'Rumbo did not start login, inspect credentials, contact the provider, or run a paid request.',
    };
  } catch (error) {
    return {
      provider, state: error?.code === 'ENOENT' ? 'not_installed' : 'probe_failed',
      installed: false, executable: definition.executable, checkedAt,
      liveAccountChecked: false, probeMode: 'executable_version_only',
      note: 'Rumbo did not start login, inspect credentials, contact the provider, or run a paid request.',
    };
  }
}

function seed(db, { demo = false } = {}) {
  const created = '2026-08-30T08:00:00.000Z';
  const updated = '2026-08-31T06:30:00.000Z';
  db.prepare(`INSERT OR IGNORE INTO local_profile (id,name,email,avatar_url,created_at,updated_at) VALUES ('local',?,?,?,?,?)`)
    .run('You', null, null, created, updated);
  const defaultSettings = {
    appearance: { theme: 'dark', density: 'compact', reduceMotion: false },
    notifications: { agentNeedsInput: true, runCompleted: true, runFailed: true },
    privacy: { localOnly: true, analytics: false, crashReports: false },
    agentDefaults: { approvalMode: 'ask', concurrentRuns: 2, preserveRawEvents: true },
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    db.prepare('INSERT OR IGNORE INTO settings (key,value_json,updated_at) VALUES (?,?,?)').run(key, JSON.stringify(value), updated);
  }

  for (const [provider, definition] of Object.entries(PROVIDERS)) {
    db.prepare('INSERT OR IGNORE INTO connections (id,provider,category,display_name,description,state,mode,auth_method,capabilities_json,constraints_json,metadata_json,last_probed_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(`conn_${provider.replace('-', '_')}`, provider, definition.category, definition.displayName, definition.description, 'not_connected', 'local', definition.authMethod, JSON.stringify(definition.capabilities), JSON.stringify(definition.constraints), JSON.stringify({ liveAccountChecked: false }), null, updated);
  }

  if (!demo) return;

  db.prepare('INSERT OR IGNORE INTO workspaces (id,name,slug,description,icon,color,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('ws_personal', 'Northstar', 'northstar', 'Local workspace for product and engineering projects.', 'diamond', '#7c7c86', created, updated);
  db.prepare("UPDATE workspaces SET name='Northstar',slug='northstar',updated_at=? WHERE id='ws_personal' AND name='Personal'").run(updated);
  db.prepare('INSERT OR IGNORE INTO projects (id,workspace_id,name,identifier,description,goal,status,icon,color,local_path,github_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('proj_sourcelens', 'ws_personal', 'SourceLens', 'SOU', 'Chrome extension for concise page summaries and trustworthy source context.', 'Ship a useful, privacy-minded first version of SourceLens.', 'active', 'browser', '#8b8b96', null, 'https://github.com/example/sourcelens', created, updated);

  const tasks = [
    ['task_popup', 14, 'Build Chrome extension popup UI', 'Implement the compact popup states from the approved product direction.', 'in_progress', 'high', ['codex'], ['frontend', 'mvp']],
    ['task_citations', 15, 'Extract citations from the current page', 'Return normalized sources with title, host, and page location.', 'review', 'high', ['claude'], ['extension', 'data']],
    ['task_privacy', 16, 'Document local-first privacy behavior', 'Explain what stays local and what connected providers receive.', 'ready', 'medium', [], ['docs', 'privacy']],
    ['task_empty', 17, 'Design useful empty states', 'Create first-use guidance for chats, projects, and live work.', 'backlog', 'low', [], ['design']],
    ['task_focus', 18, 'Trap focus inside the extension popup', 'Keep keyboard focus within the open popup and restore it on close.', 'ready', 'medium', ['claude'], ['accessibility', 'mvp']],
  ];
  for (const [taskId, number, title, description, status, priority, agents, labels] of tasks) {
    db.prepare('INSERT OR IGNORE INTO tasks (id,workspace_id,project_id,number,title,description,status,priority,assignee_agent_ids_json,labels_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(taskId, 'ws_personal', 'proj_sourcelens', number, title, description, status, priority, JSON.stringify(agents), JSON.stringify(labels), created, updated);
  }

  db.prepare('INSERT OR IGNORE INTO chats (id,workspace_id,project_id,task_id,title,kind,participant_agent_ids_json,pinned,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('chat_popup', 'ws_personal', 'proj_sourcelens', 'task_popup', 'Popup implementation', 'task', JSON.stringify(['codex', 'claude']), 1, created, updated);
  db.prepare('INSERT OR IGNORE INTO chats (id,workspace_id,project_id,task_id,title,kind,participant_agent_ids_json,pinned,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('chat_project', 'ws_personal', 'proj_sourcelens', null, 'SourceLens planning', 'project', JSON.stringify(['codex']), 0, created, updated);
  const messages = [
    ['msg_1', 'chat_popup', 'user', 'local', 'Evan', 'Build the popup UI with loading, result, and error states. Keep permissions unchanged.', 'message', '2026-08-31T06:10:00.000Z'],
    ['msg_2', 'chat_popup', 'agent', 'codex', 'Codex', 'I’ll inspect the existing popup structure first, then implement the three states and run the local checks.', 'message', '2026-08-31T06:11:00.000Z'],
    ['msg_3', 'chat_popup', 'system', null, 'Rumbo', 'Demo run started. No provider account was contacted.', 'run_event', '2026-08-31T06:11:04.000Z'],
    ['msg_4', 'chat_project', 'user', 'local', 'Evan', 'The MVP should summarize the current page and preserve a clear source trail.', 'message', '2026-08-30T09:00:00.000Z'],
    ['msg_5', 'chat_popup', 'agent', 'claude', 'Claude', 'Review note: the popup should trap keyboard focus while open and restore focus to the trigger when it closes.', 'message', '2026-08-31T06:18:00.000Z'],
    ['msg_6', 'chat_popup', 'user', 'local', 'Evan', 'Good catch. I linked that finding to SOU-18 so it stays visible after this run.', 'message', '2026-08-31T06:19:00.000Z'],
  ];
  for (const [messageId, chatId, senderType, senderId, senderName, content, kind, timestamp] of messages) {
    db.prepare('INSERT OR IGNORE INTO messages (id,chat_id,sender_type,sender_id,sender_name,content,kind,attachments_json,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(messageId, chatId, senderType, senderId, senderName, content, kind, '[]', '{}', timestamp, timestamp);
  }

  db.prepare("UPDATE connections SET state='demo',mode='demo',updated_at=?").run(updated);

  db.prepare('INSERT OR IGNORE INTO runs (id,workspace_id,project_id,task_id,chat_id,provider,agent_name,status,title,prompt,mode,requires_approval,started_at,finished_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('run_demo_popup', 'ws_personal', 'proj_sourcelens', 'task_popup', 'chat_popup', 'codex', 'Codex', 'needs_input', 'Build popup UI', 'Implement the popup states.', 'demo', 1, '2026-08-31T06:11:04.000Z', null, '2026-08-31T06:11:04.000Z', updated);
  const events = [
    ['evt_demo_1', 1, 'run.started', 'Demo run started', { demo: true }],
    ['evt_demo_2', 2, 'agent.message', 'Inspected the popup structure', { text: 'The popup already has a minimal React entry point.' }],
    ['evt_demo_3', 3, 'file.changed', 'Prepared Popup.jsx changes', { path: 'src/popup/Popup.jsx', change: 'modified' }],
    ['evt_demo_4', 4, 'approval.requested', 'Approval needed to run tests', { command: 'npm test', risk: 'low' }],
  ];
  for (const [eventId, sequence, type, summary, payload] of events) {
    db.prepare('INSERT OR IGNORE INTO run_events (id,run_id,sequence,type,summary,payload_json,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(eventId, 'run_demo_popup', sequence, type, summary, JSON.stringify(payload), `2026-08-31T06:11:0${sequence}.000Z`);
  }
  db.prepare('INSERT OR IGNORE INTO approvals (id,run_id,event_id,title,detail,status,created_at) VALUES (?,?,?,?,?,?,?)')
    .run('approval_demo_tests', 'run_demo_popup', 'evt_demo_4', 'Run project tests?', 'Mock approval only; no command or provider request will run.', 'pending', '2026-08-31T06:11:08.000Z');
}

function createDatabase(dataDir, { seedMode = 'clean' } = {}) {
  const directory = dataDir || join(process.cwd(), '.rumbo');
  mkdirSync(directory, { recursive: true });
  const dbPath = join(directory, 'rumbo.sqlite');
  const db = new DatabaseSync(dbPath);
  const schemaPath = join(dirname(fileURLToPath(import.meta.url)), 'schema.sql');
  db.exec(readFileSync(schemaPath, 'utf8'));
  seed(db, { demo: seedMode === 'demo' });
  return { db, dbPath, directory };
}

function snapshot(db) {
  const settings = {};
  for (const row of db.prepare('SELECT * FROM settings ORDER BY key').all()) settings[row.key] = parseJson(row.value_json, {});
  const events = rows(db.prepare('SELECT * FROM run_events ORDER BY created_at,sequence'));
  return {
    profile: present(db.prepare("SELECT * FROM local_profile WHERE id='local'").get()),
    settings,
    workspaces: rows(db.prepare('SELECT * FROM workspaces ORDER BY created_at')),
    projects: rows(db.prepare('SELECT * FROM projects ORDER BY updated_at DESC')),
    tasks: rows(db.prepare('SELECT * FROM tasks ORDER BY number')),
    chats: rows(db.prepare('SELECT * FROM chats ORDER BY pinned DESC, updated_at DESC')),
    messages: rows(db.prepare('SELECT * FROM messages ORDER BY created_at')),
    runs: rows(db.prepare('SELECT * FROM runs ORDER BY created_at DESC')),
    approvals: rows(db.prepare('SELECT * FROM approvals ORDER BY created_at DESC')),
    events,
    connections: rows(db.prepare('SELECT * FROM connections ORDER BY category, display_name')),
    meta: {
      localOnly: true,
      demoData: Boolean(db.prepare("SELECT 1 FROM workspaces WHERE id='ws_personal'").get()),
      apiVersion: 1,
      generatedAt: now(),
      lastEventAt: events.at(-1)?.created_at || null,
    },
  };
}

export function createLocalApi({ dataDir, seedMode = 'clean' } = {}) {
  let store = createDatabase(dataDir, { seedMode });
  let closed = false;
  const listeners = new Map();
  const runTimers = new Map();

  function getDb() {
    if (closed) throw new Error('Local API is closed.');
    return store.db;
  }
  function emitEvent(runId, event) {
    for (const res of listeners.get(runId) || []) {
      if (!res.writableEnded) res.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
  }
  function addRunEvent(runId, type, summary, payload = {}) {
    const db = getDb();
    const sequence = Number(db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM run_events WHERE run_id=?').get(runId).next);
    const event = { id: id('evt'), run_id: runId, sequence, type, summary, payload, created_at: now() };
    db.prepare('INSERT INTO run_events (id,run_id,sequence,type,summary,payload_json,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(event.id, runId, sequence, type, summary, JSON.stringify(payload), event.created_at);
    emitEvent(runId, event);
    return event;
  }
  function updateRun(runId, status, finished = false) {
    const stamp = now();
    getDb().prepare('UPDATE runs SET status=?, finished_at=CASE WHEN ? THEN ? ELSE finished_at END, updated_at=? WHERE id=?')
      .run(status, bool(finished), stamp, stamp, runId);
  }
  function clearRunTimers(runId) {
    for (const timer of runTimers.get(runId) || []) clearTimeout(timer);
    runTimers.delete(runId);
  }
  function scheduleMockRun(runId, scenario) {
    const timers = [];
    const later = (ms, callback) => {
      const timer = setTimeout(() => { if (!closed) callback(); }, ms);
      timer.unref?.();
      timers.push(timer);
    };
    later(100, () => addRunEvent(runId, 'agent.message', 'Reviewed the task context', { demo: true }));
    later(220, () => addRunEvent(runId, 'work.progress', 'Prepared a proposed approach', { progress: 45, demo: true }));
    if (scenario === 'failure') {
      later(360, () => { updateRun(runId, 'failed', true); addRunEvent(runId, 'run.failed', 'Mock run failed safely', { reason: 'simulated_failure', demo: true }); });
    } else {
      later(420, () => { updateRun(runId, 'completed', true); addRunEvent(runId, 'run.completed', 'Mock run completed', { summary: 'Demo result ready for review.', demo: true }); });
    }
    runTimers.set(runId, timers);
  }

  async function collectionRoute(req, res, resource, itemId, url) {
    const db = getDb();
    const config = TABLE_CONFIG[resource];
    if (!config) return false;
    if (req.method === 'GET' && !itemId) {
      const clauses = [];
      const values = [];
      for (const key of ['workspace_id', 'project_id', 'task_id', 'chat_id', 'status']) {
        if (url.searchParams.has(key)) { clauses.push(`${key}=?`); values.push(url.searchParams.get(key)); }
      }
      const order = resource === 'messages' ? 'created_at' : resource === 'tasks' ? 'number' : 'updated_at DESC';
      return send(res, 200, { [resource]: rows(db.prepare(`SELECT * FROM ${resource}${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY ${order}`), ...values) });
    }
    if (req.method === 'GET' && itemId) {
      const item = present(db.prepare(`SELECT * FROM ${resource} WHERE id=?`).get(itemId));
      return item ? send(res, 200, { [resource.slice(0, -1)]: item }) : fail(res, 404, 'not_found', `${resource.slice(0, -1)} not found.`);
    }
    if (req.method === 'POST' && !itemId) {
      const body = normalizeInput(resource, await readBody(req));
      const missing = config.required.filter((field) => body[field] == null || body[field] === '');
      if (missing.length) return fail(res, 400, 'validation_error', `Missing required fields: ${missing.join(', ')}.`);
      const stamp = now();
      const record = { ...body };
      if (resource === 'workspaces') record.slug ||= slugify(record.name);
      if (resource === 'projects') record.identifier ||= String(record.name).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'PRJ';
      if (resource === 'tasks' && !record.number) record.number = Number(db.prepare('SELECT COALESCE(MAX(number),0)+1 AS next FROM tasks WHERE workspace_id=?').get(record.workspace_id).next);
      if (resource === 'messages') {
        record.sender_type ||= 'user'; record.sender_name ||= 'You'; record.kind ||= 'message';
        db.prepare('UPDATE chats SET updated_at=? WHERE id=?').run(stamp, record.chat_id);
      }
      const itemIdNew = id(resource.slice(0, -1));
      const fields = config.fields.filter((field) => record[field] !== undefined);
      const values = fields.map((field) => dbValue(field, record[field]));
      db.prepare(`INSERT INTO ${resource} (id,${fields.join(',')},created_at,updated_at) VALUES (?,${fields.map(() => '?').join(',')},?,?)`)
        .run(itemIdNew, ...values, stamp, stamp);
      const item = present(db.prepare(`SELECT * FROM ${resource} WHERE id=?`).get(itemIdNew));
      return send(res, 201, { [resource.slice(0, -1)]: item });
    }
    if ((req.method === 'PATCH' || req.method === 'PUT') && itemId) {
      if (!db.prepare(`SELECT 1 FROM ${resource} WHERE id=?`).get(itemId)) return fail(res, 404, 'not_found', `${resource.slice(0, -1)} not found.`);
      const body = normalizeInput(resource, await readBody(req));
      const fields = config.fields.filter((field) => body[field] !== undefined);
      if (!fields.length) return fail(res, 400, 'validation_error', 'No supported fields were supplied.');
      const stamp = now();
      db.prepare(`UPDATE ${resource} SET ${fields.map((field) => `${field}=?`).join(',')},updated_at=? WHERE id=?`)
        .run(...fields.map((field) => dbValue(field, body[field])), stamp, itemId);
      return send(res, 200, { [resource.slice(0, -1)]: present(db.prepare(`SELECT * FROM ${resource} WHERE id=?`).get(itemId)) });
    }
    if (req.method === 'DELETE' && itemId) {
      const result = db.prepare(`DELETE FROM ${resource} WHERE id=?`).run(itemId);
      return result.changes ? send(res, 200, { ok: true, id: itemId }) : fail(res, 404, 'not_found', `${resource.slice(0, -1)} not found.`);
    }
    return false;
  }

  async function middleware(req, res, next = () => {}) {
    let url;
    try { url = new URL(req.url || '/', 'http://127.0.0.1'); }
    catch { return fail(res, 400, 'bad_url', 'Invalid request URL.'); }
    if (!url.pathname.startsWith(API_PREFIX)) return next();
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!allowedLoopbackHost(req.headers.host)) return fail(res, 403, 'invalid_host', 'Rumbo only accepts loopback hosts.');
    if (!allowedOrigin(req.headers.origin, req.headers.host)) return fail(res, 403, 'invalid_origin', 'Cross-origin API requests are not allowed.');
    try {
      const db = getDb();
      const path = url.pathname.slice(API_PREFIX.length) || '/';
      if (req.method === 'GET' && (path === '/bootstrap' || path === '/snapshot')) return send(res, 200, snapshot(db));
      if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true, localOnly: true, database: 'ready' });
      if (req.method === 'GET' && path === '/events') {
        const since = url.searchParams.get('since');
        const events = since
          ? rows(db.prepare('SELECT * FROM run_events WHERE created_at>? ORDER BY created_at,sequence'), since)
          : rows(db.prepare('SELECT * FROM run_events ORDER BY created_at,sequence'));
        return send(res, 200, {
          events,
          cursor: events.at(-1)?.created_at || since || null,
          bootstrap: snapshot(db),
        });
      }

      const nestedMessages = path.match(/^\/chats\/([^/]+)\/messages(?:\/([^/]+))?$/);
      if (nestedMessages) {
        url.searchParams.set('chat_id', nestedMessages[1]);
        if (req.method === 'POST') {
          const body = await readBody(req);
          if (!db.prepare('SELECT 1 FROM chats WHERE id=?').get(nestedMessages[1])) return fail(res, 404, 'not_found', 'Chat not found.');
          if (typeof body.content !== 'string' || !body.content.trim()) return fail(res, 400, 'validation_error', 'Message content is required.');
          const stamp = now();
          const messageId = id('message');
          db.prepare('INSERT INTO messages (id,chat_id,sender_type,sender_id,sender_name,content,kind,attachments_json,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
            .run(messageId, nestedMessages[1], body.sender_type || 'user', body.sender_id || 'local', body.sender_name || 'You', body.content || '', body.kind || 'message', JSON.stringify(body.attachments || []), JSON.stringify(body.metadata || {}), stamp, stamp);
          db.prepare('UPDATE chats SET updated_at=? WHERE id=?').run(stamp, nestedMessages[1]);
          return send(res, 201, { message: present(db.prepare('SELECT * FROM messages WHERE id=?').get(messageId)) });
        }
        return collectionRoute(req, res, 'messages', nestedMessages[2], url);
      }

      const collectionMatch = path.match(/^\/(workspaces|projects|tasks|chats|messages)(?:\/([^/]+))?$/);
      if (collectionMatch) {
        const handled = await collectionRoute(req, res, collectionMatch[1], collectionMatch[2], url);
        if (handled !== false) return handled;
      }

      if (req.method === 'GET' && path === '/runs') return send(res, 200, { runs: rows(db.prepare('SELECT * FROM runs ORDER BY created_at DESC')) });
      if (req.method === 'GET' && path.match(/^\/runs\/[^/]+$/)) {
        const runId = path.split('/')[2];
        const run = present(db.prepare('SELECT * FROM runs WHERE id=?').get(runId));
        if (!run) return fail(res, 404, 'not_found', 'Run not found.');
        return send(res, 200, { run, events: rows(db.prepare('SELECT * FROM run_events WHERE run_id=? ORDER BY sequence'), runId), approvals: rows(db.prepare('SELECT * FROM approvals WHERE run_id=? ORDER BY created_at'), runId) });
      }
      const taskRunMatch = path.match(/^\/tasks\/([^/]+)\/runs$/);
      if (req.method === 'POST' && (path === '/runs' || path === '/runs/start' || taskRunMatch)) {
        const body = await readBody(req);
        const task = taskRunMatch ? db.prepare('SELECT * FROM tasks WHERE id=?').get(taskRunMatch[1]) : null;
        if (taskRunMatch && !task) return fail(res, 404, 'not_found', 'Task not found.');
        const workspaceId = body.workspace_id || body.workspaceId || task?.workspace_id || 'ws_personal';
        if (!db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId)) return fail(res, 400, 'validation_error', 'A valid workspace_id is required.');
        const runId = id('run');
        const stamp = now();
        const provider = PROVIDERS[body.provider] ? body.provider : 'codex';
        const needsApproval = Boolean(body.requires_approval || body.requiresApproval || body.scenario === 'approval');
        db.prepare('INSERT INTO runs (id,workspace_id,project_id,task_id,chat_id,provider,agent_name,status,title,prompt,mode,requires_approval,started_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(runId, workspaceId, body.project_id || body.projectId || task?.project_id || null, body.task_id || body.taskId || task?.id || null, body.chat_id || body.chatId || null, provider, body.agent_name || body.agentName || PROVIDERS[provider].displayName, needsApproval ? 'needs_input' : 'running', body.title || task?.title || 'Untitled agent run', body.prompt || '', 'mock', bool(needsApproval), stamp, stamp, stamp);
        addRunEvent(runId, 'run.started', 'Mock run started', { demo: true, provider, liveAccountContacted: false });
        if (needsApproval) {
          const event = addRunEvent(runId, 'approval.requested', 'Approval required to continue the mock run', { demo: true, action: body.approval_action || 'Run a simulated check' });
          const approvalId = id('approval');
          db.prepare('INSERT INTO approvals (id,run_id,event_id,title,detail,status,created_at) VALUES (?,?,?,?,?,?,?)')
            .run(approvalId, runId, event.id, 'Continue mock run?', 'This is a simulated approval; no command or provider request will run.', 'pending', now());
        } else if (body.scenario !== 'manual') scheduleMockRun(runId, body.scenario);
        const run = present(db.prepare('SELECT * FROM runs WHERE id=?').get(runId));
        return send(res, 201, { run, demo: true });
      }
      const stopMatch = path.match(/^\/runs\/([^/]+)\/stop$/);
      if (req.method === 'POST' && stopMatch) {
        const runId = stopMatch[1];
        if (!db.prepare('SELECT 1 FROM runs WHERE id=?').get(runId)) return fail(res, 404, 'not_found', 'Run not found.');
        clearRunTimers(runId); updateRun(runId, 'stopped', true);
        const event = addRunEvent(runId, 'run.stopped', 'Mock run stopped by user', { demo: true });
        return send(res, 200, { run: present(db.prepare('SELECT * FROM runs WHERE id=?').get(runId)), event });
      }
      const approveMatch = path.match(/^\/runs\/([^/]+)\/(approve|approvals\/[^/]+)$/);
      if (req.method === 'POST' && approveMatch) {
        const runId = approveMatch[1];
        const body = await readBody(req);
        const approvalId = approveMatch[2].startsWith('approvals/') ? approveMatch[2].split('/')[1] : body.approval_id;
        const approval = approvalId
          ? db.prepare("SELECT * FROM approvals WHERE id=? AND run_id=? AND status='pending'").get(approvalId, runId)
          : db.prepare("SELECT * FROM approvals WHERE run_id=? AND status='pending' ORDER BY created_at LIMIT 1").get(runId);
        if (!approval) return fail(res, 404, 'not_found', 'Pending approval not found.');
        const decision = body.decision === 'deny' || body.approved === false ? 'denied' : 'approved';
        db.prepare('UPDATE approvals SET status=?,decision_note=?,resolved_at=? WHERE id=?').run(decision, body.note || null, now(), approval.id);
        addRunEvent(runId, 'approval.resolved', `Approval ${decision}`, { demo: true, approvalId: approval.id, decision });
        if (decision === 'approved') { updateRun(runId, 'running'); scheduleMockRun(runId, body.scenario); }
        else { updateRun(runId, 'stopped', true); addRunEvent(runId, 'run.stopped', 'Mock run stopped after approval was denied', { demo: true }); }
        return send(res, 200, { approval: present(db.prepare('SELECT * FROM approvals WHERE id=?').get(approval.id)), run: present(db.prepare('SELECT * FROM runs WHERE id=?').get(runId)) });
      }
      const eventsMatch = path.match(/^\/runs\/([^/]+)\/(events|timeline)$/);
      if (req.method === 'GET' && eventsMatch) return send(res, 200, { events: rows(db.prepare('SELECT * FROM run_events WHERE run_id=? ORDER BY sequence'), eventsMatch[1]) });
      const streamMatch = path.match(/^\/runs\/([^/]+)\/(events\/stream|stream)$/);
      if (req.method === 'GET' && streamMatch) {
        const runId = streamMatch[1];
        if (!db.prepare('SELECT 1 FROM runs WHERE id=?').get(runId)) return fail(res, 404, 'not_found', 'Run not found.');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
        res.write(': rumbo local event stream\n\n');
        for (const event of rows(db.prepare('SELECT * FROM run_events WHERE run_id=? ORDER BY sequence'), runId)) res.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        if (!listeners.has(runId)) listeners.set(runId, new Set());
        listeners.get(runId).add(res);
        const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': keepalive\n\n'); }, 15_000);
        heartbeat.unref?.();
        req.on('close', () => { clearInterval(heartbeat); listeners.get(runId)?.delete(res); });
        return;
      }

      if (req.method === 'GET' && path === '/connections') return send(res, 200, { connections: rows(db.prepare('SELECT * FROM connections ORDER BY category,display_name')), note: 'Demo states are not live account connections.' });
      if (req.method === 'GET' && path === '/connections/setup') {
        const origin = `http://${req.headers.host || '127.0.0.1:4173'}`;
        return send(res, 200, { setups: listProviderSetups({ origin }), accountSafe: true });
      }
      const setupMatch = path.match(/^\/connections\/(github|google-drive|codex|claude)\/setup$/);
      if (req.method === 'GET' && setupMatch) {
        const origin = `http://${req.headers.host || '127.0.0.1:4173'}`;
        return send(res, 200, { setup: providerSetup(setupMatch[1], { origin }), accountSafe: true });
      }
      const probeMatch = path.match(/^\/connections\/(?:probe\/)?(github|google-drive|codex|claude)(?:\/probe)?$/);
      if ((req.method === 'POST' || req.method === 'GET') && probeMatch) {
        const provider = probeMatch[1];
        const probe = safeExecutableProbe(provider);
        db.prepare('UPDATE connections SET state=?,metadata_json=?,last_probed_at=?,updated_at=? WHERE provider=?')
          .run(probe.state, JSON.stringify(probe), probe.checkedAt, probe.checkedAt, provider);
        return send(res, 200, { connection: present(db.prepare('SELECT * FROM connections WHERE provider=?').get(provider)), probe, safe: true });
      }

      if (req.method === 'GET' && (path === '/account' || path === '/profile')) return send(res, 200, { profile: present(db.prepare("SELECT * FROM local_profile WHERE id='local'").get()) });
      if ((req.method === 'PATCH' || req.method === 'PUT') && (path === '/account' || path === '/profile')) {
        const body = await readBody(req);
        const allowed = ['name', 'email', 'avatar_url'].filter((field) => body[field] !== undefined);
        if (!allowed.length) return fail(res, 400, 'validation_error', 'No supported profile fields were supplied.');
        db.prepare(`UPDATE local_profile SET ${allowed.map((field) => `${field}=?`).join(',')},updated_at=? WHERE id='local'`).run(...allowed.map((field) => body[field]), now());
        return send(res, 200, { profile: present(db.prepare("SELECT * FROM local_profile WHERE id='local'").get()) });
      }
      if (req.method === 'GET' && path === '/settings') {
        const result = {}; for (const row of db.prepare('SELECT * FROM settings ORDER BY key').all()) result[row.key] = parseJson(row.value_json, {});
        return send(res, 200, { settings: result });
      }
      if ((req.method === 'PATCH' || req.method === 'PUT') && path === '/settings') {
        const body = await readBody(req); const stamp = now();
        for (const [key, value] of Object.entries(body.settings || body)) db.prepare('INSERT INTO settings (key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at').run(key, JSON.stringify(value), stamp);
        const result = {}; for (const row of db.prepare('SELECT * FROM settings ORDER BY key').all()) result[row.key] = parseJson(row.value_json, {});
        return send(res, 200, { settings: result });
      }

      return fail(res, 404, 'not_found', `Unknown local API route: ${path}`);
    } catch (error) {
      if (error?.code?.startsWith('SQLITE_CONSTRAINT')) return fail(res, 409, 'conflict', 'The requested change conflicts with existing local data.', error.message);
      return fail(res, error?.statusCode || 500, 'local_api_error', error?.message || 'Unexpected local API error.');
    }
  }

  function close() {
    if (closed) return;
    for (const runId of runTimers.keys()) clearRunTimers(runId);
    for (const responses of listeners.values()) for (const res of responses) if (!res.writableEnded) res.end();
    listeners.clear();
    store.db.close();
    closed = true;
  }
  function reset() {
    const directory = store.directory;
    for (const runId of runTimers.keys()) clearRunTimers(runId);
    for (const responses of listeners.values()) {
      for (const res of responses) {
        if (!res.writableEnded) {
          res.write('event: server.reset\ndata: {"reason":"local_data_reset"}\n\n');
          res.end();
        }
      }
    }
    listeners.clear();
    store.db.close();
    rmSync(store.dbPath, { force: true });
    rmSync(`${store.dbPath}-wal`, { force: true });
    rmSync(`${store.dbPath}-shm`, { force: true });
    store = createDatabase(directory, { seedMode });
    closed = false;
    return snapshot(store.db);
  }

  return { middleware, handle: middleware, close, reset, snapshot: () => snapshot(getDb()), dbPath: store.dbPath };
}

export default createLocalApi;

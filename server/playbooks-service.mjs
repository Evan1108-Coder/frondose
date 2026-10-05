import { randomUUID } from 'node:crypto';
import { validationError } from './validation.mjs';

const ACTIONS = Object.freeze([
  { id: 'route.create_draft', label: 'Create a draft Route', description: 'Create a backlog Route without starting an agent.', permission: 'routes.write', config_fields: [
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'description', label: 'Description', type: 'textarea', required: false },
    { key: 'project_id', label: 'Project', type: 'project', required: false },
  ] },
  { id: 'document.create_draft', label: 'Create a project document', description: 'Create a project document without publishing externally.', permission: 'documents.write', config_fields: [
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'content', label: 'Content', type: 'textarea', required: false },
    { key: 'project_id', label: 'Project', type: 'project', required: true },
  ] },
  { id: 'project.create_draft', label: 'Create a draft Project', description: 'Create a planned Project without linking files or starting work.', permission: 'projects.write', config_fields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'description', label: 'Description', type: 'textarea', required: false },
    { key: 'goal', label: 'Goal', type: 'textarea', required: false },
  ] },
  { id: 'chat.create_draft', label: 'Create an empty conversation', description: 'Create a conversation without sending a message or contacting an agent.', permission: 'chats.write', config_fields: [
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'project_id', label: 'Project', type: 'project', required: false },
  ] },
]);
const ACTION_BY_ID = new Map(ACTIONS.map(action => [action.id, action]));
const EVENTS = ['inbox.opened'];
const stamp = date => (date instanceof Date ? date : new Date(date)).toISOString();
const error = (message, statusCode = 400, code = 'invalid_playbook') => Object.assign(new Error(message), { statusCode, code });
const exact = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw validationError(`${label} has unsupported fields.`);
};
const string = (value, label, max, required = true) => {
  if (typeof value !== 'string' || value.length > max || /\0/.test(value) || required && !value.trim()) throw validationError(`${label} must be ${required ? 'non-empty ' : ''}text of at most ${max} characters.`);
  return value.trim();
};
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value) ? value : (() => { throw validationError('Provide an idempotency key of 8–128 letters, numbers, underscores or hyphens.'); })();
const json = value => JSON.parse(value);
const output = row => row && { ...row, enabled: Boolean(row.enabled), definition: json(row.definition_json), definition_json: undefined };

export function playbookCatalog() {
  return { actions: ACTIONS.map(({ permission, ...action }) => action), triggers: [
    { type: 'manual', label: 'Run button' },
    { type: 'event', label: 'When something happens', events: EVENTS },
    { type: 'schedule', label: 'At a scheduled time', frequency: 'daily or selected weekdays', timezone: 'IANA timezone' },
  ] };
}

function normalizeDefinition(value) {
  exact(value, ['trigger', 'steps'], 'Playbook definition');
  const trigger = value.trigger;
  exact(trigger, ['type', 'event', 'time', 'timezone', 'days_of_week'], 'Trigger');
  if (!['manual', 'event', 'schedule'].includes(trigger.type)) throw validationError('Choose a supported trigger.');
  let normalizedTrigger;
  if (trigger.type === 'manual') {
    if (Object.keys(trigger).length !== 1) throw validationError('Manual triggers have no schedule or event fields.');
    normalizedTrigger = { type: 'manual' };
  } else if (trigger.type === 'event') {
    if (!EVENTS.includes(trigger.event) || Object.keys(trigger).some(key => !['type', 'event'].includes(key))) throw validationError('Choose a supported event trigger.');
    normalizedTrigger = { type: 'event', event: trigger.event };
  } else {
    if (Object.keys(trigger).some(key => !['type', 'time', 'timezone', 'days_of_week'].includes(key)) || typeof trigger.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(trigger.time)) throw validationError('Scheduled time must be HH:mm in 24-hour form.');
    const timezone = string(trigger.timezone, 'Timezone', 80);
    try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date()); } catch { throw validationError('Choose a valid IANA timezone.'); }
    const days = trigger.days_of_week ?? [0, 1, 2, 3, 4, 5, 6];
    if (!Array.isArray(days) || !days.length || days.length > 7 || new Set(days).size !== days.length || days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw validationError('Choose unique weekdays 0–6.');
    normalizedTrigger = { type: 'schedule', time: trigger.time, timezone, days_of_week: [...days].sort() };
  }
  if (!Array.isArray(value.steps) || !value.steps.length || value.steps.length > 20) throw validationError('Add 1–20 Playbook actions.');
  const steps = value.steps.map((step, index) => {
    exact(step, ['action_id', 'config'], `Step ${index + 1}`);
    const action = ACTION_BY_ID.get(step.action_id);
    if (!action) throw validationError(`Step ${index + 1} uses an unavailable action.`);
    const allowed = action.config_fields.map(field => field.key);
    exact(step.config, allowed, `Step ${index + 1} configuration`);
    const config = {};
    for (const field of action.config_fields) {
      const value = step.config[field.key];
      if (value === undefined || value === null || value === '') {
        if (field.required) throw validationError(`${field.label} is required in step ${index + 1}.`);
        config[field.key] = '';
      } else config[field.key] = string(value, field.label, field.type === 'textarea' ? 50_000 : field.type === 'project' ? 128 : 200);
    }
    return { action_id: action.id, config };
  });
  return { trigger: normalizedTrigger, steps };
}

function localMinute(date, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]));
  return { time: `${parts.hour}:${parts.minute}`, day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday), key: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}[${timezone}]` };
}

export function createPlaybooksService({ db, allowed, now = () => new Date() }) {
  const instant = () => stamp(now());
  const authorize = (workspaceId, actor, permission, at = {}) => {
    if (!actor?.id || !allowed(workspaceId, actor, permission, at)) throw error(`Permission required: ${permission}.`, 403, 'access_denied');
  };
  const workspace = (id, actor, permission) => {
    if (!id || !db.prepare('SELECT id FROM workspaces WHERE id=?').get(id)) throw error('Workspace not found.', 404);
    authorize(id, actor, permission);
    return id;
  };
  const item = (id, actor, permission = 'automations.manage') => {
    const row = db.prepare('SELECT * FROM playbooks WHERE id=? AND archived_at IS NULL').get(id);
    if (!row) throw error('Playbook not found.', 404);
    workspace(row.workspace_id, actor, permission);
    return row;
  };
  const transaction = fn => { db.exec('SAVEPOINT playbook_operation'); try { const result = fn(); db.exec('RELEASE playbook_operation'); return result; } catch (cause) { db.exec('ROLLBACK TO playbook_operation; RELEASE playbook_operation'); throw cause; } };
  const get = (id, actor) => output(item(id, actor));
  const list = (workspaceId, actor) => { workspace(workspaceId, actor, 'automations.manage'); return db.prepare('SELECT * FROM playbooks WHERE workspace_id=? AND archived_at IS NULL ORDER BY updated_at DESC,id').all(workspaceId).map(output); };
  const runs = (id, actor) => {
    const book = item(id, actor);
    return db.prepare('SELECT * FROM playbook_runs WHERE playbook_id=? AND workspace_id=? ORDER BY created_at DESC LIMIT 100').all(id, book.workspace_id).map(run => ({ ...run, receipts: db.prepare('SELECT step_index,action_id,status,result_json,created_at FROM playbook_step_receipts WHERE run_id=? ORDER BY step_index').all(run.id).map(receipt => ({ ...receipt, result: json(receipt.result_json), result_json: undefined })) }));
  };
  const create = (body, actor) => transaction(() => {
    exact(body, ['workspace_id', 'name', 'description', 'definition', 'enabled'], 'Playbook');
    const ws = workspace(body.workspace_id, actor, 'automations.manage');
    const name = string(body.name, 'Name', 120), description = string(body.description ?? '', 'Description', 1000, false);
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw validationError('Enabled must be true or false.');
    const definition = normalizeDefinition(body.definition), date = instant(), id = `playbook_${randomUUID()}`;
    const raw = JSON.stringify(definition);
    db.prepare('INSERT INTO playbooks(id,workspace_id,name,description,definition_json,enabled,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, ws, name, description, raw, body.enabled === false ? 0 : 1, actor.id, date, date);
    db.prepare('INSERT INTO playbook_versions(playbook_id,version,definition_json,created_by,created_at) VALUES(?,?,?,?,?)').run(id, 1, raw, actor.id, date);
    return get(id, actor);
  });
  const update = (id, body, actor) => transaction(() => {
    exact(body, ['version', 'name', 'description', 'definition', 'enabled'], 'Playbook update');
    const previous = item(id, actor, 'automations.manage');
    if (!Number.isInteger(body.version) || body.version !== previous.version) throw error('Playbook changed. Reload before saving.', 409, 'stale_playbook');
    const definition = body.definition === undefined ? json(previous.definition_json) : normalizeDefinition(body.definition);
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw validationError('Enabled must be true or false.');
    const name = body.name === undefined ? previous.name : string(body.name, 'Name', 120);
    const description = body.description === undefined ? previous.description : string(body.description, 'Description', 1000, false);
    const version = previous.version + 1, date = instant(), raw = JSON.stringify(definition);
    db.prepare('UPDATE playbooks SET name=?,description=?,definition_json=?,enabled=?,version=?,updated_at=? WHERE id=?').run(name, description, raw, body.enabled === undefined ? previous.enabled : body.enabled ? 1 : 0, version, date, id);
    db.prepare('INSERT INTO playbook_versions(playbook_id,version,definition_json,created_by,created_at) VALUES(?,?,?,?,?)').run(id, version, raw, actor.id, date);
    return get(id, actor);
  });
  const archive = (id, body, actor) => transaction(() => {
    exact(body, ['version'], 'Archive request');
    const previous = item(id, actor, 'automations.manage');
    if (!Number.isInteger(body.version) || body.version !== previous.version) throw error('Playbook changed. Reload before archiving.', 409, 'stale_playbook');
    const date = instant();
    db.prepare('UPDATE playbooks SET archived_at=?,enabled=0,version=version+1,updated_at=? WHERE id=?').run(date, date, id);
    db.prepare('INSERT INTO playbook_versions(playbook_id,version,definition_json,created_by,created_at) VALUES(?,?,?,?,?)').run(id, previous.version + 1, previous.definition_json, actor.id, date);
    return { id, archived_at: date };
  });
  const projectFor = (ws, projectId, actor, permission) => {
    if (!projectId) return null;
    const project = db.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(projectId, ws);
    if (!project) throw error('Project unavailable in this workspace.', 404);
    authorize(ws, actor, permission, { scope_type: 'project', scope_id: projectId });
    return project;
  };
  const apply = (step, ws, actor, date) => {
    const action = ACTION_BY_ID.get(step.action_id);
    if (!action) throw error('This action is no longer available.', 409, 'action_unavailable');
    const config = step.config;
    authorize(ws, actor, action.permission);
    const project = projectFor(ws, config.project_id, actor, action.permission);
    if (step.action_id === 'route.create_draft') {
      const id = `task_${randomUUID()}`;
      const next = db.prepare('SELECT COALESCE(MAX(number),0)+1 AS number FROM tasks WHERE workspace_id=?').get(ws).number;
      db.prepare('INSERT INTO tasks(id,workspace_id,project_id,team_id,number,title,description,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, ws, project?.id ?? null, project?.team_id ?? null, next, config.title, config.description, 'backlog', date, date);
      return { route_id: id, number: next };
    }
    if (step.action_id === 'document.create_draft') {
      const id = `doc_${randomUUID()}`;
      db.prepare('INSERT INTO documents(id,workspace_id,project_id,title,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, ws, project?.id ?? null, config.title, config.content, date, date);
      return { document_id: id };
    }
    if (step.action_id === 'project.create_draft') {
      const id = `project_${randomUUID()}`;
      const identifier = `PB${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
      db.prepare('INSERT INTO projects(id,workspace_id,name,identifier,description,goal,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, ws, config.name, identifier, config.description, config.goal, 'planned', date, date);
      return { project_id: id };
    }
    if (step.action_id === 'chat.create_draft') {
      const id = `chat_${randomUUID()}`;
      db.prepare('INSERT INTO chats(id,workspace_id,project_id,title,kind,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, ws, project?.id ?? null, config.title, 'general', date, date);
      return { chat_id: id };
    }
    throw error('This action is unavailable.', 409, 'action_unavailable');
  };
  const readRun = id => {
    const run = db.prepare('SELECT * FROM playbook_runs WHERE id=?').get(id);
    return run && { ...run, receipts: db.prepare('SELECT step_index,action_id,status,result_json,created_at FROM playbook_step_receipts WHERE run_id=? ORDER BY step_index').all(id).map(receipt => ({ ...receipt, result: json(receipt.result_json), result_json: undefined })) };
  };
  const execute = (book, actor, type, key) => {
    if (!book.enabled || book.archived_at) return null;
    const existing = db.prepare('SELECT id FROM playbook_runs WHERE playbook_id=? AND trigger_key=?').get(book.id, key);
    if (existing) return readRun(existing.id);
    const definition = json(book.definition_json), started = instant(), id = `pbrun_${randomUUID()}`;
    // Reserve first. Retries return this receipt and never repeat uncertain writes.
    db.prepare('INSERT INTO playbook_runs(id,playbook_id,workspace_id,playbook_version,trigger_type,trigger_key,actor_id,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, book.id, book.workspace_id, book.version, type, key, actor.id, 'running', started);
    for (const [index, step] of definition.steps.entries()) {
      try {
        transaction(() => {
          // Re-check membership and permission at every step; saved definitions confer no grants.
          authorize(book.workspace_id, actor, 'automations.manage');
          const value = apply(step, book.workspace_id, actor, instant());
          db.prepare('INSERT INTO playbook_step_receipts(run_id,step_index,action_id,status,result_json,created_at) VALUES(?,?,?,?,?,?)').run(id, index, step.action_id, 'completed', JSON.stringify(value), instant());
        });
      } catch (cause) {
        const message = String(cause?.message || 'Action failed').slice(0, 500);
        db.prepare('INSERT INTO playbook_step_receipts(run_id,step_index,action_id,status,result_json,created_at) VALUES(?,?,?,?,?,?)').run(id, index, step.action_id, 'failed', JSON.stringify({ error: message }), instant());
        db.prepare('UPDATE playbook_runs SET status=?,error=?,finished_at=? WHERE id=?').run('failed', message, instant(), id);
        return readRun(id);
      }
    }
    db.prepare('UPDATE playbook_runs SET status=?,finished_at=? WHERE id=?').run('completed', instant(), id);
    return readRun(id);
  };
  const run = (id, body, actor) => {
    exact(body, ['idempotency_key'], 'Run request');
    const book = item(id, actor, 'automations.manage');
    if (!book.enabled) throw error('Playbook is disabled.', 409, 'playbook_disabled');
    return execute(book, actor, 'manual', `manual:${identifier(body.idempotency_key)}`);
  };
  const dispatchEvent = (body, actor) => {
    exact(body, ['workspace_id', 'event', 'idempotency_key'], 'Event request');
    const ws = workspace(body.workspace_id, actor, 'workspace.read');
    if (!EVENTS.includes(body.event)) throw validationError('Unsupported Playbook event.');
    // Inbox emits the signal for any signed-in workspace reader. People who
    // cannot manage Playbooks see no definitions and trigger no background work.
    if (!allowed(ws, actor, 'automations.manage')) return [];
    const key = identifier(body.idempotency_key);
    return db.prepare('SELECT * FROM playbooks WHERE workspace_id=? AND enabled=1 AND archived_at IS NULL').all(ws)
      .filter(book => { const trigger = json(book.definition_json).trigger; return trigger.type === 'event' && trigger.event === body.event; })
      .map(book => {
        // Browser mount/re-render can signal the same open twice with different
        // keys. Collapse signals within two seconds for this actor and event.
        const previous = db.prepare("SELECT id,created_at,trigger_key FROM playbook_runs WHERE playbook_id=? AND actor_id=? AND trigger_type='event' ORDER BY created_at DESC LIMIT 1").get(book.id, actor.id);
        if (previous && new Date(instant()).getTime() - new Date(previous.created_at).getTime() < 2000 && previous.trigger_key.startsWith(`event:${body.event}:`)) return readRun(previous.id);
        return execute(book, actor, 'event', `event:${body.event}:${actor.id}:${key}`);
      });
  };
  const dispatchDue = (at = now()) => {
    const due = [];
    for (const book of db.prepare('SELECT * FROM playbooks WHERE enabled=1 AND archived_at IS NULL').all()) {
      try {
        const trigger = json(book.definition_json).trigger;
        if (trigger.type !== 'schedule') continue;
        const local = localMinute(at, trigger.timezone);
        if (local.time !== trigger.time || !trigger.days_of_week.includes(local.day)) continue;
        const actor = { id: book.created_by };
        due.push(execute(book, actor, 'schedule', `schedule:${local.key}`));
      } catch { /* A single invalid or inaccessible definition must not halt the scheduler. */ }
    }
    return due.filter(Boolean);
  };
  return { catalog: playbookCatalog, list, get, create, update, archive, run, runs, dispatchEvent, dispatchDue };
}

export async function playbooksRoute({ service, req, res, path, url, body, send, actor }) {
  if (!path.startsWith('/playbooks')) return false;
  const method = req.method;
  if (path === '/playbooks/catalog' && method === 'GET') { send(res, 200, { result: service.catalog() }); return true; }
  if (path === '/playbooks' && method === 'GET') { send(res, 200, { result: service.list(url.searchParams.get('workspace_id'), actor) }); return true; }
  if (path === '/playbooks' && method === 'POST') { send(res, 201, { result: service.create(body, actor) }); return true; }
  if (path === '/playbooks/dispatch-event' && method === 'POST') { send(res, 200, { result: service.dispatchEvent(body, actor) }); return true; }
  const match = path.match(/^\/playbooks\/([^/]+)(?:\/(runs|run))?$/);
  if (!match) throw error('Playbook endpoint not found.', 404);
  const [, id, action] = match;
  if (action === 'runs' && method === 'GET') send(res, 200, { result: service.runs(id, actor) });
  else if (action === 'run' && method === 'POST') send(res, 200, { result: service.run(id, body, actor) });
  else if (!action && method === 'GET') send(res, 200, { result: service.get(id, actor) });
  else if (!action && method === 'PATCH') send(res, 200, { result: service.update(id, body, actor) });
  else if (!action && method === 'DELETE') send(res, 200, { result: service.archive(id, body, actor) });
  else throw error('Playbook method not allowed.', 405);
  return true;
}

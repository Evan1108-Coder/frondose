import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { captureSourceAccess } from '../server/context-source-access.mjs';
import { installRunContextStore, saveInspection, consumeInspection, captureRunContext } from '../server/run-context-store.mjs';
import { createNativeAgentToolService, listNativeAgentTools } from '../server/native-agent-tools.mjs';

function fixture(t, { areaOnly = false } = {}) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(`
    CREATE TABLE workspaces(id TEXT PRIMARY KEY,name TEXT,archived_at TEXT);
    CREATE TABLE teams(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,archived_at TEXT);
    CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,description TEXT,goal TEXT,status TEXT,updated_at TEXT,archived_at TEXT);
    CREATE TABLE agents(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,archived_at TEXT);
    CREATE TABLE agent_profile_versions(agent_id TEXT,version INTEGER,PRIMARY KEY(agent_id,version));
    CREATE TABLE runs(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,task_id TEXT,agent_id TEXT,agent_profile_version INTEGER,mode TEXT,status TEXT);
    CREATE TABLE agent_run_sponsors(run_id TEXT PRIMARY KEY,actor_id TEXT);
    INSERT INTO workspaces VALUES('ws','Workspace',NULL);
    INSERT INTO teams VALUES('area','ws','Area',NULL);
    INSERT INTO projects VALUES('project','ws','Project','Old description','Old goal','active','original',NULL);
    INSERT INTO agents VALUES('agent','ws','Agent',NULL);
    INSERT INTO agent_profile_versions VALUES('agent',1);
    INSERT INTO runs VALUES('run','ws','project',NULL,'agent',1,'live','running');
    INSERT INTO agent_run_sponsors VALUES('run','sponsor');
  `);
  installRunContextStore(db);
  const section = (kind, id, content) => ({ kind, id, label: id, status: 'included', content, content_hash: createHash('sha256').update(content).digest('hex') });
  const inspection = { finalPrompt: 'Reviewed old context', request: { native_tools: true }, manifest: { resolved: { workspace_id: 'ws', project_id: 'project', task_id: null, agent_id: 'agent' }, permissions: { available_tools: listNativeAgentTools().map(tool => ({ id: tool.id, available: true })) }, included: [section('workspace','ws','Workspace'), section('project','project',JSON.stringify({ name: 'Project', description: 'Old description', goal: 'Old goal', status: 'active' })), section('agent','agent','Agent')], excluded: [] } };
  inspection.manifest.fingerprint = 'native-audit-context';
  if (areaOnly) {
    db.prepare("UPDATE runs SET project_id=NULL WHERE id='run'").run();
    inspection.manifest.resolved.project_id = null;
    inspection.manifest.resolved.area_id = 'area';
    inspection.manifest.included = inspection.manifest.included.filter(item => item.kind !== 'project');
    inspection.manifest.included.push(section('area', 'area', 'Reviewed Area'));
  }
  inspection.sourceAccess = captureSourceAccess(db, inspection);
  const saved = saveInspection(db, { actorId: 'sponsor', workspaceId: 'ws', input: { native_tools: true }, inspection });
  consumeInspection(db, saved.id, 'run'); captureRunContext(db, 'run', inspection);
  const denied = new Set(), applied = [];
  const apply = Object.fromEntries(['propose_project_update', 'save_memory_candidate', 'submit_output'].map(name => [name, value => { applied.push(value); return { applied: true }; }]));
  const service = createNativeAgentToolService({ db, allowed: (_ws, actor, permission, scope) => !denied.has(`${actor.id}:${permission}`) && !denied.has(`${actor.id}:${permission}:${scope?.scope_id || '*'}`), apply });
  return { db, service, denied, applied };
}

test('audit: a project edit before proposal must not be approved against an obsolete before-state', t => {
  const { db, service, applied } = fixture(t);
  db.prepare("UPDATE projects SET goal='New human goal',updated_at='changed-before-proposal' WHERE id='project'").run();
  const response = service.invoke('run', 'propose_project_update', { idempotency_key: 'stale-context', project_id: 'project', patch: { goal: 'Agent replacement' } });
  if (!response.ok) { assert.equal(response.error.code, 'stale_target'); return; }
  const request = service.listRunHistory('run', { id: 'reviewer' }).requests[0];
  if (JSON.stringify(request.before).includes('New human goal')) return;
  assert.throws(() => service.decideRequest(response.result.request_id, { actor: { id: 'reviewer' }, decision: 'approve', version: 1 }), { code: 'stale_target' });
  assert.equal(applied.length, 0);
});

test('audit: same-key write replay rechecks the specific write capability', t => {
  const { service, denied } = fixture(t);
  const args = { idempotency_key: 'same', project_id: 'project', patch: { goal: 'Agent goal' } };
  assert.equal(service.invoke('run', 'propose_project_update', args).ok, true);
  denied.add('sponsor:projects.write');
  const replay = service.invoke('run', 'propose_project_update', args);
  assert.equal(replay.ok, false);
  assert.equal(replay.error.code, 'tool_access_denied');
});

test('audit: Area-only run proposals do not bypass Area document-write denial through workspace fallback', t => {
  const { service, denied, applied } = fixture(t, { areaOnly: true });
  denied.add('sponsor:documents.write:area');
  denied.add('reviewer:documents.write:area');
  for (const [tool, args] of [
    ['save_memory_candidate', { idempotency_key: 'memory', title: 'Area memory', content: 'Area-private information' }],
    ['submit_output', { idempotency_key: 'output', title: 'Area output', content: 'Area-private information' }],
  ]) {
    const proposal = service.invoke('run', tool, args);
    if (!proposal.ok) { assert.equal(proposal.error.code, 'tool_access_denied'); continue; }
    assert.throws(() => service.decideRequest(proposal.result.request_id, { actor: { id: 'reviewer' }, decision: 'approve', version: 1 }), { code: 'tool_access_denied' });
  }
  assert.equal(applied.length, 0);
});

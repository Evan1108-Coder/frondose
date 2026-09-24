import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createLocalApi } from '../server/local-api.mjs';
import { getInspection, captureRunContext } from '../server/run-context-store.mjs';
import { captureSourceAccess, assertSourceAccess } from '../server/context-source-access.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'rumbo-context-security-'));
  const forbidden = () => { throw new Error('Provider calls are forbidden in context security fixtures.'); };
  const api = createLocalApi({ dataDir: dir, seedMode: 'clean', integrationOptions: { env: {}, execute: forbidden, fetchImpl: forbidden, spawnProcess: forbidden } });
  const db = new DatabaseSync(api.dbPath);
  const server = createServer(api.middleware); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = async (path, body, method = body === undefined ? 'GET' : 'POST', cookie) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const call = async (path, body, method = body === undefined ? 'GET' : 'POST', cookie) => {
    const response = await request(path, body, method, cookie);
    assert.ok(response.status >= 200 && response.status < 300, `${path}: ${JSON.stringify(response.body)}`);
    return response.body;
  };
  t.after(async () => { api.close(); await new Promise(resolve => server.close(resolve)); db.close(); await rm(dir, { recursive: true, force: true }); });
  const workspace = (await call('/workspaces', { name: 'Context security fixture' })).workspace;
  const project = (await call('/projects', { workspace_id: workspace.id, name: 'Public work' })).project;
  const agent = (await call('/agents', { workspace_id: workspace.id, name: 'Context reader', provider: 'codex' })).agent;
  // Capture a real compiled preview against a non-executing fixture run. This
  // exercises the production historical-context endpoint without any provider.
  const capture = async (extra = {}) => {
    const input = { workspace_id: workspace.id, project_id: project.id, agent_id: agent.id, prompt: 'Review supplied context.', work_mode: 'conversation', permission_mode: 'read-only', include_chat: false, ...extra };
    const preview = (await call('/context/inspect', input)).result;
    const inspection = getInspection(db, preview.id, { actorId: 'local-owner', workspaceId: workspace.id }).inspection;
    const { run } = await call('/runs', { workspace_id: workspace.id, project_id: project.id, agent_id: agent.id, prompt: input.prompt, mode: 'mock' });
    captureRunContext(db, run.id, inspection);
    return { run, preview };
  };
  return { api, db, request, call, workspace, project, agent, capture };
}

test('captured document text keeps its historical project permission boundary after the document moves', async t => {
  const { db, request, call, workspace, project, capture } = await fixture(t);
  const privateProject = (await call('/projects', { workspace_id: workspace.id, name: 'Private work' })).project;
  const doc = (await call('/documents', { workspace_id: workspace.id, project_id: privateProject.id, title: 'Private document', content: 'HISTORICAL_PRIVATE_DOCUMENT_SECRET' })).document;
  const pack = (await call('/workspace-items', { workspace_id: workspace.id, kind: 'context_pack', name: 'Cross-project evidence', payload: { description: '', content: '', document_ids: [doc.id], memory_ids: [] } })).result;
  const { run, preview } = await capture({ context_pack_ids: [pack.id] });
  assert.match(preview.finalPrompt, /HISTORICAL_PRIVATE_DOCUMENT_SECRET/);
  await call(`/documents/${doc.id}`, { project_id: project.id, content: 'Current public document text' }, 'PATCH');
  const member = (await call('/governance', { workspace_id: workspace.id, action: 'create_member', name: 'Reader', email: 'reader-context-security@example.com' })).result;
  const owner = await request('/identity/setup', { name: 'Owner', email: 'owner-context-security@example.com', password: 'owner fixture password 123' });
  assert.equal(owner.status, 200);
  const invitation = (await call('/identity/invite', { workspace_id: workspace.id, member_id: member.id }, 'POST', owner.cookie)).result;
  const accepted = await request('/identity/accept', { token: invitation.invitation_token, password: 'member fixture password 123' });
  assert.equal(accepted.status, 200);
  await call('/governance', { workspace_id: workspace.id, action: 'grant', member_id: member.id, permission: 'documents.read', effect: 'deny', scope_type: 'project', scope_id: privateProject.id, reason: 'No historical private document access' }, 'POST', owner.cookie);
  assert.equal((await request(`/documents/${doc.id}`, undefined, 'GET', accepted.cookie)).status, 200, 'The current public document is readable');
  const historical = await request(`/runs/${run.id}/context`, undefined, 'GET', accepted.cookie);
  assert.equal(historical.status, 403, `Historical private text must stay private; returned status ${historical.status}, leaked=${JSON.stringify(historical.body).includes('HISTORICAL_PRIVATE_DOCUMENT_SECRET')}`);
  assert.equal(db.prepare('SELECT project_id FROM documents WHERE id=?').get(doc.id).project_id, project.id);
});

function cachedConnection(db, workspace, agent) {
  const now = new Date().toISOString();
  const settings = { selected_resources: ['repo-private', 'repo-public'], enabled_features: ['read'], agent_access: true, allowed_agent_ids: [agent.id] };
  db.prepare('INSERT INTO platform_connections(id,workspace_id,provider,scope_type,scope_id,state,settings,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('fixture-connection', workspace.id, 'github', 'workspace', workspace.id, 'connected', JSON.stringify(settings), now, now);
  for (const [id, resource, secret] of [['private-object', 'repo-private', 'REVOKED_PRIVATE_RESOURCE_SECRET'], ['public-object', 'repo-public', 'Retained public resource']]) {
    db.prepare('INSERT INTO platform_external_objects(id,connection_id,resource_id,kind,external_id,title,content,content_hash,synced_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, 'fixture-connection', resource, 'issue', id, id, JSON.stringify({ body: secret }), 'fixture-hash', now);
  }
  return settings;
}

test('removing a selected connection resource revokes its captured excerpts even while the connection remains available', async t => {
  const { db, workspace, agent, capture, request, call } = await fixture(t);
  const settings = cachedConnection(db, workspace, agent);
  const { run, preview } = await capture();
  assert.match(preview.finalPrompt, /REVOKED_PRIVATE_RESOURCE_SECRET/);
  // Fixture-only state mutation: no OAuth, synchronization or remote account.
  db.prepare('UPDATE platform_connections SET settings=? WHERE id=?').run(JSON.stringify({ ...settings, selected_resources: ['repo-public'] }), 'fixture-connection');
  const current = (await call('/context/inspect', { workspace_id: workspace.id, agent_id: agent.id, prompt: 'Current resources', work_mode: 'conversation' })).result;
  assert.doesNotMatch(current.finalPrompt, /REVOKED_PRIVATE_RESOURCE_SECRET/);
  assert.ok(current.manifest.included.some(source => source.kind === 'connection' && source.id === 'fixture-connection'));
  const historical = await request(`/runs/${run.id}/context`);
  assert.equal(historical.status, 403, `Revoked cached excerpt must not be returned; status=${historical.status}, leaked=${JSON.stringify(historical.body).includes('REVOKED_PRIVATE_RESOURCE_SECRET')}`);
});

test('disabling connection reads revokes captured cached text without requiring complete disconnection', async t => {
  const { db, workspace, agent, capture, request, call } = await fixture(t);
  const settings = cachedConnection(db, workspace, agent);
  const { run, preview } = await capture();
  assert.match(preview.finalPrompt, /REVOKED_PRIVATE_RESOURCE_SECRET/);
  db.prepare('UPDATE platform_connections SET settings=? WHERE id=?').run(JSON.stringify({ ...settings, enabled_features: [] }), 'fixture-connection');
  const current = (await call('/context/inspect', { workspace_id: workspace.id, agent_id: agent.id, prompt: 'Current resources', work_mode: 'conversation' })).result;
  assert.doesNotMatch(current.finalPrompt, /REVOKED_PRIVATE_RESOURCE_SECRET/);
  assert.ok(current.manifest.included.some(source => source.kind === 'connection' && source.id === 'fixture-connection'));
  const historical = await request(`/runs/${run.id}/context`);
  assert.equal(historical.status, 403, `Disabled reads must hide historical cached text; status=${historical.status}, leaked=${JSON.stringify(historical.body).includes('REVOKED_PRIVATE_RESOURCE_SECRET')}`);
});

test('moving a document project to another Area does not discard the original Area document permission', async t => {
  const { request, call, workspace, project, capture } = await fixture(t);
  const privateArea = (await call('/teams', { workspace_id: workspace.id, name: 'Original private Area' })).team;
  const publicArea = (await call('/teams', { workspace_id: workspace.id, name: 'New public Area' })).team;
  const sourceProject = (await call('/projects', { workspace_id: workspace.id, team_id: privateArea.id, name: 'Moving source project' })).project;
  const doc = (await call('/documents', { workspace_id: workspace.id, project_id: sourceProject.id, title: 'Area-private document', content: 'HISTORICAL_PRIVATE_AREA_SECRET' })).document;
  const pack = (await call('/workspace-items', { workspace_id: workspace.id, kind: 'context_pack', name: 'Moving project evidence', payload: { description: '', content: '', document_ids: [doc.id], memory_ids: [] } })).result;
  const { run, preview } = await capture({ context_pack_ids: [pack.id] });
  assert.match(preview.finalPrompt, /HISTORICAL_PRIVATE_AREA_SECRET/);
  await call(`/projects/${sourceProject.id}`, { team_id: publicArea.id }, 'PATCH');
  const member = (await call('/governance', { workspace_id: workspace.id, action: 'create_member', name: 'Reader', email: 'reader-area-security@example.com' })).result;
  const owner = await request('/identity/setup', { name: 'Owner', email: 'owner-area-security@example.com', password: 'owner fixture password 123' });
  const invitation = (await call('/identity/invite', { workspace_id: workspace.id, member_id: member.id }, 'POST', owner.cookie)).result;
  const accepted = await request('/identity/accept', { token: invitation.invitation_token, password: 'member fixture password 123' });
  await call('/governance', { workspace_id: workspace.id, action: 'grant', member_id: member.id, permission: 'documents.read', effect: 'deny', scope_type: 'team', scope_id: privateArea.id, reason: 'No original Area document access' }, 'POST', owner.cookie);
  assert.equal((await request(`/documents/${doc.id}`, undefined, 'GET', accepted.cookie)).status, 200);
  assert.equal((await request(`/projects/${project.id}`, undefined, 'GET', accepted.cookie)).status, 200);
  const historical = await request(`/runs/${run.id}/context`, undefined, 'GET', accepted.cookie);
  assert.equal(historical.status, 403, `Original Area protection must survive project moves; status=${historical.status}, leaked=${JSON.stringify(historical.body).includes('HISTORICAL_PRIVATE_AREA_SECRET')}`);
});

test('source provenance permits safe edits but checks labeled excluded sources and attachment ancestry', async t => {
  const { db, call, workspace, project, agent } = await fixture(t);
  const doc = (await call('/documents', { workspace_id: workspace.id, project_id: project.id, title: 'Budget-excluded private title', content: 'Original content' })).document;
  const chat = (await call('/chats', { workspace_id: workspace.id, project_id: project.id, title: 'Attachment conversation' })).chat;
  const message = (await call('/messages', { chat_id: chat.id, sender_name: 'You', content: 'Source', attachments: [{ name: 'file.txt', content: 'Evidence' }] })).message;
  const manifest = { resolved: { workspace_id: workspace.id, agent_id: agent.id }, included: [{ kind: 'attachment', id: `${message.id}:0`, label: 'file.txt' }], excluded: [{ kind: 'documents', id: doc.id, label: doc.title, reason: 'context_budget' }] };
  const inspection = { manifest };
  inspection.sourceAccess = captureSourceAccess(db, inspection);
  assert.ok(inspection.sourceAccess.sources.some(ref => ref.table === 'documents' && ref.id === doc.id));
  assert.ok(inspection.sourceAccess.sources.some(ref => ref.table === 'messages' && ref.id === message.id));
  assert.ok(inspection.sourceAccess.sources.some(ref => ref.table === 'chats' && ref.id === chat.id));
  await call(`/documents/${doc.id}`, { content: 'Safe content revision' }, 'PATCH');
  assert.equal(assertSourceAccess(db, inspection, { id: 'local-owner' }, () => true), true);
  assert.throws(() => assertSourceAccess(db, inspection, { id: 'local-owner' }, (_ws, _actor, permission, scope) => !(permission === 'documents.read' && scope.scope_id === project.id)), { code: 'context_access_revoked', statusCode: 403 });
  assert.throws(() => assertSourceAccess(db, { manifest }, { id: 'local-owner' }, () => true), { code: 'context_access_revoked' });
});

test('unverifiable truncated connection references cannot unlock historical cached data', async t => {
  const { db, workspace, agent } = await fixture(t);
  cachedConnection(db, workspace, agent);
  const inspection = { manifest: { resolved: { workspace_id: workspace.id, agent_id: agent.id }, included: [{ kind: 'connection', id: 'fixture-connection', status: 'truncated', content: '{"provider":"github","cached_objects":[' }], excluded: [] } };
  inspection.sourceAccess = captureSourceAccess(db, inspection);
  assert.equal(inspection.sourceAccess.connections[0].unverifiable, true);
  assert.throws(() => assertSourceAccess(db, inspection, { id: 'local-owner' }, () => true), { code: 'context_access_revoked', statusCode: 403 });
});

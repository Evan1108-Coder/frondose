import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { installAgentAwareness, captureAgentActions, agentAwarenessRoute, connectionActionProtocol } from '../server/agent-awareness.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE workspaces(id TEXT PRIMARY KEY,archived_at TEXT); INSERT INTO workspaces VALUES('ws',NULL),('foreign',NULL);
    CREATE TABLE agents(id TEXT PRIMARY KEY,workspace_id TEXT); INSERT INTO agents VALUES('agent','ws');
    CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,archived_at TEXT);
    CREATE TABLE runs(id TEXT PRIMARY KEY,workspace_id TEXT,agent_id TEXT,project_id TEXT,status TEXT); INSERT INTO runs VALUES('run','ws','agent',NULL,'completed');
    CREATE TABLE platform_connections(id TEXT PRIMARY KEY,workspace_id TEXT,provider TEXT,scope_type TEXT,scope_id TEXT,state TEXT,settings TEXT);`);
  installAgentAwareness(db);
  const settings = { agent_access: true, allowed_agent_ids: ['agent'], enabled_features: ['create_issue'], selected_resources: ['acme/repo'] };
  db.prepare('INSERT INTO platform_connections VALUES(?,?,?,?,?,?,?)').run('connection', 'ws', 'github', 'workspace', 'ws', 'connected', JSON.stringify(settings));
  const proposal = { type: 'connection.action', connection_id: 'connection', action: 'create_issue', input: { resource_id: 'acme/repo', title: 'Reviewed request' } };
  const block = action => `Draft for review.\n\`\`\`rumbo-actions\n${JSON.stringify({ nonce: 'nonce', actions: [action] })}\n\`\`\``;
  const capture = (action = proposal, authorizeCapture = () => {}) => {
    captureAgentActions(db, 'run', block(action), 'nonce', { authorizeCapture });
    return db.prepare('SELECT * FROM agent_action_requests').get();
  };
  const decide = async (action, executeConnectionAction, extra = {}) => {
    let response;
    const handled = await agentAwarenessRoute({ db, req: { method: 'POST' }, res: {}, path: `/agent-actions/${action.id}/decision`, url: new URL('http://localhost'), readBody: async () => ({ decision: 'approve' }), send: (_res, status, body) => { response = { status, ...(body.result || body) }; }, authorizeProposal: async () => {}, executeConnectionAction, ...extra });
    assert.equal(handled, true); return response;
  };
  return { db, settings, proposal, capture, decide };
}

test('connection proposals require explicit named-agent delegation and selected resources before capture', () => {
  const { db, settings, proposal, capture } = fixture();
  db.prepare('UPDATE platform_connections SET settings=?').run(JSON.stringify({ ...settings, agent_access: false }));
  assert.throws(() => capture(), /not delegated/);
  db.prepare('UPDATE platform_connections SET settings=?').run(JSON.stringify({ ...settings, allowed_agent_ids: ['someone-else'] }));
  assert.throws(() => capture(), /not delegated/);
  db.prepare('UPDATE platform_connections SET settings=?').run(JSON.stringify(settings));
  assert.throws(() => capture({ ...proposal, input: { ...proposal.input, resource_id: 'private/other' } }), /not selected/);
  assert.throws(() => capture({ ...proposal, input: { ...proposal.input, access_token: 'forbidden' } }), /unsupported fields/);
  db.prepare("UPDATE platform_connections SET workspace_id='foreign'").run();
  assert.throws(() => capture(), /this workspace/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_action_requests').get().n, 0);
  assert.match(connectionActionProtocol, /not a live tool call/); db.close();
});

test('execution requires current review authorization, preserves key across owner approval, and runs exactly once', async () => {
  const { db, capture, decide } = fixture(); const action = capture(); let attempts = 0; const keys = [];
  await assert.rejects(decide(action, async () => { attempts++; }, { authorizeProposal: async () => { throw Error('Permission revoked'); } }), /Permission revoked/);
  assert.equal(attempts, 0);
  const execute = async input => { keys.push(input.idempotency_key); attempts++; return attempts === 1 ? { approval_required: true, approval: { id: 'approval' } } : { external_id: 'issue-42' }; };
  assert.equal((await decide(action, execute)).status, 'awaiting_approval');
  assert.equal((await decide(action, execute)).status, 'applied');
  assert.deepEqual(keys, [`agent-action:${action.id}`, `agent-action:${action.id}`]);
  assert.equal(JSON.parse(db.prepare('SELECT result_json FROM agent_action_requests').get().result_json).external_id, 'issue-42');
  await assert.rejects(decide(action, execute), /already resolved/);
  assert.equal(attempts, 2); db.close();
});

test('connection configuration changes invalidate proposals and provider failures remain uncertain', async () => {
  const { db, settings, capture, decide } = fixture(); const action = capture();
  db.prepare('UPDATE platform_connections SET settings=?').run(JSON.stringify({ ...settings, selected_resources: ['acme/repo', 'acme/extra'] }));
  await assert.rejects(decide(action, async () => assert.fail('stale action must not execute')), /changed since/);
  db.prepare('UPDATE platform_connections SET settings=?').run(JSON.stringify(settings));
  await assert.rejects(decide(action, async () => { throw Error('Socket closed after send'); }), /Socket closed/);
  assert.equal(db.prepare('SELECT status FROM agent_action_requests').get().status, 'uncertain');
  await assert.rejects(decide(action, async () => assert.fail('uncertain action must not be retried')), /already resolved/); db.close();
});

test('concurrent approvals cannot send the same proposal twice', async () => {
  const { db, capture, decide } = fixture(); const action = capture(); let finish, started;
  const entered = new Promise(resolve => { started = resolve; }); let sends = 0;
  const execute = async () => { sends++; started(); return new Promise(resolve => { finish = resolve; }); };
  const first = decide(action, execute); await entered;
  await assert.rejects(decide(action, execute), /already resolved/);
  finish({ completed: true }); await first; assert.equal(sends, 1); db.close();
});

test('capture authorization runs before reading the target snapshot', () => {
  const { db, capture } = fixture();
  assert.throws(() => capture(undefined, () => { throw Error('Sponsor cannot access connection'); }), /Sponsor cannot/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_action_requests').get().n, 0); db.close();
});

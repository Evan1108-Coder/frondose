import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { changeContext } from '../server/change-context.mjs';
import { bumpAgentProfileVersion, installAgentProfiles, snapshotAgentProfile } from '../server/agent-profiles.mjs';
import {
  installAgentProfileHistory,
  listAgentContentHistory,
  restoreAgentContent,
} from '../server/agent-profile-history.mjs';
import { installWorkspaceFeatures } from '../server/workspace-features.mjs';

const actor = { id: 'local-owner', name: 'Local owner', mode: 'account' };
const stamp = '2026-09-24T12:00:00.000Z';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  installWorkspaceFeatures(db);
  installAgentProfiles(db);
  installAgentProfileHistory(db);
  db.prepare('INSERT INTO workspaces(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)').run('ws', 'Workspace', 'workspace', stamp, stamp);
  db.prepare(`INSERT INTO agents
    (id,workspace_id,name,provider,role,description,instructions,status,model,reasoning_effort,memory_policy,context_source_ids_json,permission_policy,output_behavior,version,color,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'agent', 'ws', 'Historian', 'custom', 'Researcher', 'First description', 'First instructions', 'available', 'private-model', '', 'none', '[]', 'read-only', 'First output', 1, '#8b95a5', stamp, stamp,
    );
  snapshotAgentProfile(db, 'agent', stamp);
  const allowed = (_workspaceId, _actor, permission) => permission === 'agents.read' || permission === 'agents.write' || permission === 'workspace.read' || permission === 'documents.read' || permission === 'projects.read';
  return { db, allowed };
}

function history(db, allowed, query = '') {
  return listAgentContentHistory({ db, agentId: 'agent', url: new URL(`http://localhost/agents/agent/content-history${query}`), actor, allowed });
}

function makeVersion(db, patch, at) {
  const fields = Object.keys(patch);
  db.prepare(`UPDATE agents SET ${fields.map(field => `${field}=?`).join(',')},updated_at=? WHERE id='agent'`).run(...Object.values(patch), at);
  return bumpAgentProfileVersion(db, 'agent', fields, at);
}

function restore(db, allowed, overrides = {}) {
  const source = history(db, allowed, '?version=1').versions[0];
  return changeContext.run({ actor, source: 'Rumbo' }, () => restoreAgentContent({
    db, agentId: 'agent', actor, allowed,
    body: {
      current_version: db.prepare("SELECT version FROM agents WHERE id='agent'").get().version,
      source_version: 1,
      source_hash: source.source_sha256,
      fields: ['instructions'], confirmed: true, request_id: 'restore-request-0001', ...overrides,
    },
  }));
}

test('content history is bounded, exactly addressable, and never returns profile authority fields', () => {
  const { db, allowed } = fixture();
  try {
    makeVersion(db, { instructions: 'Second instructions', model: 'another-private-model' }, '2026-09-24T12:01:00.000Z');
    makeVersion(db, { description: 'Third description' }, '2026-09-24T12:02:00.000Z');
    const page = history(db, allowed, '?limit=2');
    assert.deepEqual(page.versions.map(row => row.version), [3, 2]);
    assert.equal(page.next_before_version, 2);
    assert.deepEqual(history(db, allowed, `?before_version=${page.next_before_version}&limit=2`).versions.map(row => row.version), [1]);
    const exact = history(db, allowed, '?version=1').versions[0];
    assert.deepEqual(Object.keys(exact.content), ['role', 'description', 'instructions', 'output_behavior']);
    assert.equal(exact.content.instructions, 'First instructions');
    assert.equal(exact.model, undefined);
    assert.equal(exact.source_sha256.length, 64);
    assert.equal(exact.author, null);
    assert.equal(exact.provenance, 'legacy_unknown');
    assert.throws(() => history(db, allowed, '?version=1&limit=1'), /cannot include pagination/);
  } finally { db.close(); }
});

test('restoration creates one immutable content-only version and replays without overwriting later changes', () => {
  const { db, allowed } = fixture();
  try {
    makeVersion(db, { instructions: 'New instructions', description: 'Keep this description', model: 'pinned-model' }, '2026-09-24T12:01:00.000Z');
    const before = db.prepare("SELECT * FROM agents WHERE id='agent'").get();
    const first = restore(db, allowed);
    assert.equal(first.result.current_version, 3);
    assert.equal(first.result.restored_version.content.instructions, 'First instructions');
    assert.deepEqual(first.result.restored_version.restored_from.fields, ['instructions']);
    const after = db.prepare("SELECT * FROM agents WHERE id='agent'").get();
    for (const field of ['provider', 'provider_connection_id', 'working_directory', 'model', 'reasoning_effort', 'memory_policy', 'context_source_ids_json', 'default_area_id', 'default_project_id', 'permission_policy', 'name', 'status', 'workspace_id', 'color']) assert.equal(after[field], before[field], field);
    assert.equal(after.description, 'Keep this description');
    assert.equal(after.instructions, 'First instructions');
    assert.equal(db.prepare("SELECT COUNT(*) count FROM agent_profile_content_restores WHERE agent_id='agent'").get().count, 1);
    const audit = db.prepare("SELECT * FROM change_log WHERE entity_type='agents' AND entity_id='agent' ORDER BY rowid DESC").get();
    assert.equal(audit.action, 'content_restored');
    assert.equal(JSON.parse(audit.after_json).model, undefined);
    assert.equal(JSON.parse(audit.after_json).provider_connection_id, undefined);

    makeVersion(db, { instructions: 'Fourth instructions' }, '2026-09-24T12:03:00.000Z');
    const replay = restore(db, allowed, { current_version: 2 });
    assert.equal(replay.replayed, true);
    assert.equal(replay.result.restored_version.version, 3);
    assert.equal(db.prepare("SELECT instructions FROM agents WHERE id='agent'").get().instructions, 'Fourth instructions');
    assert.equal(db.prepare("SELECT COUNT(*) count FROM agent_profile_content_restores WHERE agent_id='agent'").get().count, 1);
    db.prepare("DELETE FROM agents WHERE id='agent'").run();
    assert.equal(db.prepare("SELECT COUNT(*) count FROM agent_profile_content_restores").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM agent_profile_history_requests").get().count, 0);
  } finally { db.close(); }
});

test('restore rejects stale state, forged bodies, wrong hashes, archives, agent actors, and changed idempotency payloads', () => {
  const { db, allowed } = fixture();
  try {
    makeVersion(db, { instructions: 'Changed' }, '2026-09-24T12:01:00.000Z');
    assert.throws(() => restore(db, allowed, { current_version: 1 }), error => error.statusCode === 409 && error.errorCode === 'stale_profile');
    assert.throws(() => restore(db, allowed, { source_hash: '0'.repeat(64) }), error => error.statusCode === 409 && error.errorCode === 'stale_source');
    assert.throws(() => restore(db, allowed, { fields: [] }), /one or more/);
    assert.throws(() => restore(db, allowed, { fields: ['model'] }), /restorable/);
    assert.throws(() => restoreAgentContent({ db, agentId: 'agent', actor, allowed, body: { unexpected: true } }), /Unknown field/);
    const result = restore(db, allowed);
    assert.equal(result.result.current_version, 3);
    assert.throws(() => restore(db, allowed, { fields: ['role'] }), error => error.statusCode === 409 && error.errorCode === 'idempotency_conflict');
    const source = history(db, allowed, '?version=1').versions[0];
    assert.throws(() => restoreAgentContent({ db, agentId: 'agent', actor: { id: 'agent', mode: 'agent' }, allowed, body: {
      current_version: 3, source_version: 1, source_hash: source.source_sha256, fields: ['role'], confirmed: true, request_id: 'agent-forbidden-0001',
    } }), error => error.statusCode === 403);
    db.prepare("UPDATE agents SET archived_at='2026-09-24T13:00:00.000Z' WHERE id='agent'").run();
    assert.throws(() => history(db, allowed), error => error.statusCode === 409 && error.errorCode === 'agent_archived');
  } finally { db.close(); }
});

test('unreadable source references return an explicit restricted row and cannot be restored', () => {
  const { db, allowed } = fixture();
  try {
    db.prepare('INSERT INTO projects(id,workspace_id,name,identifier,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('project', 'ws', 'Private project', 'PRI', stamp, stamp);
    db.prepare('INSERT INTO documents(id,workspace_id,project_id,title,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('document', 'ws', 'project', 'Secret', 'PRIVATE', stamp, stamp);
    db.prepare('INSERT INTO workspace_items(id,workspace_id,kind,name,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('pack', 'ws', 'context_pack', 'Private pack', JSON.stringify({ document_ids: ['document'], memory_ids: [] }), stamp, stamp);
    db.prepare("UPDATE agents SET context_source_ids_json='[\"pack\"]' WHERE id='agent'").run();
    makeVersion(db, { instructions: 'Uses private context' }, '2026-09-24T12:01:00.000Z');
    makeVersion(db, { context_source_ids_json: '[]', instructions: 'No private context' }, '2026-09-24T12:02:00.000Z');
    const denyPrivateProject = (_ws, _actor, permission, scope) => !(permission === 'documents.read' && scope?.scope_id === 'project');
    const restricted = history(db, denyPrivateProject, '?version=2').versions[0];
    assert.deepEqual(restricted, { version: 2, created_at: '2026-09-24T12:01:00.000Z', restricted: true, reason: 'source_access_unavailable' });
    assert.throws(() => restore(db, denyPrivateProject, { source_version: 2, source_hash: '0'.repeat(64) }), error => error.statusCode === 403 && error.errorCode === 'source_access_unavailable');
  } finally { db.close(); }
});

test('snapshot integrity is enforced and immutable snapshots still cascade on agent deletion', () => {
  const { db, allowed } = fixture();
  try {
    assert.throws(() => db.prepare("UPDATE agent_profile_versions SET snapshot_json='{}' WHERE agent_id='agent' AND version=1").run(), /immutable/);
    db.exec('DROP TRIGGER agent_profile_versions_no_update');
    db.prepare("UPDATE agent_profile_versions SET snapshot_json='{}' WHERE agent_id='agent' AND version=1").run();
    assert.deepEqual(history(db, allowed, '?version=1').versions[0], { version: 1, created_at: stamp, restricted: true, reason: 'invalid_snapshot' });
    db.prepare("DELETE FROM agents WHERE id='agent'").run();
    assert.equal(db.prepare("SELECT COUNT(*) count FROM agent_profile_versions WHERE agent_id='agent'").get().count, 0);
  } finally { db.close(); }
});

test('shared profile history is restricted to installation owner authority', () => {
  const { db, allowed } = fixture();
  try {
    db.prepare(`INSERT INTO agents(id,name,provider,role,description,instructions,status,context_source_ids_json,permission_policy,output_behavior,version,color,created_at,updated_at)
      VALUES('shared','Shared','custom','','','','available','[]','read-only','',1,'#8b95a5',?,?)`).run(stamp, stamp);
    snapshotAgentProfile(db, 'shared', stamp);
    const url = new URL('http://localhost/agents/shared/content-history');
    assert.equal(listAgentContentHistory({ db, agentId: 'shared', url, actor, allowed }).versions.length, 1);
    assert.throws(() => listAgentContentHistory({ db, agentId: 'shared', url, actor: { id: 'member' }, allowed }), error => error.statusCode === 403);
  } finally { db.close(); }
});

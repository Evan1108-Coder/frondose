import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { installWorkflow, workflowRoute, workflowSnapshot } from '../server/workflow-service.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  for (const table of ['workspaces', 'projects', 'tasks', 'chats']) db.exec(`ALTER TABLE ${table} ADD COLUMN archived_at TEXT`);
  installWorkflow(db);
  db.exec("INSERT INTO workspaces(id,name,slug,created_at,updated_at) VALUES('ws','Review fixture','review','now','now')");
  const call = async (path, body, actor = { id: 'human-owner', mode: 'account' }) => {
    let result;
    assert.equal(await workflowRoute({ db, req: { method: 'POST' }, res: {}, path: `/workflow/${path}`, url: new URL('http://localhost'), actor, allowed: () => true, readBody: async () => body, send: (_res, _status, value) => { result = value.result; }, snapshot: workflowSnapshot }), true);
    return result;
  };
  return { db, call };
}

test('new output reviews retain server actor identity separately from typed attribution', async () => {
  const { db, call } = fixture();
  try {
    const output = await call('outputs', { workspace_id: 'ws', title: 'Manual output', content: 'Exact output version' });
    const version = db.prepare('SELECT id FROM output_versions WHERE output_id=?').get(output.id);
    const review = await call(`outputs/${output.id}/review`, { version: output.version, version_id: version.id, decision: 'approved', reviewer_name: 'Typed display attribution', reviewer_id: 'forged-agent-id' });
    assert.equal(review.reviewer_id, 'human-owner');
    assert.equal(review.reviewer_name, 'Typed display attribution');
    assert.equal(db.prepare('SELECT reviewer_id FROM output_reviews WHERE id=?').get(review.id).reviewer_id, 'human-owner');
    installWorkflow(db);
    assert.equal(db.prepare('SELECT reviewer_id FROM output_reviews WHERE id=?').get(review.id).reviewer_id, 'human-owner');
  } finally { db.close(); }
});

test('agent identity cannot decide an output review', async () => {
  const { db, call } = fixture();
  try {
    const output = await call('outputs', { workspace_id: 'ws', title: 'Agent output', content: 'Needs independent review' });
    const version = db.prepare('SELECT id FROM output_versions WHERE output_id=?').get(output.id);
    await assert.rejects(call(`outputs/${output.id}/review`, { version: output.version, version_id: version.id, decision: 'approved', reviewer_name: 'Agent' }, { id: 'agent', mode: 'agent' }), error => error.statusCode === 403);
    assert.equal(db.prepare('SELECT count(*) AS n FROM output_reviews').get().n, 0);
  } finally { db.close(); }
});

test('additive reviewer identity migration preserves legacy recorded names without inventing an actor', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
    db.exec("CREATE TABLE output_reviews(id TEXT PRIMARY KEY,output_id TEXT,workspace_id TEXT,version_id TEXT,decision TEXT,reviewer_name TEXT,feedback TEXT,revision_task_id TEXT,created_at TEXT)");
    db.exec("INSERT INTO output_reviews VALUES('legacy','out','ws','v1','approved','Historical reviewer','',NULL,'2026-09-01')");
    installWorkflow(db);
    const row = db.prepare("SELECT * FROM output_reviews WHERE id='legacy'").get();
    assert.equal(row.reviewer_name, 'Historical reviewer');
    assert.equal(row.reviewer_id, null);
    installWorkflow(db);
    assert.equal(db.prepare('SELECT count(*) AS n FROM output_reviews').get().n, 1);
  } finally { db.close(); }
});

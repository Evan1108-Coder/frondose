import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { installLocalAiWorkspaces, enableLocalAi, localAiEnabled } from '../server/local-ai-workspace.mjs';
import { isPersonalTalvoriProfile } from '../server/talvori-agent-service.mjs';

test('local AI migration preserves real bindings, not empty workspaces, and never reactivates on restart', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE workspaces(id TEXT PRIMARY KEY);
      CREATE TABLE agents(id TEXT,workspace_id TEXT,provider TEXT,provider_connection_id TEXT);
      INSERT INTO workspaces VALUES ('existing'),('empty');
      INSERT INTO agents VALUES ('manual','existing','codex','conn_codex');`);
    installLocalAiWorkspaces(db);
    assert.equal(localAiEnabled(db, 'existing', 'codex'), true);
    assert.equal(localAiEnabled(db, 'existing', 'claude'), false);
    assert.equal(localAiEnabled(db, 'empty', 'codex'), false);
    db.exec("INSERT INTO workspaces VALUES ('new'); INSERT INTO agents VALUES ('new-profile','new','codex','conn_codex')");
    installLocalAiWorkspaces(db);
    assert.equal(localAiEnabled(db, 'new', 'codex'), false);
    enableLocalAi(db, 'new', 'codex');
    assert.equal(localAiEnabled(db, 'new', 'codex'), true);
    db.exec("DELETE FROM local_ai_workspace_connections WHERE workspace_id='existing'");
    installLocalAiWorkspaces(db);
    assert.equal(localAiEnabled(db, 'existing', 'codex'), false);
  } finally { db.close(); }
});

test('personal profile identity is not inferred from a name or an ID prefix', () => {
  assert.equal(isPersonalTalvoriProfile({ id: 'rumbo_agent_manual', workspace_id: 'ws', provider: 'codex', name: 'Talvori' }), false);
  assert.equal(isPersonalTalvoriProfile({ id: 'ordinary', name: 'Talvori' }), false);
});

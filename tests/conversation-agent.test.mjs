import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { installConversationAgent, validateConversationAgent, assertConversationAgent, bindConversationAgent } from '../server/conversation-agent.mjs';

function fixture(t) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE chats(id TEXT PRIMARY KEY,workspace_id TEXT,participant_agent_ids_json TEXT);
    CREATE TABLE agents(id TEXT PRIMARY KEY,workspace_id TEXT,archived_at TEXT,status TEXT);
    CREATE TABLE runs(id TEXT,chat_id TEXT,status TEXT);
    INSERT INTO agents VALUES('one','ws',NULL,'available'),('two','ws',NULL,'available'),('foreign','other',NULL,'available'),('archived','ws','yesterday','available');
    INSERT INTO chats VALUES('legacy','ws','["one", "two"]'),('note','ws','[]');`);
  installConversationAgent(db);return db;
}
test('additive installation retains legacy participants and leaves future identity unchosen',t=>{
  const db=fixture(t);installConversationAgent(db);
  const old=db.prepare('SELECT * FROM chats WHERE id=?').get('legacy');
  assert.equal(old.participant_agent_ids_json,'["one", "two"]');assert.equal(old.responding_agent_id,null);
});
test('new single-agent conversations bind; multi-agent creation and mismatched inputs reject',t=>{
  const db=fixture(t);
  const one={workspace_id:'ws',participant_agent_ids_json:['one']};validateConversationAgent(db,one);assert.equal(one.responding_agent_id,'one');
  assert.throws(()=>validateConversationAgent(db,{workspace_id:'ws',participant_agent_ids_json:['one','two']}),/only one/);
  assert.throws(()=>validateConversationAgent(db,{workspace_id:'ws',participant_agent_ids_json:['one'],responding_agent_id:'two'}),/must match/);
  for(const id of ['foreign','archived','missing']) assert.throws(()=>validateConversationAgent(db,{workspace_id:'ws',responding_agent_id:id}),/available agent/);
  assert.equal(validateConversationAgent(db,{workspace_id:'ws',participant_agent_ids_json:[]}).responding_agent_id,undefined);
});
test('legacy explicit binding preserves historical participants and cannot later be switched or cleared',t=>{
  const db=fixture(t),current=db.prepare('SELECT * FROM chats WHERE id=?').get('legacy');
  validateConversationAgent(db,{workspace_id:'ws',participant_agent_ids_json:['one','two'],responding_agent_id:'two'},current);
  db.exec('BEGIN');bindConversationAgent(db,'legacy','two');db.exec('COMMIT');
  const bound=db.prepare('SELECT * FROM chats WHERE id=?').get('legacy');
  assert.equal(bound.participant_agent_ids_json,current.participant_agent_ids_json);
  for(const id of ['one',null]) assert.throws(()=>validateConversationAgent(db,{workspace_id:'ws',participant_agent_ids_json:['one','two'],responding_agent_id:id},bound),{errorCode:'conversation_agent_mismatch'});
  assert.throws(()=>validateConversationAgent(db,{workspace_id:'ws',participant_agent_ids_json:['two'],responding_agent_id:'two'},bound),/Historical/);
  db.prepare('DELETE FROM agents WHERE id=?').run('two');
  assert.equal(db.prepare('SELECT responding_agent_id FROM chats WHERE id=?').get('legacy').responding_agent_id,'two');
  assert.throws(()=>assertConversationAgent(bound,'one'),{errorCode:'conversation_agent_mismatch'});
});
test('binding competes at transaction time and rolls back without rewriting history',t=>{
  const db=fixture(t),stale=db.prepare('SELECT * FROM chats WHERE id=?').get('legacy');
  assertConversationAgent(stale,'one');assertConversationAgent(stale,'two');
  db.exec('BEGIN');bindConversationAgent(db,'legacy','one');db.exec('COMMIT');
  db.exec('BEGIN');assert.throws(()=>bindConversationAgent(db,'legacy','two'),{errorCode:'conversation_agent_mismatch'});db.exec('ROLLBACK');
  assert.equal(db.prepare('SELECT responding_agent_id FROM chats WHERE id=?').get('legacy').responding_agent_id,'one');
  db.exec('BEGIN');bindConversationAgent(db,'note','one');db.exec('ROLLBACK');
  assert.equal(db.prepare('SELECT responding_agent_id FROM chats WHERE id=?').get('note').responding_agent_id,null);
});
test('explicit legacy binding waits for active work, while unchanged locked identities stay editable if unavailable',t=>{
  const db=fixture(t),current=db.prepare('SELECT * FROM chats WHERE id=?').get('legacy');
  db.prepare('INSERT INTO runs VALUES(?,?,?)').run('run','legacy','running');
  assert.throws(()=>validateConversationAgent(db,{workspace_id:'ws',participant_agent_ids_json:['one','two'],responding_agent_id:'two'},current),/active work/);
  const unavailable={...current,responding_agent_id:'missing'};
  assert.doesNotThrow(()=>validateConversationAgent(db,{workspace_id:'ws',participant_agent_ids_json:['one','two'],responding_agent_id:'missing'},unavailable));
});

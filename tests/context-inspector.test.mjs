import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildContextInspection } from '../server/context-inspector.mjs';

function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(`
    CREATE TABLE workspaces(id TEXT PRIMARY KEY,name TEXT,description TEXT,archived_at TEXT);
    CREATE TABLE teams(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,description TEXT,archived_at TEXT);
    CREATE TABLE area_settings(id TEXT PRIMARY KEY,workspace_id TEXT,instructions TEXT,context_pack_ids_json TEXT,allowed_tools_json TEXT,permission_policy TEXT,version INTEGER);
    CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,team_id TEXT,name TEXT,description TEXT,goal TEXT,status TEXT,archived_at TEXT);
    CREATE TABLE tasks(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,team_id TEXT,title TEXT,description TEXT,status TEXT,priority TEXT,due_at TEXT,archived_at TEXT);
    CREATE TABLE agents(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,instructions TEXT,role TEXT,context_source_ids_json TEXT,default_area_id TEXT,default_project_id TEXT,memory_policy TEXT,permission_policy TEXT,version INTEGER,archived_at TEXT);
    CREATE TABLE workspace_items(id TEXT PRIMARY KEY,workspace_id TEXT,kind TEXT,name TEXT,payload_json TEXT,version INTEGER,archived_at TEXT);
    CREATE TABLE documents(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,title TEXT,content TEXT,archived_at TEXT);
    CREATE TABLE memory_notes(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,title TEXT,content TEXT,updated_at TEXT,archived_at TEXT);
    CREATE TABLE agent_memories(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,agent_id TEXT,title TEXT,content TEXT,updated_at TEXT,archived_at TEXT);
    CREATE TABLE knowledge_entries(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,title TEXT,content TEXT,state TEXT,updated_at TEXT,archived_at TEXT);
    CREATE TABLE chats(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,task_id TEXT,title TEXT,archived_at TEXT);
    CREATE TABLE messages(id TEXT PRIMARY KEY,chat_id TEXT,sender_type TEXT,sender_name TEXT,content TEXT,attachments_json TEXT,created_at TEXT);
    INSERT INTO workspaces VALUES('ws','Workspace','Workspace description',NULL),('foreign','Other workspace','SECRET FOREIGN',NULL);
    INSERT INTO teams VALUES('area','ws','Engineering','Area description',NULL),('other-area','ws','Other Area','Other defaults',NULL);
    INSERT INTO area_settings VALUES('area','ws','Area rules: check evidence','["pack"]','["read_document"]','review',2);
    INSERT INTO projects VALUES('project','ws','area','Launch','Project scope','Ship safely','active',NULL),('other-project','ws','other-area','Elsewhere','Other scope','Other goal','active',NULL);
    INSERT INTO tasks VALUES('route','ws','project','area','Deliver feature','Route description','ready','high','2026-10-01',NULL);
    INSERT INTO agents VALUES('agent','ws','Helper','Agent instructions','Researcher','["pack"]','other-area','other-project','reviewed','read-only',3,NULL);
    INSERT INTO chats VALUES('chat','ws','project','route','Discussion',NULL),('other-chat','ws','other-project',NULL,'Other discussion',NULL),('general','ws',NULL,NULL,'General chat',NULL);
    INSERT INTO documents VALUES('doc','ws','project','Evidence','Document evidence',NULL),('secret','ws','other-project','SECRET TITLE','SECRET TEXT',NULL),('foreign-doc','foreign',NULL,'FOREIGN TITLE','FOREIGN TEXT',NULL);
    INSERT INTO memory_notes VALUES('note','ws','project','Saved note','Human note','2026-01-01',NULL),('other-note','ws','other-project','Other note','OTHER PROJECT MEMORY','2026-01-02',NULL);
    INSERT INTO agent_memories VALUES('reviewed','ws','project','agent','Reviewed memory','Approved agent memory','2026-01-01',NULL),('other-agent-memory','ws','project','other-agent','Foreign agent memory','OTHER AGENT MEMORY','2026-01-02',NULL);
    INSERT INTO knowledge_entries VALUES('approved','ws','project','Approved knowledge','Approved knowledge content','approved','2026-01-01',NULL),('draft','ws','project','Draft knowledge','DRAFT KNOWLEDGE','draft','2026-01-02',NULL);
    INSERT INTO messages VALUES('old','chat','user','You','Older conversation','[]','2026-01-01'),('current','chat','user','You','Current instruction text','[]','2026-01-02'),('outside','other-chat','user','Other','SECRET OTHER CHAT','[]','2026-01-03');
  `);
  db.prepare('INSERT INTO workspace_items VALUES(?,?,?,?,?,?,?)').run('pack', 'ws', 'context_pack', 'Evidence pack', JSON.stringify({ document_ids: ['doc'], memory_ids: ['note'], content: 'Additional pack text' }), 1, null);
  const inspect = extra => buildContextInspection({ db, workspaceId: 'ws', projectId: 'project', taskId: 'route', chatId: 'chat', agentId: 'agent', prompt: 'Current instruction text', sourceMessageId: 'current', filter: value => value, workMode: 'project', ...extra });
  return { db, inspect };
}

test('inspector deterministically assembles launch prefix and manifest without DB writes or runtime protocols', t => {
  const { db, inspect } = fixture(t);
  const changes = db.prepare('SELECT total_changes() AS count').get().count;
  const result = inspect({ availableTools: [{ id: 'read_document', available: true }, { id: 'write_file', available: false, reason: 'read_only' }] });
  assert.deepEqual(result, inspect({ availableTools: [{ id: 'read_document', available: true }, { id: 'write_file', available: false, reason: 'read_only' }] }));
  assert.equal(db.prepare('SELECT total_changes() AS count').get().count, changes);
  assert.equal(result.finalPrompt, result.prefix + 'Current instruction:\nCurrent instruction text');
  assert.equal(result.manifest.current_instruction.content, 'Current instruction text');
  assert.equal(result.manifest.runtime_protocol_included, false);
  assert.equal(result.manifest.resolved.area_id, 'area');
  assert.equal(result.manifest.permissions.permission_mode, 'read-only');
  assert.equal(result.manifest.permissions.available_tools[0].preferred_by_area, true);
  for (const content of ['Workspace description', 'Area rules: check evidence', 'Agent instructions', 'Project scope', 'Route description', 'Document evidence', 'Additional pack text', 'Human note', 'Approved agent memory', 'Approved knowledge content', 'Older conversation']) assert.ok(result.prefix.includes(content), content);
  for (const content of ['DRAFT KNOWLEDGE', 'OTHER PROJECT MEMORY', 'OTHER AGENT MEMORY', 'SECRET OTHER CHAT', 'Current instruction text', 'Other defaults']) assert.ok(!result.prefix.includes(content), content);
  assert.equal(result.manifest.included.filter(item => item.kind === 'context_pack').length, 1);
  assert.equal(result.manifest.included.filter(item => item.id === 'note').length, 1);
  assert.ok(result.manifest.excluded.some(item => item.id === 'draft' && item.reason === 'not_approved'));
  assert.match(result.prefix, /untrusted reference material/);
});

test('required targets fail closed and optional references honor access redaction without leaking hidden content', t => {
  const { db, inspect } = fixture(t);
  assert.throws(() => inspect({ filter: undefined }), /access filter/);
  assert.throws(() => inspect({ filter: value => Object.fromEntries(Object.keys(value).map(key => [key, []])) }), { code: 'context_target_unavailable' });
  assert.throws(() => inspect({ projectId: 'other-project' }), { code: 'context_scope_mismatch' });
  assert.throws(() => inspect({ areaId: 'other-area' }), { code: 'context_scope_mismatch' });
  assert.throws(() => inspect({ taskId: 'missing', chatId: undefined, sourceMessageId: undefined }), { code: 'context_target_unavailable' });
  db.prepare('UPDATE workspace_items SET payload_json=? WHERE id=?').run(JSON.stringify({ document_ids: ['doc', 'secret', 'foreign-doc', 'missing'], content: 'Pack' }), 'pack');
  const result = inspect({ filter: value => Object.fromEntries(Object.entries(value).map(([key, rows]) => [key, rows.filter(row => row.id !== 'secret').map(row => row.id === 'doc' ? { ...row, content: 'Redacted safe text' } : row)])) });
  assert.ok(result.prefix.includes('Redacted safe text')); assert.ok(!result.prefix.includes('Document evidence'));
  for (const forbidden of ['SECRET TITLE', 'SECRET TEXT', 'FOREIGN TITLE', 'FOREIGN TEXT']) assert.ok(!JSON.stringify(result).includes(forbidden));
  for (const id of ['secret', 'foreign-doc', 'missing']) assert.ok(result.manifest.excluded.some(item => item.id === id && item.reason === 'unavailable_or_not_permitted'));
});

test('current attachments use canonical message data, precede history and remain available with history excluded', t => {
  const { db, inspect } = fixture(t);
  db.prepare('UPDATE messages SET attachments_json=? WHERE id=?').run(JSON.stringify([{ name: 'current.txt', type: 'text/plain', content: 'CANONICAL FILE' }, { name: 'image.png', type: 'image/png', content: 'data:image/png;base64,AA==' }]), 'current');
  db.prepare('UPDATE messages SET attachments_json=? WHERE id=?').run(JSON.stringify([{ name: 'old.txt', type: 'text/plain', content: 'OLD FILE' }]), 'old');
  const result = inspect({ includeChat: false, currentAttachments: [{ name: 'forged.txt', content: 'FORGED OVERRIDE' }] });
  assert.ok(result.prefix.includes('CANONICAL FILE'));
  for (const value of ['OLD FILE', 'Older conversation', 'FORGED OVERRIDE', 'data:image/png']) assert.ok(!result.prefix.includes(value));
  assert.ok(result.manifest.excluded.some(item => item.reason === 'unsupported_attachment'));
  assert.ok(result.manifest.excluded.some(item => item.reason === 'history_disabled'));
  assert.ok(!result.manifest.excluded.some(item => item.kind === 'current_message'));
  const wrong = inspect({ sourceMessageId: 'outside', currentAttachments: [{ name: 'fake', content: 'FORGED OVERRIDE' }] });
  assert.ok(!wrong.prefix.includes('SECRET OTHER CHAT')); assert.ok(!wrong.prefix.includes('FORGED OVERRIDE'));
  assert.ok(wrong.manifest.excluded.some(item => item.kind === 'current_message' && item.reason === 'unavailable_or_not_permitted'));
});

test('memory opt-outs cover pack memory, agent memory and reviewed knowledge without altering selected documents', t => {
  const { db, inspect } = fixture(t);
  for (const input of [{ includeMemory: false }, {}]) {
    if (!Object.hasOwn(input, 'includeMemory')) db.prepare("UPDATE agents SET memory_policy='none' WHERE id='agent'").run();
    const result = inspect(input);
    for (const content of ['Human note', 'Approved agent memory', 'Approved knowledge content']) assert.ok(!result.prefix.includes(content));
    assert.ok(result.prefix.includes('Document evidence'));
    assert.ok(result.manifest.excluded.some(item => ['memory_disabled', 'agent_memory_disabled'].includes(item.reason)));
  }
});

test('budgets and Unicode truncation have deterministic exact character/byte counts with complete framing', t => {
  const { inspect } = fixture(t);
  const result = inspect({ maxContextCharacters: 1500, currentAttachments: [{ name: 'large.txt', type: 'text/plain', content: '😀'.repeat(20000) }], sourceMessageId: undefined });
  assert.equal(result.truncated, true);
  assert.ok(result.prefix.length <= 1500);
  assert.equal(result.approximate_characters, result.finalPrompt.length);
  assert.equal(result.counts.total_characters, result.finalPrompt.length);
  assert.equal(result.counts.utf8_bytes, Buffer.byteLength(result.finalPrompt));
  assert.equal(result.counts.character_unit, 'UTF-16 code units');
  for (const item of result.manifest.included) {
    assert.equal(item.included_characters, item.content.length);
    const serialized = result.prefix.slice(item.prefix_start, item.prefix_end);
    assert.equal(serialized.length, item.serialized_characters);
    const rendered = JSON.parse(serialized.slice('Reference data '.length).trim());
    assert.equal(rendered.content, item.content);
    assert.equal(rendered.truncated, item.status === 'truncated');
    assert.ok(!/[\uD800-\uDBFF]$/.test(item.content));
  }
  const empty = inspect({ maxContextCharacters: 0 });
  assert.equal(empty.prefix, ''); assert.equal(empty.finalPrompt, 'Current instruction:\nCurrent instruction text');
  assert.ok(empty.manifest.excluded.some(item => item.reason === 'context_budget'));
  assert.throws(() => inspect({ prompt: 'a'.repeat(100000) }), /prompt budget/);
});

test('pre-authorized connection summaries bypass database ACL collections and are allowlisted; preferences never expand tools', t => {
  const { inspect } = fixture(t);
  const result = inspect({ connectionSummaries: [
    { id: 'github', provider: 'github', name: 'GitHub', state: 'connected', access_token: 'SECRET TOKEN', last_error: 'SECRET ERROR', selected_resources: ['repo'], actions: [{ id: 'read', name: 'Read', token: 'SECRET ACTION TOKEN' }], cached_objects: [{ id: 'o', title: 'Cached issue', content_excerpt: 'Provider reference', credentials: 'SECRET CREDENTIALS' }] },
    { id: 'offline', state: 'not_connected', name: 'Offline', access_token: 'OFFLINE TOKEN' },
  ], availableTools: [], filter: value => {
    assert.ok(!Object.hasOwn(value, 'connection_summaries'), 'Synthetic provider summaries must not enter table ACL filtering');
    return value;
  } });
  assert.ok(result.prefix.includes('Provider reference'));
  for (const forbidden of ['SECRET TOKEN', 'SECRET ERROR', 'SECRET ACTION TOKEN', 'SECRET CREDENTIALS', 'OFFLINE TOKEN']) assert.ok(!JSON.stringify(result).includes(forbidden));
  assert.ok(result.manifest.excluded.some(item => item.id === 'offline' && item.reason === 'resource_not_connected'));
  assert.deepEqual(result.manifest.permissions.available_tools, []);
  const general = inspect({ projectId: undefined, taskId: undefined, chatId: 'general', sourceMessageId: undefined, permissionMode: 'workspace-write', workMode: 'conversation' });
  assert.equal(general.manifest.resolved.project_id, null); assert.equal(general.manifest.resolved.area_id, null);
  assert.equal(general.manifest.permissions.permission_mode, 'read-only');
});

test('explicit Area overrides agent default project and connection excerpt limits are reported in prompt and manifest', t => {
  const { inspect } = fixture(t);
  const explicitArea = inspect({ projectId: undefined, taskId: undefined, chatId: undefined, sourceMessageId: undefined, areaId: 'area' });
  assert.equal(explicitArea.manifest.resolved.area_id, 'area');
  assert.equal(explicitArea.manifest.resolved.project_id, null);
  const result = inspect({ connectionSummaries: [{ id: 'github', state: 'connected', provider: 'github', actions: [null], cached_objects: [null, { id: 'o', content_excerpt: '😀'.repeat(1001) }] }] });
  const source = result.manifest.included.find(item => item.kind === 'connection');
  assert.equal(source.status, 'truncated');
  assert.equal(source.reason, 'summary_limit');
  assert.equal(source.summary_limits.truncated_excerpts, 1);
  assert.equal(result.truncated, true);
  const rendered = JSON.parse(result.prefix.slice(source.prefix_start, source.prefix_end).slice('Reference data '.length));
  assert.equal(rendered.truncated, true);
  assert.equal(JSON.parse(source.content).cached_objects[0].content_excerpt.length, 2000);
});

test('Context Pack reference selection limits are explicit rather than silently dropping references', t => {
  const { db, inspect } = fixture(t);
  db.prepare('UPDATE workspace_items SET payload_json=? WHERE id=?').run(JSON.stringify({ document_ids: Array.from({ length: 52 }, (_, index) => `reference-${index}`) }), 'pack');
  const result = inspect();
  assert.equal(result.truncated, true);
  assert.equal(result.manifest.excluded.filter(item => item.kind === 'documents' && item.reason === 'selection_limit').length, 2);
});

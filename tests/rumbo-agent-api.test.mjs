import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLocalApi } from '../server/local-api.mjs';
import { captureSourceAccess, assertSourceAccess } from '../server/context-source-access.mjs';

async function fixture(t, { onboard = true } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'rumbo-assistant-api-'));
  const fake = { launches: [], commands: [], mode: 'success' };
  const api = createLocalApi({ dataDir, seedMode: 'clean', integrationOptions: {
    env: {}, fetchImpl: () => { throw new Error('Network forbidden in Rumbo Agent fixtures.'); },
    execute: async (command, args) => { fake.commands.push({ command, args }); return { stdout: args.includes('mcp') ? '[]' : '{"loggedIn":true}', stderr: '', code: 0 }; },
    spawnProcess: (command, args, options) => {
      const child = new EventEmitter(), launch = { command, args, options };
      fake.launches.push(launch);
      child.stdin = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = () => queueMicrotask(() => child.emit('close', 1));
      child.stdin.end = prompt => { launch.prompt = prompt; if (fake.mode === 'hold') return; queueMicrotask(() => {
        if (fake.mode === 'success') child.stdout.emit('data', Buffer.from(`${JSON.stringify(command === 'claude' ? { type: 'result', subtype: 'success', result: 'Injected Claude Rumbo Agent reply.', is_error: false } : { type: 'item.completed', item: { type: 'agent_message', text: 'Injected Rumbo Agent reply.' } })}\n`));
        child.emit('close', fake.mode === 'success' ? 0 : 1);
      }); };
      return child;
    },
  } });
  const db = new DatabaseSync(api.dbPath), server = createServer(api.middleware);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = async (path, body, method = body === undefined ? 'GET' : 'POST', cookie) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, signal: AbortSignal.timeout(5000), headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(error => { throw new Error(`${method} ${path}: ${error.message}`, { cause: error }); });
    return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  const call = async (...args) => { const response = await request(...args); assert.ok(response.status >= 200 && response.status < 300, `${args[0]}: ${JSON.stringify(response.body)}`); return response.body; };
  t.after(async () => { api.close(); await new Promise(resolve => server.close(resolve)); db.close(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = (await call('/workspaces', { name: 'Rumbo Agent fixture' })).workspace;
  if (onboard) await call('/rumbo-agent/preferences', { workspace_id: workspace.id, preferences: { display_name: 'Rumbo Agent', orb_color: 'blue', purpose: 'Help organize this workspace.', guidelines: 'Be clear and ask before changing work.', onboarding_complete: true } }, 'PATCH');
  const connect = async (provider = 'codex') => call(`/connections/${provider}/connect`, { method: 'existing' });
  const create = (extra = {}) => call('/rumbo-agent/chats', { workspace_id: workspace.id, provider: 'codex', request_id: 'new-chat-fixture', ...extra });
  const inspect = (chat, agent, extra = {}) => ({ workspace_id: workspace.id, chat_id: chat.id, agent_id: agent.id, prompt: 'Explain this workspace carefully.', work_mode: 'conversation', permission_mode: 'read-only', ...extra });
  const send = async (input, extra = {}) => {
    const preview = (await call('/context/inspect', input)).result;
    const result = await call(`/chats/${input.chat_id}/turns`, { ...input, content: input.prompt, client_turn_id: 'rumbo-fixture-turn', context_inspection_id: preview.id, ...extra });
    return { ...result, preview };
  };
  return { api, db, call, request, fake, workspace, connect, create, inspect, send };
}

test('opening Rumbo Agent is read-only; disconnected creation stores nothing and configured models are not claimed as discovered', async t => {
  const { api, call, request, fake, workspace, connect, create } = await fixture(t);
  const before = api.snapshot();
  const result = (await call(`/rumbo-agent?workspace_id=${workspace.id}`)).result;
  assert.deepEqual(result.providers.map(provider => provider.provider), ['codex', 'claude', 'openrouter', 'huggingface']);
  assert.ok(result.providers.filter(provider => ['openrouter', 'huggingface'].includes(provider.provider)).every(provider => provider.model_required && !provider.models.some(model => !model.id)));
  assert.ok(result.providers.every(provider => !provider.connected && !provider.agent_id && provider.model_catalog_complete === false));
  assert.deepEqual(api.snapshot().agents, before.agents);
  assert.equal(fake.commands.length, 0); assert.equal(fake.launches.length, 0);
  assert.equal((await request('/rumbo-agent/chats', { workspace_id: workspace.id, provider: 'codex', request_id: 'disconnected-create' })).status, 409);
  assert.equal(api.snapshot().chats.length, 0); assert.equal(api.snapshot().agents.length, before.agents.length);
  await connect();
  const first = await create(), second = await create({ request_id: 'second-chat-fixture' });
  assert.equal(first.agent.id, second.agent.id); assert.notEqual(first.chat.id, second.chat.id);
  assert.equal(first.agent.provider_connection_id, 'conn_codex'); assert.equal(first.chat.kind, 'rumbo-agent');
  await call(`/agents/${first.agent.id}`, { model: 'configured-fixture-model' }, 'PATCH');
  const known = (await call(`/rumbo-agent?workspace_id=${workspace.id}`)).result.providers.find(provider => provider.provider === 'codex');
  assert.deepEqual(known.models[1], { id: 'configured-fixture-model', label: 'configured-fixture-model', provenance: 'configured_profile', availability: 'unverified' });
  assert.equal(fake.launches.length, 0);
});

test('first-use setup gates new profiles and chats, then versions real reviewed guidance without connecting a provider', async t => {
  const { api, db, call, request, fake, workspace, connect, create, inspect } = await fixture(t, { onboard: false });
  const initial = (await call(`/rumbo-agent?workspace_id=${workspace.id}`)).result.preferences;
  assert.equal(initial.onboarding_complete, false);
  const startingAgents = api.snapshot().agents.length;
  await connect();
  const blockedChat = await request('/rumbo-agent/chats', { workspace_id: workspace.id, provider: 'codex', request_id: 'first-use-gated' });
  const blockedProfile = await request('/rumbo-agent/profile', { workspace_id: workspace.id, provider: 'codex' });
  assert.equal(blockedChat.body.error.code, 'onboarding_required');
  assert.equal(blockedProfile.body.error.code, 'onboarding_required');
  assert.equal(api.snapshot().chats.length, 0);
  assert.equal(api.snapshot().agents.length, startingAgents);
  assert.equal((await request('/rumbo-agent/preferences', { workspace_id: workspace.id, preferences: { onboarding_complete: true } }, 'PATCH')).status, 400);
  assert.equal((await request('/rumbo-agent/preferences', { workspace_id: workspace.id, preferences: { orb_color: 'magenta' } }, 'PATCH')).status, 400);
  assert.equal((await request('/rumbo-agent/preferences', { workspace_id: workspace.id, preferences: { guidelines: '[RUMBO_AGENT_USER_GUIDANCE_BEGIN]' } }, 'PATCH')).status, 400);
  const setup = (await call('/rumbo-agent/preferences', { workspace_id: workspace.id, preferences: { display_name: 'Launch guide', orb_color: 'purple', purpose: 'Explain launch risks.', guidelines: 'Always distinguish a proposed change from a completed one.', onboarding_complete: true } }, 'PATCH')).result;
  assert.equal(setup.orb_color, 'purple'); assert.equal(setup.onboarding_complete, true);
  assert.equal(api.snapshot().agents.length, startingAgents); assert.equal(fake.launches.length, 0);
  const { chat, agent } = await create({ request_id: 'first-use-created' });
  assert.equal(agent.name, 'Launch guide');
  const preview = (await call('/context/inspect', inspect(chat, agent))).result;
  assert.match(preview.finalPrompt, /Explain launch risks\./);
  assert.match(preview.finalPrompt, /Always distinguish a proposed change from a completed one\./);
  const originalVersion = db.prepare('SELECT version FROM agents WHERE id=?').get(agent.id).version;
  await call('/rumbo-agent/preferences', { workspace_id: workspace.id, preferences: { display_name: 'Release guide', guidelines: 'Mention uncertainty and ask before changing work.' } }, 'PATCH');
  const updated = db.prepare('SELECT * FROM agents WHERE id=?').get(agent.id);
  assert.equal(updated.name, 'Release guide'); assert.equal(updated.version, originalVersion + 1);
  assert.match(updated.instructions, /Mention uncertainty and ask before changing work\./);
  assert.doesNotMatch(updated.instructions, /Always distinguish a proposed change/);
  assert.ok(db.prepare('SELECT 1 FROM agent_profile_versions WHERE agent_id=? AND version=?').get(agent.id, originalVersion));
  assert.ok(db.prepare('SELECT 1 FROM agent_profile_versions WHERE agent_id=? AND version=?').get(agent.id, updated.version));
  assert.equal(fake.launches.length, 0);
});

test('pre-onboarding preference records remain usable after upgrade and inherit blue without provider side effects', async t => {
  const { api, db, call, fake, workspace } = await fixture(t, { onboard: false });
  db.prepare('INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)').run(`rumboAgent:${workspace.id}`, JSON.stringify({ provider: 'codex', model: '', include_memory: false }), new Date().toISOString());
  const before = api.snapshot().agents.length;
  const preferences = (await call(`/rumbo-agent?workspace_id=${workspace.id}`)).result.preferences;
  assert.equal(preferences.onboarding_complete, true);
  assert.equal(preferences.orb_color, 'blue');
  assert.equal(preferences.include_memory, false);
  assert.equal(api.snapshot().agents.length, before);
  assert.equal(fake.launches.length, 0);
});

test('chat creation is idempotent and unknown/cross-workspace sources cannot create profiles or chats', async t => {
  const { api, call, request, workspace, connect, create } = await fixture(t);
  await connect();
  const first = await create(), replay = await create(); assert.equal(replay.chat.id, first.chat.id); assert.equal(replay.replayed, true);
  const foreign = (await call('/workspaces', { name: 'Other fixture workspace' })).workspace;
  const project = (await call('/projects', { workspace_id: foreign.id, name: 'Other project' })).project;
  const count = api.snapshot().chats.length;
  for (const source of [{ type: 'project', id: project.id }, { type: 'document', id: 'missing' }, { type: 'command', id: 'rm' }]) {
    const result = await request('/rumbo-agent/chats', { workspace_id: workspace.id, provider: 'codex', request_id: 'different-request', source });
    assert.ok([400, 403].includes(result.status), JSON.stringify(result.body));
  }
  assert.equal(api.snapshot().chats.length, count);
  const conflict = await request('/rumbo-agent/chats', { workspace_id: workspace.id, provider: 'claude', request_id: 'new-chat-fixture' });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, 'request_id_reused');
});

test('Codex and Claude Rumbo profiles share their existing accounts, switch per chat without model leakage, and reject unsupported reasoning', async t => {
  const { api, call, request, fake, connect, create, inspect, send, workspace } = await fixture(t);
  await connect('codex'); await connect('claude');
  const codex = await create(), claude = await create({ provider: 'claude', request_id: 'claude-chat-fixture' });
  assert.notEqual(codex.agent.id, claude.agent.id);
  assert.equal(codex.agent.provider_connection_id, 'conn_codex'); assert.equal(claude.agent.provider_connection_id, 'conn_claude');
  const reused = (await call('/rumbo-agent/profile', { workspace_id: workspace.id, provider: 'claude' })).agent;
  assert.equal(reused.id, claude.agent.id);
  assert.equal(api.snapshot().connections.filter(row => ['codex', 'claude'].includes(row.provider)).length, 2, 'Profiles never duplicate provider accounts');
  const invalid = await request('/context/inspect', inspect(claude.chat, claude.agent, { model: 'fixture-claude-model', reasoning_effort: 'high' }));
  assert.equal(invalid.status, 400); assert.equal(fake.launches.length, 0);
  const result = await send(inspect(codex.chat, claude.agent, { model: 'fixture-claude-model', reasoning_effort: '' }));
  assert.equal(result.run.provider, 'claude'); assert.equal(result.run.agent_id, claude.agent.id); assert.equal(result.run.status, 'completed');
  assert.equal(fake.launches[0].command, 'claude'); assert.equal(fake.launches[0].args[fake.launches[0].args.indexOf('--model') + 1], 'fixture-claude-model');
  assert.equal(fake.launches[0].args.some(value => value.startsWith('model_reasoning_effort=')), false);
  const next = await send(inspect(codex.chat, codex.agent, { model: 'fixture-codex-model', reasoning_effort: 'medium' }), { client_turn_id: 'switched-back-codex' });
  assert.equal(next.run.provider, 'codex'); assert.equal(fake.launches[1].command, 'codex');
  assert.equal(fake.launches[1].args[fake.launches[1].args.indexOf('--model') + 1], 'fixture-codex-model');
  assert.equal(api.snapshot().messages.filter(row => row.chat_id === codex.chat.id && row.sender_type === 'agent').length, 2);
});

test('effective per-turn model is preview-bound, provider-bound, usage-bound and retry-bound without changing the shared profile', async t => {
  const { api, db, call, request, fake, connect, create, inspect, send } = await fixture(t);
  await connect(); const { chat, agent } = await create();
  const input = inspect(chat, agent, { model: 'fixture-model-medium', reasoning_effort: 'medium' });
  const preview = (await call('/context/inspect', input)).result;
  assert.equal(preview.manifest.permissions.model, input.model);
  const mismatch = await request(`/chats/${chat.id}/turns`, { ...input, model: 'different-model', content: input.prompt, client_turn_id: 'mismatched-model', context_inspection_id: preview.id });
  assert.equal(mismatch.status, 409); assert.equal(api.snapshot().messages.length, 0); assert.equal(fake.launches.length, 0);
  fake.mode = 'failure'; const first = await send(input);
  assert.equal(first.message.metadata.model, input.model);
  assert.equal(fake.launches[0].args[fake.launches[0].args.indexOf('--model') + 1], input.model);
  assert.ok(fake.launches[0].args.includes('model_reasoning_effort="medium"'));
  assert.equal(db.prepare('SELECT model FROM run_usage_invocations WHERE run_id=?').get(first.run.id).model, input.model);
  assert.equal(api.snapshot().agents.find(row => row.id === agent.id).model, '');
  const replay = await request(`/chats/${chat.id}/turns`, { ...input, content: input.prompt, model: 'different-model', client_turn_id: 'rumbo-fixture-turn' });
  assert.equal(replay.status, 409);
  await call(`/agents/${agent.id}`, { model: 'new-profile-default' }, 'PATCH');
  const retryInput = inspect(chat, agent, { source_message_id: first.message.id });
  const retryPreview = (await call('/context/inspect', retryInput)).result;
  assert.equal(retryPreview.manifest.permissions.model, input.model);
  fake.mode = 'success';
  const retry = await call(`/chats/${chat.id}/turns`, { ...retryInput, content: input.prompt, client_turn_id: 'retry-original-model', context_inspection_id: retryPreview.id });
  assert.equal(retry.message.id, first.message.id);
  assert.equal(fake.launches[1].args[fake.launches[1].args.indexOf('--model') + 1], input.model);
});

test('first send titles untouched chats only and active replies block archive and deletion', async t => {
  const { api, call, request, fake, connect, create, inspect, send } = await fixture(t);
  await connect(); const { chat, agent } = await create(); fake.mode = 'hold';
  const first = await send(inspect(chat, agent, { prompt: 'Plan\n  a careful release' }));
  assert.equal(api.snapshot().chats.find(row => row.id === chat.id).title, 'Plan a careful release');
  assert.equal((await request(`/chats/${chat.id}`, { archived_at: new Date().toISOString() }, 'PATCH')).status, 409);
  assert.equal((await request(`/chats/${chat.id}`, undefined, 'DELETE')).status, 409);
  await call(`/runs/${first.run.id}/stop`, {});
  const second = await create({ request_id: 'custom-title-chat' });
  await call(`/chats/${second.chat.id}`, { title: 'My hand-written title' }, 'PATCH');
  fake.mode = 'success'; await send(inspect(second.chat, second.agent));
  assert.equal(api.snapshot().chats.find(row => row.id === second.chat.id).title, 'My hand-written title');
});

test('document sources are current at preview, stale before launch, and revoke all derived conversation surfaces when removed', async t => {
  const { api, call, request, connect, create, inspect, send, workspace } = await fixture(t);
  await connect();
  const area = (await call('/teams', { workspace_id: workspace.id, name: 'Source Area' })).team;
  const document = (await call('/documents', { workspace_id: workspace.id, team_id: area.id, title: 'Area document', content: 'BOUND_SOURCE_ORIGINAL' })).document;
  const { chat, agent } = await create({ source: { type: 'document', id: document.id } });
  const input = inspect(chat, agent), preview = (await call('/context/inspect', input)).result;
  assert.match(preview.finalPrompt, /BOUND_SOURCE_ORIGINAL/); assert.equal(preview.manifest.resolved.area_id, area.id);
  await call(`/documents/${document.id}`, { content: 'BOUND_SOURCE_CURRENT' }, 'PATCH');
  const stale = await request(`/chats/${chat.id}/turns`, { ...input, content: input.prompt, client_turn_id: 'stale-source-turn', context_inspection_id: preview.id });
  assert.equal(stale.status, 409); assert.equal(api.snapshot().messages.length, 0);
  const sent = await send(input); assert.match(sent.preview.finalPrompt, /BOUND_SOURCE_CURRENT/);
  const collab = (await call(`/chat-collaboration/${chat.id}?workspace_id=${workspace.id}`)).result;
  await call(`/chat-collaboration/${chat.id}`, { workspace_id: workspace.id, version: collab.version, action: 'bookmark', message_id: sent.message.id, enabled: true });
  assert.match((await call('/context/inspect', input)).result.finalPrompt, /BOUND_SOURCE_CURRENT/, 'Bookmark updates retain source binding');
  await call(`/documents/${document.id}`, { archived_at: new Date().toISOString() }, 'PATCH');
  for (const path of [`/chats/${chat.id}`, `/chats/${chat.id}/export`, `/runs/${sent.run.id}/context`]) assert.equal((await request(path)).status, 403, path);
  const snapshot = await call('/bootstrap');
  assert.equal(snapshot.chats.some(row => row.id === chat.id), false);
  assert.equal(snapshot.messages.some(row => row.chat_id === chat.id), false);
  assert.equal(snapshot.runs.some(row => row.id === sent.run.id), false);
  assert.equal(snapshot.events.some(row => row.run_id === sent.run.id), false);
});

test('published update sources inherit target permissions; drafts cannot be attached', async t => {
  const { call, request, connect, create, inspect, workspace } = await fixture(t);
  await connect();
  const project = (await call('/projects', { workspace_id: workspace.id, name: 'Update target' })).project;
  const published = (await call('/activity', { workspace_id: workspace.id, target_type: 'project', target_id: project.id, update_type: 'progress', content: 'PUBLISHED_UPDATE_SOURCE', publication_state: 'published' })).result;
  const { chat, agent } = await create({ source: { type: 'update', id: published.id } });
  assert.equal(chat.project_id, project.id);
  assert.match((await call('/context/inspect', inspect(chat, agent))).result.finalPrompt, /PUBLISHED_UPDATE_SOURCE/);
  const draft = (await call('/activity', { workspace_id: workspace.id, target_type: 'project', target_id: project.id, update_type: 'progress', content: 'PRIVATE_DRAFT_SOURCE', publication_state: 'draft' })).result;
  const invalid = await request('/rumbo-agent/chats', { workspace_id: workspace.id, provider: 'codex', request_id: 'draft-source-chat', source: { type: 'update', id: draft.id } });
  assert.equal(invalid.status, 403);
});

test('workspace preferences persist validated intent without provider calls, profiles or native-tool grants', async t => {
  const { api, call, request, fake, workspace } = await fixture(t);
  const agentCount = api.snapshot().agents.length;
  const settings = { provider: 'codex', model: 'fixture-model', reasoning_effort: 'low', include_workspace: false, include_memory: false, include_chat: false, context_pack_ids: [], native_tools: true };
  await call('/rumbo-agent/preferences', { workspace_id: workspace.id, preferences: settings }, 'PATCH');
  assert.deepEqual((await call(`/rumbo-agent?workspace_id=${workspace.id}`)).result.preferences, { ...settings, display_name: 'Rumbo Agent', orb_color: 'blue', purpose: 'Help organize this workspace.', guidelines: 'Be clear and ask before changing work.', onboarding_complete: true });
  assert.equal(fake.commands.length, 0); assert.equal(fake.launches.length, 0); assert.equal(api.snapshot().agents.length, agentCount);
  for (const preferences of [{ context_pack_ids: ['missing-pack'] }, { model: '--evil-shell-option' }, { provider: 'claude', reasoning_effort: 'high' }, { native_tools: 'yes' }, { permission_mode: 'workspace-write' }]) {
    assert.equal((await request('/rumbo-agent/preferences', { workspace_id: workspace.id, preferences }, 'PATCH')).status, 400);
  }
});

test('source bindings survive presentation changes and cannot be discarded by branching, document conversion or archive-field smuggling', async t => {
  const { db, call, request, connect, create, inspect, send, workspace } = await fixture(t);
  await connect();
  const project = (await call('/projects', { workspace_id: workspace.id, name: 'Protected source project' })).project;
  const document = (await call('/documents', { workspace_id: workspace.id, project_id: project.id, title: 'Protected', content: 'SOURCE_PROVENANCE_SECRET' })).document;
  const { chat, agent } = await create({ source: { type: 'document', id: document.id } });
  const sent = await send(inspect(chat, agent));
  const collab = (await call(`/chat-collaboration/${chat.id}?workspace_id=${workspace.id}`)).result;
  for (const action of ['branch', 'document']) {
    const rejected = await request(`/chat-collaboration/${chat.id}`, { workspace_id: workspace.id, version: collab.version, action, message_id: sent.message.id, title: 'Copied source', archived_at: 'smuggled' });
    assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
  }
  assert.equal((await request(`/chats/${chat.id}`, { kind: 'general' }, 'PATCH')).status, 400);
  // Simulate a legacy presentation change: provenance must not depend on kind.
  db.prepare("UPDATE chats SET kind='general' WHERE id=?").run(chat.id);
  const captured = { manifest: { resolved: { workspace_id: workspace.id }, included: [{ kind: 'run', id: sent.run.id }], excluded: [] } };
  captured.sourceAccess = captureSourceAccess(db, captured);
  assert.ok(captured.sourceAccess.sources.some(row => row.table === 'documents' && row.id === document.id), 'Derived run provenance includes the original document');
  await call(`/documents/${document.id}`, { archived_at: new Date().toISOString() }, 'PATCH');
  assert.throws(() => assertSourceAccess(db, captured, { id: 'local-owner' }, () => true), /captured context/);
  assert.equal((await request(`/chats/${chat.id}`)).status, 403);
  assert.equal((await request(`/chat-collaboration/${chat.id}`, { workspace_id: workspace.id, version: collab.version, action: 'document', message_id: sent.message.id, title: 'Bypass attempt', archived_at: 'smuggled' })).status, 403);
  assert.equal((await request(`/messages/${sent.message.id}`, { content: 'Replace content', archived_at: 'smuggled' }, 'PATCH')).status, 403);
});

test('Rumbo Agent requires exact review even without native tools and rejects cross-Area source containers', async t => {
  const { api, call, request, fake, connect, create, workspace } = await fixture(t);
  await connect(); const { chat, agent } = await create();
  const notReviewed = await request(`/chats/${chat.id}/turns`, { agent_id: agent.id, content: 'Please answer', client_turn_id: 'unreviewed-turn' });
  assert.equal(notReviewed.status, 409); assert.equal(notReviewed.body.error.code, 'context_review_required');
  assert.equal(fake.launches.length, 0); assert.equal(api.snapshot().messages.length, 0);
  const areaA = (await call('/teams', { workspace_id: workspace.id, name: 'A' })).team;
  const areaB = (await call('/teams', { workspace_id: workspace.id, name: 'B' })).team;
  const document = (await call('/documents', { workspace_id: workspace.id, team_id: areaA.id, title: 'A document', content: 'A' })).document;
  const task = (await call('/tasks', { workspace_id: workspace.id, team_id: areaB.id, title: 'B route' })).task;
  const cross = await request('/rumbo-agent/chats', { workspace_id: workspace.id, provider: 'codex', request_id: 'cross-area-chat', task_id: task.id, source: { type: 'document', id: document.id } });
  assert.equal(cross.status, 400);
});

test('derived outputs, versions, comments, reviews and chat updates disappear after source revocation', async t => {
  const { db, call, request, connect, create, inspect, send, workspace } = await fixture(t);
  await connect();
  const project = (await call('/projects', { workspace_id: workspace.id, name: 'Derived target' })).project;
  const document = (await call('/documents', { workspace_id: workspace.id, project_id: project.id, title: 'Sensitive context', content: 'DERIVED_SECRET' })).document;
  const { chat, agent } = await create({ source: { type: 'document', id: document.id } });
  const sent = await send(inspect(chat, agent));
  const output = (await call('/workflow/outputs', { workspace_id: workspace.id, project_id: project.id, run_id: sent.run.id, title: 'Derived output', content: 'DERIVED_SECRET', reviewer_name: 'Fixture' })).result;
  const version = db.prepare('SELECT id FROM output_versions WHERE output_id=?').get(output.id);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO output_comments(id,output_id,workspace_id,version_id,content,author_name,created_at) VALUES(?,?,?,?,?,?,?)').run('derived-comment', output.id, workspace.id, version.id, 'DERIVED_SECRET_COMMENT', 'Fixture', now);
  db.prepare('INSERT INTO output_reviews(id,output_id,workspace_id,version_id,decision,reviewer_name,feedback,created_at) VALUES(?,?,?,?,?,?,?,?)').run('derived-review', output.id, workspace.id, version.id, 'changes_requested', 'Fixture', 'DERIVED_SECRET_REVIEW', now);
  const update = (await call('/activity', { workspace_id: workspace.id, target_type: 'chat', target_id: chat.id, update_type: 'progress', content: 'DERIVED_SECRET_UPDATE', publication_state: 'published' })).result;
  const blockedDelete = await request(`/chats/${chat.id}`, undefined, 'DELETE');
  assert.equal(blockedDelete.status, 409); assert.equal(blockedDelete.body.error.code, 'linked_context');
  await call(`/documents/${document.id}`, { archived_at: now }, 'PATCH');
  const snapshot = await call('/bootstrap');
  for (const collection of ['outputs', 'output_versions', 'output_comments', 'output_reviews']) assert.equal(snapshot[collection].some(row => row.id === output.id || row.output_id === output.id), false, collection);
  assert.equal(snapshot.activity_entries.some(row => row.id === update.id), false);
  assert.equal((await request(`/workflow/outputs/${output.id}`)).status, 403);
  assert.equal((await request(`/activity/${update.id}`)).status, 403);
  const feed = await call(`/activity/feed?workspace_id=${workspace.id}`);
  assert.equal(JSON.stringify(feed).includes('DERIVED_SECRET_UPDATE'), false);
});

test('Rumbo workspace index is bounded, excludes document bodies, can be disabled, and protects generated history after source revocation', async t => {
  const { api, call, request, connect, create, inspect, send, workspace } = await fixture(t);
  await connect();
  const projects = [];
  for (let i = 0; i < 22; i++) projects.push((await call('/projects', { workspace_id: workspace.id, name: `INDEX_PROJECT_${i}`, description: `Project ${i} summary` })).project);
  const document = (await call('/documents', { workspace_id: workspace.id, project_id: projects[21].id, title: 'INDEX_DOCUMENT_TITLE', content: 'FULL_DOCUMENT_BODY_NOT_APPROVED' })).document;
  const { chat, agent } = await create();
  const input = inspect(chat, agent), preview = (await call('/context/inspect', input)).result;
  assert.equal(preview.manifest.workspace_index.enabled, true);
  assert.deepEqual(preview.manifest.workspace_index.categories.find(row => row.kind === 'project'), { kind: 'project', readable_count: 22, selected_count: 20, omitted_count: 2, selection_limit: 20 });
  assert.match(preview.finalPrompt, /INDEX_DOCUMENT_TITLE/); assert.doesNotMatch(preview.finalPrompt, /FULL_DOCUMENT_BODY_NOT_APPROVED/);
  assert.equal(preview.manifest.included.find(row => row.id === document.id).summary_only, true);
  const disabled = (await call('/context/inspect', { ...input, include_workspace: false })).result;
  assert.equal(disabled.manifest.workspace_index.enabled, false); assert.doesNotMatch(disabled.finalPrompt, /INDEX_PROJECT_|INDEX_DOCUMENT_TITLE/);
  const mismatch = await request(`/chats/${chat.id}/turns`, { ...input, include_workspace: false, content: input.prompt, client_turn_id: 'changed-work-index', context_inspection_id: preview.id });
  assert.equal(mismatch.status, 409);
  const sent = await send(input); assert.equal(sent.message.metadata.include_workspace, true);
  const reply = api.snapshot().messages.find(row => row.chat_id === chat.id && row.sender_type === 'agent');
  assert.ok(reply);
  for (const path of [`/messages/${reply.id}`, `/chats/${chat.id}/messages/${reply.id}`]) {
    assert.equal((await request(path, { sender_type: 'user' }, 'PATCH')).status, 400);
    assert.equal((await request(path, { metadata: { run_id: null } }, 'PATCH')).status, 400);
    const edited = (await call(path, { metadata: {}, content: 'An edited reply retains captured source boundaries.' }, 'PATCH')).message;
    assert.equal(edited.metadata.run_id, sent.run.id); assert.equal(edited.metadata.source_message_id, sent.message.id);
  }
  const editedSource = (await call(`/messages/${sent.message.id}`, { metadata: {} }, 'PATCH')).message;
  assert.equal(editedSource.metadata.latest_run_id, sent.run.id); assert.equal(editedSource.metadata.include_workspace, true);
  assert.equal((await request(`/messages/${sent.message.id}`, { metadata: { model: 'rewritten-retry-model' } }, 'PATCH')).status, 400);
  const derived = (await call('/workflow/outputs', { workspace_id: workspace.id, source_message_id: reply.id, title: 'Reply-derived output', content: 'Retain the original reply boundary.' })).result;
  assert.equal((await request(`/messages/${reply.id}`, undefined, 'DELETE')).body.error.code, 'linked_context');
  assert.equal((await request(`/chats/${chat.id}`, undefined, 'DELETE')).status, 409, 'Deleting indexed history cannot null provenance links on retained runs');
  const collaboration = (await call(`/chat-collaboration/${chat.id}?workspace_id=${workspace.id}`)).result;
  assert.equal((await request(`/chat-collaboration/${chat.id}`, { workspace_id: workspace.id, version: collaboration.version, action: 'branch', message_id: sent.message.id, title: 'Detached index' })).status, 400);
  await call(`/documents/${document.id}`, { archived_at: new Date().toISOString() }, 'PATCH');
  const snapshot = await call('/bootstrap');
  assert.equal(snapshot.runs.some(row => row.id === sent.run.id), false);
  assert.equal(snapshot.outputs.some(row => row.id === derived.id), false);
  assert.equal(snapshot.messages.some(row => row.chat_id === chat.id), false, 'No old agent reply or source message is exposed after captured index access is lost');
  assert.equal((await request(`/runs/${sent.run.id}`)).status, 403);
  assert.equal((await request(`/chats/${chat.id}/export`)).status, 403);
  const other = (await call('/chats', { workspace_id: workspace.id, title: 'Ordinary chat', participant_agent_ids: [agent.id] })).chat;
  const ordinary = (await call('/context/inspect', inspect(other, agent))).result;
  assert.equal(ordinary.manifest.workspace_index.enabled, false, 'Existing ordinary chats do not silently widen context');
  assert.ok(api.snapshot().messages.length > 0, 'Revocation hides captured content, it never deletes user history');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGENT_REASONING_OPTIONS, initialAgentForm, agentFormPayload, validateAgentForm, exportAgentDefinition, parseAgentDefinition, duplicateAgentDefinition, agentDefaultChoices } from '../src/lib/agent-editor.js';
import { agentReadiness, summarizeAgent } from '../src/lib/agents.js';

const profile = { id: 'a', workspace_id: 'w', version: 4, name: 'Reviewer', role: 'Review changes', provider: 'codex', provider_connection_id: 'account', description: 'Checks tests', instructions: 'Inspect evidence.', model: 'test-model', reasoning_effort: 'high', memory_policy: 'none', context_source_ids: ['pack'], default_area_id: 'area', default_project_id: 'project', working_directory: '/tmp/project', permission_policy: 'review', output_behavior: 'Return Markdown findings.\nStop after review.', credentials: 'never-export', token: 'never-export' };

test('Agent Studio round-trips configurable defaults with optimistic version and isolated arrays', () => {
  const form = initialAgentForm(profile);
  assert.equal(validateAgentForm(form), null);
  const payload = agentFormPayload(form, profile, 'other');
  assert.equal(payload.workspace_id, 'w');
  assert.equal(payload.version, 4);
  for (const key of ['role', 'provider_connection_id', 'model', 'reasoning_effort', 'memory_policy', 'default_area_id', 'default_project_id', 'permission_policy', 'output_behavior']) assert.equal(payload[key], profile[key]);
  assert.deepEqual(payload.context_source_ids, ['pack']);
  form.context_source_ids.push('different');
  assert.deepEqual(profile.context_source_ids, ['pack']);
  assert.equal(payload.credentials, undefined);
  assert.equal(payload.token, undefined);
});

test('model identifiers and reasoning defaults do not invent provider capabilities', () => {
  const form = initialAgentForm(profile);
  for (const effort of AGENT_REASONING_OPTIONS) assert.equal(validateAgentForm({ ...form, reasoning_effort: effort }), null);
  for (const effort of ['auto-fake', 'High']) assert.equal(validateAgentForm({ ...form, reasoning_effort: effort }).field, 'reasoning_effort');
  assert.equal(validateAgentForm({ ...form, provider: 'claude', reasoning_effort: 'high' }).field, 'reasoning_effort');
  assert.equal(validateAgentForm({ ...form, model: 'model --disable-safety' }).field, 'model');
  assert.equal(validateAgentForm({ ...form, permission_policy: 'unrestricted' }).field, 'permission_policy');
  assert.equal(validateAgentForm({ ...form, memory_policy: 'all' }).field, 'memory_policy');
  assert.equal(agentFormPayload({ ...form, provider: 'claude' }, profile, 'w').reasoning_effort, '');
});

test('portable agent definitions exclude authority, identities, runtime state and paths', () => {
  const exported = exportAgentDefinition({ ...profile, status: 'available', run_ids: ['secret-run'] });
  assert.deepEqual(Object.keys(exported), ['format', 'format_version', 'definition']);
  for (const key of ['id', 'version', 'workspace_id', 'provider_connection_id', 'working_directory', 'default_area_id', 'default_project_id', 'context_source_ids', 'permission_policy', 'credentials', 'token', 'status', 'run_ids']) assert.equal(Object.hasOwn(exported.definition, key), false, key);
  const imported = parseAgentDefinition(JSON.stringify({ ...exported, definition: { ...exported.definition, credentials: 'injected', provider_connection_id: 'injected', working_directory: '/private', default_area_id: 'injected', context_source_ids: ['private'], permission_policy: 'unrestricted' } }));
  assert.equal(imported.provider_connection_id, '');
  assert.equal(imported.working_directory, '');
  assert.equal(imported.default_area_id, '');
  assert.equal(imported.default_project_id, '');
  assert.deepEqual(imported.context_source_ids, []);
  assert.equal(imported.permission_policy, 'read-only');
  assert.equal(imported.instructions, profile.instructions);
  assert.equal(imported.credentials, undefined);
  const duplicate = duplicateAgentDefinition(profile);
  assert.equal(duplicate.name, 'Reviewer copy');
  assert.equal(duplicate.provider_connection_id, '');
  assert.equal(duplicate.permission_policy, 'read-only');
});

test('definition import rejects malformed, oversized, unsupported and incorrectly typed input', () => {
  for (const value of ['[]', 'null', 'false', '{}', 'not json']) assert.throws(() => parseAgentDefinition(value));
  const exported = exportAgentDefinition(profile);
  assert.throws(() => parseAgentDefinition(' '.repeat(250001)), /250 KB/);
  assert.throws(() => parseAgentDefinition(JSON.stringify({ ...exported, format_version: 2 })), /version 1/);
  assert.throws(() => parseAgentDefinition(JSON.stringify({ ...exported, definition: { ...exported.definition, instructions: {} } })), /text/);
  assert.throws(() => parseAgentDefinition(JSON.stringify({ ...exported, definition: { ...exported.definition, instructions: 'x'.repeat(100001) } })), /100,000/);
});

test('default choices are active, same-workspace, Area-scoped Context Packs only', () => {
  const data = { teams: [{ id: 'area', workspace_id: 'w' }, { id: 'outside', workspace_id: 'x' }], projects: [{ id: 'p1', workspace_id: 'w', team_id: 'area' }, { id: 'p2', workspace_id: 'w', team_id: 'other' }, { id: 'p3', workspace_id: 'w', team_id: 'area', archived_at: 'date' }], workspace_items: [{ id: 'pack', kind: 'context_pack', workspace_id: 'w' }, { id: 'template', kind: 'route_template', workspace_id: 'w' }, { id: 'outside', kind: 'context_pack', workspace_id: 'x' }] };
  const choices = agentDefaultChoices(data, 'w', 'area');
  assert.deepEqual(choices.areas.map(item => item.id), ['area']);
  assert.deepEqual(choices.projects.map(item => item.id), ['p1']);
  assert.deepEqual(choices.packs.map(item => item.id), ['pack']);
});

test('explicit connection identity governs readiness, including null bindings', () => {
  const account = { id: 'account', provider: 'codex', state: 'connected' };
  assert.equal(agentReadiness(profile, account).canStartLive, true);
  assert.equal(agentReadiness(profile, { ...account, id: 'other' }).canStartLive, false);
  assert.equal(agentReadiness({ ...profile, provider_connection_id: null }, account).canStartLive, false);
  assert.equal(summarizeAgent({ ...profile, provider_connection_id: null }, { connections: [account] }).connection, undefined);
  assert.equal(summarizeAgent(profile, { connections: [{ ...account, id: 'other' }, account] }).connection.id, 'account');
});

test('run and output attribution stays tied to profile ID, not name or unrelated workspace', () => {
  const summary = summarizeAgent(profile, { runs: [{ id: 'own', agent_id: 'a', workspace_id: 'w', status: 'failed' }, { id: 'other', agent_id: 'b', workspace_id: 'w', status: 'failed' }], outputs: [{ id: 'out', run_id: 'own', workspace_id: 'w' }, { id: 'not-own', run_id: 'other', workspace_id: 'w' }, { id: 'outside', run_id: 'own', workspace_id: 'x' }] });
  assert.equal(summary.failedRuns.length, 1);
  assert.deepEqual(summary.outputs.map(item => item.id), ['out']);
});

test('Studio controls expose honest provider boundaries and reviewed operations', () => {
  const editor = readFileSync(new URL('../src/components/AgentEditor.jsx', import.meta.url), 'utf8');
  const roster = readFileSync(new URL('../src/views/AgentRoster.jsx', import.meta.url), 'utf8');
  assert.match(editor, /These defaults are not access grants/);
  assert.match(editor, /does not import ordinary ChatGPT or Claude chat history/);
  assert.match(editor, /provider can reject an unsupported model/);
  assert.match(roster, /Imports start read-only and unbound/);
  assert.match(roster, /Profile version not recorded/);
  assert.match(roster, /Recorded usage below is separate from account billing/);
  assert.match(roster, /<AgentUsageDisclosure key=\{`\$\{workspace.id\}:\$\{agent.id\}`\} agentId=\{agent.id\} workspaceId=\{workspace.id\}/);
  assert.match(roster, /new AbortController\(\)/);
  assert.doesNotMatch(roster, /talvoriActions\.(?:startRun|startSession)\(/);
});

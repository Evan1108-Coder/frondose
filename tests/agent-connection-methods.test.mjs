import test from 'node:test';
import assert from 'node:assert/strict';
import { agentConnectionMethods, savedAgentConnectionMethod } from '../src/lib/agent-connection-methods.js';
import { initialAgentForm, agentFormPayload } from '../src/lib/agent-editor.js';

const ids = provider => agentConnectionMethods(provider).map(method => method.id);
test('editor methods follow implemented provider routes without website OAuth', () => {
  assert.deepEqual(ids('claude'), ['computer']);
  assert.deepEqual(ids('codex'), ['computer']);
  assert.deepEqual(ids('openai'), ['api']);
  assert.deepEqual(ids('anthropic'), ['api']);
  assert.deepEqual(ids('openrouter'), ['api', 'oauth']);
  assert.deepEqual(ids('huggingface'), ['api', 'oauth']);
  assert.deepEqual(ids('copilot'), ['oauth', 'computer']);
  assert.deepEqual(ids('pi'), ['computer']);
  assert.deepEqual(ids('not-a-provider'), []);
});
test('saved metadata distinguishes actual account methods without live probing', () => {
  assert.equal(savedAgentConnectionMethod('openrouter', {}, { method: 'oauth' }), 'oauth');
  assert.equal(savedAgentConnectionMethod('openrouter', {}, { method: 'api_key' }), 'api');
  assert.equal(savedAgentConnectionMethod('copilot', {}, { method: 'github_oauth' }), 'oauth');
  assert.equal(savedAgentConnectionMethod('copilot', {}, { method: 'local_acp' }), 'computer');
  assert.equal(savedAgentConnectionMethod('openrouter', {}), null);
  assert.equal(savedAgentConnectionMethod('claude', {}, { method: 'oauth' }), null);
  assert.equal(savedAgentConnectionMethod('codex', {}), 'computer');
});
test('simplifying visible fields preserves hidden saved defaults on edit', () => {
  const item = { id: 'agent', workspace_id: 'ws', version: 3, name: 'Existing', provider: 'codex', role: 'Reviewer', working_directory: '/tmp/project', model: 'configured-model', reasoning_effort: 'high', memory_policy: 'none', context_source_ids: ['pack'], default_area_id: 'area', default_project_id: 'project', permission_policy: 'read-only', output_behavior: 'Cite evidence.' };
  const form = initialAgentForm(item);
  form.name = 'Renamed';
  const payload = agentFormPayload(form, item, 'other');
  for (const key of ['role', 'working_directory', 'model', 'reasoning_effort', 'memory_policy', 'default_area_id', 'default_project_id', 'permission_policy', 'output_behavior']) assert.equal(payload[key], item[key], key);
  assert.deepEqual(payload.context_source_ids, item.context_source_ids);
  assert.equal(payload.version, 3);
  assert.equal(payload.workspace_id, 'ws');
});

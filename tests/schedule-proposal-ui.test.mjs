import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareScheduleProposal } from '../src/lib/schedule-proposal.js';
const proposed = () => ({ action_request_id: 'intent-1', workspace_id: 'ws', chat_id: 'chat', agent_id: 'agent', content: 'Review my Routes tomorrow', model: 'profile-model', run_at: '2030-10-20T01:00:00.000Z', timezone: 'Asia/Shanghai' });
const inspection = () => ({ id: 'new-inspection', manifest: {}, finalPrompt: 'Exact current bounded context', expires_at: new Date(Date.now() + 600000).toISOString() });
test('schedule proposal preparation uses canonical exact content/model and creates new bounded context, never a schedule', async () => {
  const operations = [];
  const result = await prepareScheduleProposal({ proposalId: 'intent-1', workspaceId: 'ws', agentId: 'agent', prepare: async () => { operations.push('prepare'); return proposed(); }, inspect: async body => { operations.push('inspect'); assert.equal(body.prompt, proposed().content); assert.equal(body.model, 'profile-model'); assert.equal(body.agent_id, 'agent'); assert.equal(body.native_tools, false); assert.equal(body.work_mode, 'conversation'); assert.equal(body.include_workspace, true); return inspection(); } });
  assert.deepEqual(operations, ['prepare', 'inspect']);
  assert.equal(result.payload.action_request_id, 'intent-1'); assert.equal(result.inspection.id, 'new-inspection');
});
test('revoked access and mismatched canonical scopes never reach context capture or scheduling', async () => {
  await assert.rejects(prepareScheduleProposal({ proposalId: 'intent-1', workspaceId: 'ws', prepare: async () => { throw new Error('Source access revoked'); }, inspect: () => assert.fail() }), /revoked/);
  for (const patch of [{ workspace_id: 'other' }, { agent_id: 'other' }, { action_request_id: 'other' }, { model: '' }, {timezone:'Invalid/Zone'}]) {
    await assert.rejects(prepareScheduleProposal({ proposalId: 'intent-1', workspaceId: 'ws', agentId: 'agent', prepare: async () => ({ ...proposed(), ...patch }), inspect: () => assert.fail() }), /no longer matches/);
  }
});
test('revocation during fresh context compile leaves the intent unscheduled', async () => {
  await assert.rejects(prepareScheduleProposal({ proposalId: 'intent-1', workspaceId: 'ws', prepare: async () => proposed(), inspect: async () => { throw new Error('Context source revoked'); } }), /revoked/);
});
test('UI requires separate schedule confirmation instead of normal approval and preloads exact proposed time', async () => {
  const review = await readFile(new URL('../src/components/AgentActionReview.jsx', import.meta.url), 'utf8');
  const dialog = await readFile(new URL('../src/components/ScheduledWork.jsx', import.meta.url), 'utf8');
  assert.match(review, /selected.proposal.type !== 'schedule.create'/);
  assert.match(review, /onClick=\{reviewSchedule\}>Review schedule/);
  assert.match(review, /kind="message" payload=\{messageSchedule.payload\}/);
  assert.match(dialog, /initialRunAt/); assert.match(dialog, /initialTimezone/);
  assert.match(dialog, /agent_schedule_\$\{payload.action_request_id\}/);
  assert.match(dialog, /onSubmit=\{save\}/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transformSync } from 'esbuild';
const activity = await readFile(new URL('../src/components/ActivityFeed.jsx', import.meta.url), 'utf8');
const agent = await readFile(new URL('../src/views/FrondoseAgent.jsx', import.meta.url), 'utf8');
const entry = await readFile(new URL('../src/components/FrondoseAgentEntry.jsx', import.meta.url), 'utf8');
test('published mentions offer explicit connected-profile handoffs without running or copying saved source text', () => {
  const handoff = activity.slice(activity.indexOf('function MentionAgentHandoff'), activity.indexOf('export function ActivityComposer'));
  assert.match(handoff, /agentReadiness\(agent, connection\).canStartLive/);
  assert.match(handoff, /agentId: agent.id, source: \{ type: 'update', id: entry.id \}/);
  assert.match(handoff, /onClick=\{prepare\}>Ask \{agent.name\}/);
  assert.doesNotMatch(handoff, /apiRequest|sendChatTurn|createChat|entry.content/);
  assert.match(activity, /!draft && !entry.archived_at \? <div className="activity-mentioned-agent-actions"/);
  const save = activity.slice(activity.indexOf('async function save(publicationState)'), activity.indexOf('function insertEvidence'));
  assert.doesNotMatch(save, /prepareFrondoseAgentEntry|sendChatTurn|createChat/);
});
test('addressed recipient survives delayed provider loading and never falls back to a different agent', () => {
  assert.match(agent, /peekFrondoseAgentEntry\(workspace.id\) \|\| \(restored\?\.instruction/);
  assert.match(agent, /agentId: restored.agent_id/);
  assert.match(agent, /pending\?\.agentId && !requestedReady/);
  assert.match(agent, /Frondose will not substitute another identity/);
  assert.match(agent, /agent_id: requestedAgent.id/);
  assert.match(agent, /!occupied && typeof draft\?\.instruction/);
  assert.match(agent, /navigate\('chats', chat.id\)/);
  assert.doesNotMatch(entry, /choose a model|Ask Frondose agent|Prepare in Frondose agent/);
  assert.match(entry, /Send captures the current context/);
  for (const text of [activity, agent, entry]) assert.doesNotThrow(() => transformSync(text, { loader: 'jsx', format: 'esm' }));
});

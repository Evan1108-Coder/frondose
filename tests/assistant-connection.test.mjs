import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hasConnectedAssistantAI, selectedAssistantConnection } from '../src/lib/assistant-connection.js';
test('assistant requires explicit current readiness, not a catalog or saved configuration', () => {
  for (const state of [null, {}, {providers:[]}, {providers:[null]}, {providers:[{state:'connected'}]}, {providers:[{connected:false,status:'configured'}]}, {providers:{connected:true}}]) assert.equal(hasConnectedAssistantAI(state),false);
  const providers = [{provider:'codex',connected:false},{provider:'claude',connected:true}];
  assert.equal(hasConnectedAssistantAI({providers}),false);
  assert.equal(hasConnectedAssistantAI({providers,preferences:{provider:'claude'}}),false,'Historical default is not explicit selection');
  assert.equal(hasConnectedAssistantAI({providers,preferences:{provider:'codex',provider_selected:true}}),false,'No fallback to another ready account');
  assert.equal(hasConnectedAssistantAI({providers,preferences:{provider:'claude',provider_selected:true}}),true);
  assert.equal(selectedAssistantConnection({providers,preferences:{provider:'missing',provider_selected:true}}),null);
});
test('Frondose is a setup hub, opens canonical Conversations only on explicit click and preserves readable work', () => {
  const source = readFileSync(new URL('../src/views/FrondoseAgent.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(source,/import \{ Conversation \}|<Conversation\b|<textarea\b/);
  assert.match(source,/navigate\('chats', chat\.id\)/);
  assert.match(source,/if \(page\.id\) navigate\('chats', page\.id/);
  assert.match(source,/<FrondoseAgentPreferences embedded/);
  assert.match(source,/section === 'activity' \|\| section === 'scheduled'/);
  assert.match(source,/provider_selected/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hasConnectedAssistantAI } from '../src/lib/assistant-connection.js';
test('assistant requires explicit current readiness, not a catalog or saved configuration', () => {
  for (const state of [null, {}, {providers:[]}, {providers:[null]}, {providers:[{state:'connected'}]}, {providers:[{connected:false,status:'configured'}]}, {providers:{connected:true}}]) assert.equal(hasConnectedAssistantAI(state),false);
  assert.equal(hasConnectedAssistantAI({providers:[{connected:false},{connected:true}]}),true);
});
test('disconnected landing is gated before onboarding while history and management remain readable', () => {
  const source = readFileSync(new URL('../src/views/TalvoriAgent.jsx',import.meta.url),'utf8');
  const gate = source.indexOf('if (connectionMissing && !currentChat && !readOnlySection)');
  assert.ok(gate > 0 && gate < source.indexOf('if (!loading && agentState && !agentState.preferences.onboarding_complete)'));
  assert.match(source,/if \(loading \|\| !hasConnectedAssistantAI\(agentState\)\)/);
  assert.match(source,/connectionMissing && \(currentChat \|\| readOnlySection\)/);
});

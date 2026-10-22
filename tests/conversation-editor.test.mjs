import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialConversationAgent, conversationAgentFields } from '../src/lib/conversation-editor.js';

const agents=[{id:'one',workspace_id:'ws',name:'One agent'},{id:'two',workspace_id:'ws',name:'Another agent'},{id:'old',workspace_id:'ws',name:'Archived identity',archived_at:'yesterday'},{id:'paused',workspace_id:'ws',name:'Paused identity',status:'paused'},{id:'foreign',workspace_id:'other',name:'Foreign agent'}];
test('new conversation defaults accept only a single explicit identity; legacy edits do not implicitly bind history',()=>{
  assert.equal(initialConversationAgent({}), '');
  assert.equal(initialConversationAgent({participant_agent_ids:['one']}),'one');
  assert.equal(initialConversationAgent({participant_agent_ids:['one','two']}),'');
  assert.equal(initialConversationAgent({participant_agent_ids:['one']},true),'');
  assert.equal(initialConversationAgent({responding_agent_id:'missing',participant_agent_ids:['one','two']},true),'missing');
});
test('new conversation payload binds one available identity and rejects unavailable selections',()=>{
  assert.deepEqual(conversationAgentFields({agentId:'two',agents,workspaceId:'ws'}),{participant_agent_ids:['two'],responding_agent_id:'two'});
  assert.throws(()=>conversationAgentFields({agentId:'',agents,workspaceId:'ws'}),/Choose one/);
  for(const agentId of ['missing','old','paused','foreign']) assert.throws(()=>conversationAgentFields({agentId,agents,workspaceId:'ws'}),/available agent/);
});
test('legacy editing preserves all historical participants with optional explicit future binding',()=>{
  const item={participant_agent_ids:['one','old','two']};
  assert.deepEqual(conversationAgentFields({item,agentId:'',agents,workspaceId:'ws'}),{participant_agent_ids:item.participant_agent_ids});
  assert.deepEqual(conversationAgentFields({item,agentId:'two',agents,workspaceId:'ws'}),{participant_agent_ids:item.participant_agent_ids,responding_agent_id:'two'});
  assert.deepEqual(item.participant_agent_ids,['one','old','two']);
});
test('a saved binding remains editable even if its profile is absent, and never switches identity',()=>{
  const item={responding_agent_id:'missing',participant_agent_ids:['one','two']};
  assert.deepEqual(conversationAgentFields({item,agentId:'missing',agents,workspaceId:'ws'}),{participant_agent_ids:['one','two'],responding_agent_id:'missing'});
  assert.throws(()=>conversationAgentFields({item,agentId:'one',agents,workspaceId:'ws'}),/cannot be changed/);
  assert.throws(()=>conversationAgentFields({item,agentId:'',agents,workspaceId:'ws'}),/cannot be changed/);
});

const require=createRequire(import.meta.url);
let runtime;
async function render({item,defaults={}}={}) {
  if(!runtime){
    const directory=mkdtempSync(join(tmpdir(),'frondose-conversation-dialog-test-'));
    try {
      const result=await build({stdin:{contents:'export { EntityDialog } from "./src/components/EntityDialog.jsx"; export { AppContext } from "./src/app-context.js";',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty','.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl'},plugins:[{name:'shared-react',setup(builder){builder.onResolve({filter:/^react(?:-dom)?(?:\/.*)?$/},args=>({path:require.resolve(args.path),external:true}));}}]});
      const path=join(directory,'dialog.mjs');writeFileSync(path,result.outputFiles[0].text);
      runtime=await import(pathToFileURL(path).href);
    } finally {rmSync(directory,{recursive:true,force:true});}
  }
  const context={data:{agents,projects:[],teams:[],tasks:[]},workspace:{id:'ws',name:'Fixture'},page:{},navigate:()=>{},notify:()=>{},setWorkspace:()=>{}};
  return renderToStaticMarkup(React.createElement(runtime.AppContext.Provider,{value:context},React.createElement(runtime.EntityDialog,{kind:'chat',item,defaults,onClose:()=>{}})));
}
test('new conversation dialog renders one required Select, with no participant checkboxes',async()=>{
  const html=await render({defaults:{title:'New conversation'}});
  assert.match(html,/aria-label="Responding agent"[^>]*aria-required="true"/);
  assert.match(html,/Choose one agent/);
  assert.doesNotMatch(html,/type="checkbox"|Agents in this conversation/);
  assert.match(html,/class="[^"]*writing-editor writing-editor-chat/);
  assert.match(html,/Expand dialog|Expand/);
});
test('bound dialog locks its saved identity and retains an unavailable identity instead of a fallback',async()=>{
  const unavailable=await render({item:{id:'chat',title:'Saved',responding_agent_id:'gone',participant_agent_ids:['one','two']}});
  assert.match(unavailable,/aria-label="Responding agent"[^>]*disabled=""/);
  assert.match(unavailable,/Saved agent.*unavailable/);
  assert.doesNotMatch(unavailable,/One agent|Another agent/);
  const archived=await render({item:{id:'chat',title:'Saved',responding_agent_id:'old',participant_agent_ids:['one','old']}});
  assert.match(archived,/Archived identity.*unavailable/);
  const available=await render({item:{id:'chat',title:'Saved',responding_agent_id:'one',participant_agent_ids:['one','two']}});
  assert.match(available,/aria-label="Responding agent"[^>]*disabled=""/);
  assert.match(available,/One agent/);assert.doesNotMatch(available,/Another agent/);
});
test('legacy dialog leaves future responder unchosen while preserving its title and linked-work editor',async()=>{
  const html=await render({item:{id:'legacy',title:'Keep history',participant_agent_ids:['one','two']}});
  assert.match(html,/No future agent selected/);
  assert.match(html,/value="Keep history"/);
  assert.match(html,/aria-label="Project"[^>]*disabled=""/);
  assert.match(html,/aria-label="Linked route"[^>]*disabled=""/);
  assert.doesNotMatch(html,/type="checkbox"/);
});

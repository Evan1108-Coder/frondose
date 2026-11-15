import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transformSync } from 'esbuild';
import { beginWorkspaceContextDrag, consumeWorkspaceContextDrag, endWorkspaceContextDrag, isWorkspaceContextDrag, terminalAiProvider, workspaceContextText, WORKSPACE_CONTEXT_TYPE } from '../src/lib/workspace-context-drop.js';
import { workspaceNeedsFocusMode } from '../src/lib/workspace-view-geometry.js';
const transfer=()=>{const data=new Map();return{get types(){return [...data.keys()];},setData:(type,value)=>data.set(type,value),getData:type=>data.get(type)||''};};
test('workspace context drops require a live same-workspace one-use local drag gesture',()=>{
  const data=transfer();assert.equal(consumeWorkspaceContextDrag(data,'ws'),false);assert(beginWorkspaceContextDrag(data,'ws',100));assert(isWorkspaceContextDrag(data));assert(consumeWorkspaceContextDrag(data,'ws',101));assert.equal(consumeWorkspaceContextDrag(data,'ws',102),false);
  beginWorkspaceContextDrag(data,'ws',100);assert.equal(consumeWorkspaceContextDrag(data,'other',101),false);
  beginWorkspaceContextDrag(data,'ws',100);assert.equal(consumeWorkspaceContextDrag(data,'ws',60101),false);
  beginWorkspaceContextDrag(data,'ws',100);endWorkspaceContextDrag();assert.equal(consumeWorkspaceContextDrag(data,'ws',101),false);
  data.setData(WORKSPACE_CONTEXT_TYPE,JSON.stringify({workspaceId:'ws',token:'forged'}));assert.equal(consumeWorkspaceContextDrag(data,'ws'),false);
  assert.equal(beginWorkspaceContextDrag(data,'../path'),false);
});
test('workspace context contains only authorized saved allowlisted same-workspace fields and is bounded',()=>{
  const snapshot={workspaces:[{id:'ws',name:'Workspace',description:'Saved scope',secret:'never include'},{id:'other',name:'Foreign'}],teams:[{id:'a',workspace_id:'ws',name:'Area'}],projects:[{id:'p',workspace_id:'ws',name:'Project',local_path:'/private/secret',api_key:'secret-value',description:'\x1b[201~unsafe'}],tasks:[{id:'t',workspace_id:'other',title:'Foreign route'},{id:'own',workspace_id:'ws',title:'Own route'},{id:'archived',workspace_id:'ws',title:'Archived',archived_at:'today'}],documents:[{id:'d',workspace_id:'ws',title:'Document',content:'Excerpt'}],connections:[{token:'credential'}],messages:[{content:'Private chat'}],profile:{self_display_name:'private name'}};
  const text=workspaceContextText(snapshot,'ws');for(const value of ['Workspace','Area','Project','Own route','Document','Excerpt'])assert(text.includes(value));for(const value of ['Foreign route','Archived','never include','secret-value','/private/secret','credential','Private chat','private name','\x1b'])assert(!text.includes(value));
  snapshot.tasks=Array.from({length:500},(_,i)=>({id:'task'+i,workspace_id:'ws',title:'x'.repeat(200),description:'y'.repeat(600)}));assert(workspaceContextText(snapshot,'ws').length<=24000);assert.match(workspaceContextText(snapshot,'ws'),/omitted by the context size limit/);assert.throws(()=>workspaceContextText(snapshot,'missing'));
});
test('only server-reported native AI command markers qualify, never a shell name',()=>{
  assert.equal(terminalAiProvider({command:'[codex CLI]'}),'codex');assert.equal(terminalAiProvider({command:null,name:'Codex'}),null);assert.equal(terminalAiProvider({command:'codex; dangerous'}),null);
});
test('split fallback uses actual measured leaf geometry, not just the browser width',()=>{
  assert(workspaceNeedsFocusMode([{width:240,height:700},{width:600,height:700}],1200,700));assert(workspaceNeedsFocusMode([{width:500,height:150},{width:500,height:150}],1000,300));assert(!workspaceNeedsFocusMode([{width:500,height:500},{width:500,height:500}],1000,500));assert(!workspaceNeedsFocusMode([{width:200,height:100}],200,100));assert(!workspaceNeedsFocusMode([{width:0,height:0},{width:0,height:0}],0,0));
});
test('context review and terminal drop integration compile and never auto-send a newline',async()=>{
  for(const name of ['WorkspaceContextReview.jsx','TerminalPane.jsx','WorkspaceViews.jsx']){const source=await readFile(new URL('../src/components/workspace/'+name,import.meta.url),'utf8');assert.doesNotThrow(()=>transformSync(source,{loader:'jsx',format:'esm'}));}
  const pane=await readFile(new URL('../src/components/workspace/TerminalPane.jsx',import.meta.url),'utf8');assert.match(pane,/xterm\.modes\.bracketedPasteMode/);assert.match(pane,/xterm\.paste\(validateDropPaste\(text/);assert.doesNotMatch(pane,/WorkspaceContextReview|setContextOpen/);assert.doesNotMatch(pane,/paste\(text\s*\+/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require=createRequire(import.meta.url);
let component;
async function render(props={}) {
  if(!component){
    const directory=mkdtempSync(join(tmpdir(),'frondose-toolbar-test-'));
    try{
      const result=await build({entryPoints:['src/components/ConversationToolbar.jsx'],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'shared-react',setup(builder){builder.onResolve({filter:/^react(?:-dom)?(?:\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
      const path=join(directory,'toolbar.mjs');writeFileSync(path,result.outputFiles[0].text);
      component=(await import(pathToFileURL(path).href)).ConversationToolbar;
    }finally{rmSync(directory,{recursive:true,force:true});}
  }
  return renderToStaticMarkup(React.createElement(component,{onBack:()=>{},bookmarksOnly:false,inThread:false,bookmarkCount:0,followUpCount:0,searchOpen:false,...props}));
}
test('conversation toolbar has accessible icon controls without duplicated title or text tabs',async()=>{
  const html=await render();
  for(const name of ['Back to conversations','Conversation','Bookmarks','Native tools','Conversation updates','Search messages','Context','Conversation options']) assert.ok(html.includes(`aria-label="${name}"`),name);
  assert.doesNotMatch(html,/<h[1-6]|Workspace conversation|>Bookmarks<|>Conversation<|>More</);
  assert.match(html,/>Context</);assert.equal((html.match(/aria-label="Conversation options"/g)||[]).length,1);
});
test('compact controls retain filter/search state and optional follow-up access',async()=>{
  const html=await render({bookmarksOnly:true,bookmarkCount:2,searchOpen:true,followUpCount:3});
  assert.match(html,/aria-label="Bookmarks \(2\)" aria-pressed="true"/);
  assert.match(html,/aria-label="Close message search" aria-pressed="true"/);
  assert.match(html,/aria-label="Saved follow-ups \(3\)"/);
});
test('toolbar styling is borderless with matching small glyphs and retained keyboard focus',()=>{
  const css=readFileSync(new URL('../src/components/conversation-toolbar.css',import.meta.url),'utf8');
  assert.match(css,/border: 0/);assert.match(css,/width: 16px; height: 16px/);assert.match(css,/:focus-visible/);
  const source=readFileSync(new URL('../src/views/Chats.jsx',import.meta.url),'utf8');
  assert.match(source,/<ConversationToolbar/);assert.doesNotMatch(source,/className="chat-thread-title"|className="chat-thread-navigation"/);
  assert.match(source,/Recorded native tools/);assert.match(source,/Conversation updates/);
});

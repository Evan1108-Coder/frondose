import test from 'node:test';
import assert from 'node:assert/strict';
import { beginContextDrag, consumeContextDrag, selectedFileContext, tabContextSource, isContextDropCenter } from '../src/lib/workspace-context-drop.js';
import { pageContextText, loadContextPreview } from '../src/lib/context-preview.js';
import { formatMarkdown, continueMarkdownList, markdownOutline } from '../src/lib/markdown-editing.js';
import { readFile } from 'node:fs/promises';
import { transformSync } from 'esbuild';
const transfer = () => { const data = new Map(); return { get types() { return [...data.keys()]; }, setData:(k,v)=>data.set(k,v), getData:k=>data.get(k)||'' }; };
test('drag payload carries only proof; the selection is frozen locally with exact inclusive line numbers', () => {
  const draft={loaded:true,path:'README.md',content:'one\ntwo\nthree',baseline:'one\ntwo\nthree',version:'saved'};
  const source=selectedFileContext(draft,'root',4,8), data=transfer();
  assert.equal(source.startLine,2);assert.equal(source.endLine,2);assert.equal(source.text,'two\n');
  assert(beginContextDrag(data,'ws',source,100));assert(!data.getData('application/x-frondose-workspace-context').includes('two'));
  draft.content='other';assert.deepEqual(consumeContextDrag(data,'ws',101),source);assert.equal(consumeContextDrag(data,'ws',102),null);
  assert.equal(selectedFileContext(draft,'root',4,4),null);assert.equal(selectedFileContext(draft,'root',-1,5),null);
  assert.equal(beginContextDrag(data,'ws',{kind:'file',path:'../secret',rootVersion:'root'}),false);
  assert.equal(tabContextSource({contentType:'terminal',label:'Private terminal'}),null);
  assert.deepEqual(tabContextSource({contentType:'editor',path:'README.md',rootVersion:2}),{kind:'file',path:'README.md',rootVersion:2});
});
test('tab center provides context but edges remain available for arranging views',()=>{
  const data=transfer();data.setData('application/frondose-tab','tab');const rect={left:100,top:100,right:500,bottom:500,width:400,height:400};
  assert(isContextDropCenter(data,{clientX:300,clientY:300},rect));assert(!isContextDropCenter(data,{clientX:105,clientY:300},rect));
  assert(isContextDropCenter(transfer(),{clientX:105,clientY:300},rect));
});
test('a project or Route drag never widens into all workspace records',()=>{
  const snapshot={workspaces:[{id:'ws',name:'Current'}],projects:[{id:'p',workspace_id:'ws',name:'Chosen'},{id:'other',workspace_id:'ws',name:'Unrelated'}],tasks:[{id:'route',workspace_id:'ws',project_id:'p',title:'Chosen Route'},{id:'child',workspace_id:'ws',parent_id:'route',title:'Child Route'},{id:'foreign',workspace_id:'other',project_id:'p',title:'Foreign Route'},{id:'unrelated',workspace_id:'ws',project_id:'other',title:'Unrelated Route'}]};
  const project=pageContextText(snapshot,'ws',{kind:'page',view:'projects',id:'p'});assert.match(project,/Chosen Route/);assert(!project.includes('Unrelated'));assert(!project.includes('Foreign Route'));
  const route=pageContextText(snapshot,'ws',{kind:'page',view:'tasks',id:'route'});assert.match(route,/Child Route/);assert(!route.includes('Unrelated Route'));
  assert.throws(()=>pageContextText(snapshot,'ws',{kind:'page',view:'projects',id:'missing'}));
  const filtered=pageContextText(snapshot,'ws',{kind:'page',view:'tasks',projectId:'p'});assert(!filtered.includes('Unrelated Route'));
});
test('file context uses fresh scoped API reads and selection rejects stale root/file versions',async()=>{
  const calls=[];const request=async path=>{calls.push(path);return{result:path.includes('/file?')?{path:'readme.md',version:'hash',content:'x'.repeat(30000)+'\x1b'}:{binding:{version:'root'}}};};
  const file=await loadContextPreview(request,'ws',{kind:'file',path:'readme.md',rootVersion:'root'});assert(file.length<180);assert.match(file,/readme.md/);assert.doesNotMatch(file,/x{100}/);assert(calls[0].includes('expected_binding_version=root'));
  const source={kind:'selection',path:'readme.md',rootVersion:'old',version:'hash',text:'private selection',startLine:1,endLine:1};
  await assert.rejects(loadContextPreview(request,'ws',source),/directory changed/);
  await assert.rejects(loadContextPreview(request,'ws',{...source,rootVersion:'root',version:'old'}),/changed on disk/);
  const selected=await loadContextPreview(request,'ws',{...source,rootVersion:'root'});assert.match(selected,/private selection/);assert.match(selected,/Lines: 1–1/);
  const draft=await loadContextPreview(request,'ws',{...source,rootVersion:'root',dirty:true});assert.match(draft,/unsaved editor text/);
});
test('Markdown tools edit source and selection, continue/exit lists, and outline skips fenced code',()=>{
  assert.deepEqual(formatMarkdown('hello',0,5,'bold'),{content:'**hello**',start:2,end:7});
  assert.equal(formatMarkdown('a\nb',0,3,'numbered').content,'1. a\n2. b');
  assert.equal(formatMarkdown('a',-1,2,'bold'),null);
  assert.equal(continueMarkdownList('1. first',8,8).content,'1. first\n2. ');
  assert.equal(continueMarkdownList('- ',2,2).content,'');
  assert.equal(continueMarkdownList('ordinary',8,8),null);
  assert.deepEqual(markdownOutline('# Title\n```\n# Not a heading\n```\n## Next'),[{line:1,level:1,title:'Title'},{line:5,level:2,title:'Next'}]);
});
test('all context/editor JSX compiles and responsive explorer retains desktop preference',async()=>{
  for(const path of ['src/components/Shell.jsx','src/components/workspace/WorkspaceSurface.jsx','src/components/workspace/DirectoryFiles.jsx','src/components/workspace/EditorSelectionTools.jsx','src/components/workspace/WorkspaceContextReview.jsx']) {const source=await readFile(new URL('../'+path,import.meta.url),'utf8');assert.doesNotThrow(()=>transformSync(source,{loader:'jsx',format:'esm'}));}
  const surface=await readFile(new URL('../src/components/workspace/WorkspaceSurface.jsx',import.meta.url),'utf8');assert.match(surface,/if\(!narrowFiles\)writeLocal/);assert.match(surface,/setExplorerOpen\(media.matches\?false:/);
});

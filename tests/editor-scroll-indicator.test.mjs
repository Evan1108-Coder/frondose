import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { editorScrollPosition, installEditorScrollIndicator } from '../src/lib/editor-scroll-indicator.js';

test('scroll position reflects top/middle/bottom and visible content fraction', () => {
  assert.deepEqual(editorScrollPosition({height:400,scrollHeight:2000,top:0}),{visible:true,size:80,offset:0,percent:0});
  assert.deepEqual(editorScrollPosition({height:400,scrollHeight:2000,top:800}),{visible:true,size:80,offset:160,percent:50});
  assert.deepEqual(editorScrollPosition({height:400,scrollHeight:2000,top:1600}),{visible:true,size:80,offset:320,percent:100});
});
test('short/invalid files hide the indicator; overscroll and huge files remain bounded', () => {
  for(const value of [{},{height:100,scrollHeight:100},{height:0,scrollHeight:1000},{height:NaN,scrollHeight:Infinity}]) assert.equal(editorScrollPosition(value).visible,false);
  assert.equal(editorScrollPosition({height:400,scrollHeight:2000,top:-50}).percent,0);
  assert.equal(editorScrollPosition({height:400,scrollHeight:2000,top:99999}).percent,100);
  assert.equal(editorScrollPosition({height:400,scrollHeight:1e8,top:500}).size,24);
  assert.equal(editorScrollPosition({height:16,scrollHeight:1000}).size,16);
});
test('indicator coalesces scroll/resize, ignores horizontal offset and never changes editor scroll', () => {
  let callback, resizeCallback, top=0, mutations=0, scale=1;
  const listeners=new Map(), thumb={style:{}},label={style:{},textContent:''};
  const win={requestAnimationFrame(fn){callback=fn;return 1;},cancelAnimationFrame(){callback=null;},addEventListener(type,fn){listeners.set(`window:${type}`,fn);},removeEventListener(type){listeners.delete(`window:${type}`);},ResizeObserver:class{constructor(fn){resizeCallback=fn;}observe(){}disconnect(){mutations++;}}};
  const scroller={ownerDocument:{defaultView:win},isConnected:true,children:[{}],clientHeight:400,scrollHeight:2000,scrollLeft:900,get scrollTop(){return top;},set scrollTop(_){throw Error('Indicator must never write the editor scroll position');},getBoundingClientRect:()=>({top:50+40*scale}),addEventListener(type,fn,options){assert.equal(options.passive,true);listeners.set(type,fn);},removeEventListener(type){listeners.delete(type);}};
  const indicator={isConnected:true,style:{},attributes:{},parentElement:{offsetHeight:400,getBoundingClientRect:()=>({top:50,height:400*scale})},querySelector:selector=>selector==='[data-scroll-thumb]'?thumb:label,setAttribute(key,value){this.attributes[key]=value;}};
  const dispose=installEditorScrollIndicator(scroller,indicator);callback();
  assert.equal(indicator.style.top,'40px');assert.equal(indicator.style.height,'400px');assert.equal(indicator.attributes['aria-valuenow'],'0');
  scale=1.5;resizeCallback();callback();assert.equal(indicator.style.top,'40px','UI zoom must not double-scale search-panel offsets');
  top=800;listeners.get('scroll')();const scheduled=callback;listeners.get('scroll')();assert.equal(callback,scheduled);callback();
  assert.equal(thumb.style.transform,'translateY(160px)');assert.equal(label.textContent,'50%');assert.equal(top,800);
  scroller.scrollHeight=1200;resizeCallback();callback();assert.equal(indicator.attributes['aria-valuetext'],'100% scrolled');
  scroller.scrollHeight=400;resizeCallback();callback();assert.equal(indicator.hidden,true);
  dispose();assert.equal(listeners.size,0);assert.equal(callback,null);assert.equal(mutations,1);
});
test('indicator stays outside masks and cannot block wheel, selection or native scrollbar input', () => {
  const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
  assert.match(read('src/components/workspace/SourceCodeEditor.jsx'),/setScrollOwner\(current.scrollDOM\)/);
  assert.match(read('src/components/workspace/SourceCodeEditor.jsx'),/<EditorScrollIndicator scroller=\{scrollOwner\}/);
  assert.match(read('src/components/workspace/source-code-editor.css'),/\.directory-scroll-indicator[^\n]*pointer-events:none/);
  assert.match(read('src/components/workspace/source-code-editor.css'),/forced-colors:active/);
  assert.match(read('src/lib/scroll-fades.js'),/!record.target\?\.closest\?\.\('\[data-editor-scroll-indicator\]'\)/);
  assert.doesNotMatch(read('src/lib/editor-scroll-indicator.js'),/setState|scrollTop\s*=/);
});

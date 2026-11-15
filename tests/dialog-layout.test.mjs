import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {buildSync} from 'esbuild';
const require=createRequire(import.meta.url);
const bundle=buildSync({entryPoints:[fileURLToPath(new URL('../src/lib/dialog-content.jsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react']});
const module={exports:{}};
new Function('module','exports','require',bundle.outputFiles[0].text)(module,module.exports,require);
const {layoutDialogContent}=module.exports;
const h=React.createElement;
const Field=({children})=>h('div',{className:'field'},children), Button=({children,...props})=>h('button',props,children), ErrorMessage=()=>null;
const types={Field,Button,ErrorMessage};
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('legacy confirmation paragraphs and fields receive a padded shared body',()=>{
 const html=renderToStaticMarkup(layoutDialogContent([h('p',{key:'p'},'Archive without deleting history.'),h(Field,{key:'f'},h('input',{'aria-label':'Run name'})),h('footer',{key:'foot',className:'dialog-footer'},'Actions')],types));
 assert.match(html,/<div class="dialog-body"><p>Archive without deleting history/);
 assert.match(html,/<input aria-label="Run name"/);
 assert.match(html,/<\/div><footer class="dialog-footer">Actions/);
});
test('bare actions group without executing or replacing their handlers',()=>{
 let calls=0;const click=()=>calls++;
 const result=layoutDialogContent([h('p',{key:'p'},'Confirm?'),h(Button,{key:'cancel',onClick:click},'Cancel'),h(Button,{key:'archive',onClick:click},'Archive')],types);
 assert.equal(result[1].props.className,'dialog-footer');assert.equal(result[1].props.children[0].props.onClick,click);assert.equal(calls,0);
});
test('authored forms/readers preserve their content and submit behavior',()=>{
 const submit=()=>{};const form=h('form',{key:'custom',className:'gov-editor',onSubmit:submit},h('input'));
 const result=layoutDialogContent([form,h(ErrorMessage,{key:'error'})],types);
 assert.equal(result[0].props.className,'gov-editor');assert.equal(result[0].props.onSubmit,submit);assert.equal(result.length,2);
 assert.equal(renderToStaticMarkup(layoutDialogContent([h(ErrorMessage)],types)),'');
});
test('fragment groups retain unique keys and text order',()=>{
 const result=layoutDialogContent([h(React.Fragment,{key:'a'},h('p',null,'First')),h(React.Fragment,{key:'b'},h('p',null,'Second'))],types);
 assert.equal(result.length,1);const kids=result[0].props.children;assert.notEqual(kids[0].key,kids[1].key);
 assert.match(renderToStaticMarkup(result),/First<\/p><p>Second/);
});
test('shared popup layout bounds content and only unclassed forms get generic columns',()=>{
 const css=source('src/components/dialog-layout.css');assert.match(css,/\.dialog-body \{ padding: 24px 26px/);assert.match(css,/min-height: 0; overflow-wrap: anywhere; overflow: auto/);assert.match(css,/flex-wrap: wrap/);
 const editors=source('src/components/editor-dialog.css');assert.match(editors,/> form:not\(\[class\]\)/);assert.doesNotMatch(editors,/> form:not\(\.entity-form\)/);
 const ui=source('src/ui.jsx');assert.match(ui,/layoutDialogContent\(typeof children === 'function'/);
});
test('standalone Settings panel padding cannot be erased by the row-panel rule',()=>{
 const css=source('src/views/settings/settings-center.css');assert.match(css,/\.settings-panel\.display-preferences \{ padding: 20px/);assert.match(css,/\.settings-panel\.identity-setup \{ padding: 24px/);assert.match(css,/\.setting-row > \.rumbo-select/);
});
test('Docs counts are removed and pointer-opened dialogs do not auto-display close tooltips',()=>{
 const docs=source('src/views/Docs.jsx');assert.doesNotMatch(docs,/docs-count|\{items.length\} articles|Search \{DOC_ARTICLES.length\}/);assert.match(docs,/Search documentation…/);
 assert.match(source('src/components/Tooltip.jsx'),/dataset.inputModality === 'keyboard'\) schedule\(\)/);
});

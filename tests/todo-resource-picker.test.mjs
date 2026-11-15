import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import {resourceKey,workspaceResourceOptions} from '../src/lib/todo-resource-options.js';
test('Resource choices contain only saved active items in the current workspace',()=>{
 const data={projects:[{id:'p',workspace_id:'ws',name:'Design'},{id:'other',workspace_id:'foreign',name:'Private'},{id:'gone',workspace_id:'ws',name:'Archived',archived_at:'date'}],tasks:[{id:'r',workspace_id:'ws',title:'Review'}],teams:[{id:'a',workspace_id:'ws',name:'Product'}],documents:[{id:'d',workspace_id:'ws',title:'Brief'}]};
 assert.deepEqual(workspaceResourceOptions(data,'ws').map(row=>row.label),['Brief','Design','Product','Review']);
 assert.deepEqual(workspaceResourceOptions(data,'ws',' ROUTE ').map(row=>row.id),['r']);
 assert.deepEqual(workspaceResourceOptions(data,'ws','private'),[]);
 assert.equal(data.projects.length,3);
});
test('Resource labels are bounded and empty collections are supported',()=>{
 assert.deepEqual(workspaceResourceOptions({},'ws'),[]);
 assert.equal(workspaceResourceOptions({documents:[{id:'d',workspace_id:'ws',title:'x'.repeat(400)}]},'ws')[0].label.length,200);
});
test('Duplicate identity ignores labels but distinguishes roots and page types',()=>{
 const file={kind:'file',path:'notes.md',rootVersion:'one',label:'Notes'};
 assert.equal(resourceKey(file),resourceKey({...file,label:'Different'}));
 assert.notEqual(resourceKey(file),resourceKey({...file,rootVersion:'two'}));
 assert.notEqual(resourceKey({kind:'page',view:'projects',id:'x'}),resourceKey({kind:'page',view:'tasks',id:'x'}));
 assert.notEqual(resourceKey({kind:'comment',rootVersion:'one',id:'c'}),resourceKey({kind:'comment',rootVersion:'two',id:'c'}));
});
test('Picker parses and uses existing scoped, revision-guarded APIs without launches',()=>{
 const source=readFileSync(new URL('../src/components/TodoResourcePicker.jsx',import.meta.url),'utf8');
 assert.doesNotThrow(()=>transformSync(source,{loader:'jsx'}));
 assert.match(source,/after.binding.version !== rootVersion/);
 assert.match(source,/expected_binding_version: resource.rootVersion/);
 assert.match(source,/controller.abort()/);
 assert.match(source,/entry.type !== 'link'/);
 assert.match(source,/resources.length >= 20/);
 assert.doesNotMatch(source,/method: 'POST'|terminal-providers|launch/);
});
test('Add resource is below the link row and preserves the existing drag target',()=>{
 const source=readFileSync(new URL('../src/views/TodoBoard.jsx',import.meta.url),'utf8');
 assert.ok(source.indexOf('className="todo-add-resource"')>source.indexOf('className="todo-add-link"'));
 assert.match(source,/onDrop={resourceDrop}/);
 assert.match(source,/onAdd={addResource}/);
 assert.match(source,/old.resources.some/);
});

test('Picker search reserves icon space and reveal respects reduced motion',()=>{
 const css=readFileSync(new URL('../src/views/todo-board.css',import.meta.url),'utf8');
 assert.match(css,/search-field input\[type=search\]\{padding-left:36px/);
 const source=readFileSync(new URL('../src/components/TodoResourcePicker.jsx',import.meta.url),'utf8');
 assert.match(source,/scrollIntoView/);
 assert.match(source,/prefers-reduced-motion/);
});

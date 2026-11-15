import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import {createTodoService} from '../server/local-todos.mjs';
import {installTeamResources} from '../server/team-resources.mjs';
import {resourceKey,todoResourceOutsideAreas,todoResourceScopeQuery} from '../src/lib/todo-resource-options.js';
import {pageHash,parsePage} from '../src/lib/navigation.js';
async function fixture(run) {
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY,archived_at TEXT);CREATE TABLE teams(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,archived_at TEXT);INSERT INTO workspaces VALUES('ws',NULL),('other',NULL);INSERT INTO teams VALUES('a','ws','Design',NULL),('b','ws','Engineering',NULL),('c','ws','Other Area',NULL),('foreign','other','Foreign',NULL),('archived','ws','Old','date');");
 installTeamResources(db);
 const insert=db.prepare('INSERT INTO team_resources(id,workspace_id,team_id,kind,name,description,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?)');
 for(const [id,ws,team,archived] of [['ra','ws','a',null],['rb','ws','b',null],['rc','ws','c',null],['rf','other','foreign',null],['rx','ws','a','date'],['ro','ws','archived',null]])insert.run(id,ws,team,'file',id+' guide','Saved resource description','now','now',archived);
 const service=createTodoService({db,roots:{},comments:{}});
 const send=(action='',input={},method='POST',query={},actor={id:'local-owner'})=>service.dispatch({workspaceId:'ws',actor,action,method,input,query:new URLSearchParams(query)});
 const fresh=extra=>({title:'Review',resources:[],priority:'important',request_id:randomUUID(),...extra});
 const ref=(id,teamId)=>({kind:'area-resource',id,teamId,label:'Untrusted label'});
 const listing=value=>send('resources',{},'GET',todoResourceScopeQuery(value));
 try{await run({db,send,fresh,ref,listing});}finally{db.close();}
}
test('Selected Area picker contains only that Area; multi-Area picker uses the union',()=>fixture(async({listing})=>{
 assert.deepEqual((await listing({area_scope:'selected',team_ids:['a']})).items.map(x=>x.id),['ra']);
 assert.deepEqual((await listing({area_scope:'selected',team_ids:['a','b']})).items.map(x=>x.id),['ra','rb']);
}));
test('All and No Areas remain current-workspace only and exclude archived resources or owners',()=>fixture(async({listing})=>{
 for(const area_scope of ['all','none'])assert.deepEqual((await listing({area_scope,team_ids:[]})).items.map(x=>x.id),['ra','rb','rc']);
}));
test('Saved reference is canonical, deduplicable, retained after edit and exportable without file bytes',()=>fixture(async({db,send,fresh,ref})=>{
 let item=await send('',fresh({area_scope:'selected',team_ids:['a'],resources:[ref('ra','a')]}));
 assert.deepEqual(item.resources,[{kind:'area-resource',id:'ra',teamId:'a',label:'ra guide'}]);
 assert.ok(!JSON.stringify(item).includes('Saved resource description'));
 db.prepare('UPDATE team_resources SET name=? WHERE id=?').run('Renamed guide','ra');
 item=await send('',fresh({...item,title:'Changed title'}));
 assert.equal(item.resources[0].label,'Renamed guide');
 const text=(await send('context',{},'GET',{id:item.id})).text;
 assert.match(text,/Renamed guide.*Area resource a:ra/);assert.ok(!text.includes('undefined:'));
 assert.equal((await send('',{},'GET')).items[0].resources[0].id,'ra');
}));
test('Saving and choosing reject cross-Area, forged owner, missing, archived and foreign-workspace references',()=>fixture(async({send,fresh,ref})=>{
 for(const resource of [ref('rb','b'),ref('ra','b'),ref('missing','a'),ref('rx','a'),ref('rf','foreign'),ref('ro','archived')]){
  await assert.rejects(send('',fresh({area_scope:'selected',team_ids:['a'],resources:[resource]})));
  await assert.rejects(send('resources',{},'GET',{area_scope:'selected',team_ids:'["a"]',id:resource.id,team_id:resource.teamId}));
 }
 for(const area_scope of ['all','none'])await assert.rejects(send('',fresh({area_scope,resources:[ref('rf','foreign')]})));
}));
test('Area changes reject incompatible links without changing the saved task; explicit removal succeeds',()=>fixture(async({send,fresh,ref})=>{
 const item=await send('',fresh({area_scope:'selected',team_ids:['a','b'],resources:[ref('ra','a'),ref('rb','b')]}));
 await assert.rejects(send('',fresh({...item,team_ids:['b']})),/different Area/);
 const unchanged=(await send('',{},'GET')).items[0];assert.equal(unchanged.version,1);assert.equal(unchanged.resources.length,2);
 const saved=await send('',fresh({...item,team_ids:['b'],resources:[ref('rb','b')]}));assert.equal(saved.version,2);
}));
test('Archive/revocation is rechecked for copy context, edit and restore',()=>fixture(async({db,send,fresh,ref})=>{
 let item=await send('',fresh({area_scope:'selected',team_ids:['a'],resources:[ref('ra','a')]}));
 item=await send('archive',{id:item.id,version:item.version,request_id:randomUUID()});
 db.prepare('UPDATE team_resources SET archived_at=? WHERE id=?').run('now','ra');
 await assert.rejects(send('restore',{id:item.id,version:item.version,request_id:randomUUID()}),/no longer available/);
 db.prepare('UPDATE team_resources SET archived_at=NULL WHERE id=?').run('ra');
 item=await send('restore',{id:item.id,version:item.version,request_id:randomUUID()});
 db.prepare('DELETE FROM team_resources WHERE id=?').run('ra');
 await assert.rejects(send('context',{},'GET',{id:item.id}),/no longer available/);
 await assert.rejects(send('',fresh({...item})),/no longer available/);
}));
test('Resource listing is owner-only, validates scope and pages/searches bounded results',()=>fixture(async({db,send})=>{
 await assert.rejects(send('resources',{},'GET',{}, {id:'other'}),e=>e.statusCode===403);
 for(const query of [{team_ids:'oops'},{area_scope:'selected',team_ids:'[]'},{area_scope:'selected',team_ids:'["foreign"]'},{offset:'-1'},{q:'x'.repeat(201)}])await assert.rejects(send('resources',{},'GET',query));
 assert.deepEqual((await send('resources',{},'GET',{q:'Engineering'})).items.map(x=>x.id),['rb']);
 for(let n=0;n<60;n++)db.prepare('INSERT INTO team_resources(id,workspace_id,team_id,kind,name,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('p'+n,'ws','a','url','Page '+n,'now','now');
 const first=await send('resources',{},'GET',{}),next=await send('resources',{},'GET',{offset:String(first.next_offset)});
 assert.equal(first.items.length,50);assert.equal(first.next_offset,50);assert.equal(next.items.length,13);assert.equal(next.next_offset,null);
}));
test('Resource identity, draft warning and canonical Area deep link are independent of labels',()=>{
 const resource={kind:'area-resource',teamId:'a',id:'ra',label:'Guide'};
 assert.notEqual(resourceKey(resource),resourceKey({...resource,id:'rb'}));
 assert.notEqual(resourceKey(resource),resourceKey({kind:'url',url:'https://example.com'}));
 assert.equal(todoResourceOutsideAreas(resource,{area_scope:'selected',team_ids:['b']}),true);
 assert.equal(todoResourceOutsideAreas(resource,{area_scope:'selected',team_ids:['a','b']}),false);
 const hash=pageHash('teams','a',{section:'resources',resourceId:'ra'});assert.equal(hash,'#/areas/a?section=resources&resource=ra');
 assert.equal(parsePage(hash).resourceId,'ra');assert.equal(parsePage('#/areas/a?section=todos&resource=ra').resourceId,undefined);
});
test('Resource picker and original resource navigation modules compile with scoped props',()=>{
 for(const file of ['src/components/TodoResourcePicker.jsx','src/views/TodoBoard.jsx','src/views/TeamResources.jsx'])assert.doesNotThrow(()=>transformSync(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{loader:'jsx'}));
});

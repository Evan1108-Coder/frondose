import assert from 'node:assert/strict';
import test from 'node:test';
import { searchCatalog, searchExcerpt } from '../src/lib/search.js';
import { isSidebarHidden, normalizeOrganization } from '../src/lib/organization.js';
import { parsePage, pageHash } from '../src/lib/navigation.js';
test('workspace search combines type, project, status, phrases and content without mutation',()=>{
  const items=[{id:'o',type:'Output',title:'Release memo',projectName:'Atlas Studio',status:'needs_review',searchText:'primary source evidence'}, {id:'m',type:'Message',title:'Discussion',subtitle:'Release memo',searchOnly:true}];
  assert.deepEqual(searchCatalog(items,'type:outputs project:"Atlas Studio" status:needs_review evidence').map(i=>i.id),['o']);
  assert.equal(searchCatalog(items,'type:message release')[0].id,'m'); assert.equal(searchCatalog(items,'').length,1);
  assert.equal(searchCatalog(items,'type:output unknown').length,0); assert.equal(searchCatalog(items,'release')[0].id,'o');
  assert.ok(searchExcerpt('x'.repeat(500)+'needle','needle').length<190);
});
test('hidden entities are scoped, bounded, independent of favorites and restorable',()=>{
  const p=normalizeOrganization({version:1,hiddenItems:[{view:'projects',id:'p'},{view:'projects',id:'p'},{view:'settings',id:'x'},null],favorites:[{view:'projects',id:'p'}]});
  assert.equal(p.hiddenItems.length,1); assert.equal(p.favorites.length,1); assert.equal(isSidebarHidden(p,'projects','p'),true); assert.equal(isSidebarHidden(p,'chats','p'),false);
  assert.equal(isSidebarHidden({...p,hiddenItems:[]},'projects','p'),false);
});
test('message deep links survive canonical navigation without accepting paths or duplicates',()=>{
  const page={view:'chats',id:'chat',projectId:'p',messageId:'message'};
  assert.deepEqual(parsePage(pageHash(page.view,page.id,page)),page);
  for(const hash of ['#/chats/c?message=x&message=y','#/chats/c?message=../x']) assert.equal(parsePage(hash).view,'overview');
});

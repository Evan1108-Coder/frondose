import assert from 'node:assert/strict';
import test from 'node:test';
import { visitPage, stepHistory } from '../src/lib/navigation-history.js';
import { calendarDay, projectTimeline } from '../src/lib/project-timeline.js';
import { normalizeOrganization, resolveFavorite } from '../src/lib/organization.js';

test('workspace navigation preserves forward history until a new destination and stays bounded', () => {
  let h = visitPage(null, '#/overview');
  h = visitPage(h, '#/documents/doc'); h = visitPage(h, '#/views/custom');
  h = stepHistory(h,-1); assert.equal(h.entries[h.index], '#/documents/doc');
  assert.deepEqual(visitPage(h, '#/documents/doc'), h);
  assert.equal(stepHistory(h,1).entries[2], '#/views/custom');
  h = visitPage(h, '#/chats/c?message=m'); assert.equal(h.entries.includes('#/views/custom'),false);
  h = stepHistory(stepHistory(h,-1),-1); assert.equal(stepHistory(h,-1).index,0);
  for (let i=0;i<110;i++) h = visitPage(h, `#/tasks/${i}`);
  assert.equal(h.entries.length,100); assert.equal(h.index,99);
  assert.equal(visitPage(h,'https://evil.test').entries.at(-1),'#/overview');
});
test('timeline uses real dates, preserves undated work and flags late dependencies without inventing estimates', () => {
  const data = { tasks:[{id:'one',project_id:'p',title:'One',status:'ready',due_at:'2026-09-20'}, {id:'two',project_id:'p',title:'Two',status:'done',due_at:'2026-09-22'}, {id:'three',project_id:'p',title:'Three',status:'ready'}, {id:'elsewhere',project_id:'q',title:'Other',status:'ready'}], route_workflows:[{id:'one',dependency_ids:['two','missing']}], milestones:[{id:'m',project_id:'p',title:'Launch',target_date:'2026-09-23',status:'planned'}] };
  let timeline = projectTimeline(data,{id:'p',start_date:'2026-09-19',target_date:'2026-09-24'});
  assert.equal(timeline.dated.length,3); assert.equal(timeline.undated.length,1);
  assert.equal(timeline.dated[0].dependencies[0].late,false);
  assert.equal(timeline.dated[0].dependencies[1].available,false);
  data.tasks[1].status='ready'; timeline=projectTimeline(data,{id:'p'});
  assert.equal(timeline.dated[0].dependencies[0].late,true);
  assert.equal(timeline.dated[0].start,timeline.dated[0].end);
  assert.equal(calendarDay('2026-02-30'),null); assert.equal(calendarDay(undefined),null);
  assert.equal(projectTimeline({},{id:'p'}).min,null);
  assert.ok(timeline.percent(timeline.dated[0].end)>0);
});
test('documents and saved queries can be favorited while unrelated workspace resources cannot masquerade as views', () => {
  const data={documents:[{id:'doc',title:'Brief'}],workspace_items:[{id:'view',kind:'saved_view',name:'Ready work'},{id:'preset',kind:'preset',name:'Not a view'}]};
  assert.equal(resolveFavorite(data,{view:'documents',id:'doc'}).title,'Brief');
  assert.equal(resolveFavorite(data,{view:'views',id:'view'}).title,'Ready work');
  assert.equal(resolveFavorite(data,{view:'views',id:'preset'}),null);
  assert.deepEqual(normalizeOrganization({version:1,hiddenItems:[{view:'views',id:'view'}]}).hiddenItems,[{view:'views',id:'view'}]);
});

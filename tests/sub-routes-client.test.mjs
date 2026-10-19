import test from 'node:test';
import assert from 'node:assert/strict';
import { leafRouteProgress, routeForestRows } from '../src/lib/sub-routes.js';
import { talvoriApi } from '../src/data/api.js';
const route = (id, status = 'ready', extra = {}) => ({ id, status, workspace_id: 'w', project_id: 'p', team_id: null, ...extra });

test('leaf progress excludes double-counted parents, cancelled and archived work', () => {
  const routes = [route('parent'), route('a','done'), route('b'), route('c','cancelled'), route('d','done',{archived_at:'2026-09-20'})];
  const workflows = routes.slice(1).map(item => ({ id:item.id,parent_task_id:'parent' }));
  assert.deepEqual(leafRouteProgress(routes,workflows),{total:2,done:1,unfinished:1,cancelled:1,archived:1,routeCount:4,complete:true,percent:50});
  assert.equal(leafRouteProgress([route('cancelled','cancelled')]).percent,0);
});
test('restricted, cyclic, cross-scope or missing ancestry cannot report complete progress', () => {
  assert.equal(leafRouteProgress([route('p','done')],[{id:'p',hierarchy_restricted:true}]).percent,null);
  assert.equal(leafRouteProgress([route('p','done')],[{id:'p',hierarchy_invalid:true}]).percent,null);
  assert.equal(leafRouteProgress([route('a'),route('b')],[{id:'a',parent_task_id:'b'},{id:'b',parent_task_id:'a'}]).complete,false);
  assert.equal(leafRouteProgress([route('a')],[{id:'a',parent_task_id:'missing'}]).complete,false);
  assert.equal(leafRouteProgress([route('a'),route('b','done',{project_id:'other'})],[{id:'a',parent_task_id:'b'}]).complete,false);
});
test('forest nests siblings by explicit order and collapses without hiding filtered or corrupt roots', () => {
  const routes = [route('a'),route('parent'),route('b'),route('other')];
  const workflows = [{id:'a',parent_task_id:'parent',sibling_position:2},{id:'b',parent_task_id:'parent',sibling_position:1}];
  assert.deepEqual(routeForestRows(routes,workflows).map(row=>[row.route.id,row.depth]),[['parent',0],['b',1],['a',1],['other',0]]);
  assert.deepEqual(routeForestRows(routes,workflows,new Set(['parent'])).map(row=>row.route.id),['parent','other']);
  assert.equal(routeForestRows([route('a')],workflows)[0].depth,0);
  assert.equal(routeForestRows([route('a'),route('b')],[{id:'a',parent_task_id:'b'},{id:'b',parent_task_id:'a'}]).length,2);
});
test('Sub-routes API preserves exact workspace, graph revision and retry payload', async () => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (path, options) => { calls.push({ path, options }); return Response.json({ result: { revision: 4, tree: {} } }); };
  try {
    await talvoriApi.subRoutes('route one', 'w&1');
    assert.equal(calls[0].path, '/api/sub-routes/route%20one?workspace_id=w%261');
    const input = { workspace_id: 'w&1', revision: 4, request_id: 'stable-retry-key', child_ids: ['b','a'] };
    await talvoriApi.mutateSubRoutes('route one', 'reorder', input);
    assert.equal(calls[1].path, '/api/sub-routes/route%20one/reorder');
    assert.equal(calls[1].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[1].options.body), input);
  } finally { globalThis.fetch = original; }
});
test('legacy over-deep lists stay readable without recursive stack overflow', () => {
  const routes = Array.from({length:10000}, (_, index) => route(String(index)));
  const workflows = routes.slice(1).map((item,index)=>({id:item.id,parent_task_id:String(index)}));
  const rows = routeForestRows(routes,workflows);
  assert.equal(rows.length,10000);
  assert.equal(rows.at(-1).depth,4);
  assert.equal(leafRouteProgress(routes,workflows).complete,false);
});

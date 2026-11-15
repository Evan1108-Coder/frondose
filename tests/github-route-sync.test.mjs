import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createGitHubRouteSyncService, normalizeGitHubRouteConfig } from '../server/github-route-sync.mjs';

const owner = { id: 'local-owner' };
async function fixture(fn, options = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE workspaces(id TEXT PRIMARY KEY, archived_at TEXT);
    CREATE TABLE teams(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,archived_at TEXT);
    CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,team_id TEXT,name TEXT,archived_at TEXT);
    CREATE TABLE tasks(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,team_id TEXT,number INTEGER,title TEXT,description TEXT,status TEXT,priority TEXT,labels_json TEXT,created_at TEXT,updated_at TEXT,archived_at TEXT,UNIQUE(workspace_id,number));
    INSERT INTO workspaces VALUES('ws',NULL),('other',NULL);
    INSERT INTO teams VALUES('a','ws','Area',NULL),('foreign-a','other','Other',NULL);
    INSERT INTO projects VALUES('p','ws','a','Project',NULL),('foreign-p','other','foreign-a','Other',NULL);`);
  const state = { connected: true, connectionVersion:'consent-v1', version: 'git-v1', bindingVersion: 'root-v1', head: 'abcd', github: { slug: 'example/repo', url: 'https://github.com/example/repo' } };
  const binding = { version: 'root-v1', root_identity: 'physical-1', project_id: 'p' }, calls = [], changes = [];
  let time = Date.parse('2026-10-28T12:00:00Z'), permitted = true, issueHook;
  const issue = { number: 12, title: 'Fix fixture', body: 'Original GitHub description', state: 'open', labels: ['bug'], assignees: ['fixture'], updatedAt: '2026-10-28T00:00:00Z' };
  const git = { async inspect(workspaceId, actor) { assert.equal(actor.id,'local-owner'); return structuredClone(state); }, async issues(workspaceId, actor, input) { calls.push({ workspaceId, actor, input }); await issueHook?.(); return { issues: [structuredClone(issue)], limited: false, repository: structuredClone(state.github) }; } };
  const roots = { async rootFor() { return { row: structuredClone(binding), root: '/fixture' }; } };
  const service = createGitHubRouteSyncService({ db, git, roots, now: () => time, start: false, allowed: () => permitted, record: (...args) => changes.push(args), ...options });
  const save = async (patch = {}, expected) => service.save('ws', owner, { enabled: false, project_id: 'p', area_id: 'a', ...patch, expected_revision: expected === undefined ? (await service.settings('ws',owner)).config?.revision || null : expected, expected_binding_version: binding.version, expected_repository: state.github?.slug, confirmed: true });
  const sync = async () => service.sync('ws', owner, { confirmed: true, expected_revision: (await service.settings('ws',owner)).config?.revision });
  try { await fn({ db, service, state, binding, calls, changes, issue, save, sync, setTime: value => { time = value; }, advance: value => { time += value; }, setPermission: value => { permitted = value; }, hook: value => { issueHook = value; } }); }
  finally { service.close(); db.close(); }
}

test('config validates bounded source filters, booleans and safe initial Route policy', () => {
  assert.equal(normalizeGitHubRouteConfig({enabled:false}).initial_status,'backlog');
  for (const patch of [{interval_minutes:1},{limit:1000},{query:'repo:other/private'},{query:'is:pr'},{query:'owner:other'},{query:'bad\nfilter'},{labels:['']},{labels:Array(11).fill('bug')},{enabled:'true'},{initial_status:'done'},{include_body:'yes'},{area_id:12}]) assert.throws(()=>normalizeGitHubRouteConfig({enabled:false,...patch}));
  assert.deepEqual(normalizeGitHubRouteConfig({enabled:true,labels:['bug','bug',' docs ']}).labels,['bug','docs']);
});
test('mount/status and saving a disabled default never read GitHub or create Routes', async () => fixture(async ({service,save,calls,db}) => {
  const initial = await service.settings('ws',owner); assert.equal(initial.config,null); assert.equal(initial.status.state,'manual');
  await save(); await service.tick(); assert.equal(calls.length,0); assert.equal(db.prepare('SELECT count(*) n FROM tasks').get().n,0);
}));
test('settings are unavailable to other actors or an unconnected source', async () => fixture(async ({service,state,save,calls}) => {
  await assert.rejects(service.settings('ws',{id:'someone'}),{statusCode:403});
  state.connected=false; const settings = await service.settings('ws',owner); assert.equal(settings.connected,false);
  await assert.rejects(save(),{code:'github_not_connected'}); assert.equal(calls.length,0);
}));
test('foreign/archived project or Area and conflicting project Area cannot be destinations', async () => fixture(async ({save,db}) => {
  for (const patch of [{project_id:'foreign-p',area_id:null},{project_id:null,area_id:'foreign-a'},{project_id:'p',area_id:'foreign-a'}]) await assert.rejects(save(patch),{code:'github_routes_destination'});
  db.prepare("UPDATE projects SET archived_at='now' WHERE id='p'").run(); await assert.rejects(save(),{code:'github_routes_destination'});
}));
test('saving requires explicit confirmation and optimistic settings/repository/root revisions', async () => fixture(async ({service,save}) => {
  await assert.rejects(service.save('ws',owner,{enabled:true}),/Confirm/);
  await save(); await assert.rejects(save({},'stale'),{code:'github_routes_conflict'});
  await assert.rejects(service.save('ws',owner,{enabled:true,confirmed:true,expected_binding_version:'stale'}),{code:'github_routes_conflict'});
}));
test('manual import creates scoped source-linked Routes with bounded body and immutable dedup identity', async () => fixture(async ({save,sync,db,calls,changes,issue}) => {
  await save({copy_labels:true}); const first = await sync(); assert.equal(first.created,1); assert.equal(changes.length,1);
  const route = db.prepare('SELECT * FROM tasks').get(); assert.equal(route.project_id,'p'); assert.equal(route.team_id,'a'); assert.equal(route.status,'backlog'); assert.match(route.description,/https:\/\/github.com\/example\/repo\/issues\/12/); assert.equal(route.labels_json,'["bug"]');
  assert.equal(calls[0].input.limit,50); assert.equal(calls[0].input.include_body,true); assert.equal(calls[0].input.confirmed,true);
  db.prepare('UPDATE tasks SET title=?,description=?,status=? WHERE id=?').run('My title','My edits','done',route.id); issue.title='Changed remotely'; issue.body='Remote edit';
  const second = await sync(); assert.equal(second.created,0); assert.equal(second.existing,1); const after = db.prepare('SELECT * FROM tasks').get(); assert.equal(after.title,'My title'); assert.equal(after.description,'My edits'); assert.equal(after.status,'done');
}));
test('deleted imported Routes stay deleted rather than resurrecting on the next check', async () => fixture(async ({save,sync,db}) => {
  await save(); await sync(); db.prepare('DELETE FROM tasks').run(); assert.equal(db.prepare('SELECT route_id FROM github_route_sources').get().route_id,null);
  assert.equal((await sync()).existing,1); assert.equal(db.prepare('SELECT count(*) n FROM tasks').get().n,0);
}));
test('required labels filter issues; omitted body is not copied; closed issues never auto-complete', async () => fixture(async ({save,sync,db,issue}) => {
  await save({labels:['important']}); assert.equal((await sync()).filtered,1);
  issue.state='closed'; await save({state:'closed',include_body:false}); await sync(); const route = db.prepare('SELECT * FROM tasks').get(); assert.equal(route.status,'backlog'); assert.doesNotMatch(route.description,/Original GitHub description/);
}));
test('automatic import is opt-in, waits for its interval and is bounded per check', async () => fixture(async ({service,save,calls,advance,db}) => {
  await save({enabled:true,interval_minutes:5,limit:25}); await service.tick(); assert.equal(calls.length,0);
  advance(5*60000); await service.tick(); assert.equal(calls.length,1); assert.equal(calls[0].input.limit,25); assert.equal(db.prepare('SELECT count(*) n FROM tasks').get().n,1);
  await service.tick(); assert.equal(calls.length,1); await save({enabled:false}); advance(60*60000); await service.tick(); assert.equal(calls.length,1);
}));
test('directory, binding or repository changes suspend imports before any issue read', async () => {
  for (const change of ['root','binding','repo','consent','reconnected']) await fixture(async ({service,save,sync,binding,state,calls}) => {
    await save(); if(change==='root') binding.root_identity='other'; if(change==='binding') binding.version='other'; if(change==='repo') state.github.slug='other/repo'; if(change==='consent') state.connected=false; if(change==='reconnected') state.connectionVersion='new-consent';
    assert.equal((await service.settings('ws',owner)).status.state,'suspended'); await assert.rejects(sync()); assert.equal(calls.length,0);
  });
});
test('late source change, revoked permission, archived destination or config update rejects every pending import', async () => {
  for (const change of ['root','permission','project','config','disconnect','reconnected']) await fixture(async ({save,sync,hook,binding,setPermission,db,state}) => {
    await save(); hook(async () => { if(change==='root') binding.version='new-version'; if(change==='permission') setPermission(false); if(change==='project') db.prepare("UPDATE projects SET archived_at='now' WHERE id='p'").run(); if(change==='config') await save({query:'new filter'}); if(change==='disconnect') state.connected=false; if(change==='reconnected') state.connectionVersion='new-consent'; });
    await assert.rejects(sync()); assert.equal(db.prepare('SELECT count(*) n FROM tasks').get().n,0);
  });
});
test('duplicate pending sync is rejected; closing waits out request without late database writes', async () => fixture(async ({service,save,sync,hook,db}) => {
  await save(); let resume; const barrier = new Promise(resolve=>{resume=resolve;}); let entered; const ready=new Promise(resolve=>{entered=resolve;}); hook(async()=>{entered();await barrier;});
  const pending=sync(); await ready; await assert.rejects(sync(),{code:'github_routes_busy'}); service.close(); resume(); assert.equal(await pending,null); assert.equal(db.prepare('SELECT count(*) n FROM tasks').get().n,0);
}));
test('failed source read is honest, creates no Routes and backs off until the next interval', async () => fixture(async ({service,save,hook,advance,calls,db}) => {
  await save({enabled:true}); hook(()=>{throw Error('fixture network unavailable');}); advance(10*60000); await service.tick(); assert.equal(calls.length,1); assert.equal(db.prepare('SELECT count(*) n FROM tasks').get().n,0);
  assert.equal((await service.settings('ws',owner)).status.reason,'github_read_failed'); await service.tick(); assert.equal(calls.length,1);
}));
test('scheduler timer is unrefed and cleared on close, with no startup account probing', async () => {
  let registered=0,unref=0,cleared=0;
  await fixture(async ({service,calls})=>{assert.equal(registered,1);assert.equal(unref,1);assert.equal(calls.length,0);service.close();assert.equal(cleared,1);},{start:true,setTimer:()=>{++registered;return{unref(){++unref;}};},clearTimer:()=>{++cleared;}});
});

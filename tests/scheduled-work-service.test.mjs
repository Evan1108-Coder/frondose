import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createScheduledWorkService } from '../server/scheduled-work-service.mjs';

function fixture(t, overrides = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE workspaces(id TEXT PRIMARY KEY,archived_at TEXT); INSERT INTO workspaces VALUES('ws',NULL);
    CREATE TABLE agent_action_requests(id TEXT PRIMARY KEY,status TEXT,result_json TEXT,resolved_at TEXT); INSERT INTO agent_action_requests VALUES('action','pending',NULL,NULL);
    CREATE TABLE runs(id TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE chat_turns(client_turn_id TEXT,run_id TEXT,source_message_id TEXT,chat_id TEXT,agent_id TEXT);
    CREATE TABLE messages(id TEXT PRIMARY KEY,chat_id TEXT,metadata_json TEXT);`);
  t.after(()=>db.close());
  let clock = '2026-10-08T12:00:00.000Z', permitted = true;
  const actor = {id:'owner',name:'Owner'}, deliveries = [], activity = [];
  const options = {db,now:()=>new Date(clock),allowed:()=>permitted,actorFor:id=>id === actor.id ? actor : null,
    authorizePayload:()=>{if (!permitted) throw Object.assign(Error('Source access revoked'),{code:'context_access_revoked'});},
    prepareMessage:async body=>({title:'Message',payload:body.payload,review:{exact:'Captured only'}}),
    prepareAction:body=>({title:'Action',payload:body.payload,review:{exact:'Captured action'}}),
    dispatchMessage:async(job,occurrence)=>{deliveries.push({job,occurrence});return {message_id:`message_${occurrence.id}`};},
    dispatchAction:(job,occurrence)=>{deliveries.push({job,occurrence});return {id:'applied'};},
    activity:(job,_actor,state)=>activity.push({id:job.id,state}),...overrides};
  let service = createScheduledWorkService(options);
  const body = (extra={})=>({workspace_id:'ws',kind:'message',payload:{chat_id:'chat',content:'Exact content',agent_id:null},timezone:'UTC',local_time:'2026-10-08T12:01',recurrence:'none',request_id:'schedule_request_1',...extra});
  return {db,actor,body,deliveries,activity,get service(){return service;},time:value=>{clock=value;},revoke:()=>{permitted=false;},restart:()=>{service=createScheduledWorkService(options);return service;}};
}

test('future scheduling is exact-request idempotent, versioned, paused, rescheduled, resumed and cancelled',async t=>{
  const f=fixture(t), created=await f.service.create(f.body(),f.actor);
  assert.equal(f.deliveries.length,0);assert.equal(created.next_due_at,'2026-10-08T12:01:00.000Z');
  assert.equal((await f.service.create(f.body(),f.actor)).id,created.id);
  await assert.rejects(f.service.create(f.body({title:'Changed'}),f.actor),{code:'schedule_request_conflict'});
  assert.throws(()=>f.service.update(created.id,{version:0,state:'paused'},f.actor),{code:'stale_schedule'});
  const paused=f.service.update(created.id,{version:1,state:'paused'},f.actor);assert.equal(paused.version,2);
  f.time('2026-10-08T12:01:30.000Z');await f.service.dispatchDue();assert.equal(f.deliveries.length,0);
  assert.throws(()=>f.service.update(created.id,{version:2,state:'active'},f.actor),/new future time/);
  assert.throws(()=>f.service.update(created.id,{version:2,state:'active',timezone:'America/New_York'},f.actor),/local date/);
  const resumed=f.service.update(created.id,{version:2,state:'active',local_time:'2026-10-08T12:05',timezone:'UTC'},f.actor);
  assert.equal(resumed.next_due_at,'2026-10-08T12:05:00.000Z');
  const cancelled=f.service.update(created.id,{version:3,state:'cancelled'},f.actor);assert.equal(cancelled.state,'cancelled');
  assert.throws(()=>f.service.update(created.id,{version:4,state:'active',local_time:'2026-10-08T12:10'},f.actor),{code:'schedule_finished'});
  f.time('2026-10-08T12:05:00.000Z');await f.service.dispatchDue();assert.equal(f.deliveries.length,0);
  assert.deepEqual(f.activity.map(item=>item.state),['scheduled','paused','resumed','cancelled']);
});

test('invalid dates/zones/horizons and recurring action approvals are rejected',async t=>{
  const f=fixture(t);
  for (const extra of [{local_time:'2026-10-08T12:00'},{local_time:'2032-01-01T12:00'},{local_time:'2026-02-30T12:00'},{timezone:'not/a-zone'},{kind:'action',recurrence:'daily'},{recurrence:'monthly'},{permissions:'all'}]) await assert.rejects(f.service.create(f.body(extra),f.actor));
  const created=await f.service.create(f.body(),f.actor);
  assert.throws(()=>f.service.update(created.id,{version:1,state:'active',local_time:'2032-01-01T12:00'},f.actor),/five years/);
});

test('concurrent creation and ticks preserve one durable schedule and one send',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture(t,{prepareMessage:async body=>{await gate;return {title:'Message',payload:body.payload,review:{}};}});
  const first=f.service.create(f.body(),f.actor),second=f.service.create(f.body(),f.actor);release();
  const [a,b]=await Promise.all([first,second]);assert.equal(a.id,b.id);assert.equal(b.replayed,true);
  f.time('2026-10-08T12:01:00.000Z');await Promise.all([f.service.dispatchDue(),f.service.dispatchDue()]);await f.service.dispatchDue();
  assert.equal(f.deliveries.length,1);assert.equal(f.service.get(a.id,f.actor).history.length,1);assert.equal(f.service.get(a.id,f.actor).history[0].status,'completed');
});

test('context inspections are exclusively reserved across schedules',async t=>{
  const f=fixture(t);await f.service.create(f.body({context_inspection_id:'exact-inspection'}),f.actor);
  await assert.rejects(f.service.create(f.body({request_id:'another_schedule',context_inspection_id:'exact-inspection'}),f.actor),{code:'context_inspection_reserved'});
  assert.equal(f.db.prepare('SELECT count(*) n FROM scheduled_work').get().n,1);
});

test('daily/weekly messages advance by wall time; actions apply once or return to pending on cancellation',async t=>{
  const f=fixture(t), daily=await f.service.create(f.body({recurrence:'daily'}),f.actor),weekly=await f.service.create(f.body({recurrence:'weekly',request_id:'weekly_schedule_1'}),f.actor);
  f.time('2026-10-08T12:01:00.000Z');await f.service.dispatchDue();
  assert.equal(f.service.get(daily.id,f.actor).next_due_at,'2026-10-09T12:01:00.000Z');assert.equal(f.service.get(weekly.id,f.actor).next_due_at,'2026-10-15T12:01:00.000Z');
  const action=await f.service.create(f.body({kind:'action',payload:{action_request_id:'action'},local_time:'2026-10-08T12:03',request_id:'action_schedule_1'}),f.actor);
  assert.equal(f.db.prepare('SELECT status FROM agent_action_requests').get().status,'scheduled');
  f.service.update(action.id,{version:1,state:'cancelled'},f.actor);assert.equal(f.db.prepare('SELECT status FROM agent_action_requests').get().status,'pending');
  const second=await f.service.create(f.body({kind:'action',payload:{action_request_id:'action'},local_time:'2026-10-08T12:03',request_id:'action_schedule_2'}),f.actor);
  f.time('2026-10-08T12:03:00.000Z');await f.service.dispatchDue();await f.service.dispatchDue();
  assert.equal(f.service.get(second.id,f.actor).history[0].status,'completed');assert.equal(f.db.prepare('SELECT status FROM agent_action_requests').get().status,'applied');
});

test('missed, revoked and failed occurrences never dispatch or silently retry',async t=>{
  const missed=fixture(t),a=await missed.service.create(missed.body(),missed.actor);missed.time('2026-10-08T12:03:01.000Z');await missed.service.dispatchDue();
  assert.equal(missed.service.get(a.id,missed.actor).history[0].status,'missed');assert.equal(missed.deliveries.length,0);
  const revoked=fixture(t),b=await revoked.service.create(revoked.body(),revoked.actor);revoked.revoke();revoked.time('2026-10-08T12:01:00.000Z');await revoked.service.dispatchDue();
  assert.equal(revoked.deliveries.length,0);assert.equal(revoked.db.prepare('SELECT status FROM scheduled_work_occurrences').get().status,'failed');assert.throws(()=>revoked.service.get(b.id,revoked.actor));
  let calls=0;const failed=fixture(t,{dispatchMessage:async()=>{calls++;throw Object.assign(Error('No provider'),{code:'not_connected'});}}),c=await failed.service.create(failed.body(),failed.actor);
  failed.time('2026-10-08T12:01:00.000Z');await failed.service.dispatchDue();await failed.service.dispatchDue();assert.equal(calls,1);assert.equal(failed.service.get(c.id,failed.actor).history[0].error.code,'not_connected');
});

test('agent occurrence status follows canonical run completion/failure, not merely dispatch',async t=>{
  const f=fixture(t,{dispatchMessage:async()=>{f.db.prepare('INSERT INTO runs VALUES(?,?)').run('canonical','running');return {run_id:'canonical',message_id:'sent'};}}),schedule=await f.service.create(f.body({payload:{chat_id:'chat',agent_id:'agent',content:'Send'}}),f.actor);
  f.time('2026-10-08T12:01:00.000Z');await f.service.dispatchDue();assert.equal(f.service.get(schedule.id,f.actor).history[0].status,'running');
  f.db.prepare('UPDATE runs SET status=? WHERE id=?').run('failed','canonical');await f.service.dispatchDue();
  assert.equal(f.service.get(schedule.id,f.actor).history[0].status,'failed');assert.equal(f.service.get(schedule.id,f.actor).history[0].error.code,'failed');
});

test('restart reconciles confirmed chat turns and notes but never replays unknown sends or strands action approvals',async t=>{
  const f=fixture(t);const schedules=[];
  for (const [requestId,kind,payload] of [['unknown_note','message',{chat_id:'chat',agent_id:null,content:'Unknown'}],['known_note','message',{chat_id:'chat',agent_id:null,content:'Known'}],['known_agent','message',{chat_id:'chat',agent_id:'agent',content:'Agent'}],['unknown_action','action',{action_request_id:'action'}]]) schedules.push(await f.service.create(f.body({kind,payload,request_id:requestId}),f.actor));
  for (let i=0;i<schedules.length;i++) {f.db.prepare('INSERT INTO scheduled_work_occurrences(id,schedule_id,due_at,status,started_at) VALUES(?,?,?,?,?)').run(`occ_${i}`,schedules[i].id,schedules[i].next_due_at,'running','2026-10-08T12:01:00.000Z');f.db.prepare('UPDATE scheduled_work SET state=?,next_due_at=NULL WHERE id=?').run('finished',schedules[i].id);}
  f.db.prepare('INSERT INTO messages VALUES(?,?,?)').run('message_occ_1','chat',JSON.stringify({scheduled_work_id:schedules[1].id,scheduled_occurrence_id:'occ_1'}));
  f.db.prepare('INSERT INTO runs VALUES(?,?)').run('existing-run','completed');f.db.prepare('INSERT INTO chat_turns VALUES(?,?,?,?,?)').run('occ_2','existing-run','existing-message','chat','agent');
  f.restart();await f.service.dispatchDue();
  assert.deepEqual(f.db.prepare('SELECT status FROM scheduled_work_occurrences ORDER BY id').all().map(row=>row.status),['interrupted','completed','completed','interrupted']);
  assert.equal(f.db.prepare('SELECT status FROM agent_action_requests').get().status,'pending');assert.equal(f.deliveries.length,0);
});

test('restart never mistakes another chat/agent occurrence ID for a scheduled delivery',async t=>{
  const f=fixture(t),schedule=await f.service.create(f.body({payload:{chat_id:'expected-chat',agent_id:'expected-agent',content:'Exact recipient'}}),f.actor);
  f.db.prepare('INSERT INTO scheduled_work_occurrences(id,schedule_id,due_at,status,started_at) VALUES(?,?,?,?,?)').run('shared_id',schedule.id,schedule.next_due_at,'running','2026-10-08T12:01:00.000Z');
  f.db.prepare('UPDATE scheduled_work SET state=?,next_due_at=NULL WHERE id=?').run('finished',schedule.id);
  f.db.prepare('INSERT INTO runs VALUES(?,?)').run('unrelated-run','completed');f.db.prepare('INSERT INTO chat_turns VALUES(?,?,?,?,?)').run('shared_id','unrelated-run','unrelated-message','other-chat','other-agent');
  f.restart();await f.service.dispatchDue();assert.equal(f.service.get(schedule.id,f.actor).history[0].status,'interrupted');assert.equal(f.deliveries.length,0);
});

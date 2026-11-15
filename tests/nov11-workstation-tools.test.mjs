import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createWorkstationTools, environmentImage, environmentName } from '../server/workstation-tools.mjs';
import { computerUseAction } from '../src/lib/computer-use-action.js';
const require=createRequire(import.meta.url),{createDesktopWorkstationTools}=require('../desktop/workstation-tools.cjs');
const owner={id:'local-owner'};
function fixture({endpoint='unix:///tmp/docker-fixture.sock',missingContainer=false,createFails=false}={}) {
  const calls=[],roots={get:async(ws,actor)=>{if(ws!=='ws'||actor?.id!=='local-owner')throw Error('Denied');return{};},withBoundRoot:async(ws,actor,permission,fn)=>fn({root:'/project',row:{version:'v'}})};
  const resolveExecutable=async name=>({path:'/tools/'+name,kind:'native'});
  const run=async(path,args,options)=>{if(args[0]==='context')return{stdout:JSON.stringify(endpoint)};const rawArgs=args;args=args[0]==='--host'?args.slice(2):args;calls.push({path,args,rawArgs,options});if(args[0]==='create'&&createFails)throw Error('Creation interrupted');if(args[0]==='container'){if(missingContainer)throw Error('Error response from daemon: No such container: '+environmentName('ws'));return{stdout:JSON.stringify([{Id:'a'.repeat(64),Config:{Labels:{'app.frondose.workspace':'ws','app.frondose.root-version':'v'},Image:'alpine:3.22'},State:{Running:true}}])};}return {stdout:''};};
  const service=createWorkstationTools({roots,env:{PATH:'/usr/bin'},platform:'darwin',resolveExecutable,run});
  const action=(action,input={})=>service.dispatch({workspaceId:'ws',actor:owner,method:'POST',action,input:{confirmed:true,expected_binding_version:'v',...input}});
  return {calls,service,action};
}
test('Tool discovery never executes commands and remains owner/workspace scoped',async()=>{const f=fixture();const result=await f.service.dispatch({workspaceId:'ws',actor:owner});assert.equal(f.calls.length,0);assert.equal(result.environment.state,'available');await assert.rejects(f.service.dispatch({workspaceId:'other',actor:owner}),/Denied/);});
test('Environment image and resource identities reject option and shell injection',()=>{assert.equal(environmentImage('alpine:3.22'),'alpine:3.22');assert.equal(environmentName('workspace'),environmentName('workspace'));for(const value of ['--privileged','hello;touch /tmp/x','https://image','a b','../evil'])assert.throws(()=>environmentImage(value));});
test('Container creation uses restrictive fixed arguments, an explicit installed image and bound root',async()=>{const f=fixture();await f.action('environment/create',{image:'alpine:3.22'});assert.deepEqual(f.calls[0].args,['image','inspect','alpine:3.22']);const args=f.calls[1].args;assert(args.includes('--read-only'));assert(args.includes('none'));assert(args.includes('ALL'));assert(args.includes('no-new-privileges'));assert(args.includes('type=bind,src=/project,dst=/workspace'));assert(!args.includes('--privileged'));assert.equal(f.calls[1].options.shell,false);});
test('Environment commands never select arbitrary containers and reject stale/unchecked actions',async()=>{const f=fixture();await f.action('environment/exec',{command:'printf hello'});assert.deepEqual(f.calls[1].args,['exec','a'.repeat(64),'/bin/sh','-lc','printf hello']);await assert.rejects(f.action('environment/create',{expected_binding_version:'old'}),/changed/);await assert.rejects(f.action('environment/create',{confirmed:false}),/Confirm/);});
test('Device actions reject arbitrary serial options, invalid coordinates and unrelated stops',async()=>{const f=fixture();await assert.rejects(f.action('devices/tap',{device_id:'-s',device_platform:'android',x:1,y:2}),/device/);await assert.rejects(f.action('devices/tap',{device_id:'serial',device_platform:'android',x:-1,y:2}),/coordinates/);await assert.rejects(f.action('devices/stop',{device_id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',device_platform:'ios'}),/started here/);assert.equal(f.calls.length,0);});
test('Remote Docker contexts cannot receive workspace mounts or commands',async()=>{for(const endpoint of ['ssh://remote','tcp://127.0.0.1:2375']){const f=fixture({endpoint});await assert.rejects(f.action('environment/create'),/Remote Docker/);assert.equal(f.calls.length,0);}});
test('Uncertain container creation blocks directory changes until exact local absence is verified',async()=>{
  const f=fixture({missingContainer:true,createFails:true});await assert.rejects(f.action('environment/create'),/Creation interrupted/);
  assert.equal(f.service.activeSessionsFor('workspaces','ws').length,1);
  const result=await f.action('environment/status');assert.equal(result.exists,false);assert.equal(f.service.activeSessionsFor('workspaces','ws').length,0);
});
test('Unconfigured Android emulator names cannot start a process',async()=>{const f=fixture();await assert.rejects(f.action('devices/boot-android',{avd:'--evil'}),/existing Android/);assert.equal(f.calls.length,0);await assert.rejects(f.action('devices/boot-android',{avd:'Not_Configured'}),/no longer configured/);assert.deepEqual(f.calls[0].args,['-list-avds']);});
test('release workstation service never discovers or starts deferred tools and only cleans up a verified prior container',async()=>{
  const f=fixture(),release=(action,input={})=>f.service.releaseDispatch({workspaceId:'ws',actor:owner,method:'POST',action,input:{expected_binding_version:'v',confirmed:true,...input}});
  const availability=await f.service.releaseDispatch({workspaceId:'ws',actor:owner});
  for(const key of ['ios','android','androidEmulator','environment'])assert.equal(availability[key].state,'coming-soon');
  for(const action of ['environment/create','environment/start','environment/exec','environment/logs','environment/stop','environment/remove','environment/status','devices/list','devices/boot','devices/boot-android','devices/tap','devices/screenshot','devices/stop'])await assert.rejects(release(action),{code:'coming_soon',statusCode:409});
  assert.equal(f.calls.length,0);
  await f.action('environment/create'); // Populate a previous implementation's lease, using only the stub runner.
  await assert.rejects(release('environment/stop',{expected_binding_version:'stale'}),{code:'coming_soon'});
  await assert.rejects(release('environment/stop',{confirmed:false}),/Confirm/);
  await assert.rejects(release('environment/start'),{code:'coming_soon'});
  const verified=await release('environment/status');assert.equal(verified.id,'a'.repeat(64));
  assert.deepEqual(await release('environment/stop'),{stopped:true});
  assert.deepEqual(f.calls.at(-1).args,['stop','--time','10','a'.repeat(64)]);
});
function nativeFixture({unrelatedChanges=false,targetChanges=false,screenLocked=false}={}) {
  const calls=[];let time=1000,snapshotReads=0;
  const spawnProcess=(command,args)=>{
    const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{queueMicrotask(()=>child.emit('close',null));return true;};let input='';child.stdin.on('data',chunk=>input+=chunk);child.stdin.on('finish',()=>queueMicrotask(()=>{
      const p=JSON.parse(input||'{}');calls.push({command,args,p});let result={};
      if(p.operation==='apps')result={apps:[{pid:42,bundleId:'test.app',name:'Test'}]};if(p.operation==='permissions')result={accessibility:true,screenRecording:false,screenLocked,interactiveSession:!screenLocked};if(p.operation==='snapshot'){snapshotReads++;result={elements:[{path:[0],role:'AXButton',title:targetChanges&&snapshotReads>1?'Delete':'Save',press:true},...(unrelatedChanges?[{path:[1],role:'AXStaticText',value:String(snapshotReads)}]:[])]};}if(p.operation==='dictate')result={ready:true,text:'private fixture transcript'};
      child.stdout.write(JSON.stringify(result)+'\n');child.emit('close',0);
    }));return child;
  };
  const service=createDesktopWorkstationTools({platform:'darwin',helper:'/helper',accessible:async()=>{},authorizeWorkspace:async ws=>{if(ws!=='ws')throw Error('Denied');},spawnProcess,now:()=>time});
  const action=(operation,p={})=>service.command({workspaceId:'ws',operation,confirmed:true,...p});return {service,action,calls,advance:n=>time+=n};
}
test('Native discovery does not launch apps, request permissions or record audio',async()=>{const f=nativeFixture();const result=await f.action('capabilities');assert.equal(result.computer,'available');assert.equal(f.calls.length,0);await assert.rejects(f.service.command({workspaceId:'other',operation:'capabilities'}),/Denied/);f.service.close();});
test('OS permissions never substitute for an unlocked interactive Mac session',async()=>{const f=nativeFixture({screenLocked:true});await assert.rejects(f.action('computer/grant',{pid:42,bundleId:'test.app'}),/Unlock/);await assert.rejects(f.action('computer/snapshot'),/authorize/);assert(!f.calls.some(c=>['snapshot','press','setValue','dictate'].includes(c.p.operation)));f.service.close();});
test('Computer Use requires selected-app authorization and single-use fresh element snapshots',async()=>{const f=nativeFixture();await assert.rejects(f.action('computer/snapshot'),/authorize/);await f.action('computer/grant',{pid:42,bundleId:'test.app'});const state=await f.action('computer/snapshot');await f.action('computer/press',{snapshotId:state.snapshotId,index:0});await assert.rejects(f.action('computer/press',{snapshotId:state.snapshotId,index:0}),/Refresh/);const next=await f.action('computer/snapshot');f.advance(16000);await assert.rejects(f.action('computer/press',{snapshotId:next.snapshotId,index:0}),/Refresh/);f.service.close();});
test('Revocation, expiry and invalid app identities fail closed',async()=>{const f=nativeFixture();await assert.rejects(f.action('computer/grant',{pid:666,bundleId:'evil'}),/no longer/);await f.action('computer/grant',{pid:42,bundleId:'test.app'});await f.action('computer/revoke');await assert.rejects(f.action('computer/snapshot'),/authorize/);await f.action('computer/grant',{pid:42,bundleId:'test.app'});f.advance(300001);await assert.rejects(f.action('computer/snapshot'),/authorize/);f.service.close();});
test('External AI launching uses only detected allowlisted application paths',async()=>{const f=nativeFixture();await assert.rejects(f.action('ai/open',{appId:'../../evil'}),/supported/);await f.action('ai/open',{appId:'codex'});assert.deepEqual(f.calls[0].args,['-a','/Applications/Codex.app']);assert.equal(f.calls[0].command,'/usr/bin/open');f.service.close();});
test('release IPC keeps detected AI apps while deferred native tools never spawn or return transcripts',async t=>{
  const f=nativeFixture(),release=(operation,options)=>f.service.releaseCommand({workspaceId:'ws',operation,confirmed:true,...options});
  t.after(()=>f.service.close());
  const status=await release('capabilities');assert.equal(status.computer,'coming-soon');assert.equal(status.dictation,'coming-soon');assert(status.apps.some(app=>app.id==='codex'&&app.installed));
  for(const operation of ['computer/apps','computer/permissions','computer/request-permission','computer/grant','computer/snapshot','computer/press','computer/set-value','computer/screenshot','dictation/state','dictation/start'])await assert.rejects(release(operation),/coming soon/);
  assert.deepEqual(await release('computer/revoke'),{revoked:true});
  assert.deepEqual(await release('dictation/stop'),{phase:'stopped'});
  assert.equal(f.calls.length,0);
  await assert.rejects(release('ai/open',{appId:'../../evil'}),/supported/);
  await assert.rejects(release('ai/open',{appId:'codex',confirmed:false}),/Confirm/);
  assert.deepEqual(await release('ai/open',{appId:'codex'}),{opened:true,name:'Codex'});
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].command,'/usr/bin/open');assert.deepEqual(f.calls[0].args,['-a','/Applications/Codex.app']);
  await f.action('dictation/start',{locale:'en-US'}); // Simulate a legacy private transcription with no real audio.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await f.action('dictation/state')).text,'private fixture transcript');
  assert.deepEqual(await release('dictation/stop'),{phase:'stopped'});
});
test('Computer grants are isolated between manual controls and separate AI conversations',async()=>{const f=nativeFixture();await f.action('computer/grant',{pid:42,bundleId:'test.app',scopeId:'conversation-1'});await assert.rejects(f.action('computer/snapshot',{scopeId:'conversation-2'}),/authorize/);await assert.rejects(f.action('computer/snapshot'),/authorize/);const state=await f.action('computer/snapshot',{scopeId:'conversation-1'});assert(state.snapshotId);await f.action('computer/revoke',{scopeId:'conversation-1'});await assert.rejects(f.action('computer/snapshot',{scopeId:'conversation-1'}),/authorize/);f.service.close();});
test('Native actions revalidate the selected control rather than unrelated changing UI',async()=>{
  const f=nativeFixture({unrelatedChanges:true});await f.action('computer/grant',{pid:42,bundleId:'test.app'});const state=await f.action('computer/snapshot');await f.action('computer/press',{snapshotId:state.snapshotId,index:0});assert(f.calls.some(c=>c.p.operation==='press'));f.service.close();
  const changed=nativeFixture({targetChanges:true});await changed.action('computer/grant',{pid:42,bundleId:'test.app'});const snapshot=await changed.action('computer/snapshot');await assert.rejects(changed.action('computer/press',{snapshotId:snapshot.snapshotId,index:0}),/selected control changed/);assert(!changed.calls.some(c=>c.p.operation==='press'));changed.service.close();
});
test('AI computer requests cannot select apps, grant permissions or supply arbitrary IPC operations',()=>{assert.deepEqual(computerUseAction({operation:'snapshot'}),{operation:'snapshot'});for(const input of [{operation:'grant',pid:42},{operation:'snapshot',bundleId:'app'},{operation:'set-value',snapshotId:'s',index:0,text:'x\0'},{operation:'press',snapshotId:'s',index:-1},{operation:'scroll',snapshotId:'s',index:0,direction:'sideways'}])assert.throws(()=>computerUseAction(input));});

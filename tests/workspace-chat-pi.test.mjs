import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp,realpath,rm,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runWorkspacePiChat } from '../server/workspace-chat-pi.mjs';

async function fixture(t,provider,behavior='complete') {
 const cwd=await realpath(await mkdtemp(join(tmpdir(),'frondose-chat-fixture-')));
 t.after(()=>rm(cwd,{force:true,recursive:true}));
 const file=join(cwd,'chat.jsonl');await writeFile(file,'{}\n');
 const sent=[], calls=[], snapshots=[], deltas=[];
 let stop, saved;
 const options={provider,cwd,platform:process.platform,launch:{command:'/fixture/agent',env:{PATH:'/bin'}},prompt:'Hello',sessionFile:null,
  onStop:callback=>{stop=callback;},onText:text=>deltas.push(text),onSnapshot:text=>snapshots.push(text),remember:next=>{saved=next;},
  start(command,args,options){
   calls.push({command,args,options});
   const child=new EventEmitter();
   child.stdout=new PassThrough();child.stdin=new PassThrough();child.stderr=new PassThrough();
   child.kill=()=>{queueMicrotask(()=>child.emit('close',0));return true;};
   const emit=value=>child.stdout.write(JSON.stringify(value)+'\n');
   if(provider==='omp')queueMicrotask(()=>emit({type:'ready',protocolVersion:1}));
   child.stdin.on('data',bytes=>{
    const row=JSON.parse(bytes);sent.push(row);
    if(row.type==='get_state')queueMicrotask(()=>emit({type:'response',id:row.id,data:{sessionFile:file,dumpTools:behavior==='enabled'?[{name:'bash'}]:[],isStreaming:false}}));
    if(row.type==='prompt')queueMicrotask(()=>{
     if(behavior==='wait'){stop();return;}
     if(behavior==='tool'){emit({type:'tool_execution_start'});return;}
     emit({type:'response',id:row.id,data:{disposition:'started'}});
     emit({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'Hi'}});
     emit({type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:'Hi there'}]}});
     if(provider==='omp'){emit({type:'prompt_result',status:'completed',agentInvoked:true,sessionSettled:false,id:row.id});emit({type:'session_settled'});}
     else emit({type:'agent_settled'});
    });
   });
   return child;
  },
 };
 return {options,sent,calls,snapshots,deltas,file,get saved(){return saved;}};
}
for(const name of ['pi','omp'])test(name+' streams a bounded response and reopens its saved native session without replaying old prompts',async t=>{
 const f=await fixture(t,name);
 await runWorkspacePiChat(f.options);
 assert.equal(f.saved,f.file);assert.deepEqual(f.deltas,['Hi']);assert.deepEqual(f.snapshots,['Hi there']);
 assert.equal(f.calls[0].options.shell,false);assert.ok(f.calls[0].args.includes('--no-tools'));assert.ok(f.calls[0].args.includes('--no-extensions'));
 await runWorkspacePiChat({...f.options,sessionFile:f.saved,prompt:'Continue'});
 assert.deepEqual(f.calls[1].args.slice(-2),['--session',f.file]);
 assert.deepEqual(f.sent.filter(row=>row.type==='prompt').map(row=>row.message),['Hello','Continue']);
});
test('rejects inline shell/slash commands, missing saved sessions, unexpected tools, and cancelled requests',async t=>{
 const f=await fixture(t,'pi');
 for(const prompt of ['! pwd',' /bash ls'])await assert.rejects(runWorkspacePiChat({...f.options,prompt}),/Shell shortcuts/);
 await assert.rejects(runWorkspacePiChat({...f.options,sessionFile:join(f.options.cwd,'missing.jsonl')}),/could not be reopened/);
 assert.equal(f.calls.length,0);
 const tool=await fixture(t,'pi','tool');
 await assert.rejects(runWorkspacePiChat(tool.options),/attempted to use tools/);
 const enabled=await fixture(t,'omp','enabled');await assert.rejects(runWorkspacePiChat(enabled.options),/tool-free/);assert.equal(enabled.sent.some(row=>row.type==='prompt'),false);
 const wait=await fixture(t,'pi','wait');await assert.rejects(runWorkspacePiChat(wait.options),/cancelled/);assert.equal(wait.sent.filter(row=>row.type==='prompt').length,1);assert.equal(wait.sent.some(row=>row.type==='abort'),true);
});

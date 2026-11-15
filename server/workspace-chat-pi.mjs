import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { createRuntimeTransport } from './runner-adapters/transport.mjs';

const common=['--mode','rpc','--no-tools','--no-extensions','--no-skills','--no-context-files'];
export const PI_CHAT_AGENTS=Object.freeze({pi:'Pi',omp:'Oh My Pi'});
export const isPiChat=id=>Object.hasOwn(PI_CHAT_AGENTS,id);

export async function runWorkspacePiChat({ provider, launch, platform, cwd, prompt, sessionFile, start, onStop, onText, onSnapshot, remember }) {
  const omp=provider==='omp', api=platform==='win32'?path.win32:path.posix;
  const validFile=value=>typeof value==='string'&&value.length<=4096&&api.isAbsolute(value)&&value.endsWith('.jsonl')&&!/[\x00-\x1f]/.test(value);
  if(platform==='win32'&&(/\.(?:cmd|bat)$/i.test(launch.command)||api.basename(launch.command).toLowerCase()==='cmd.exe')) throw Error('Chat needs a directly executable CLI on Windows. Use Terminal for this installation.');
  if(sessionFile&&(!validFile(sessionFile)||!(await lstat(sessionFile).catch(()=>null))?.isFile()||await realpath(sessionFile).catch(()=>null)!==sessionFile))throw Error('The previous native chat could not be reopened. Start a new conversation.');
  if (/^\s*[!/]/.test(prompt)) throw Error('Shell shortcuts and slash commands are not available in text Chat. Use Terminal.');
  const flags=omp?['--no-lsp','--no-pty','--no-rules']:['--no-mcp','--no-approve','--no-prompt-templates'];
  const controller=new AbortController();
  const child=start(launch.command,[...common,...flags,...(sessionFile?['--session',sessionFile]:[])],{cwd,env:launch.env,shell:false,windowsHide:true,detached:platform!=='win32',stdio:['pipe','pipe','pipe']});
  let ready=false,sent=false,ompCompleted=false,settled=false,complete=false,reply=false,assistantFailed=false;
  let transport, finish;
  const done=new Promise(resolve=>{finish=resolve;});
  const completeOmp=()=>{if(ompCompleted&&settled)finish();};
  transport=createRuntimeTransport(child,{platform,env:launch.env,signal:controller.signal,timeoutMs:1_190_000,
    onStop(){transport.send({type:'abort'});},
    onFrame(frame){
      if(frame.type==='ready'){ready=true;return;}
      if(frame.type==='extension_ui_request'){transport.send({type:'extension_ui_response',id:frame.id,cancelled:true});return;}
      if(!sent)return;
      if(['tool_execution_start','tool_execution_update'].includes(frame.type))throw Error('The runtime attempted to use tools in text Chat.');
      if(frame.type==='message_update'&&frame.assistantMessageEvent?.type==='text_delta'&&typeof frame.assistantMessageEvent.delta==='string')onText(frame.assistantMessageEvent.delta);
      if(frame.type==='message_end'&&frame.message?.role==='assistant'){
        assistantFailed=['aborted','error'].includes(frame.message.stopReason);
        const text=(Array.isArray(frame.message.content)?frame.message.content:[]).filter(block=>block?.type==='text'&&typeof block.text==='string').map(block=>block.text).join('');
        if(text){reply=true;onSnapshot(text);}
      }
      if(!omp&&frame.type==='agent_settled'){
        if(assistantFailed||frame.status==='error'||frame.status==='aborted')throw Error('Pi did not complete this reply. Check the CLI account and model.');
        finish();
      }
      if(omp&&frame.type==='prompt_result'&&frame.id==='2'){
        if(frame.status!=='completed'||frame.agentInvoked===false)throw Error('Oh My Pi did not complete this reply. Check the CLI account and model.');
        ompCompleted=true;if(frame.sessionSettled===true)settled=true;completeOmp();
      }
      if(omp&&frame.type==='session_settled'){settled=true;completeOmp();}
    },
  });
  onStop(()=>controller.abort());
  try {
    if(omp&&!ready)await transport.wait(frame=>frame.type==='ready'&&frame.protocolVersion===1);
    const state=await transport.request('get_state',{},{rpc:false});
    if(!validFile(state.sessionFile)||sessionFile&&state.sessionFile!==sessionFile||state.isStreaming||state.isCompacting||state.goal||(omp&&(!Array.isArray(state.dumpTools)||state.dumpTools.length)))throw Error('The CLI did not open an idle, tool-free chat session.');
    sent=true;
    const accepted=await transport.request('prompt',{message:prompt},{rpc:false});
    if(accepted.disposition==='handled'||accepted.agentInvoked===false)throw Error('The CLI handled the message locally instead of sending it.');
    await transport.race(done);
    if(!reply)throw Error('The CLI did not return a text reply. Check its account and model in Terminal.');
    await transport.dispose({graceful:true});
    const canonical=await realpath(state.sessionFile).catch(()=>null);
    if(!canonical||!(await lstat(state.sessionFile).catch(()=>null))?.isFile()||!validFile(canonical))throw Error('The agent replied, but its conversation could not be saved.');
    remember(canonical);
    complete=true;
  } finally { if(!complete)await transport.dispose(); }
}

// Read-only Codex app-server quota probe, informed by Orca's MIT probe and
// window mapper at 00de405c5c0cffea06c2beb6eb0a0038b5d53fe6.
// Frondose owns discovery, account-safe environment, transport and cleanup.
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {terminalDiscoveryEnvironment,pairTerminalRuntimePath} from './terminal-install-discovery.mjs';
import {terminalEnvironment,resolveCodexInstallation} from './terminal-launch-plan.mjs';
import {resolveRunnerExecutable,prepareRunnerLaunch} from './runner-process.mjs';
import {createRuntimeTransport} from './runner-adapters/transport.mjs';
import {normalizeCodexQuota} from '../src/lib/provider-quota.js';
export const CODEX_QUOTA_ARGS=Object.freeze(['-c','approval_policy=never','-c','features.plugins=false','-c','mcp_servers={}','-s','read-only','-a','never','app-server']);
const unavailable=(code,message,now)=>({provider:'codex',status:'unavailable',code,message,windows:[],updatedAt:now});
export async function codexQuotaLaunchPlan({platform=process.platform,env=process.env,discover=terminalDiscoveryEnvironment,resolveExecutable=resolveRunnerExecutable,pair=pairTerminalRuntimePath,cwd}={}){
 const discoveryEnv=await discover({platform,env});
 const found=await resolveCodexInstallation({platform,env,discoveryEnv,resolveExecutable});
 if(!found)return null;
 const paired=await pair(found.executable.path,found.env,{platform,resolveExecutable});
 return prepareRunnerLaunch(found.executable,[...CODEX_QUOTA_ARGS],{platform,env:{...terminalEnvironment(env,platform),PATH:paired.PATH},cwd});
}
export function createCodexQuotaService({platform=process.platform,env=process.env,now=Date.now,launchPlan=options=>codexQuotaLaunchPlan(options),spawnImpl=spawn,makeDirectory=()=>mkdtemp(join(tmpdir(),'frondose-codex-quota-')),removeDirectory=directory=>rm(directory,{recursive:true,force:true}),timeoutMs=30000,cacheMs=60000}={}){
 let pending=null,cached=null,lastAttempt=-Infinity,closed=false,quarantined=false,abort=null;
 const state=(code,message)=>unavailable(code,message,now());
 async function probe(){let directory,transport,result,clean=true;const controller=new AbortController();abort=controller;
  try{directory=await makeDirectory();if(closed)return state('closed','Frondose is closing.');const plan=await launchPlan({platform,env,cwd:directory});
   if(!plan)return state('not_installed','Codex CLI was not found. Refresh installed CLIs after installing it.');
   if(closed)return state('closed','Frondose is closing.');
   const child=spawnImpl(plan.command,plan.args,{...plan.options,stdio:['pipe','pipe','pipe'],detached:platform!=='win32'});
   transport=createRuntimeTransport(child,{platform,env:plan.options.env,signal:controller.signal,timeoutMs,onFrame:frame=>{if(frame.method&&frame.id!==undefined)transport.send({id:frame.id,error:{code:-32601,message:'This read-only usage client grants no tools, login or refresh-token capability.'}});}});
   await transport.request('initialize',{clientInfo:{name:'frondose-usage',title:'Frondose usage',version:'0.1.1'}},{jsonrpc:true});
   transport.send({jsonrpc:'2.0',method:'initialized',params:{}});
   const account=await transport.request('account/read',{refreshToken:false},{jsonrpc:true});
   if(!account?.account)result=state('sign_in_required','Sign in through Codex CLI to read your plan allowance.');
   else if(account.account.type==='apiKey'||account.account.type==='apikey')result=state('api_key_account','API-key accounts do not expose a ChatGPT plan allowance.');
   else result=normalizeCodexQuota(await transport.request('account/rateLimits/read',{},{jsonrpc:true}),now());
  }catch(error){result=state(error?.code==='run_timeout'?'timeout':error?.code==='not_installed'?'not_installed':'read_failed',error?.code==='run_timeout'?'The Codex usage read timed out. Your CLI tabs were not touched.':error?.code==='not_installed'?'Codex CLI was not found.':'Codex could not provide quota data. Check its CLI sign-in or update the CLI, then refresh.');}
  finally{if(transport)try{await transport.dispose();}catch{clean=false;quarantined=true;result=state('cleanup_failed','The usage helper did not stop cleanly. Restart the Frondose app before retrying. Your CLI tabs were not stopped.');}if(directory&&clean)await removeDirectory(directory).catch(()=>{});if(abort===controller)abort=null;}
  return result||state('read_failed','Codex did not provide quota data.');
 }
 return {read({refresh=false}={}){if(closed)return Promise.resolve(state('closed','Frondose is closing.'));if(quarantined)return Promise.resolve(state('cleanup_failed','Restart the Frondose app before retrying its usage helper.'));if(pending)return pending;const age=now()-lastAttempt;if(cached&&age<(refresh?5000:cacheMs))return Promise.resolve({...cached,windows:cached.windows.map(window=>({...window,expired:window.resetsAt!==null&&window.resetsAt<=now()}))});lastAttempt=now();pending=probe().then(value=>(cached=value)).finally(()=>{pending=null;});return pending;},async close(){closed=true;abort?.abort();await pending?.catch(()=>{});cached=null;}};
}

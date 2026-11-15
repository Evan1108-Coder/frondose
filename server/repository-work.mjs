import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,open,realpath,rename,unlink} from 'node:fs/promises';
import {basename,dirname,join,resolve,win32} from 'node:path';
import {directoryRelativePath} from './directory-workspace.mjs';
import {parseGitStatusZ,parseWorktreesZ} from '../src/lib/repository-work.js';
export const repositoryPathKey=(value,platform=process.platform)=>platform==='win32'?win32.resolve(value).toLowerCase():resolve(value);
const samePath=(a,b)=>repositoryPathKey(a)===repositoryPathKey(b);
const listedWorktrees=output=>parseWorktreesZ(output).map(row=>({...row,path:resolve(row.path)}));
const digest=value=>createHash('sha256').update(value).digest('hex');
const fail=(message,code='repository_work_error',statusCode=400)=>{throw Object.assign(Error(message),{code,errorCode:code,statusCode});};
const stale=()=>fail('Repository files or index changed. Refresh and review again.','repository_work_stale',409);
const safePath=value=>{try{return directoryRelativePath(value)===value;}catch{return false;}};
const text=value=>typeof value==='string'?value:'';

/** Orca-inspired local source-control/worktree operations, with Frondose root,
 * stale-snapshot, private-path, explicit-action and non-replay boundaries.
 * No renderer-supplied shell commands; no automatic stash/reset/clean/fetch.
 * Git worktrees share object/ref storage and are NOT OS security sandboxes. */
export function createRepositoryWork({db,dataDir,roots,inspect,git,command,checkExpected,active,account,mutations,mutatingRoots,mutatingPaths,recordActivity=()=>{}}){
 const receipts=new Map(),queues=new Map();
 const registryFile=join(resolve(dataDir),'managed-worktrees.json');
 async function noteActivity(event){
  try{await recordActivity(event);}catch{/* A completed Git operation must not be reported as failed. */}
 }
 async function registry(){
  let handle;
  try{
   const visible=await lstat(registryFile,{bigint:true});
   if(visible.isSymbolicLink()||!visible.isFile()||visible.nlink!==1n||visible.size>128000n||process.platform!=='win32'&&((visible.mode&0o077n)!==0n||typeof process.getuid==='function'&&visible.uid!==BigInt(process.getuid())))fail('Managed worktree metadata is unsafe.');
   handle=await open(registryFile,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
   const info=await handle.stat({bigint:true});if(info.dev!==visible.dev||info.ino!==visible.ino)stale();
   const buffer=Buffer.alloc(128001);let size=0;
   while(size<buffer.length){const result=await handle.read(buffer,size,buffer.length-size,size);if(!result.bytesRead)break;size+=result.bytesRead;}
   const after=await handle.stat({bigint:true});if(info.size!==after.size||info.mtimeNs!==after.mtimeNs||size>128000||BigInt(size)!==info.size)stale();
   const parsed=JSON.parse(buffer.subarray(0,size));
   if(parsed.version!==1||!Array.isArray(parsed.rows)||parsed.rows.length>256||parsed.rows.some(row=>!row||typeof row.id!=='string'||typeof row.common!=='string'||!/^[a-f0-9]{64}$/.test(row.common)||typeof row.path!=='string'||row.path.length>4096||typeof row.branch!=='string'||typeof row.identity!=='string'))fail('Managed worktree metadata is invalid.');
   return parsed.rows;
  }catch(error){if(error.code==='ENOENT')return [];throw error;}finally{await handle?.close();}
 }
 async function saveRegistry(rows){if(rows.length>256)fail('Managed worktree limit reached.');const temporary=`${registryFile}.${randomUUID()}.tmp`;let handle;try{const bytes=JSON.stringify({version:1,rows});if(Buffer.byteLength(bytes)>128000)fail('Managed worktree metadata is full.');handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW||0),0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await rename(temporary,registryFile);}finally{await handle?.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}}
 async function common(context){return realpath(resolve(context.root,(await git(context,['rev-parse','--git-common-dir'])).trim()));}
 async function serial(key,callback){const pending=(queues.get(key)||Promise.resolve()).catch(()=>{}).then(callback);queues.set(key,pending);try{return await pending;}finally{if(queues.get(key)===pending)queues.delete(key);}}
 async function snapshot(workspaceId,actor){
  const state=await inspect(workspaceId,actor);if(!state.isRepository)return {...state,files:[],limited:false,workVersion:null};
  const context=await roots.rootFor(workspaceId,actor);
  const [status,index]=await Promise.all([git(context,['status','--porcelain=v1','-z','--untracked-files=all','--ignore-submodules=all']),git(context,['ls-files','--stage','-z'])]);
  const all=parseGitStatusZ(status),safe=all.filter(row=>safePath(row.path)&&(!row.original||safePath(row.original))),files=[];
  for(const row of safe.slice(0,300)){let version='missing',readable=false;try{const file=await roots.file(workspaceId,actor,row.path,state.bindingVersion);if(file.version){version=file.version;readable=!file.unsupported;}else version=`unsupported:${file.size}`;}catch(error){if(error.statusCode===403)throw error;}
   files.push({...row,fileVersion:version,readable});}
  const fresh=await inspect(workspaceId,actor);if(fresh.version!==state.version)stale();
  return {...state,files,limited:safe.length>300,hidden:all.length-safe.length,privateStaged:all.some(row=>row.staged&&(!safePath(row.path)||row.original&&!safePath(row.original))),routeWork:db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workbench_agent_terminal_launches'").get()?db.prepare("SELECT substr(l.agent_id,7) AS routeId,l.status AS launchState,t.id AS terminalId,t.name,t.status AS terminalState,t.exit_code AS exitCode FROM workbench_agent_terminal_launches l LEFT JOIN workbench_terminals t ON t.id=l.terminal_id WHERE l.workspace_id=? AND l.project_id=? AND l.agent_id LIKE 'route:%' ORDER BY l.created_at DESC LIMIT 100").all(workspaceId,context.project.id):[],workVersion:digest(JSON.stringify([state.version,index,files.map(row=>[row.path,row.fileVersion])]))};
 }
 function expected(state,input){checkExpected(state,input);if(!state.workVersion||state.workVersion!==input.expected_work_version)stale();}
 async function filters(context){let output='';try{output=await git(context,['config','--get-regexp','^filter\\..*\\.(clean|smudge|process)$']);}catch(error){if(!error.commandFailed)throw error;}if(output.trim())fail('This repository uses executable content filters. Review this operation in your terminal.','git_filters_require_terminal',409);}
 async function hookGuard(){const path=join(resolve(dataDir),'git-hooks-disabled');await mkdir(path,{recursive:true,mode:0o700});const stat=await lstat(path);if(stat.isSymbolicLink()||!stat.isDirectory())fail('The private Git hook guard is unavailable.');}
 async function diff(workspaceId,actor,input){const state=await snapshot(workspaceId,actor);expected(state,input);if(!['staged','working'].includes(input.side)||!safePath(input.path))fail('Choose a visible changed file and diff side.');const row=state.files.find(row=>row.path===input.path);if(!row)stale();if(!row.readable&&!/D/.test(row.status))return {path:row.path,patch:'',unavailable:true,reason:'Binary, unsupported or unreadable file. Open it in its appropriate editor.'};const context=await roots.rootFor(workspaceId,actor);let patch;
  if(row.status==='??'){const file=await roots.file(workspaceId,actor,row.path,state.bindingVersion);patch=`--- /dev/null\n+++ b/${row.path}\n@@ -0,0 +1,${file.content.split('\n').length} @@\n`+file.content.split('\n').map(line=>`+${line}`).join('\n');}
  else patch=await git(context,['--literal-pathspecs','diff','--no-ext-diff','--no-textconv','--no-color','--unified=3',...(input.side==='staged'?['--cached']:[]),'--',row.path]);
  expected(await snapshot(workspaceId,actor),input);return {path:row.path,patch,side:input.side,fileVersion:row.fileVersion,limited:Buffer.byteLength(patch)>200000};
 }
 async function worktrees(workspaceId,actor){const state=await inspect(workspaceId,actor);if(!state.isRepository)return {state,rows:[]};const context=await roots.rootFor(workspaceId,actor),key=digest(await common(context)),records=await registry();const rows=listedWorktrees(await git(context,['worktree','list','--porcelain','-z'])).map(row=>{const managed=records.find(record=>record.common===key&&samePath(record.path,row.path)&&record.branch===row.branch);return {...row,current:samePath(row.path,context.root),managed:Boolean(managed),id:managed?.id||null,title:managed?.title||row.branch||'Detached worktree',source:managed?.source||null,createdAt:managed?.createdAt||null,taskDescription:managed?.taskDescription||null,activeSessions:db.prepare('SELECT workspace_id FROM directory_workspaces WHERE path=?').all(row.path).filter(item=>active(item.workspace_id)).length};});return {state,rows,parent:join(dirname(context.root),`${basename(context.root)}.frondose-worktrees`)};}
 async function mutate(workspaceId,actor,action,input){
  if(input.confirmed!==true)fail('Review and confirm this repository action.');
  if(typeof input.request_id!=='string'||!/^[a-zA-Z0-9_-]{10,100}$/.test(input.request_id))fail('This action needs a fresh request identity.');
  const receiptKey=`${workspaceId}:${input.request_id}`,fingerprint=digest(JSON.stringify([action,input]));const prior=receipts.get(receiptKey);if(prior){if(prior.fingerprint!==fingerprint)fail('This request identity was already used.');return prior.promise;}
  if(receipts.size>=500)receipts.delete(receipts.keys().next().value);
 const promise=roots.withBoundRoot(workspaceId,actor,'workbench.execute',async context=>serial('repository-mutations',async()=>{
   const creating=action==='create-worktree',listing=await snapshot(workspaceId,actor);expected(listing,input);await hookGuard();
   mutations.add(workspaceId);mutatingRoots.add(context.row.root_identity);mutatingPaths.add(context.root);
   try{
    if(['stage','unstage'].includes(action)){
     if(!Array.isArray(input.paths)||!input.paths.length||input.paths.length>300||new Set(input.paths).size!==input.paths.length)fail('Choose up to 300 exact visible paths.');
     const selected=input.paths.map(path=>listing.files.find(row=>row.path===path));if(selected.some(row=>!row||!safePath(row.path)||row.original&&!safePath(row.original)||row.conflict))fail('A selected path is unavailable, private or conflicted. Resolve conflicts in your terminal.');
     if(action==='stage'&&selected.some(row=>!row.readable&&!/D/.test(row.status)))fail('Unsupported files must be staged in your terminal.');
     await filters(context);expected(await snapshot(workspaceId,actor),input);
     const paths=[...new Set(selected.flatMap(row=>[row.path,...(row.original?[row.original]:[])]))];
     await git(context,action==='stage'?['--literal-pathspecs','add','--',...paths]:listing.head?['--literal-pathspecs','restore','--staged','--',...paths]:['--literal-pathspecs','rm','--cached','--ignore-unmatch','--',...paths]);
     return {completed:true,action,state:await snapshot(workspaceId,actor)};
    }
    if(action==='commit'){
     if(!text(input.message).trim()||input.message.length>2000||input.message.includes('\0'))fail('Enter a commit message of up to 2,000 characters.');
     if(input.drafts_confirmed!==true)fail('Save editor drafts and review staged files first.');
     if(listing.privateStaged||listing.hidden)fail('Private or unsupported paths are present. Review and commit in your terminal.');
     if(!listing.files.some(row=>row.staged)||listing.files.some(row=>row.conflict)||listing.limited)fail('Stage reviewed files and resolve conflicts before committing.');
     await filters(context);expected(await snapshot(workspaceId,actor),input);
     // Preserve the configured author/signing identity. Hooks are intentionally
     // disabled by the shared runner; this is explicit in the review UI.
     await git(context,['commit','-m',input.message]);
     const state=await snapshot(workspaceId,actor);
     if(state.head&&state.head!==listing.head)await noteActivity({workspaceId,kind:'git.committed',title:'Git commit created',entityId:context.project.id});
     return {completed:true,action,state};
    }
    if(creating){
     if(input.issue_number!==undefined&&input.route_id!==undefined)fail('Choose one source task.');
     const issue=input.issue_number!==undefined?await issueDetail(workspaceId,actor,input):null;
     const route=input.route_id!==undefined?db.prepare('SELECT * FROM tasks WHERE id=? AND workspace_id=? AND project_id=? AND archived_at IS NULL').get(input.route_id,workspaceId,context.project.id):null;
     if(input.route_id!==undefined&&(!route||['done','cancelled'].includes(route.status)||route.version!==input.route_version))fail('The Route changed. Refresh and review it before creating a worktree.','route_work_stale',409);
     if(route&&(typeof route.description!=='string'||route.description.length>12000||route.description.includes('\0')))fail('The Route description is too large or unsupported for a copied worktree task.');
     const name=text(input.name).trim(),branch=text(input.branch).trim();if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,59}$/.test(name)||!/^frondose\/[a-zA-Z0-9][a-zA-Z0-9/_-]{0,100}$/.test(branch)||branch.includes('//')||branch.endsWith('/'))fail('Use a simple worktree name and a new frondose/ branch.');
     const base=listing.branchDetails.find(row=>row.name===input.base)?.commit;if(!base)fail('Choose an existing local base branch.');
     await git(context,['check-ref-format','--branch',branch]);if(listing.branches.includes(branch))fail('That branch already exists. Choose a new branch name.');await filters(context);
     const parent=join(dirname(context.root),`${basename(context.root)}.frondose-worktrees`);await mkdir(parent,{recursive:false,mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});const parentInfo=await lstat(parent);if(parentInfo.isSymbolicLink()||!parentInfo.isDirectory()||await realpath(parent)!==parent)fail('The worktree destination is linked or unsafe.');
     const target=join(parent,name);try{await lstat(target);fail('That worktree folder already exists.');}catch(error){if(error.code!=='ENOENT')throw error;}
     const records=await registry();if(records.length>=256)fail('Managed worktree limit reached.');expected(await snapshot(workspaceId,actor),input);
     await git(context,['worktree','add','--no-guess','-b',branch,target,base]);
     const record={id:randomUUID(),common:digest(await common(context)),path:target,branch,title:text(input.title).replace(/[\x00-\x1f]/g,'').slice(0,200)||name,createdAt:new Date().toISOString(),identity:null,source:issue?.url||null};
     const info=await lstat(target,{bigint:true});record.identity=String(info.dev)+':'+String(info.ino);
     if(issue){record.title=issue.title;record.taskDescription='Source: '+record.source+'\n\n'+issue.body;}
     if(route){record.title=route.title;record.taskDescription=route.description;record.originRouteId=route.id;}
     try{await saveRegistry([...records,record]);}catch{fail(`Worktree was created at ${target}, but its metadata could not be saved. Do not repeat creation; open the existing directory.`, 'worktree_created_metadata_failed',409);}
     return {completed:true,action,worktree:record,baseCommit:base,filesCopiedFrom:'committed base only'};
    }
    if(action==='remove-worktree'){
     if(input.drafts_confirmed!==true)fail('Close or save worktree drafts before removal.');
     const records=await registry(),key=digest(await common(context)),record=records.find(row=>row.id===input.worktree_id&&row.common===key);
     const listed=listedWorktrees(await git(context,['worktree','list','--porcelain','-z']));
     const row=record&&listed.find(item=>samePath(item.path,record.path)&&item.branch===record.branch);
     if(!row||samePath(row.path,context.root)||row.locked||row.prunable||!samePath(await realpath(row.path),row.path))fail('Choose an available, unlocked managed worktree other than the current directory.');
     const info=await lstat(row.path,{bigint:true});if(record.identity!==String(info.dev)+':'+String(info.ino))stale();
     const bound=db.prepare('SELECT workspace_id FROM directory_workspaces WHERE path=?').all(record.path);if(bound.some(item=>active(item.workspace_id)))fail('Stop that worktree’s own terminals before removing it. Other worktrees stay running.','worktree_active',409);
     const target={...context,root:row.path};if((await git(target,['status','--porcelain=v1','--untracked-files=all'])).trim()||(await git(target,['ls-files','--others','--ignored','--exclude-standard','-z'])).length)fail('This worktree contains changes or ignored files. Preserve them before removal. No force removal is available.');
     await git(context,['worktree','remove','--',row.path]);
     try{await saveRegistry(records.filter(item=>item.id!==record.id));}catch{fail('The clean worktree was removed but its metadata could not be refreshed. Refresh before continuing.','worktree_removed_metadata_failed',409);}
     return {completed:true,action,branchRetained:record.branch};
    }
    if(['fetch','push','create-pr'].includes(action)){
     if(!listing.connected||input.external_confirmed!==true||!listing.github)fail('Connect GitHub and explicitly confirm the external operation.');
     if(!listing.branch||!listing.head)fail('Choose a committed local branch.');
     // No repository-configured transport, push URL, credential-bearing URL,
     // remote helper or shell is inherited from a browser-provided value.
     const url=`https://github.com/${listing.github.slug}.git`;
     let rewrites='';try{rewrites=await git(context,['config','--get-regexp','^url\\..*\\.(insteadof|pushinsteadof)$']);}catch(error){if(!error.commandFailed)throw error;}
     if(rewrites.trim())fail('Git URL rewriting is configured. Review network operations in your terminal.','git_transport_requires_terminal',409);
     expected(await snapshot(workspaceId,actor),input);
     if(action==='fetch'){await git(context,['-c','credential.interactive=false','fetch','--no-tags','--no-recurse-submodules',url]);}
     if(action==='push'){
      if(!/^frondose\//.test(listing.branch))fail('Push from a dedicated frondose/ worktree branch.');
      const target=`refs/heads/${listing.branch}`,output=await git(context,['-c','credential.interactive=false','push','--no-verify','--porcelain',url,`HEAD:${target}`]);
      // Git marks an actual fast-forward with a literal space, and a new ref
      // with '*'. No activity for up-to-date, unknown or unsuccessful updates.
      if(output.split('\n').some(line=>{
       const [flag,refSpec,summary,...extra]=line.split('\t');
       return (flag===' '||flag==='*')&&refSpec?.split(':').at(-1)===target&&Boolean(summary)&&!extra.length;
      }))await noteActivity({workspaceId,kind:'git.pushed',title:'Git branch pushed',entityId:context.project.id});
     }
     if(action==='create-pr'){
      if(!/^frondose\//.test(listing.branch)||!listing.branches.includes(input.base)||input.base===listing.branch||!text(input.title).trim()||input.title.length>250||!text(input.body)||input.body.length>8000)fail('Choose a different local base branch, a title and a reviewed PR description.');
      const auth=await account(context);if(!auth.authenticated)fail('Sign in with GitHub CLI before creating a pull request.','gh_account_unverified',409);
      // gh never receives --fill, --web, a shell command or automatic push.
      const output=await command('gh',['pr','create','--repo',`github.com/${listing.github.slug}`,'--head',listing.branch,'--base',input.base,'--title',input.title,'--body',input.body,...(input.draft?['--draft']:[])],context.root);
      const prUrl=output.trim(),prefix=listing.github.url+'/pull/';if(!prUrl.startsWith(prefix)||!/^\d+$/.test(prUrl.slice(prefix.length)))fail('GitHub may have created the PR, but its URL was not recognized. Check GitHub before retrying.','github_write_uncertain',409);
      return {completed:true,action,url:prUrl};
     }
     return {completed:true,action,state:await snapshot(workspaceId,actor)};
    }
    fail('This repository action is unavailable.','not_found',404);
   }catch(error){if(error.commandFailed)fail('Git did not complete this action. Refresh and inspect the repository before retrying; no force, reset, clean or automatic stash was attempted.','repository_action_failed',409);throw error;}
   finally{mutations.delete(workspaceId);mutatingRoots.delete(context.row.root_identity);mutatingPaths.delete(context.root);}
  }));receipts.set(receiptKey,{fingerprint,promise});return promise;
 }
 async function issueDetail(workspaceId,actor,input){const state=await snapshot(workspaceId,actor);expected(state,input);if(input.confirmed!==true||!state.connected||!Number.isSafeInteger(input.issue_number)||input.issue_number<1)fail('Choose an issue from this connected GitHub repository.');const context=await roots.rootFor(workspaceId,actor),auth=await account(context);if(!auth.authenticated)fail('Verify your GitHub CLI login before reading this issue.');const raw=JSON.parse(await command('gh',['issue','view',String(input.issue_number),'--repo','github.com/'+state.github.slug,'--json','number,title,body'],context.root));if(raw.number!==input.issue_number||typeof raw.title!=='string'||typeof raw.body!=='string'||raw.body.length>12000||/[\x00-\x08\x0b-\x1f\x7f]/.test(raw.body))fail('The issue is unavailable or too large for a local task.');expected(await snapshot(workspaceId,actor),input);return {number:raw.number,title:raw.title.slice(0,200),body:raw.body,url:state.github.url+'/issues/'+raw.number};}
 async function worktreeTarget(workspaceId,actor,input){const state=await snapshot(workspaceId,actor);expected(state,input);if(input.confirmed!==true)fail('Confirm opening this worktree directory.');const context=await roots.rootFor(workspaceId,actor),key=digest(await common(context));const record=(await registry()).find(row=>row.id===input.worktree_id&&row.common===key);const listed=listedWorktrees(await git(context,['worktree','list','--porcelain','-z'])).find(row=>record&&samePath(row.path,record.path)&&row.branch===record?.branch);if(!record||!listed||listed.bare||listed.prunable||!samePath(await realpath(record.path),record.path))stale();const info=await lstat(record.path,{bigint:true});if(info.isSymbolicLink()||record.identity!==String(info.dev)+':'+String(info.ino))stale();return {...record,managed:true};}
 async function dispatch({workspaceId,actor,action,method,input}){if(method==='GET'&&action==='snapshot')return snapshot(workspaceId,actor);if(method==='GET'&&action==='worktrees')return worktrees(workspaceId,actor);if(method==='POST'&&action==='worktree-target')return worktreeTarget(workspaceId,actor,input);if(method==='POST'&&action==='issue-detail')return issueDetail(workspaceId,actor,input);if(method==='POST'&&action==='diff')return diff(workspaceId,actor,input);if(method==='POST')return mutate(workspaceId,actor,action,input);fail('Repository action unavailable.','not_found',404);}
 return {dispatch,snapshot,worktrees,diff};
}

import {isDeferredWorkstationTool} from './workstation-tool-availability.js';

// View metadata only. This queue never carries a command, token or AI launch.
const kinds=new Set(['editor','browser','release-notes','automations','worktrees','repository-tasks','source-control','workstation-tool']);
const labels={automations:'Automations',worktrees:'Worktrees','repository-tasks':'Repository tasks','source-control':'Source control'};
let receiver=null,pending=null;
export function requestWorkspaceTool(workspaceId,kind,fields={},showWorkspace=()=>{}){
 if(typeof workspaceId!=='string'||!kinds.has(kind)||kind==='workstation-tool'&&isDeferredWorkstationTool(fields.toolId))return false;
 const toolId=fields.toolId==='versions'?'versions':'ai';
 const intent={workspaceId,kind,fields:kind==='workstation-tool'?{toolId,label:toolId==='ai'?'AI sessions':'Versions'}:kind==='editor'?{path:String(fields.path||'').slice(0,2048),expectedRootVersion:fields.rootVersion}:kind==='browser'?{initialUrl:fields.initialUrl}:kind==='release-notes'&&typeof fields.releaseId==='string'?{releaseId:fields.releaseId.slice(0,160),label:String(fields.label||'What’s New').slice(0,150)}:{label:labels[kind]}};
 if(receiver?.workspaceId===workspaceId)receiver.open(intent);else{pending=intent;showWorkspace();}return true;
}
export function registerWorkspaceTool(workspaceId,open){const entry={workspaceId,open};receiver=entry;if(pending){const saved=pending;pending=null;if(saved.workspaceId===workspaceId)open(saved);}return()=>{if(receiver===entry)receiver=null;};}

// Window-local capabilities, not persisted terminal IDs or inferred AI activity.
const targets=new Map();
export function registerCliReviewTarget(workspaceId,terminalId,metadata,review){const key=workspaceId+':'+terminalId,entry={workspaceId,terminalId,name:String(metadata.name||'AI CLI').slice(0,150),provider:metadata.provider,review};targets.set(key,entry);return()=>{if(targets.get(key)===entry)targets.delete(key);};}
export function cliReviewTargets(workspaceId){return [...targets.values()].filter(row=>row.workspaceId===workspaceId).map(({review,...row})=>row).slice(0,80);}
export function openCliReview(workspaceId,terminalId,source){const entry=targets.get(workspaceId+':'+terminalId);if(!entry)throw Error('This CLI is no longer available. Refresh the list.');entry.review(source);}

const fail=message=>{throw Object.assign(Error(message),{statusCode:400,code:'todo_resource_scope'});};
const sections=new Set(['overview','routes','projects','todos','resources','documents','updates']);
const tables={projects:'projects',tasks:'tasks',teams:'teams',documents:'documents',library:'outputs'};
const collectionLabels={workspace:'Workspace',projects:'Projects',tasks:'Routes',teams:'Areas',documents:'Documents',updates:'Updates',todos:'To Do List',library:'Outputs'};
export function resolveTodoPageResource(db,workspaceId,membership,value){
 const view=value.view==='areas'?'teams':value.view;if(!collectionLabels[view])fail('Choose a supported Frondose page.');
 const row=(table,id)=>db.prepare('SELECT * FROM '+table+' WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(id,workspaceId);
 let teamId=value.teamId||null,projectId=value.projectId||null,target=null;
 if(value.id){if(!tables[view])fail('Choose a collection rather than a missing item.');target=row(tables[view],value.id);if(!target)fail('This saved item is unavailable in this workspace.');if(view==='teams')teamId=target.id;else if(view==='projects')teamId=target.team_id||null;else{const project=target.project_id&&row('projects',target.project_id);if(target.project_id&&!project)fail('This item’s project is unavailable.');teamId=project?.team_id||target.team_id||null;}}
 if(projectId){const project=row('projects',projectId);if(!project||target&&target.project_id!==projectId)fail('Choose a matching current-workspace project.');teamId=project.team_id||null;}
 if(teamId&&!row('teams',teamId))fail('This Area is unavailable in this workspace.');
 if(membership.area_scope==='selected'&&(!teamId||!membership.team_ids.includes(teamId)))fail('Choose a resource or scoped tab from the selected Areas.');
 if(value.section&&(view!=='teams'||!target||!sections.has(value.section)))fail('Choose a supported Area tab.');
 const section=value.section||null,team=teamId&&row('teams',teamId);
 const label=target?(target.name||target.title)+(section?' · '+(section==='routes'?'Routes':section==='todos'?'To Do List':section[0].toUpperCase()+section.slice(1)):''):collectionLabels[view]+(team?' · '+team.name:'');
 return{kind:'page',view,id:target?.id||null,label:label.slice(0,200),...(teamId&&!target?{teamId}:{}),...(projectId?{projectId}:{}),...(section?{section}:{})};
}

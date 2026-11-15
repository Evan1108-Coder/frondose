export function resourceKey(resource) {
  if (['upload','todo'].includes(resource.kind)) return JSON.stringify([resource.kind,resource.id]);
  if (resource.kind === 'note') return JSON.stringify(['note',resource.text]);
  if (resource.kind === 'area-resource') return JSON.stringify(['area-resource', resource.teamId, resource.id]);
  if (resource.kind === 'file') return JSON.stringify(['file', resource.rootVersion, resource.path]);
  if (resource.kind === 'comment') return JSON.stringify(['comment', resource.rootVersion, resource.id]);
  if (resource.kind === 'tool') return JSON.stringify(['tool',resource.tool,resource.id]);
  if (resource.kind === 'page') return JSON.stringify(['page', resource.view, resource.id,resource.section||null,resource.teamId||null,resource.projectId||null]);
  return JSON.stringify(['url', resource.url]);
}

export function workspaceResourceOptions(data,workspaceId,query='',membership) {
 const needle=query.trim().toLocaleLowerCase(),selected=membership?.area_scope==='selected'?new Set(membership.team_ids||[]):null;
 const areaFor=(view,item)=>view==='teams'?item.id:view==='projects'?item.team_id:(data.projects||[]).find(project=>project.id===item.project_id)?.team_id||item.team_id;
 const items=[['projects','Project'],['tasks','Route'],['teams','Area'],['documents','Document']].flatMap(([view,type])=>(data[view]||[]).filter(item=>item.workspace_id===workspaceId&&!item.archived_at&&item.id&&(!selected||selected.has(areaFor(view,item)))).map(item=>({kind:'page',view,id:item.id,label:String(item.title||item.name||type).slice(0,200),type})));
 if(membership){for(const team of (data.teams||[]).filter(team=>team.workspace_id===workspaceId&&!team.archived_at&&(!selected||selected.has(team.id))))for(const [section,title]of [['routes','Routes'],['projects','Projects'],['todos','To Do List'],['resources','Resources'],['documents','Documents'],['updates','Updates']])items.push({kind:'page',view:'teams',id:team.id,section,label:(team.name+' · '+title).slice(0,200),type:'Area tab'});if(!selected)for(const[view,label]of[['tasks','Routes'],['projects','Projects'],['teams','Areas'],['documents','Documents'],['todos','To Do List'],['updates','Updates']])items.push({kind:'page',view,id:null,label,type:'Workspace tab'});}
 return items.filter(item=>!needle||(item.label+' '+item.type).toLocaleLowerCase().includes(needle)).sort((a,b)=>a.label.localeCompare(b.label));
}

export function todoResourceScopeQuery(value) {
  return {area_scope:value.area_scope, team_ids:JSON.stringify(value.team_ids || [])};
}
export function todoResourceOutsideAreas(resource, value) {
  return resource.kind === 'area-resource' && value.area_scope === 'selected' && !(value.team_ids || []).includes(resource.teamId);
}

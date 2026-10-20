import { createHash, randomUUID } from 'node:crypto';
import { isRecord, validationError, validateRecord, mergeSettings } from './validation.mjs';
import { guardRouteMutation, assertRouteLink, routeGraph, inspectRouteGraph, routeScope } from './route-hierarchy.mjs';
import { setRouteParent } from './sub-routes-service.mjs';
import { recordChange } from './workspace-features.mjs';
import { changeContext } from './change-context.mjs';
import { areaSettings, saveAreaSettings } from './area-service.mjs';
import { validTimezone } from '../src/lib/scheduled-time.js';
import { validApiModel } from '../src/lib/ai-provider-catalog.js';
import { captureSourceAccess, assertSourceAccess } from './context-source-access.mjs';
import { coordinationTarget, coordinationReference, coordinationTargetScope, createRunCoordination } from './run-coordination-service.mjs';

const stamp = () => new Date().toISOString();
const text = (max = 10000, minLength = 0) => ({ type: 'string', maxLength: max, minLength });
const date = { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] };
const ref = { anyOf: [text(200, 1), { type: 'null' }] };
const choice = values => ({ type: 'string', enum: values });
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const definitions = {
  projects: { label: 'Project', permission: 'projects', name: 'name', fields: { name: text(200, 1), description: text(), goal: text(), status: choice(['planned','active','paused','completed','cancelled','archived']), start_date: date, target_date: date }, scopes: { team_id: ref } },
  tasks: { label: 'Route', permission: 'routes', name: 'title', fields: { title: text(200, 1), description: text(), status: choice(['backlog','ready','in_progress','review','blocked','done','cancelled']), priority: choice(['no_priority','low','medium','high','urgent']), due_at: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] } }, scopes: { project_id: ref, team_id: ref, parent_task_id: ref } },
  documents: { label: 'Document', permission: 'documents', name: 'title', fields: { title: text(200, 1), content: text() }, scopes: { project_id: ref, team_id: ref } },
  milestones: { label: 'Milestone', permission: 'projects', name: 'title', fields: { title: text(200, 1), description: text(), status: choice(['planned','in_progress','completed']), target_date: date }, scopes: { project_id: text(200, 1) } },
  chats: { label: 'Chat', permission: 'chats', name: 'title', fields: { title: text(200, 1), pinned: { type: 'boolean' } }, scopes: { project_id: ref, task_id: ref } },
};
export const actionSettingsFields = { appearance: ['theme','density','reduceMotion','textSize','underlineLinks'], preferences: ['home','sendKey','weekStart'] };
const settingsSchemas = {
  appearance: { theme: choice(['dark','light','system']), density: choice(['compact','comfortable']), reduceMotion: { type:'boolean' }, textSize: choice(['standard','large']), underlineLinks:{type:'boolean'} },
  preferences: { home: choice(['overview','focus','inbox','projects','tasks','chats','agents']), sendKey:choice(['enter','modifier']), weekStart:choice(['monday','sunday']) },
};
export function actionCatalog() {
  const result = [];
  result.push({id:'coordination.handoff',type:'coordination.handoff',label:'Record a cross-conversation agent handoff (no launch)',review_required:true,execution:'local',direct_low_risk_eligible:true,schema:object({type:{const:'coordination.handoff'},target_chat_id:text(200,1),target_agent_id:text(200,1),content:text(10000,1)},['type','target_chat_id','target_agent_id','content'])});
  result.push({id:'agent.self_link',type:'agent.self_link',label:'Link this agent to an Area, project or Route',review_required:true,execution:'local',direct_low_risk_eligible:true,schema:object({type:{const:'agent.self_link'},resource:choice(['teams','projects','tasks']),id:text(200,1)},['type','resource','id'])});
  result.push({id:'schedule.create',type:'schedule.create',label:'Propose a scheduled agent prompt (confirmation required)',review_required:true,execution:'human_schedule_confirmation',schema:object({type:{const:'schedule.create'},chat_id:text(200,1),content:text(10000,1),model:text(120,1),run_at:text(40,1),timezone:text(100,1),recurrence:choice(['none','daily','weekly'])},['type','chat_id','content','model','run_at','timezone'])});
  result.push({id:'schedule.update',type:'schedule.update',label:'Propose pausing, rescheduling or cancelling your schedule',review_required:true,execution:'local',schema:object({type:{const:'schedule.update'},schedule_id:text(200,1),version:{type:'integer',minimum:1},state:choice(['active','paused','cancelled']),run_at:text(40,1),timezone:text(100,1)},['type','schedule_id','version','state'])});
  for (const [resource, def] of Object.entries(definitions)) {
    for (const kind of ['create','update','archive']) {
      const properties = { type: { const:`record.${kind}` }, resource: {const:resource} };
      const required = ['type','resource'];
      if (kind === 'create') { properties.fields = object({...def.fields,...def.scopes}, [def.name, ...(resource === 'milestones' ? ['project_id'] : [])]); required.push('fields'); }
      else { properties.id = text(200,1); required.push('id'); if (kind === 'update') { properties.patch = {...object(def.fields), minProperties:1}; required.push('patch'); } }
      result.push({ id:`record.${kind}:${resource}`, type:`record.${kind}`, resource, label:`${kind === 'create' ? 'Create' : kind === 'update' ? 'Edit' : 'Archive'} ${def.label}`, review_required:true, direct_low_risk_eligible:kind === 'create' && resource === 'tasks', execution:'local', schema:object(properties,required) });
    }
  }
  result.push({id:'chat.note',type:'chat.note',label:'Add local chat note',review_required:true,execution:'local',schema:object({type:{const:'chat.note'},chat_id:text(200,1),content:text(10000,1)},['type','chat_id','content'])});
  result.push({id:'memory.create',type:'memory.create',label:'Save agent-scoped reference memory',review_required:true,execution:'local',schema:object({type:{const:'memory.create'},title:text(160,1),content:text(10000,1)},['type','title','content'])});
  for (const [section,fields] of Object.entries(settingsSchemas)) result.push({id:`settings.update:${section}`,type:'settings.update',label:`Edit installation ${section}`,review_required:true,execution:'local',schema:object({type:{const:'settings.update'},section:{const:section},patch:{...object(fields),minProperties:1}},['type','section','patch'])});
  return result;
}
// Avoid repeating the full per-action JSON schemas in every provider prompt.
// This compact view is generated from the same enforced definitions.
const protocolCatalog = {
  records:Object.fromEntries(Object.entries(definitions).map(([resource,def]) => [resource,{required_name:def.name,editable_fields:def.fields,create_scope_fields:def.scopes}])),
  settings:settingsSchemas,
};
export const localActionProtocol = `Local reviewed action catalog: ${JSON.stringify(protocolCatalog)}. Forms: {"type":"record.create","resource":"projects|tasks|documents|milestones|chats","fields":{...editable_fields and create_scope_fields...}}; {"type":"record.update","resource":"...","id":"exact ID","patch":{...editable_fields only...}}; {"type":"record.archive","resource":"...","id":"exact ID"}; {"type":"chat.note","chat_id":"exact ID","content":"non-empty text up to 10000 characters"}; {"type":"memory.create","title":"non-empty text up to 160 characters","content":"non-empty text up to 10000 characters"}; {"type":"settings.update","section":"appearance|preferences","patch":{...declared settings fields...}}. Use exact accessible IDs. Route children use parent_task_id and must keep their parent's workspace/project/Area. Documents require exactly one project_id or team_id; milestones require project_id. No action starts an agent, sends a provider message, accepts output, publishes Knowledge, changes access policy or credentials, or enables a paused Plugin. chat.note writes a local note only. memory.create saves agent-scoped reference material, not published Knowledge. Dates can be null to clear them. Archive is recoverable but hides the item and always requires human review. Timed actions are scheduled explicitly by a human from an exact proposal, never by an agent action block.`;
const readSettings = db => Object.fromEntries(db.prepare('SELECT key,value_json FROM settings').all().map(row => [row.key,JSON.parse(row.value_json)]));
const active = (db,resource,id,workspaceId) => {
  if (typeof id !== 'string' || !id || id.length > 200) throw validationError('Use an exact bounded target ID.');
  const item = resource === 'workspaces' ? db.prepare('SELECT * FROM workspaces WHERE id=? AND archived_at IS NULL').get(id) : db.prepare(`SELECT * FROM ${resource} WHERE id=? AND workspace_id=? AND archived_at IS NULL`).get(id,workspaceId);
  if (!item) throw validationError('Action target is outside this workspace or unavailable.');
  return item;
};
function exactKeys(value, keys, required = []) {
  if (!isRecord(value) || Object.keys(value).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(value,key))) throw validationError('Unsupported or missing action fields.');
}
function checkFields(value, fields, required = []) {
  exactKeys(value,Object.keys(fields),required);
  for (const [key,val] of Object.entries(value)) {
    const schema = fields[key];
    const alternatives = schema.anyOf || [schema];
    if (!alternatives.some(item => val === null ? item.type === 'null' : item.type === 'string' ? typeof val === 'string' && val.length <= (item.maxLength || 100) && !val.includes('\0') && (!item.minLength || val.trim().length >= item.minLength) && (!item.enum || item.enum.includes(val)) : item.type === 'boolean' && typeof val === 'boolean')) throw validationError(`Invalid action field: ${key}.`);
  }
}
function parentsFor(db,record,workspaceId) {
  const parents = [];
  for (const [key,resource] of [['project_id','projects'],['team_id','teams'],['task_id','tasks'],['parent_task_id','tasks']]) if (record[key]) {
    const parent = active(db,resource,record[key],workspaceId); parents.push({resource,record:parent});
    if (parent.project_id) parents.push({resource:'projects',record:active(db,'projects',parent.project_id,workspaceId)});
    if (parent.team_id) parents.push({resource:'teams',record:active(db,'teams',parent.team_id,workspaceId)});
  }
  return [...new Map(parents.map(item => [`${item.resource}:${item.record.id}`,item])).values()];
}
function hierarchyFor(db,record) {
  const graph = routeGraph(db,record.workspace_id), task = graph.get(record.id);
  return task ? inspectRouteGraph(graph,task).sort((a,b) => a.id.localeCompare(b.id)) : [];
}
export function validateWorkspaceAgentLink(db,workspaceId,agentId,resource,id) {
  active(db,'workspaces',workspaceId,workspaceId);
  if (!['teams','projects','tasks'].includes(resource)) throw validationError('Unsupported agent link target.');
  if (typeof agentId !== 'string' || !agentId || agentId.length > 200) throw validationError('Choose an exact workspace agent ID.');
  if (db.prepare('SELECT 1 FROM agents WHERE id=? AND workspace_id IS NULL AND archived_at IS NULL').get(agentId)) throw Object.assign(validationError('Create a workspace profile in Agent Studio to add this shared identity here. Shared profiles are not workspace memberships.'),{statusCode:409,errorCode:'workspace_profile_required'});
  const agent = active(db,'agents',agentId,workspaceId), target = active(db,resource,id,workspaceId);
  const area = resource === 'teams' ? areaSettings(db,target) : null;
  const projectLinks = resource === 'projects' ? db.prepare('SELECT agent_id FROM agent_project_links WHERE workspace_id=? AND project_id=? ORDER BY agent_id').all(workspaceId,id).map(row=>row.agent_id) : null;
  const ids = area?.default_agent_ids || (resource === 'tasks' ? JSON.parse(target.assignee_agent_ids_json) : projectLinks || []);
  if (!ids.includes(agent.id) && ids.length >= 50) throw validationError('Target already has the maximum agent selections.');
  return {target,agent,area,projectLinks,parents:parentsFor(db,target,workspaceId)};
}
export function agentLinkPermissionTargets(before,resource) {
  const target = before.target, prefix = resource === 'teams' ? 'workspace' : definitions[resource].permission;
  const scope = resource === 'teams' ? {scope_type:'team',scope_id:target.id} : resource === 'projects' ? {scope_type:'project',scope_id:target.id} : routeScope(target);
  return [{permission:`${prefix}.read`,scope},{permission:`${prefix}.write`,scope},...['read','write'].map(verb=>({permission:`agents.${verb}`,scope:{scope_type:'agent',scope_id:before.agent.id}})),...before.parents.map(parent=>({permission:`${parent.resource === 'teams' ? 'workspace' : parent.resource === 'tasks' ? 'routes' : 'projects'}.read`,scope:parent.resource === 'teams' ? {scope_type:'team',scope_id:parent.record.id} : parent.resource === 'projects' ? {scope_type:'project',scope_id:parent.record.id} : routeScope(parent.record)}))];
}
export function applyWorkspaceAgentLink(db,before,resource) {
  if (!db.isTransaction) throw validationError('Agent linking requires an atomic transaction.');
  const {target,agent,area} = before, now = stamp();
  if (resource === 'teams') {
    if (area.default_agent_ids.includes(agent.id)) return target;
    const after = {...area,default_agent_ids:[...area.default_agent_ids,agent.id],version:area.version+1,updated_at:now};
    saveAreaSettings(db,after); recordChange(db,'area_settings',area,after,'agent link'); return target;
  }
  if (resource === 'projects') {
    const result = db.prepare('INSERT OR IGNORE INTO agent_project_links(workspace_id,project_id,agent_id,created_at) VALUES(?,?,?,?)').run(target.workspace_id,target.id,agent.id,now);
    // Project activity can be readable without agent-profile access. Keep the
    // exact identity in the separately filtered membership/action ledger.
    if (result.changes) recordChange(db,'projects',target,{...target,agent_association_changed:true},'agent link');
    return target;
  }
  const ids = JSON.parse(target.assignee_agent_ids_json);
  if (ids.includes(agent.id)) return target;
  db.prepare('UPDATE tasks SET assignee_agent_ids_json=?,updated_at=? WHERE id=?').run(JSON.stringify([...ids,agent.id]),now,target.id);
  const after = db.prepare('SELECT * FROM tasks WHERE id=?').get(target.id); recordChange(db,'tasks',target,after,'agent link'); return after;
}
export function validateLocalAction(db,input,workspaceId,{run} = {}) {
  if (!isRecord(input)) throw validationError('Invalid local action.');
  const workspace = active(db,'workspaces',workspaceId,workspaceId);
  if (run) {
    const canonical = db.prepare('SELECT * FROM runs WHERE id=?').get(run.id || '');
    if (!canonical || canonical.status !== 'completed' || canonical.workspace_id !== workspaceId || canonical.agent_id !== run.agent_id || canonical.project_id !== run.project_id) throw validationError('The action source run is unavailable or its scope changed.');
  }
  return validateWithWorkspace(db,input,workspaceId,workspace,{run});
}
const utcInstant = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19) === value.slice(0,19);
const scheduleSummary = row => ({id:row.id,workspace_id:row.workspace_id,creator_id:row.creator_id,kind:row.kind,title:row.title,state:row.state,version:row.version,timezone:row.timezone,recurrence:row.recurrence,next_due_at:row.next_due_at});

// Schedules belong to their authenticated creator, not everyone who can read
// the workspace. Preserve all original prompt/action source boundaries when
// even their title or timing is copied into a later reviewed agent context.
function scheduleReference(db,row) {
  const payload = JSON.parse(row.payload_json), review = JSON.parse(row.review_json);
  const resolved = {workspace_id:row.workspace_id}, included = [];
  if (row.kind === 'message') {
    resolved.chat_id = payload.chat_id;
    if (payload.agent_id) resolved.agent_id = payload.agent_id;
    if (review.chat?.project_id) resolved.project_id = review.chat.project_id;
    if (review.chat?.task_id) resolved.task_id = review.chat.task_id;
  } else {
    if (!review.run?.id || ['schedule.create','schedule.update'].includes(review.proposal?.type)) throw validationError('Schedule source unavailable.');
    included.push({kind:'run',id:review.run.id});
    const targetKind = {projects:'project',tasks:'route',documents:'document'}[review.proposal?.resource];
    if (targetKind && review.proposal.id) included.push({kind:targetKind,id:review.proposal.id});
    if (review.proposal?.resource === 'chats') resolved.chat_id = review.proposal.id;
    if (review.proposal?.resource === 'milestones' && review.proposal.id) resolved.project_id = db.prepare('SELECT project_id FROM milestones WHERE id=? AND workspace_id=?').get(review.proposal.id,row.workspace_id)?.project_id;
    if (review.proposal?.chat_id) resolved.chat_id = review.proposal.chat_id;
    const record = review.proposal?.fields || review.before;
    for (const [field,kind] of [['project_id','project'],['team_id','area'],['task_id','route'],['parent_task_id','route']]) if (record?.[field]) included.push({kind,id:record[field]});
    for (const parent of review.before?.parents || review.before?.__action_parents || []) {
      const kind = {projects:'project',teams:'area',tasks:'route'}[parent.resource];
      if (kind && parent.record?.id) included.push({kind,id:parent.record.id});
    }
  }
  if (review.schedule_proposal_id) {
    const original = db.prepare('SELECT run_id FROM agent_action_requests WHERE id=? AND workspace_id=?').get(review.schedule_proposal_id,row.workspace_id);
    if (!original) throw validationError('Schedule source unavailable.');
    included.push({kind:'run',id:original.run_id});
  }
  const inspection = {manifest:{resolved,included},sourceAccess:captureSourceAccess(db,{manifest:{resolved,included}})};
  if (review.inspection?.sourceAccess) {
    inspection.sourceAccess.sources.push(...review.inspection.sourceAccess.sources);
    inspection.sourceAccess.connections.push(...review.inspection.sourceAccess.connections);
  }
  return {inspection,payload,review};
}
function assertScheduleReadable(db,row,actor,allowed,capturedAccess) {
  if (!row || !actor?.id || row.creator_id !== actor.id || !allowed?.(row.workspace_id,actor,'workspace.read',{})) throw Object.assign(validationError('This schedule is unavailable.'),{statusCode:403});
  const reference = scheduleReference(db,row);
  assertSourceAccess(db,reference.inspection,actor,allowed);
  if (capturedAccess) assertSourceAccess(db,{manifest:{resolved:{workspace_id:row.workspace_id}},sourceAccess:capturedAccess},actor,allowed);
  if (row.kind === 'action') {
    const run = db.prepare('SELECT * FROM runs WHERE id=?').get(reference.review.run.id);
    if (!run || !localActionReadable(db,{proposal:reference.review.proposal,before:reference.review.before,workspaceId:row.workspace_id,run,actor,allowed})) throw Object.assign(validationError('This schedule is unavailable.'),{statusCode:403});
  }
  return reference;
}
export function scheduledWorkAgentContext(db,workspaceId,{actor,allowed} = {}) {
  const schedules = [], sourceAccess = {version:1,workspace_id:workspaceId,sources:[],connections:[]};
  if (!actor?.id || !allowed?.(workspaceId,actor,'workspace.read',{}) || !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scheduled_work'").get()) return {schedules,sourceAccess};
  for (const row of db.prepare("SELECT * FROM scheduled_work WHERE workspace_id=? AND creator_id=? AND state IN ('active','paused') ORDER BY next_due_at,id LIMIT 30").all(workspaceId,actor.id)) {
    try {
      const reference = assertScheduleReadable(db,row,actor,allowed);
      if (schedules.length >= 15 || sourceAccess.sources.length + reference.inspection.sourceAccess.sources.length > 750) continue;
      schedules.push({...scheduleSummary(row),chat_id:reference.payload.chat_id || null,agent_id:reference.payload.agent_id || null});
      sourceAccess.sources.push(...reference.inspection.sourceAccess.sources);
      sourceAccess.connections.push(...reference.inspection.sourceAccess.connections);
    } catch { /* Restricted or malformed schedules are absent, not placeholders. */ }
  }
  return {schedules,sourceAccess};
}
function validateWithWorkspace(db,input,workspaceId,workspace,{run} = {}) {
  if (input.type === 'coordination.handoff') {
    exactKeys(input,['type','target_chat_id','target_agent_id','content'],['type','target_chat_id','target_agent_id','content']);
    checkFields(input,{type:choice(['coordination.handoff']),target_chat_id:text(200,1),target_agent_id:text(200,1),content:text(10000,1)});
    if (!run?.id || !run?.agent_id || !run?.chat_id || Buffer.byteLength(input.content,'utf8') > 12000) throw validationError('Handoffs require a canonical conversation run and a message within 12 KB.');
    if (run.chat_id === input.target_chat_id && run.agent_id === input.target_agent_id) throw validationError('Choose another conversation or agent for a handoff.');
    const target = coordinationTarget(db,{workspaceId,chatId:input.target_chat_id,agentId:input.target_agent_id});
    return {proposal:{...input,content:input.content.trim()},before:{target,sourceAccess:coordinationReference(db,run,target).sourceAccess}};
  }
  if (input.type === 'schedule.create') {
    exactKeys(input,['type','chat_id','content','model','run_at','timezone','recurrence'],['type','chat_id','content','model','run_at','timezone']);
    checkFields(input,{type:choice(['schedule.create']),chat_id:text(200,1),content:text(10000,1),model:text(120,1),run_at:text(40,1),timezone:text(100,1),recurrence:choice(['none','daily','weekly'])});
    if (!run?.agent_id || !validApiModel(input.model) || !validTimezone(input.timezone) || !utcInstant(input.run_at)) throw validationError('Propose an explicit model, UTC instant and IANA timezone for a named source agent.');
    const agent = db.prepare('SELECT * FROM agents WHERE id=? AND archived_at IS NULL').get(run.agent_id);
    if (!agent || agent.workspace_id && agent.workspace_id !== workspaceId) throw validationError('Schedule source agent unavailable.');
    const currentChat = active(db,'chats',input.chat_id,workspaceId), parents = parentsFor(db,currentChat,workspaceId);
    // The completed provider reply itself advances chat.updated_at after
    // capture. A NEW context inspection reviews later history; structural chat
    // and parent scope changes must still invalidate this scheduling intent.
    const {updated_at,...chat} = currentChat;
    return {proposal:{...input,content:input.content.trim(),run_at:new Date(input.run_at).toISOString()},before:{chat,parents,agent}};
  }
  if (input.type === 'schedule.update') {
    exactKeys(input,['type','schedule_id','version','state','run_at','timezone'],['type','schedule_id','version','state']);
    checkFields({schedule_id:input.schedule_id,state:input.state,...(input.run_at !== undefined ? {run_at:input.run_at} : {}),...(input.timezone !== undefined ? {timezone:input.timezone} : {})},{schedule_id:text(200,1),state:choice(['active','paused','cancelled']),run_at:text(40,1),timezone:text(100,1)});
    if (!Number.isSafeInteger(input.version) || input.version < 1 || (input.run_at === undefined) !== (input.timezone === undefined) || input.run_at !== undefined && (!utcInstant(input.run_at) || !validTimezone(input.timezone))) throw validationError('Use the exact current schedule version and a UTC instant with its IANA zone when changing time.');
    const sponsor = run?.id && db.prepare('SELECT actor_id FROM agent_run_sponsors WHERE run_id=?').get(run.id);
    const row = sponsor && db.prepare("SELECT * FROM scheduled_work WHERE id=? AND workspace_id=? AND creator_id=? AND state IN ('active','paused')").get(input.schedule_id,workspaceId,sponsor.actor_id);
    if (!row) throw validationError('Choose one of the source sponsor’s available schedules.');
    if (row.version !== input.version) throw Object.assign(validationError('This schedule changed. Request a fresh proposal.'),{statusCode:409,errorCode:'stale_schedule'});
    return {proposal:{...input,...(input.run_at ? {run_at:new Date(input.run_at).toISOString()} : {})},before:{schedule:scheduleSummary(row),sourceAccess:scheduleReference(db,row).inspection.sourceAccess}};
  }
  if (input.type === 'agent.self_link') {
    exactKeys(input,['type','resource','id'],['type','resource','id']);
    if (!['teams','projects','tasks'].includes(input.resource) || !run?.agent_id) throw validationError('Self-link requires a canonical source agent and supported target.');
    return {proposal:{type:input.type,resource:input.resource,id:input.id},before:validateWorkspaceAgentLink(db,workspaceId,run.agent_id,input.resource,input.id)};
  }
  if (input.type?.startsWith('record.')) {
    const def = definitions[input.resource], creating = input.type === 'record.create', archiving = input.type === 'record.archive';
    if (!def || !['record.create','record.update','record.archive'].includes(input.type)) throw validationError('Unsupported record action.');
    exactKeys(input,creating ? ['type','resource','fields'] : archiving ? ['type','resource','id'] : ['type','resource','id','patch'],creating ? ['fields'] : ['id']);
    const target = creating ? null : active(db,input.resource,input.id,workspaceId);
    const fields = structuredClone(creating ? input.fields : archiving ? {} : input.patch);
    checkFields(fields,creating ? {...def.fields,...def.scopes} : def.fields,creating ? [def.name,...(input.resource === 'milestones' ? ['project_id'] : [])] : []);
    if (!creating && !archiving && !Object.keys(fields).length) throw validationError('Provide at least one editable field.');
    if (Object.hasOwn(fields,def.name)) fields[def.name] = fields[def.name].trim();
    let record = {...target,...fields,workspace_id:workspaceId};
    if (creating && input.resource === 'tasks') {
      if (record.parent_task_id) {
        const parent = active(db,'tasks',record.parent_task_id,workspaceId);
        for (const key of ['project_id','team_id']) { if (Object.hasOwn(fields,key) && (fields[key] || null) !== (parent[key] || null)) throw validationError('A sub-route must use its parent’s project and Area.'); fields[key] = parent[key] || null; }
      }
      if (fields.project_id) { const project = active(db,'projects',fields.project_id,workspaceId); if (fields.team_id && fields.team_id !== project.team_id) throw validationError('A Route uses its project’s Area.'); fields.team_id = project.team_id || null; }
      record = {...fields,id:`pending_${randomUUID()}`,workspace_id:workspaceId,status:fields.status || 'backlog'};
      assertRouteLink(db,record,fields.parent_task_id || null);
    }
    if (creating && input.resource === 'chats' && fields.task_id) {
      const task = active(db,'tasks',fields.task_id,workspaceId);
      if (Object.hasOwn(fields,'project_id') && (fields.project_id || null) !== (task.project_id || null)) throw validationError('A chat must use its Route’s project.');
      fields.project_id = task.project_id || null; record = {...fields,workspace_id:workspaceId};
    }
    const parents = parentsFor(db,record,workspaceId);
    validateRecord(db,input.resource,record,creating ? [def.name,...(input.resource === 'milestones' ? ['project_id'] : [])] : [],Object.keys({...def.fields,...def.scopes}).filter(key => key !== 'parent_task_id'));
    const hierarchy = input.resource === 'tasks' ? hierarchyFor(db,target || (fields.parent_task_id ? active(db,'tasks',fields.parent_task_id,workspaceId) : record)) : [];
    // Parent and hierarchy snapshots prevent an unchanged child row from
    // retaining authority after its surrounding scope has changed.
    const before = creating ? {workspace,parents,hierarchy} : {...target,__action_parents:parents,__action_hierarchy:hierarchy};
    return {proposal:creating ? {type:input.type,resource:input.resource,fields} : archiving ? {type:input.type,resource:input.resource,id:target.id} : {type:input.type,resource:input.resource,id:target.id,patch:fields},before};
  }
  if (input.type === 'chat.note') {
    exactKeys(input,['type','chat_id','content'],['chat_id','content']); checkFields({content:input.content},{content:text(10000,1)});
    const chat = active(db,'chats',input.chat_id,workspaceId), parents = parentsFor(db,chat,workspaceId);
    return {proposal:{type:'chat.note',chat_id:chat.id,content:input.content},before:{chat,parents}};
  }
  if (input.type === 'memory.create') {
    exactKeys(input,['type','title','content'],['title','content']); checkFields({title:input.title,content:input.content},{title:text(160,1),content:text(10000,1)});
    if (!run?.agent_id) throw validationError('Memory requires a named source agent.');
    const agent = db.prepare('SELECT * FROM agents WHERE id=? AND archived_at IS NULL').get(run.agent_id);
    if (!agent || agent.workspace_id && agent.workspace_id !== workspaceId) throw validationError('Memory source agent is unavailable.');
    if (run.project_id) active(db,'projects',run.project_id,workspaceId);
    return {proposal:{type:input.type,title:input.title.trim(),content:input.content},before:null};
  }
  if (input.type === 'settings.update') {
    exactKeys(input,['type','section','patch'],['section','patch']);
    if (!settingsSchemas[input.section]) throw validationError('Only presentation settings can be proposed.');
    checkFields(input.patch,settingsSchemas[input.section]); if (!Object.keys(input.patch).length) throw validationError('Provide a settings patch.');
    const current = readSettings(db); mergeSettings(current,{[input.section]:input.patch});
    return {proposal:structuredClone(input),before:current[input.section] || {}};
  }
  throw validationError('This action is outside the local action catalog.');
}

// Scope/permission requirements are reused by the sponsor, human reviewer and
// scheduler. Source-text IDs cannot grant access to the referenced scope.
export function actionPermissionTargets(db,proposal,workspaceId,{run} = {}) {
  const validated = validateLocalAction(db,proposal,workspaceId,{run});
  const p = validated.proposal;
  if (p.type === 'coordination.handoff') {
    const scope = coordinationTargetScope({sourceAccess:validated.before.sourceAccess},p.target_chat_id);
    return [{permission:'chats.read',scope},{permission:'chats.write',scope},{permission:'agents.run',scope},{permission:'agents.read',scope:{scope_type:'agent',scope_id:p.target_agent_id}}];
  }
  if (p.type === 'schedule.update') return [{permission:'workspace.read',scope:{}}];
  if (p.type === 'schedule.create') {
    const chat = validated.before.chat, scope = chat.project_id ? {scope_type:'project',scope_id:chat.project_id} : {};
    return [{permission:'chats.read',scope},{permission:'chats.write',scope},{permission:'agents.read',scope:{scope_type:'agent',scope_id:run.agent_id}},{permission:'agents.run',scope},...validated.before.parents.map(parent=>({permission:`${parent.resource === 'teams' ? 'workspace' : parent.resource === 'tasks' ? 'routes' : 'projects'}.read`,scope:parent.resource === 'teams' ? {scope_type:'team',scope_id:parent.record.id} : parent.resource === 'projects' ? {scope_type:'project',scope_id:parent.record.id} : routeScope(parent.record)}))];
  }
  if (p.type === 'agent.self_link') {
    return agentLinkPermissionTargets(validated.before,p.resource);
  }
  if (p.type === 'settings.update') return [{permission:'installation.settings',scope:{}}];
  if (p.type === 'memory.create') return ['agents.read','agents.write'].map(permission => ({permission,scope:run?.project_id ? {scope_type:'project',scope_id:run.project_id} : {}}));
  const resource = p.type === 'chat.note' ? 'chats' : p.resource;
  const item = p.type === 'record.create' ? p.fields : p.type === 'chat.note' ? validated.before.chat : validated.before;
  const scope = resource === 'projects' && p.type !== 'record.create' ? {scope_type:'project',scope_id:p.id} : item.project_id ? {scope_type:'project',scope_id:item.project_id} : item.team_id ? {scope_type:'team',scope_id:item.team_id} : item.task_id ? routeScope(active(db,'tasks',item.task_id,workspaceId)) : {};
  const requirements = [{permission:`${definitions[resource].permission}.read`,scope}, {permission:`${definitions[resource].permission}.${p.type === 'record.archive' ? 'delete' : 'write'}`,scope,resource,id:p.id || p.chat_id,method:p.type === 'record.create' || p.type === 'chat.note' ? 'POST' : p.type === 'record.archive' ? 'DELETE' : 'PATCH',body:p.fields || p.patch || {}}];
  const parents = validated.before?.parents || validated.before?.__action_parents || [];
  for (const parent of parents) requirements.push({permission:`${parent.resource === 'tasks' ? 'routes' : parent.resource === 'teams' ? 'workspace' : 'projects'}.read`,scope:parent.resource === 'projects' ? {scope_type:'project',scope_id:parent.record.id} : parent.resource === 'teams' ? {scope_type:'team',scope_id:parent.record.id} : routeScope(parent.record)});
  const hierarchy = validated.before?.hierarchy || validated.before?.__action_hierarchy || [];
  for (const task of hierarchy) requirements.push({permission:'routes.read',scope:routeScope(task)}, {permission:'routes.write',scope:routeScope(task)});
  return requirements;
}
export function authorizeLocalAction(db,{proposal,workspaceId,run,actors,allowed}) {
  if (!allowed || !Array.isArray(actors) || !actors.length || actors.some(actor => !actor?.id)) throw Object.assign(new Error('Authenticated action authority is required.'),{statusCode:403});
  const requirements = actionPermissionTargets(db,proposal,workspaceId,{run});
  if (proposal.type === 'coordination.handoff') {
    const validated = validateLocalAction(db,proposal,workspaceId,{run});
    for (const actor of actors) assertSourceAccess(db,{manifest:{resolved:{workspace_id:workspaceId}},sourceAccess:validated.before.sourceAccess},actor,allowed);
  }
  if (proposal.type === 'schedule.update') {
    const row = db.prepare('SELECT * FROM scheduled_work WHERE id=? AND workspace_id=?').get(proposal.schedule_id,workspaceId);
    for (const actor of actors) assertScheduleReadable(db,row,actor,allowed);
  }
  for (const actor of actors) for (const {permission,scope} of requirements) if (permission === 'installation.settings' ? actor.id !== 'local-owner' : !allowed(workspaceId,actor,permission,scope)) throw Object.assign(new Error('The action’s sponsor or reviewer no longer has target access.'),{statusCode:403});
}
export function assertActionFresh(before,current) {
  // Legacy update proposals predate parent/hierarchy snapshots. They retain
  // target-level staleness protection without acquiring extra authority.
  if (before && !Object.hasOwn(before,'__action_parents') && current?.__action_parents) { const {__action_parents,__action_hierarchy,...target} = current; current = target; }
  if (JSON.stringify(before) !== JSON.stringify(current)) throw Object.assign(validationError('The action target or its parent scope changed. Reject it and request a fresh proposal.'),{statusCode:409,errorCode:'stale_action'});
}

// History must protect both captured and current scopes, even after a target
// moves or becomes archived. Staleness does not itself hide a readable request.
export function localActionReadable(db,{proposal,before,workspaceId,run,actor,allowed}) {
  if (!actor?.id || !allowed || !isRecord(proposal)) return false;
  if (proposal.type === 'coordination.handoff') {
    try {
      assertSourceAccess(db,{manifest:{resolved:{workspace_id:workspaceId}},sourceAccess:before?.sourceAccess},actor,allowed);
      const target = coordinationTarget(db,{workspaceId,chatId:proposal.target_chat_id,agentId:proposal.target_agent_id});
      return assertSourceAccess(db,coordinationReference(db,run,target),actor,allowed) === true;
    } catch { return false; }
  }
  if (proposal.type === 'schedule.update') {
    try {
      const row = db.prepare('SELECT * FROM scheduled_work WHERE id=? AND workspace_id=?').get(proposal.schedule_id,workspaceId);
      assertScheduleReadable(db,row,actor,allowed,before?.sourceAccess);
      return before?.schedule?.creator_id === actor.id;
    } catch { return false; }
  }
  if (proposal.type === 'schedule.create') {
    if (before?.agent?.id !== run?.agent_id || !allowed(workspaceId,actor,'agents.read',{scope_type:'agent',scope_id:run.agent_id})) return false;
    return localActionReadable(db,{proposal:{type:'chat.note',chat_id:proposal.chat_id},before,workspaceId,run,actor,allowed});
  }
  if (proposal.type === 'agent.self_link') {
    if (!run?.agent_id || before?.agent?.id !== run.agent_id || before.agent.workspace_id !== workspaceId || !allowed(workspaceId,actor,'agents.read',{scope_type:'agent',scope_id:run.agent_id})) return false;
    const agent = db.prepare('SELECT workspace_id FROM agents WHERE id=?').get(run.agent_id);
    if (agent?.workspace_id !== workspaceId) return false;
    const nodes = [{resource:proposal.resource,record:before.target},...(before.parents || [])];
    for (const node of [...nodes]) {
      const current = db.prepare(`SELECT * FROM ${node.resource} WHERE id=? AND workspace_id=?`).get(node.record?.id,workspaceId);
      nodes.push({resource:node.resource,record:current});
      for (const [key,resource] of [['project_id','projects'],['team_id','teams']]) if (current?.[key]) nodes.push({resource,record:db.prepare(`SELECT * FROM ${resource} WHERE id=? AND workspace_id=?`).get(current[key],workspaceId)});
    }
    return nodes.every(({resource,record})=>record?.workspace_id === workspaceId && allowed(workspaceId,actor,`${resource === 'teams' ? 'workspace' : definitions[resource].permission}.read`,resource === 'teams' ? {scope_type:'team',scope_id:record.id} : resource === 'projects' ? {scope_type:'project',scope_id:record.id} : routeScope(record)));
  }
  if (proposal.type === 'settings.update') return actor.id === 'local-owner';
  if (proposal.type === 'memory.create') return allowed(workspaceId,actor,'agents.read',run?.project_id ? {scope_type:'project',scope_id:run.project_id} : {});
  const readable = (resource,item) => {
    if (!item || item.workspace_id !== workspaceId) return false;
    const prefix = resource === 'teams' ? 'workspace' : definitions[resource]?.permission;
    if (!prefix) return false;
    const scope = resource === 'projects' && item.id ? {scope_type:'project',scope_id:item.id} : resource === 'teams' ? {scope_type:'team',scope_id:item.id} : item.project_id ? {scope_type:'project',scope_id:item.project_id} : item.team_id ? {scope_type:'team',scope_id:item.team_id} : {};
    return allowed(workspaceId,actor,`${prefix}.read`,scope);
  };
  const nodes = [];
  const resource = proposal.type === 'chat.note' ? 'chats' : proposal.resource;
  if (!definitions[resource]) return false;
  const id = proposal.id || proposal.chat_id;
  if (id) {
    const current = db.prepare(`SELECT * FROM ${resource} WHERE id=? AND workspace_id=?`).get(id,workspaceId);
    nodes.push({resource,record:current},{resource,record:proposal.type === 'chat.note' ? before?.chat : before});
  } else nodes.push({resource,record:{...proposal.fields,workspace_id:workspaceId}});
  nodes.push(...(before?.parents || before?.__action_parents || []));
  for (const task of before?.hierarchy || before?.__action_hierarchy || []) nodes.push({resource:'tasks',record:task});
  for (const node of [...nodes]) {
    if (node.record?.id) nodes.push({resource:node.resource,record:db.prepare(`SELECT * FROM ${node.resource} WHERE id=? AND workspace_id=?`).get(node.record.id,workspaceId)});
    for (const [key,parentResource] of [['project_id','projects'],['team_id','teams'],['task_id','tasks']]) if (node.record?.[key]) nodes.push({resource:parentResource,record:db.prepare(`SELECT * FROM ${parentResource} WHERE id=? AND workspace_id=?`).get(node.record[key],workspaceId)});
  }
  return nodes.every(node=>readable(node.resource,node.record));
}

// The caller owns the durable receipt and transaction (reviewed proposal or
// scheduled-action ledger). Execution must occur in that same transaction;
// a claimed receipt prevents retries from applying updates twice.
export function executeLocalAction(db,{proposal,before,workspaceId,run,actor,actors = [actor],allowed,activeRunsFor = () => [],idempotencyKey,authorization = 'human_review',updateSchedule}) {
  if (proposal?.type === 'schedule.create') throw validationError('Prepare this schedule draft, inspect its exact prompt/model/context, and explicitly confirm it in Schedule. Approval alone never schedules paid work.');
  if (!db.isTransaction) throw validationError('Local actions require an atomic caller-owned receipt transaction.');
  if (typeof idempotencyKey !== 'string' || !idempotencyKey || idempotencyKey.length > 240) throw validationError('Provide a bounded stable action receipt key.');
  authorizeLocalAction(db,{proposal,workspaceId,run,actors,allowed});
  const validated = validateLocalAction(db,proposal,workspaceId,{run}); assertActionFresh(before,validated.before);
  const p = validated.proposal, now = stamp(), key = createHash('sha256').update(`${workspaceId}:${idempotencyKey}`).digest('hex').slice(0,32);
  const record = changeContext.run({actor,source:run ? `${authorization === 'actor_low_risk_policy' ? 'Agent direct action' : 'Agent proposal'} ${run.id}` : 'Scheduled human action'},() => {
    if (p.type === 'coordination.handoff') {
      return createRunCoordination(db,{runId:run.id,input:{request_id:idempotencyKey,kind:'handoff',target_chat_id:p.target_chat_id,target_agent_id:p.target_agent_id,content:p.content},actor,allowed,authorType:'agent'});
    }
    if (p.type === 'schedule.update') {
      if (typeof updateSchedule !== 'function' || authorization !== 'human_review') throw validationError('Schedule changes require explicit human confirmation through the canonical scheduler.');
      return updateSchedule(p,actor);
    }
    if (p.type === 'agent.self_link') {
      return applyWorkspaceAgentLink(db,validated.before,p.resource);
    }
    if (p.type === 'settings.update') {
      const settings = mergeSettings(readSettings(db),{[p.section]:p.patch});
      db.prepare('INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at').run(p.section,JSON.stringify(settings[p.section]),now);
      return {section:p.section};
    }
    if (p.type === 'memory.create') {
      const id = `memory_${key}`;
      db.prepare('INSERT INTO agent_memories(id,workspace_id,agent_id,project_id,title,content,source_run_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,workspaceId,run.agent_id,run.project_id || null,p.title,p.content,run.id,now,now);
      const after = db.prepare('SELECT * FROM agent_memories WHERE id=?').get(id); recordChange(db,'agent_memories',null,after,'agent-approved memory'); return after;
    }
    if (p.type === 'chat.note') {
      const id = `message_${key}`;
      const metadata = {origin:run ? 'reviewed_agent_proposal' : 'scheduled_human_action',source_run_id:run?.id || null,approved_by:actor.id,idempotency_key:idempotencyKey};
      db.prepare('INSERT INTO messages(id,chat_id,sender_type,sender_id,sender_name,content,kind,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,p.chat_id,'system',actor.id,run ? `${run.agent_name || 'Agent'} · reviewed note` : actor.name || 'Scheduled note',p.content,'note',JSON.stringify(metadata),now,now);
      db.prepare('UPDATE chats SET updated_at=? WHERE id=?').run(now,p.chat_id);
      const after = {...db.prepare('SELECT * FROM messages WHERE id=?').get(id),workspace_id:workspaceId}; recordChange(db,'messages',null,after,'reviewed local note'); return after;
    }
    if (p.type === 'record.create') {
      const id = `${p.resource.slice(0,-1)}_${key}`, fields = {...p.fields,workspace_id:workspaceId}; delete fields.parent_task_id;
      if (p.resource === 'projects') {
        const base = fields.name.replace(/[^A-Za-z]/g,'').slice(0,3).toUpperCase() || 'PRJ'; fields.identifier = base; let suffix = 2;
        while (db.prepare('SELECT 1 FROM projects WHERE workspace_id=? AND identifier=?').get(workspaceId,fields.identifier)) fields.identifier = `${base}${suffix++}`;
      }
      if (p.resource === 'tasks') fields.number = db.prepare('SELECT COALESCE(MAX(number),0)+1 n FROM tasks WHERE workspace_id=?').get(workspaceId).n;
      if (p.resource === 'chats') { fields.kind = fields.task_id ? 'task' : fields.project_id ? 'project' : 'general'; fields.pinned = Number(fields.pinned || false); }
      const names = Object.keys(fields);
      db.prepare(`INSERT INTO ${p.resource}(id,${names.join(',')},created_at,updated_at) VALUES(?,${names.map(() => '?').join(',')},?,?)`).run(id,...Object.values(fields),now,now);
      const after = db.prepare(`SELECT * FROM ${p.resource} WHERE id=?`).get(id);
      if (p.resource === 'tasks' && p.fields.parent_task_id) setRouteParent(db,after,p.fields.parent_task_id,{actor,allowed});
      recordChange(db,p.resource,null,after,authorization === 'actor_low_risk_policy' ? 'agent direct create' : 'agent-approved create'); return after;
    }
    if (activeRunsFor(p.resource,p.id).length) throw validationError('Stop linked active sessions before changing this item.');
    const patch = p.type === 'record.archive' ? {archived_at:now} : {...p.patch};
    if (['projects','tasks'].includes(p.resource) && Object.hasOwn(patch,'status') && patch.status !== validated.before.status) patch.workflow_status_id = null;
    if (p.resource === 'chats' && Object.hasOwn(patch,'pinned')) patch.pinned = Number(patch.pinned);
    if (p.resource === 'tasks') guardRouteMutation(db,validated.before,{...validated.before,...patch},{actor,allowed});
    db.prepare(`UPDATE ${p.resource} SET ${Object.keys(patch).map(field => `${field}=?`).join(',')},updated_at=? WHERE id=? AND workspace_id=?`).run(...Object.values(patch),now,p.id,workspaceId);
    const after = db.prepare(`SELECT * FROM ${p.resource} WHERE id=?`).get(p.id); const {__action_parents,__action_hierarchy,...target} = validated.before;
    recordChange(db,p.resource,target,after,p.type === 'record.archive' ? 'agent-approved archive' : 'agent-approved update'); return after;
  });
  return {status:'applied',type:p.type,resource:p.resource || (p.type === 'coordination.handoff' ? 'run_coordination' : p.type === 'schedule.update' ? 'scheduled_work' : p.type === 'chat.note' ? 'messages' : p.type === 'memory.create' ? 'agent_memories' : 'settings'),id:record.id || null,reviewed_by:authorization === 'actor_low_risk_policy' ? null : actor.id,...(authorization === 'actor_low_risk_policy' ? {authorized_by:actor.id,authorization} : {}),source_run_id:run?.id || null,...(p.type === 'coordination.handoff' ? {dispatched:false,target_chat_id:p.target_chat_id,target_agent_id:p.target_agent_id} : {})};
}

import { createHash } from 'node:crypto';
import { isRecord, validationError } from './validation.mjs';
import { validateSteps } from './coordination-service.mjs';
import { getReaction, normalizeReactionColor, reactionKey } from '../src/lib/reaction-catalog.js';
import { ACTIVITY_TARGET_TABLES } from './activity-policy.mjs';

export const EXTENSION_TABLES = ['route_workflows', 'outputs', 'output_versions', 'output_comments', 'output_reviews', 'context_snapshots', 'knowledge_entries', 'project_strategies', 'milestone_contracts', 'work_plans', 'route_schedules', 'activity_entries'];
export const EXTENSION_PARENTS = { route_workflows: 'tasks', project_strategies: 'projects', milestone_contracts: 'milestones' };
const error = message => validationError(`Cannot import workspace: ${message}`);
const txt = (value, max = 100000, fallback = '') => { value ??= fallback; if (typeof value !== 'string' || value.length > max) throw error('invalid text field.'); return value; };
const list = (value, max = 100) => { if (!Array.isArray(value) || value.length > max) throw error('invalid list.'); return value; };
const choice = (value, options) => { if (!options.includes(value)) throw error('invalid state or type.'); return value; };
const positive = value => { if (!Number.isInteger(value) || value < 1 || value > 100000) throw error('invalid version.'); return value; };
const timestamp = value => { if (value == null) return null; if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw error('invalid timestamp.'); return value; };
const checklist = value => { const seen = new Set(); return list(value).map(item => { if (!isRecord(item) || typeof item.done !== 'boolean' || !item.id || seen.has(item.id)) throw error('invalid acceptance criteria.'); seen.add(item.id); return { id: txt(item.id,100), text: txt(item.text,1000), done:item.done }; }); };
const hash = value => createHash('sha256').update(value).digest('hex');

// Runs, connections and permissions never come back to life during a restore.
// Imported approvals remain historical records; new outputs require review.
export function importExtensions(db, data, ids, workspaceId, stamp) {
  const collections = new Map(Object.entries(data).filter(([,rows]) => Array.isArray(rows)).map(([key,rows]) => [key, new Map(rows.map(row => [row.id,row]))]));
  const source = (table,id, required = false) => { if (!id && !required) return null; const item = collections.get(table)?.get(id); if (!item || !ids.has(id)) throw error(`missing ${table} reference.`); return item; };
  const ref = (table,id, required = false) => source(table,id,required) ? ids.get(id) : null;
  const insert = (table,row) => { const fields = Object.keys(row); db.prepare(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(()=>'?').join(',')})`).run(...Object.values(row)); };
  // Reactions/bookmarks belong to message identities, not display text. Restore
  // them only after remapping and validating ownership; never restore execution.
  const chatsSeen = new Set();
  for (const row of list(data.chat_collaboration ?? [], 10000)) {
    if (!isRecord(row) || chatsSeen.has(row.chat_id)) throw error('invalid conversation preferences.');
    chatsSeen.add(row.chat_id);
    const chatId = ref('chats', row.chat_id, true);
    const messageId = oldId => { const message = source('messages', oldId, true); if (message.chat_id !== row.chat_id) throw error('reaction or bookmark belongs to another conversation.'); return ids.get(oldId); };
    const bookmarks = list(row.bookmarks ?? [], 200).map(messageId);
    if (!isRecord(row.reactions ?? {})) throw error('invalid reactions.');
    const reactions = {};
    for (const [oldId, values] of Object.entries(row.reactions ?? {})) {
      const id = messageId(oldId), seen = new Set();
      reactions[id] = list(values, 24).map(value => {
        if (!isRecord(value)) throw error('invalid reaction.');
        let item = getReaction(value.id);
        if (typeof value.id === 'string' && value.id.startsWith('custom:')) {
          const original = source('workspace_items', value.id.slice(7), true);
          if (original.kind !== 'emoji') throw error('custom reaction must reference an emoji.');
          item = { id: `custom:${ids.get(original.id)}`, type: 'custom' };
        }
        const color = normalizeReactionColor(value.color);
        if (!item || color === undefined || item.type !== 'icon' && color !== null) throw error('unknown reaction or invalid icon color.');
        const result = { id: item.id, color, created_at: timestamp(value.created_at) || stamp };
        const key = reactionKey(result); if (seen.has(key)) throw error('duplicate reaction.'); seen.add(key); return result;
      });
    }
    insert('chat_collaboration', { chat_id: chatId, workspace_id: workspaceId, version: 1, payload_json: JSON.stringify({ bookmarks, reactions, drafts: [], branch: null }), updated_at: stamp });
  }
  for (const table of EXTENSION_TABLES) for (const row of data[table] ?? []) {
    let fields = { id: ids.get(row.id), workspace_id: workspaceId };
    const projectId = () => ref('projects',row.project_id);
    if (table === 'activity_entries') {
      const targetTable = ACTIVITY_TARGET_TABLES[row.target_type];
      if (!targetTable) throw error('unsupported activity target.');
      const target = source(targetTable, row.target_id, true);
      if (row.target_type === 'request' && target.kind !== 'request') throw error('activity request target is not a request.');
      const content = txt(row.content, 50000); if (!content.trim()) throw error('published updates need content.');
      fields = { ...fields, target_type: row.target_type, target_id: ref(targetTable, row.target_id, true), update_type: choice(row.update_type, ['progress','decision','blocker','risk','release','outcome','comment']), parent_id: null, actor_type: choice(row.actor_type, ['user','agent','system']), actor_id: null, actor_name: txt(row.actor_name,160) || 'Imported author', content, title: txt(row.title,200), health: choice(row.health || 'none',['none','on_track','at_risk','blocked']), publication_state:'published', published_at:timestamp(row.published_at) || timestamp(row.created_at) || stamp, imported:1, version:1, archived_at:timestamp(row.archived_at), created_at:timestamp(row.created_at) || stamp, updated_at:stamp };
    } else if (table === 'route_workflows') {
      source('tasks',row.id,true);
      const deps = list(row.dependency_ids), parent = ref('tasks',row.parent_task_id);
      if (deps.includes(row.id) || row.parent_task_id === row.id || new Set(deps).size !== deps.length) throw error('invalid route dependency.');
      fields = { ...fields, owner_name:txt(row.owner_name,120), reviewer_name:txt(row.reviewer_name,120), output_type:choice(row.output_type,['document','report','code_change','design','test_result','research','other']), parent_task_id:parent, acceptance_json:JSON.stringify(checklist(row.acceptance)), dependency_ids_json:JSON.stringify(deps.map(id=>ref('tasks',id,true))), version:1, updated_at:stamp };
    } else if (table === 'outputs') {
      const task = source('tasks',row.task_id), chat = source('chats',row.chat_id), message = source('messages',row.source_message_id);
      if (task && task.project_id !== row.project_id || chat && chat.project_id !== row.project_id || message && message.chat_id !== row.chat_id) throw error('output provenance does not match its project or conversation.');
      const versions = (data.output_versions ?? []).filter(v=>v.output_id === row.id);
      if (!versions.some(v=>v.number === row.current_version)) throw error('output is missing its current version.');
      fields = { ...fields, project_id:projectId(), task_id:ref('tasks',row.task_id), run_id:null, title:txt(row.title,200), kind:choice(row.kind,['document','report','code_change','design','test_result','research','other']), reviewer_name:txt(row.reviewer_name,120), state:'needs_review', current_version:positive(row.current_version), version:1, archived_at:timestamp(row.archived_at), created_at:stamp, updated_at:stamp, chat_id:ref('chats',row.chat_id), source_message_id:ref('messages',row.source_message_id) };
    } else if (table === 'output_versions') {
      fields = { ...fields, output_id:ref('outputs',row.output_id,true), number:positive(row.number), content:txt(row.content,200000), summary:txt(row.summary,2000), author_name:txt(row.author_name,120), created_at:timestamp(row.created_at) || stamp };
    } else if (table === 'output_comments' || table === 'output_reviews') {
      const version = source('output_versions',row.version_id,true);
      if (version.output_id !== row.output_id) throw error('review refers to another output’s version.');
      fields = { ...fields, output_id:ref('outputs',row.output_id,true), version_id:ref('output_versions',row.version_id,true), created_at:timestamp(row.created_at) || stamp };
      if (table === 'output_comments') { const anchor = txt(row.anchor,2000); if (anchor && !version.content.includes(anchor)) throw error('comment quote is absent from its version.'); fields = { ...fields, anchor, content:txt(row.content,10000), author_name:txt(row.author_name,120), resolved_at:timestamp(row.resolved_at) }; }
      else fields = { ...fields, decision:choice(row.decision,['approved','changes_requested']), reviewer_name:txt(row.reviewer_name,120), feedback:txt(row.feedback,20000), revision_task_id:ref('tasks',row.revision_task_id) };
    } else if (table === 'context_snapshots') {
      const content = txt(row.content,200000);
      const sources = list(row.sources).map(item => { if (!isRecord(item) || !['documents','memory_notes','knowledge_entries'].includes(item.type)) throw error('invalid context source.'); return { ...item, id:ref(item.type,item.id,true), title:txt(item.title,200), hash:txt(item.hash,128), updated_at:txt(item.updated_at,100) }; });
      fields = { ...fields, project_id:projectId(), name:txt(row.name,200), content, sources_json:JSON.stringify(sources), content_hash:hash(content), created_at:timestamp(row.created_at) || stamp };
    } else if (table === 'knowledge_entries') {
      const reviewDate = txt(row.review_date,10); if (reviewDate && (!/^\d{4}-\d{2}-\d{2}$/.test(reviewDate) || !Number.isFinite(Date.parse(reviewDate)) || new Date(reviewDate).toISOString().slice(0,10) !== reviewDate)) throw error('invalid knowledge review date.');
      fields = { ...fields, project_id:projectId(), title:txt(row.title,200), kind:choice(row.kind,['fact','decision','preference','instruction']), content:txt(row.content,50000), source:txt(row.source,2000), state:row.state === 'superseded' ? 'superseded' : 'draft', review_date:reviewDate, version:1, archived_at:timestamp(row.archived_at), created_at:stamp, updated_at:stamp };
    } else if (table === 'project_strategies') {
      source('projects',row.id,true);
      const concerns = list(row.concerns).map(item => { if (!isRecord(item)) throw error('invalid project concern.'); return { id:txt(item.id,100), kind:choice(item.kind,['risk','question']), content:txt(item.content,5000), owner:txt(item.owner,120), state:choice(item.state,['open','resolved']), resolution:txt(item.resolution,5000) }; });
      fields = { ...fields, ...Object.fromEntries(['audience','scope','success','exclusions','health_reason','retrospective'].map(key=>[key,txt(row[key],20000)])), health:choice(row.health,['on_track','at_risk','blocked','complete']), concerns_json:JSON.stringify(concerns), version:1, updated_at:stamp };
    } else if (table === 'milestone_contracts') {
      source('milestones',row.id,true); fields = { ...fields, acceptance_json:JSON.stringify(checklist(row.acceptance)), version:1, updated_at:stamp };
    } else if (table === 'route_schedules') {
      const day = txt(row.next_date,10); if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0,10) !== day || !Number.isInteger(row.interval_days) || row.interval_days < 1 || row.interval_days > 365) throw error('invalid repeat schedule.');
      fields = { ...fields, source_task_id:ref('tasks',row.source_task_id,true), name:txt(row.name,160), interval_days:row.interval_days, next_date:day, state:'paused', last_task_id:ref('tasks',row.last_task_id), generated_count:Number.isInteger(row.generated_count) && row.generated_count >= 0 ? row.generated_count : 0, version:1, created_at:stamp, updated_at:stamp };
    } else if (table === 'work_plans') {
      const previous = list(row.steps,40);
      const steps = validateSteps(db,workspaceId,projectId(),previous.map(step=>({ ...step, agent_id:ref('agents',step.agent_id), task_id:ref('tasks',step.task_id), brief:txt(step.brief,8000) + (step.summary ? `\n\nImported handoff (historical): ${txt(step.summary,1500)}` : '') })));
      fields = { ...fields, project_id:projectId(), title:txt(row.title,200), state:'paused', steps_json:JSON.stringify(steps), version:1, created_at:stamp, updated_at:stamp };
    }
    insert(table,fields);
  }
  for (const entry of data.activity_entries || []) {
    const seen = new Set([entry.id]); let current = entry;
    while (current.parent_id) {
      if (seen.has(current.parent_id) || seen.size >= 5) throw error('activity reply cycle or excessive depth.');
      seen.add(current.parent_id); current = source('activity_entries', current.parent_id, true);
      if (current.target_type !== entry.target_type || current.target_id !== entry.target_id) throw error('activity reply belongs to a different target.');
    }
    if (entry.parent_id) db.prepare('UPDATE activity_entries SET parent_id=? WHERE id=?').run(ref('activity_entries', entry.parent_id, true), ref('activity_entries', entry.id, true));
  }
  // Check both graphs after all rows have been imported, before the transaction commits.
  const workflows = new Map((data.route_workflows ?? []).map(row=>[row.id,row]));
  for (const parents of [true,false]) {
    const visiting = new Set(), visited = new Set();
    const visit = (id,depth=0) => { if (depth > 500 || visiting.has(id)) throw error('route dependency cycle or excessive depth.'); if (visited.has(id)) return; visiting.add(id); const row=workflows.get(id); for (const next of parents ? row?.parent_task_id ? [row.parent_task_id] : [] : row?.dependency_ids ?? []) visit(next,depth+1); visiting.delete(id); visited.add(id); };
    workflows.forEach((_,id)=>visit(id));
  }
}

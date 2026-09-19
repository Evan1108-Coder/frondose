import { parsePage, pageHash } from './navigation.js';
import { focusItems } from './organization.js';

export const EXPERIENCE_DEFAULTS = { groupAttention: 'reason', snoozeHours: 4, recentLimit: 12, includeCompleted: true };
const plain = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export function normalizeExperience(input) {
  const p = plain(input), options = plain(p.options);
  return {
    options: { groupAttention: options.groupAttention === 'project' ? 'project' : 'reason', snoozeHours: [1, 4, 24].includes(options.snoozeHours) ? options.snoozeHours : 4, recentLimit: [6, 12, 24].includes(options.recentLimit) ? options.recentLimit : 12, includeCompleted: options.includeCompleted !== false },
    recent: (Array.isArray(p.recent) ? p.recent : []).filter(i => typeof i?.hash === 'string' && i.hash === pageHash(parsePage(i.hash).view, parsePage(i.hash).id, parsePage(i.hash)) && Number.isFinite(i.at)).slice(0, 24),
    snoozed: Object.fromEntries(Object.entries(plain(p.snoozed)).filter(([k,v]) => k.length < 250 && Number.isFinite(v)).slice(-500)),
    followed: [...new Set((Array.isArray(p.followed) ? p.followed : []).filter(i => typeof i === 'string' && i.length < 250))].slice(0, 200),
    lastSeenAt: Number.isFinite(p.lastSeenAt) ? p.lastSeenAt : null,
  };
}
export function readExperience(storage, workspaceId) {
  try { return normalizeExperience(JSON.parse(storage.getItem(`rumbo.experience.${workspaceId}`))); } catch { return normalizeExperience(null); }
}
export function rememberPage(preferences, page, time = Date.now()) {
  if (['settings', 'docs'].includes(page.view)) return preferences;
  const hash = pageHash(page.view, page.id, page);
  const recent = [{ hash, at: time }, ...preferences.recent.filter(p => p.hash !== hash)].slice(0, 24);
  return { ...preferences, recent };
}
export function attentionItems(data, seenFailures = [], now = Date.now()) {
  const items = focusItems(data, seenFailures);
  for (const output of data.outputs ?? []) {
    if (output.archived_at || !['needs_review', 'changes_requested'].includes(output.state)) continue;
    items.push({ key: `output:${output.id}`, group: 'attention', reason: 'Review', view: 'library', id: output.id, title: output.title, detail: output.state === 'needs_review' ? 'Review this output version' : 'Changes requested', projectId: output.project_id });
  }
  for (const task of data.tasks ?? []) {
    if (task.archived_at || !task.due_at || ['done', 'cancelled'].includes(task.status) || Date.parse(task.due_at) >= now) continue;
    const existing = items.find(i => i.view === 'tasks' && i.id === task.id);
    if (existing) { existing.group = 'attention'; existing.detail += ' · Overdue'; }
    else items.push({ key: `overdue:${task.id}`, group: 'attention', reason: 'Overdue', view: 'tasks', id: task.id, title: task.title, detail: 'Past its due date', projectId: task.project_id });
  }
  return items;
}
export function describePage(data, page) {
  const collection = { memory: 'memory_notes', library: 'outputs', workbench: 'projects', work: 'runs', views: 'workspace_items' }[page.view] ?? page.view;
  const item = page.id && (data[collection] ?? []).find(i => i.id === page.id && !i.archived_at);
  if (page.id && !item && !['operations', 'library'].includes(page.view)) return null;
  return item?.title || item?.name || { overview: 'Home', work: 'Live work', tasks: 'Routes', workbench: 'Workbench', library: 'Library', operations: 'Coordination' }[page.view] || page.view.replace(/^./, c => c.toUpperCase());
}

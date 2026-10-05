import { val, visible } from "./model.js";
import { normalizeSidebarLayout } from './sidebar-layout.js';

export const NAV_ITEMS = [
  { id: "overview", label: "Today", key: "O" },
  { id: "rumbo-agent", label: "Rumbo Agent", key: "" },
  { id: "starred", label: "Starred", key: "Z" },
  { id: "focus", label: "Focus", key: "F" },
  { id: "inbox", label: "Inbox", key: "I" },
  { id: "updates", label: "Updates", key: "U" },
  { id: "work", label: "Runs", key: "W" },
  { id: "playbooks", label: "Playbooks", key: "Q" },
  { id: "workbench", label: "Workbench", key: "B" },
  { id: "operations", label: "Coordination", key: "D" },
  { id: "workflows", label: "Workflows", key: "Y" },
  { id: "library", label: "Knowledge", key: "L" },
  { id: "documents", label: "Documents", key: "J" },
  { id: "views", label: "Saved views", key: "V" },
  { id: "teams", label: "Areas", key: "T" },
  { id: "projects", label: "Projects", key: "P" },
  { id: "tasks", label: "Routes", key: "R" },
  { id: "chats", label: "Conversations", key: "C" },
  { id: "agents", label: "Agents", key: "A" },
  { id: "skills", label: "Skills", key: "K" },
  { id: "memory", label: "Memory", key: "M" },
  { id: "connections", label: "AI connections", key: "N" },
  { id: "settings", label: "Settings", key: "S" },
];
export const SIDEBAR_GROUPS = {
  primary: ["overview", "rumbo-agent", "starred", "focus", "inbox", "updates", "work", "playbooks", "workbench", "workflows", "operations"],
  sections: ["favorites", "agents", "teams", "projects", "workspace", "views", "chats"],
  tools: ["tasks", "skills", "library", "documents", "memory", "connections"],
};
export const SECTION_LABELS = { favorites: "Favorites", agents: "Agents", teams: "Areas", projects: "Projects", workspace: "Workspace", views: "Saved views", chats: "Conversations" };
export const FOCUSED_SIDEBAR_ROOT = new Set(['overview', 'rumbo-agent', 'starred', 'inbox', 'projects']);
export function focusedSidebarHiddenKeys(organization) {
  if (organization.navigationMode !== 'focused') return [];
  return organization.layout.root.filter(key => Object.values(SIDEBAR_GROUPS).flat().includes(key) && !FOCUSED_SIDEBAR_ROOT.has(key));
}
const FAVORITE_VIEWS = new Set(["projects", "teams", "tasks", "chats", "agents", "memory", "library", "work", "workbench", "documents", "views"]);
const ids = (input, allowed) => [...new Set([...(Array.isArray(input) ? input.filter(id => allowed.includes(id)) : []), ...allowed])];
const validString = value => typeof value === "string" && value.length > 0 && value.length < 513 && !/[\u0000-\u001f/\\]/.test(value);
export function favoriteKey(item) { return `${item.view}:${item.id}`; }
export function normalizeOrganization(value) {
  const input = value?.version === 1 ? value : {};
  const order = Object.fromEntries(Object.entries(SIDEBAR_GROUPS).map(([key, defaults]) => [key, ids(input.order?.[key], defaults)]));
  const visibility = Object.fromEntries(Object.values(SIDEBAR_GROUPS).flat().map(id => [id, ["always", "activity", "hidden"].includes(input.visibility?.[id]) ? input.visibility[id] : id === "favorites" ? "activity" : "always"]));
  visibility['rumbo-agent'] = 'always';
  const favorites = [], seen = new Set();
  for (const item of Array.isArray(input.favorites) ? input.favorites.slice(0, 100) : []) {
    if (!FAVORITE_VIEWS.has(item?.view) || !validString(item.id) || seen.has(favoriteKey(item))) continue;
    seen.add(favoriteKey(item)); favorites.push({ view: item.view, id: item.id });
  }
  const hiddenItems = [], hiddenSeen = new Set();
  for (const item of Array.isArray(input.hiddenItems) ? input.hiddenItems.slice(0, 500) : []) {
    if (!['projects', 'teams', 'agents', 'chats', 'views'].includes(item?.view) || !validString(item.id) || hiddenSeen.has(favoriteKey(item))) continue;
    hiddenSeen.add(favoriteKey(item)); hiddenItems.push({ view: item.view, id: item.id });
  }
  const layout = normalizeSidebarLayout(input.layout, order);
  for (const group of layout.groups) visibility[group.id] = input.visibility?.[group.id] === 'hidden' ? 'hidden' : 'always';
  const pinnedLayout = (Array.isArray(input.pinnedLayout) ? input.pinnedLayout : []).filter(id => Object.values(SIDEBAR_GROUPS).flat().includes(id) || layout.groups.some(g => g.id === id));
  const entityOrder = Object.fromEntries(['projects', 'teams', 'agents', 'chats'].map(view => [view, [...new Set((Array.isArray(input.entityOrder?.[view]) ? input.entityOrder[view] : []).filter(validString))].slice(0, 500)]));
  return { version: 1, order, visibility, favorites, hiddenItems, pinnedLayout, entityOrder, layout,
    navigationMode: input.navigationMode === 'focused' || input.navigationMode === 'full' ? input.navigationMode : value?.version === 1 ? 'full' : 'focused',
    badges: ["count", "dot", "none"].includes(input.badges) ? input.badges : "count",
    density: input.density === "compact" ? "compact" : "comfortable",
    shortcuts: input.shortcuts !== false,
    seenFailures: [...new Set((Array.isArray(input.seenFailures) ? input.seenFailures : []).filter(validString))].slice(-200),
  };
}
export function isSidebarHidden(preferences, view, id) {
  return (preferences.hiddenItems ?? []).some(item => item.view === view && item.id === id);
}
export function readOrganization(storage, workspaceId) {
  try { return normalizeOrganization(JSON.parse(storage.getItem(`rumbo.organization.v1.${workspaceId}`))); }
  catch { return normalizeOrganization(null); }
}
export function saveOrganization(storage, workspaceId, value) {
  storage.setItem(`rumbo.organization.v1.${workspaceId}`, JSON.stringify(normalizeOrganization(value)));
}
export function moveItem(items, id, offset) {
  const next = [...items], from = next.indexOf(id), to = from + offset;
  if (from < 0 || to < 0 || to >= next.length) return next;
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
export function placeSidebarItem(items, source, target) {
  if (source === target || !items.includes(source) || !items.includes(target)) return [...items];
  const next = items.filter(id => id !== source);
  next.splice(items.indexOf(target), 0, source);
  return next;
}
export function sortSidebarEntities(items, order = []) {
  const positions = new Map(order.map((id, index) => [id, index]));
  return [...items].sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity));
}
export function resolveFavorite(data, reference) {
  if (!FAVORITE_VIEWS.has(reference?.view)) return null;
  const collection = { memory: "memory_notes", library: "outputs", work: "runs", workbench: "projects", views: 'workspace_items' }[reference.view] ?? reference.view;
  const item = visible(data?.[collection]).find(item => item.id === reference.id && (reference.view !== 'views' || item.kind === 'saved_view'));
  return item ? { ...reference, title: item.name || item.title, item } : null;
}
export function favoriteForPage(data, page) {
  return page.id ? resolveFavorite(data, { view: page.view, id: page.id }) : null;
}
export const runningStatuses = new Set(["queued", "starting", "running", "needs_input", "paused"]);
export function focusItems(data, seenFailures = []) {
  const items = [], seen = new Set(seenFailures);
  const projects = new Map(visible(data.projects).map(p => [p.id, p]));
  const teams = new Set(visible(data.teams).map(t => t.id));
  const available = item => {
    const projectId = val(item, "project_id"), teamId = val(item, "team_id"), projectTeam = val(projects.get(projectId), "team_id");
    return (!projectId || projects.has(projectId)) && (!teamId || teams.has(teamId)) && (!projectTeam || teams.has(projectTeam));
  };
  const runs = new Map(visible(data.runs).filter(available).map(run => [run.id, run]));
  const approvals = new Set();
  for (const approval of data.approvals ?? []) {
    const run = runs.get(val(approval, "run_id"));
    if (approval.status !== "pending" || !run || !runningStatuses.has(run.status)) continue;
    approvals.add(run.id);
    items.push({ key: `approval:${approval.id}`, group: "attention", view: "work", id: run.id, title: run.title, detail: "Permission request · review before approving", status: "needs_input", projectId: val(run, "project_id") });
  }
  for (const run of runs.values()) {
    if (approvals.has(run.id)) continue;
    if (run.status === "failed" && seen.has(run.id)) continue;
    const group = ["needs_input", "failed", "paused"].includes(run.status) ? "attention" : runningStatuses.has(run.status) ? "running" : null;
    if (group) items.push({ key: `run:${run.id}`, group, view: "work", id: run.id, title: run.title, detail: run.status === "failed" ? "Session failed · inspect the result" : run.status === "paused" ? "Session paused" : "Agent session", status: run.status, projectId: val(run, "project_id"), dismissible: run.status === "failed" });
  }
  for (const task of visible(data.tasks).filter(available)) {
    const group = ["blocked", "review"].includes(task.status) ? "attention" : task.status === "ready" ? "ready" : null;
    if (group) items.push({ key: `task:${task.id}`, group, view: "tasks", id: task.id, title: task.title, detail: task.status === "blocked" ? "Route blocked · unblock the next step" : task.status === "review" ? "Route ready for review" : "Ready to assign or start", status: task.status, projectId: val(task, "project_id") });
  }
  return items;
}
export function organizationCounts(data, preferences) {
  const items = focusItems(data, preferences.seenFailures);
  return { overview: 0, starred: preferences.favorites.filter(f => resolveFavorite(data, f)).length, focus: items.filter(i => i.group === "attention").length,
    inbox: (data.approvals ?? []).filter(a => a.status === "pending").length,
    work: (data.runs ?? []).filter(r => runningStatuses.has(r.status)).length,
    workbench: visible(data.projects).length,
    library: visible(data.outputs ?? []).length,
    documents: visible(data.documents ?? []).length,
    views: (data.workspace_items ?? []).filter(i => i.kind === 'saved_view' && !i.archived_at).length,
    operations: (data.workspace_items ?? []).filter(i => !i.archived_at && ['queue', 'handoff', 'request'].includes(i.kind)).length,
    favorites: preferences.favorites.filter(f => resolveFavorite(data, f)).length,
    agents: visible(data.agents).length, teams: visible(data.teams).length, projects: visible(data.projects).length,
    workspace: visible(data.tasks).filter(t => t.status !== "done").length + visible(data.memory_notes).length,
    tasks: visible(data.tasks).filter(t => ["blocked", "review"].includes(t.status)).length,
    chats: visible(data.chats).length, memory: visible(data.memory_notes).length,
    connections: (data.connections ?? []).filter(c => ["probe_failed", "error"].includes(c.state)).length };
}
export function showSidebarItem(id, preferences, counts) {
  return preferences.visibility[id] === "always" || preferences.visibility[id] === "activity" && (counts[id] ?? 0) > 0;
}

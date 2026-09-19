import { byUpdated, val, visible } from "./model.js";

export const MILESTONE_STATUSES = {
  planned: "Planned",
  in_progress: "In progress",
  completed: "Completed",
};

export function teamProjects(data, teamId) {
  return visible(data.projects).filter((project) => val(project, "team_id") === teamId);
}

export function teamRoutes(data, teamId) {
  const projectIds = new Set(teamProjects(data, teamId).map((project) => project.id));
  return visible(data.tasks).filter((route) => val(route, "team_id") === teamId || projectIds.has(val(route, "project_id")));
}

export function ownerDocuments(data, { projectId, teamId }, archived = false) {
  return (data.documents ?? []).filter((document) =>
    (projectId ? val(document, "project_id") === projectId : val(document, "team_id") === teamId && !val(document, "project_id")) &&
    Boolean(val(document, "archived_at")) === archived,
  ).toSorted(byUpdated);
}

/** A factual summary of current records, not a fabricated change log. */
export function projectActivity(data, projectId) {
  const runs = (data.runs ?? []).filter((run) => val(run, "project_id") === projectId);
  const runIds = new Set(runs.map((run) => run.id));
  return [
    ...visible(data.tasks).filter((item) => val(item, "project_id") === projectId).map((item) => ({ id: `route-${item.id}`, type: "route", title: item.title, detail: item.status === "done" ? "Route completed" : "Route updated", at: val(item, "updated_at"), target: item.id })),
    ...visible(data.chats).filter((item) => val(item, "project_id") === projectId).map((item) => ({ id: `chat-${item.id}`, type: "chat", title: item.title, detail: "Conversation updated", at: val(item, "updated_at"), target: item.id })),
    ...visible(data.documents).filter((item) => val(item, "project_id") === projectId).map((item) => ({ id: `document-${item.id}`, type: "document", title: item.title, detail: "Document updated", at: val(item, "updated_at"), target: item.id })),
    ...(data.events ?? []).filter((item) => runIds.has(val(item, "run_id"))).map((item) => ({ id: `event-${item.id}`, type: "work", title: item.summary || item.type || "Session update", detail: "Agent work", at: val(item, "created_at"), target: val(item, "run_id") })),
  ].sort((a, b) => new Date(b.at ?? 0) - new Date(a.at ?? 0));
}

export function documentFilename(title) {
  return `${(title || "Untitled document").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim() || "Document"}.md`;
}

export function validateProjectDates(start, target) {
  if (start && target && start > target) return "Target date must be on or after the start date.";
  return null;
}

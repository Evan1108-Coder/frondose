export const STATUSES = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In progress",
  review: "In review",
  blocked: "Blocked",
  done: "Done",
};
export const PRIORITIES = {
  no_priority: "No priority",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};
export const PROJECT_STATUSES = {
  planned: "Planned",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
};
export const RUN_STATUSES = {
  queued: "Queued",
  starting: "Starting",
  running: "Running",
  needs_input: "Needs input",
  completed: "Completed",
  stopped: "Stopped",
  failed: "Failed",
};
export const activeRun = (run) =>
  ["queued", "starting", "running", "needs_input"].includes(run?.status);
export const val = (
  item,
  snake,
  camel = snake.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
) => item?.[snake] ?? item?.[camel];
export const visible = (items) =>
  (items ?? []).filter((item) => !val(item, "archived_at"));
export const initials = (name = "You") =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
export function relative(value) {
  if (!value) return "Just now";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return "—";
  if (ms < 60000) return "Just now";
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  if (ms < 604800000) return `${Math.floor(ms / 86400000)}d ago`;
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
export const dateLabel = (value) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "No due date";
export const byUpdated = (a, b) =>
  new Date(val(b, "updated_at") ?? 0) - new Date(val(a, "updated_at") ?? 0);
export function progress(project, tasks) {
  const routes = visible(tasks).filter(
    (task) => val(task, "project_id") === project.id,
  );
  const done = routes.filter((task) => task.status === "done").length;
  return {
    total: routes.length,
    done,
    percent: routes.length ? Math.round((done / routes.length) * 100) : 0,
  };
}
export function download(name, content, type = "application/json") {
  const url = URL.createObjectURL(
    new Blob(
      [
        typeof content === "string"
          ? content
          : JSON.stringify(content, null, 2),
      ],
      { type },
    ),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const safeUrl = (value) => {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};
export function activityItems(data) {
  return [
    ...(data.events ?? []).map((event) => ({
      id: event.id,
      type: "work",
      title: event.summary,
      time: val(event, "created_at"),
      target: val(event, "run_id"),
    })),
    ...visible(data.tasks).map((task) => ({
      id: task.id,
      type: "tasks",
      title: task.status === "done" ? `Completed ${task.title}` : task.title,
      detail: STATUSES[task.status],
      time: val(task, "updated_at"),
      target: task.id,
    })),
    ...visible(data.chats).map((chat) => ({
      id: chat.id,
      type: "chats",
      title: chat.title,
      detail: "Conversation updated",
      time: val(chat, "updated_at"),
      target: chat.id,
    })),
  ].sort((a, b) => new Date(b.time) - new Date(a.time));
}

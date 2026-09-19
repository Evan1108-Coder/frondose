import { NAV_ITEMS } from "./organization.js";

export const CREATE_SHORTCUTS = [
  ["r", "task", "route"], ["p", "project", "project"], ["t", "team", "team"],
  ["c", "chat", "chat"], ["a", "agent", "agent"], ["m", "memory", "memory note"], ["s", "session", "session"],
];
export const SHORTCUTS = [
  { id: "search", label: "Search and commands", keys: "⌘ / Ctrl K", group: "Essentials" },
  { id: "history:back", label: "Back within this workspace", keys: "⌘ / Ctrl [", group: "Navigate" },
  { id: "history:forward", label: "Forward within this workspace", keys: "⌘ / Ctrl ]", group: "Navigate" },
  { id: "sidebar", label: "Collapse or expand sidebar", keys: "[", group: "Essentials" },
  { id: "favorite", label: "Favorite the current item", keys: "F", group: "Essentials" },
  { id: "customize", label: "Customize sidebar", keys: "Shift B", group: "Essentials" },
  { id: "help", label: "Keyboard shortcuts", keys: "?", group: "Essentials" },
  { id: "close", label: "Close dialog / cancel shortcut", keys: "Esc", group: "Essentials" },
  ...CREATE_SHORTCUTS.map(([key, kind, label]) => ({ id: `create:${kind}`, label: `Create ${label}`, keys: `N ${key.toUpperCase()}${kind === "task" ? " / C" : ""}`, group: "Create" })),
  ...NAV_ITEMS.map(item => ({ id: `go:${item.id}`, label: `Go to ${item.label.toLowerCase()}`, keys: `G ${item.key}`, group: "Navigate" })),
];

/** No DOM or side effects: inputs include editor/modal state and a short-lived chord. */
export function resolveShortcut(event, { editing = false, overlay = false, paletteOpen = false, enabled = true, prefix = null, now = Date.now() } = {}) {
  const key = event.key?.toLowerCase();
  if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey) return { prefix: null };
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && key === "k" && (!overlay || paletteOpen)) return { action: "search", prefix: null };
  if (editing || overlay || event.metaKey || event.ctrlKey) return { prefix: null };
  if (key === "escape") return { action: "cancel", prefix: null };
  if (!enabled) return { prefix: null };
  if (prefix && now - prefix.at < 1000) {
    const item = prefix.key === "g" ? NAV_ITEMS.find(item => item.key.toLowerCase() === key) : CREATE_SHORTCUTS.find(item => item[0] === key);
    return { action: item ? prefix.key === "g" ? `go:${item.id}` : `create:${item[1]}` : undefined, prefix: null, consumed: true };
  }
  if (!event.shiftKey && ["g", "n"].includes(key)) return { prefix: { key, at: now }, consumed: true };
  const action = key === "?" ? "help" : event.shiftKey && key === "b" ? "customize" : !event.shiftKey ? ({ c: "create:task", f: "favorite", "[": "sidebar", "/": "search" })[key] : undefined;
  return { action, prefix: null };
}

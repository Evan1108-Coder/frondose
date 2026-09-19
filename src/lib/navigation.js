const VIEWS = new Set([
  "overview", "inbox", "projects", "tasks", "chats", "work", "memory",
  "agents", "connections", "settings", "teams", "focus", "workbench", "library", "operations", "documents", "views",
]);
const SCOPED_VIEWS = new Set(["tasks", "chats", "memory", "workbench", "library", "operations", "documents"]);
const home = () => ({ view: "overview", id: null, projectId: null });
const TEAM_SECTIONS = new Set(['overview', 'routes', 'projects', 'resources', 'documents', 'people']);

function validId(value) {
  return typeof value === "string" && value.length > 0 &&
    value.length <= 512 && !/[\/\\\u0000-\u001f\u007f]/.test(value) &&
    value !== "." && value !== "..";
}

/** Parse only Rumbo's hash routes, not arbitrary URLs or nested paths. */
export function parsePage(hash = "") {
  if (typeof hash !== "string") return home();
  try {
    const route = hash.replace(/^#/, "").replace(/^\//, "");
    if (route.includes("#")) return home();
    const queryIndex = route.indexOf("?");
    const path = queryIndex < 0 ? route : route.slice(0, queryIndex);
    const query = queryIndex < 0 ? "" : route.slice(queryIndex + 1);
    const parts = path.split("/");
    if (parts.length > 2 || !VIEWS.has(parts[0])) return home();
    const view = parts[0];
    const id = parts.length === 2 ? decodeURIComponent(parts[1]) : null;
    if (id !== null && !validId(id)) return home();
    // URLSearchParams repairs malformed encoding; reject it instead.
    decodeURIComponent(query.replace(/\+/g, " "));
    const params = new URLSearchParams(query);
    const scopes = params.getAll("project");
    if (scopes.length > 1 || (scopes.length && !validId(scopes[0])))
      return home();
    const projectId = SCOPED_VIEWS.has(view) ? scopes[0] ?? null : null;
    const messages = params.getAll('message');
    if (messages.length > 1 || messages.length && !validId(messages[0])) return home();
    const sections = params.getAll('section');
    if (sections.length > 1 || (sections.length && !TEAM_SECTIONS.has(sections[0]))) return home();
    return { view, id, projectId, ...(view === 'teams' && id && sections.length ? { section: sections[0] } : {}), ...(view === 'chats' && id && messages.length ? { messageId: messages[0] } : {}) };
  } catch {
    return home();
  }
}

/** Build a canonical hash while preserving a project-scoped list or detail. */
export function pageHash(view, id = null, { projectId = null, messageId = null, section = null } = {}) {
  if (!VIEWS.has(view)) return "#/overview";
  if (id !== null && !validId(id)) throw new TypeError("Invalid page identifier");
  if (projectId !== null && !validId(projectId))
    throw new TypeError("Invalid project identifier");
  const path = `#/${view}${id === null ? "" : `/${encodeURIComponent(id)}`}`;
  if (messageId !== null && !validId(messageId)) throw new TypeError('Invalid message identifier');
  const query = new URLSearchParams();
  if (section && view === 'teams' && id) {
    if (!TEAM_SECTIONS.has(section)) throw new TypeError('Invalid team section');
    query.set('section', section);
  }
  if (projectId && SCOPED_VIEWS.has(view)) query.set('project', projectId);
  if (messageId && view === 'chats' && id) query.set('message', messageId);
  return `${path}${query.size ? `?${query}` : ''}`;
}

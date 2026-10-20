const VIEWS = new Set([
  "overview", "rumbo-agent", "starred", "inbox", "projects", "tasks", "chats", "work", "memory",
  "agents", "connections", "settings", "teams", "focus", "workbench", "library", "operations", "documents", "views", "docs", "reader", "updates", "skills", "workflows",
]);
const SCOPED_VIEWS = new Set(["tasks", "chats", "memory", "workbench", "library", "operations", "documents", "updates"]);
const home = () => ({ view: "overview", id: null, projectId: null });
const TEAM_SECTIONS = new Set(['overview', 'routes', 'projects', 'agents', 'resources', 'documents', 'updates', 'people', 'settings']);
const ASSISTANT_SECTIONS = new Set(['conversation', 'activity', 'scheduled']);
const VIEW_ALIASES = { 'frondose-agent': 'rumbo-agent', 'talvori-agent': 'rumbo-agent', areas: 'teams', today: 'overview', conversations: 'chats', knowledge: 'library', runs: 'work' };

function validId(value) {
  return typeof value === "string" && value.length > 0 &&
    value.length <= 512 && !/[\/\\\u0000-\u001f\u007f]/.test(value) &&
    value !== "." && value !== "..";
}

/** Parse only Frondose's hash routes, not arbitrary URLs or nested paths. */
export function parsePage(hash = "") {
  if (typeof hash !== "string") return home();
  try {
    const route = hash.replace(/^#/, "").replace(/^\//, "");
    if (route.includes("#")) return home();
    const queryIndex = route.indexOf("?");
    const path = queryIndex < 0 ? route : route.slice(0, queryIndex);
    const query = queryIndex < 0 ? "" : route.slice(queryIndex + 1);
    const parts = path.split("/");
    const view = VIEW_ALIASES[parts[0]] || parts[0];
    if (parts.length > 2 || !VIEWS.has(view) && view !== 'playbooks') return home();
    let id = parts.length === 2 ? decodeURIComponent(parts[1]) : null;
    if (view === 'settings' && ['frondose-agent', 'talvori-agent'].includes(id)) id = 'rumbo-agent';
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
    const reviews = params.getAll('review');
    if (reviews.length > 1 || reviews.length && !validId(reviews[0])) return home();
    const returns = params.getAll('from');
    if (returns.length > 1 || returns.length && !validReturn(returns[0])) return home();
    const coordinationRuns = params.getAll('coordinationRun'), coordinationItems = params.getAll('coordination');
    if (coordinationRuns.length > 1 || coordinationItems.length > 1 || coordinationRuns.length !== coordinationItems.length || [...coordinationRuns,...coordinationItems].some(value=>!validId(value))) return home();
    const sections = params.getAll('section').map(value => value === 'contacts' ? 'people' : value);
    const sectionOptions = view === 'rumbo-agent' ? ASSISTANT_SECTIONS : TEAM_SECTIONS;
    if (sections.length > 1 || (sections.length && !sectionOptions.has(sections[0]))) return home();
    // Retired Playbooks links remain useful without reviving the old builder.
    if (view === 'playbooks') return { view: 'settings', id: 'scheduled-work', projectId: null };
    return { view, id, projectId, ...(reviews.length ? { reviewId: reviews[0] } : {}), ...(view === 'reader' && returns.length ? { returnTo: returns[0] } : {}), ...(view === 'chats' && id && coordinationRuns.length ? { coordinationRunId:coordinationRuns[0],coordinationId:coordinationItems[0] } : {}), ...((view === 'teams' && id || view === 'rumbo-agent') && sections.length ? { section: sections[0] } : {}), ...(['chats', 'rumbo-agent'].includes(view) && id && messages.length ? { messageId: messages[0] } : {}) };
  } catch {
    return home();
  }
}

/** Build a canonical hash while preserving a project-scoped list or detail. */
export function pageHash(view, id = null, { projectId = null, messageId = null, section = null, reviewId = null, returnTo = null, coordinationRunId = null, coordinationId = null } = {}) {
  view = VIEW_ALIASES[view] || view;
  if (view === 'playbooks') {
    if (id !== null && !validId(id)) throw new TypeError('Invalid page identifier');
    return '#/settings/scheduled-work';
  }
  if (!VIEWS.has(view)) return "#/overview";
  if (id !== null && !validId(id)) throw new TypeError("Invalid page identifier");
  if (projectId !== null && !validId(projectId))
    throw new TypeError("Invalid project identifier");
  const publicView = view === 'teams' ? 'areas' : view === 'rumbo-agent' ? 'frondose-agent' : view;
  const publicId = view === 'settings' && id === 'rumbo-agent' ? 'frondose-agent' : id;
  const path = `#/${publicView}${publicId === null ? "" : `/${encodeURIComponent(publicId)}`}`;
  if (messageId !== null && !validId(messageId)) throw new TypeError('Invalid message identifier');
  const query = new URLSearchParams();
  if (reviewId !== null) { if (!validId(reviewId)) throw new TypeError('Invalid review identifier'); query.set('review', reviewId); }
  if (view === 'reader' && returnTo !== null) { if (!validReturn(returnTo)) throw new TypeError('Invalid return location'); query.set('from',returnTo); }
  if (view === 'chats' && id && (coordinationRunId !== null || coordinationId !== null)) {
    if (!validId(coordinationRunId) || !validId(coordinationId)) throw new TypeError('Invalid coordination reference');
    query.set('coordinationRun',coordinationRunId); query.set('coordination',coordinationId);
  }
  if (section && view === 'teams' && id) {
    if (section === 'contacts') section = 'people';
    if (!TEAM_SECTIONS.has(section)) throw new TypeError('Invalid team section');
    query.set('section', section === 'people' ? 'contacts' : section);
  }
  if (section && view === 'rumbo-agent') {
    if (!ASSISTANT_SECTIONS.has(section)) throw new TypeError('Invalid assistant section');
    query.set('section', section);
  }
  if (projectId && SCOPED_VIEWS.has(view)) query.set('project', projectId);
  if (messageId && ['chats', 'rumbo-agent'].includes(view) && id) query.set('message', messageId);
  return `${path}${query.size ? `?${query}` : ''}`;
}

// Temporary readers may return only to an ordinary canonical in-app location.
// Disallow nesting before parsing so malicious deep links cannot recurse.
function validReturn(hash) {
  if (typeof hash !== 'string' || hash.length > 2000 || !hash.startsWith('#/') || /^(?:#\/reader)(?:\/|\?|$)/.test(hash)) return false;
  const query = new URLSearchParams(hash.split('?')[1] || '');
  if (query.has('from')) return false;
  const page = parsePage(hash);
  const canonical = hash.replace(/^#\/talvori-agent(?=\/|\?|$)/, '#/frondose-agent').replace(/^#\/settings\/talvori-agent(?=\?|$)/, '#/settings/frondose-agent');
  return page.view !== 'reader' && pageHash(page.view,page.id,page) === canonical;
}

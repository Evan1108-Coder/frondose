import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowRight, CircleCheck, CircleAlert, X, Menu, ChevronRight, RotateCcw, LoaderCircle, Pin, PinOff } from "./components/icons.jsx";
import { rumboActions, useRumboData, useRumboStatus } from "./data/useRumbo.js";
import {
  AppContext,
  Button,
  ErrorMessage,
  Field,
  IconButton,
  useAsync,
} from "./ui.jsx";
import { val, visible } from "./lib/model.js";
import {
  NAV,
  Sidebar,
  CommandPalette,
  Shortcuts,
} from "./components/Shell.jsx";
import { EntityDialog } from "./components/EntityDialog.jsx";
import { AgentEditor } from "./components/AgentEditor.jsx";
import { WorkspaceEditor } from "./components/WorkspaceEditor.jsx";
const TeamsView = lazy(() => import('./views/Teams.jsx').then(module => ({ default: module.TeamsView })));
import { Overview, InboxView } from "./views/Overview.jsx";
import { ProjectsView, RoutesView } from "./views/Projects.jsx";
const ChatsView = lazy(() => import('./views/Chats.jsx').then(module => ({ default: module.ChatsView })));
import { WorkView, SessionDialog } from "./views/Work.jsx";
import { MemoryView } from "./views/Agents.jsx";
const AgentsView = lazy(() => import('./views/AgentRoster.jsx').then(module => ({ default: module.AgentsView })));
import { Form } from "./components/Form.jsx";
const ConnectionsView = lazy(() => import('./views/Connections.jsx').then(module => ({ default: module.ConnectionsView })));
const SettingsCenter = lazy(() => import('./views/settings/SettingsCenter.jsx').then(module => ({ default: module.SettingsCenter })));
import { RumboWordmark, RumboSymbol } from "./components/Brand.jsx";
import { parsePage, pageHash } from "./lib/navigation.js";
import { trackInputModality } from "./lib/motion.js";
import { favoriteForPage, favoriteKey, normalizeOrganization, readOrganization, saveOrganization } from "./lib/organization.js";
import { resolveShortcut } from "./lib/shortcuts.js";
import { SidebarEditor } from "./components/SidebarEditor.jsx";
import { NavigationHistory } from './components/NavigationHistory.jsx';
import { FocusView } from "./views/Focus.jsx";
import { Home } from './views/Home.jsx';
const OperationsView = lazy(() => import('./views/Operations.jsx').then(module => ({ default: module.OperationsView })));
const DocumentsView = lazy(() => import('./views/WorkspaceContent.jsx').then(m => ({ default: m.DocumentsView })));
const SavedViews = lazy(() => import('./views/WorkspaceContent.jsx').then(m => ({ default: m.SavedViews })));
import { normalizeExperience, readExperience, rememberPage } from './lib/workspace-experience.js';
const Workbench = lazy(() => import('./views/Workbench.jsx').then(module => ({ default: module.Workbench })));
const LibraryView = lazy(() => import('./views/Library.jsx').then(module => ({ default: module.LibraryView })));

function readPage() {
  return parsePage(location.hash);
}
function readPreference(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function usePreference(key, fallback) {
  const [value, setValue] = useState(() => readPreference(key, fallback));
  const update = useCallback(
    (next) => {
      setValue((current) => {
        const result = typeof next === "function" ? next(current) : next;
        try {
          localStorage.setItem(key, JSON.stringify(result));
        } catch {}
        return result;
      });
    },
    [key],
  );
  return [value, update];
}

export function App() {
  // Include onboarding and error/loading screens, not only the workspace sidebar.
  useEffect(trackInputModality, []);
  const rawData = useRumboData(),
    status = useRumboStatus();
  const [page, setPage] = useState(readPage);
  const [workspaceId, setWorkspaceId] = usePreference("rumbo.workspace", null),
    [collapsed, setCollapsed] = usePreference("rumbo.sidebar.collapsed", false);
  const [mobileOpen, setMobileOpen] = useState(false),
    [commandOpen, setCommandOpen] = useState(false),
    [helpOpen, setHelpOpen] = useState(false),
    [editor, setEditor] = useState(null),
    [session, setSession] = useState(null),
    [toast, setToast] = useState(null);
  const [sidebarEditorOpen, setSidebarEditorOpen] = useState(false);
  const [organizationState, setOrganizationState] = useState(null);
  const [experienceState, setExperienceState] = useState(null);
  const [shortcutPrefix, setShortcutPrefix] = useState(null);
  const chordRef = useRef(null);
  const toastTimer = useRef();
  const navigate = useCallback((view, id = null, options = {}) => {
    const next = pageHash(view, id, options);
    if (location.hash !== next) location.hash = next;
    else setPage(parsePage(next));
  }, []);
  const notify = useCallback((message, type = "success", undo) => {
    clearTimeout(toastTimer.current);
    setToast({ message, type, undo });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 10000 : 5000);
  }, []);
  const perform = useCallback(
    async (action, success) => {
      try {
        const result = await action();
        if (success) notify(success);
        return result;
      } catch (error) {
        notify(error.message ?? "Something went wrong.", "error");
        return undefined;
      }
    },
    [notify],
  );
  const edit = useCallback(
    (kind, item = null, defaults = {}) => setEditor({ kind, item, defaults }),
    [],
  );
  const startSession = useCallback((defaults = {}) => setSession(defaults), []);
  const setWorkspace = useCallback(
    (id) => {
      setWorkspaceId(id);
      navigate("overview");
      setEditor(null);
      setSession(null);
    },
    [navigate, setWorkspaceId],
  );
  const workspace =
    visible(rawData?.workspaces).find((item) => item.id === workspaceId) ??
    visible(rawData?.workspaces)[0];
  const organization = useMemo(() => organizationState && organizationState.workspaceId === workspace?.id ? organizationState.value : readOrganization(localStorage, workspace?.id), [workspace?.id, organizationState]);
  const experience = useMemo(() => experienceState && experienceState.workspaceId === workspace?.id ? experienceState.value : readExperience(localStorage, workspace?.id), [workspace?.id, experienceState]);
  const updateExperience = useCallback(value => {
    if (!workspace) return;
    const next = normalizeExperience(value);
    try { localStorage.setItem(`rumbo.experience.${workspace.id}`, JSON.stringify(next)); setExperienceState({ workspaceId: workspace.id, value: next }); }
    catch { notify('Your browser could not save this preference.', 'error'); }
  }, [workspace?.id, notify]);
  useEffect(() => {
    if (!workspace || page.view === 'settings') return;
    setExperienceState(current => {
      const previous = current?.workspaceId === workspace.id ? current.value : readExperience(localStorage, workspace.id);
      const next = rememberPage(previous, page);
      try { localStorage.setItem(`rumbo.experience.${workspace.id}`, JSON.stringify(next)); } catch {}
      return { workspaceId: workspace.id, value: next };
    });
  }, [workspace?.id, page.view, page.id, page.projectId, page.messageId]);
  const updateOrganization = useCallback((value) => {
    if (!workspace) return;
    const next = normalizeOrganization(value);
    try { saveOrganization(localStorage, workspace.id, next); }
    catch { throw new Error("Your browser could not save this preference. Check browser storage access and try again."); }
    setOrganizationState({ workspaceId: workspace.id, value: next });
  }, [workspace?.id]);
  useEffect(() => {
    const changed = event => { if (event.key === null || event.key === `rumbo.organization.v1.${workspace?.id}`) setOrganizationState({ workspaceId: workspace?.id, value: readOrganization(localStorage, workspace?.id) }); };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [workspace?.id]);
  const data = useMemo(() => {
    if (!rawData) return null;
    const scoped = (collection) =>
      (rawData[collection] ?? []).filter(
        (item) => val(item, "workspace_id") === workspace?.id,
      );
    const projects = scoped("projects"),
      tasks = scoped("tasks"),
      chats = scoped("chats"),
      runs = scoped("runs");
    const chatIds = new Set(chats.map((item) => item.id)),
      runIds = new Set(runs.map((item) => item.id));
    return {
      ...rawData,
      workspaces: workspace ? [workspace] : [],
      projects,
      tasks,
      chats,
      runs,
      teams: scoped("teams"),
      team_members: scoped("team_members"),
      documents: scoped("documents"),
      milestones: scoped("milestones"),
      workspace_items: scoped("workspace_items"),
      audit_log: scoped("audit_log"),
      ...Object.fromEntries(['route_workflows', 'outputs', 'output_versions', 'output_comments', 'output_reviews', 'context_snapshots', 'knowledge_entries', 'project_strategies', 'milestone_contracts', 'work_plans', 'chat_collaboration', 'route_schedules'].map(key => [key, scoped(key)])),
      agents: (rawData.agents ?? []).filter(
        (item) =>
          !val(item, "workspace_id") ||
          val(item, "workspace_id") === workspace?.id,
      ),
      memory_notes: scoped("memory_notes"),
      messages: (rawData.messages ?? []).filter((item) =>
        chatIds.has(val(item, "chat_id")),
      ),
      events: (rawData.events ?? []).filter((item) =>
        runIds.has(val(item, "run_id")),
      ),
      approvals: (rawData.approvals ?? []).filter((item) =>
        runIds.has(val(item, "run_id")),
      ),
    };
  }, [rawData, workspace?.id]);
  const currentFavorite = favoriteForPage(data, page);
  const isFavorite = currentFavorite && organization.favorites.some(item => favoriteKey(item) === favoriteKey(currentFavorite));
  const toggleFavorite = useCallback((item) => {
    if (!item) { notify("Open a project, team, route, chat, agent, or memory note to favorite it."); return; }
    const exists = organization.favorites.some(entry => favoriteKey(entry) === favoriteKey(item));
    if (!exists && organization.favorites.length >= 100) { notify("You can keep up to 100 favorites. Remove one first.", "error"); return; }
    try {
      updateOrganization({ ...organization, favorites: exists ? organization.favorites.filter(entry => favoriteKey(entry) !== favoriteKey(item)) : [...organization.favorites, { view: item.view, id: item.id }] });
      notify(exists ? "Removed from favorites" : "Added to favorites");
    } catch (error) { notify(error.message, "error"); }
  }, [organization, updateOrganization, notify]);
  const archive = useCallback(
    (kind, item) => {
      const action = {
        project: "updateProject",
        task: "updateTask",
        chat: "updateChat",
        agent: "updateAgent",
        memory: "updateMemoryNote",
        team: "updateTeam",
        teamMember: "updateTeamMember",
        document: "updateDocument",
        milestone: "updateMilestone",
      }[kind];
      perform(async () => {
        await rumboActions[action](item.id, {
          archived_at: new Date().toISOString(),
        });
        if (page.id === item.id) navigate(page.view, null, { projectId: page.projectId });
        notify(
          `${kind === "task" ? "Route" : kind === "memory" ? "Memory note" : kind[0].toUpperCase() + kind.slice(1)} archived`,
          "success",
          () =>
            perform(
              () => rumboActions[action](item.id, { archived_at: null }),
              "Restored",
            ),
        );
      });
    },
    [navigate, notify, page, perform],
  );
  useEffect(() => {
    const change = () => setPage(readPage());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    const appearance = rawData?.settings?.appearance ?? {};
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        appearance.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : (appearance.theme ?? "dark");
      document.documentElement.dataset.density =
        appearance.density ?? "comfortable";
      document.documentElement.dataset.motion = appearance.reduceMotion
        ? "reduced"
        : "normal";
      document.documentElement.dataset.textSize = appearance.textSize ?? 'standard';
      document.documentElement.dataset.underlineLinks = String(Boolean(appearance.underlineLinks));
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [rawData?.settings?.appearance]);
  useEffect(() => { document.documentElement.dataset.codeWrap = String(rawData?.settings?.codeReview?.wrap !== false); }, [rawData?.settings?.codeReview?.wrap]);
  const homeApplied = useRef(false);
  useEffect(() => {
    if (!rawData || homeApplied.current) return;
    homeApplied.current = true;
    if (!location.hash || location.hash === '#/') navigate(rawData.settings?.preferences?.home ?? 'overview');
  }, [rawData, navigate]);
  useEffect(() => {
    function keydown(event) {
      if (!workspace) return;
      const result = resolveShortcut(event, {
        editing: Boolean(event.target?.isContentEditable || event.target?.closest?.('input, textarea, select, [role="textbox"], [role="combobox"], [role="menu"], [role="listbox"]')),
        overlay: Boolean(document.querySelector('[role="dialog"][aria-modal="true"]') || editor || session || commandOpen || helpOpen || sidebarEditorOpen),
        paletteOpen: commandOpen, enabled: organization.shortcuts, prefix: chordRef.current,
      });
      chordRef.current = result.prefix;
      setShortcutPrefix(result.prefix);
      if (result.consumed || result.action) event.preventDefault();
      if (!result.action) return;
      if (result.action !== "sidebar") setMobileOpen(false);
      if (result.action === "search") setCommandOpen(current => !current);
      else if (result.action === "help") setHelpOpen(true);
      else if (result.action === "customize") setSidebarEditorOpen(true);
      else if (result.action === "sidebar") matchMedia("(max-width: 800px)").matches ? setMobileOpen(current => !current) : setCollapsed(current => !current);
      else if (result.action === "favorite") toggleFavorite(currentFavorite);
      else if (result.action.startsWith("go:")) navigate(result.action.slice(3));
      else if (result.action.startsWith("create:")) {
        const kind = result.action.slice(7);
        const item = page.view === "tasks" ? data.tasks.find(item => item.id === page.id) : page.view === "chats" ? data.chats.find(item => item.id === page.id) : null;
        const projectId = page.projectId ?? (page.view === "projects" ? page.id : val(item, "project_id"));
        const defaults = projectId && ["task", "chat", "memory", "session"].includes(kind) ? { project_id: projectId } : {};
        if (kind === "session") startSession(defaults); else edit(kind, null, defaults);
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [editor, session, commandOpen, helpOpen, sidebarEditorOpen, organization.shortcuts, edit, navigate, page, workspace, data, toggleFavorite, startSession, setCollapsed]);
  useEffect(() => {
    if (!shortcutPrefix) return;
    const timer = setTimeout(() => { chordRef.current = null; setShortcutPrefix(null); }, 1000);
    return () => clearTimeout(timer);
  }, [shortcutPrefix]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  if (!rawData && status.loading)
    return (
      <div className="app-loading">
        <RumboSymbol size={48} />
        <h1>Rumbo</h1>
        <span>
          <LoaderCircle className="spin" />
          Opening your workspace…
        </span>
      </div>
    );
  if (!rawData)
    return (
      <div className="app-loading">
        <CircleAlert />
        <h1>Unable to open Rumbo</h1>
        <p>{status.error?.message ?? "The Rumbo server is unavailable."}</p>
        <Button
          onClick={() => perform(() => rumboActions.refresh())}
          icon={RotateCcw}
        >
          Try again
        </Button>
      </div>
    );
  const context = {
    data,
    rawData,
    workspace,
    setWorkspace,
    page,
    navigate,
    edit,
    archive,
    perform,
    notify,
    startSession,
    status,
    showShortcuts: () => setHelpOpen(true),
    customizeSidebar: () => { setMobileOpen(false); setSidebarEditorOpen(true); },
    organization, updateOrganization, toggleFavorite, experience, updateExperience,
  };
  if (!workspace)
    return (
      <AppContext.Provider value={context}>
        <FirstRun onCreated={setWorkspace} />
      </AppContext.Provider>
    );
  const view = {
    overview: <Home />,
    focus: <FocusView />,
    inbox: <InboxView />,
    projects: <ProjectsView />,
    teams: <TeamsView />,
    tasks: <RoutesView />,
    chats: <Suspense fallback={<div className="app-loading" role="status">Opening chats…</div>}><ChatsView /></Suspense>,
    work: <WorkView />,
    workbench: <Suspense fallback={<div className="app-loading" role="status">Opening workbench…</div>}><Workbench projectId={page.id ?? page.projectId} /></Suspense>,
    library: <Suspense fallback={<div className="app-loading" role="status">Opening library…</div>}><LibraryView selectedId={page.id} /></Suspense>,
    operations: <OperationsView />,
    documents: <Suspense fallback={<p role="status">Opening documents…</p>}><DocumentsView /></Suspense>,
    views: <Suspense fallback={<p role="status">Opening saved views…</p>}><SavedViews /></Suspense>,
    memory: <MemoryView />,
    agents: <Suspense fallback={<div className="app-loading" role="status">Opening agents…</div>}><AgentsView /></Suspense>,
    connections: <Suspense fallback={<div className="app-loading" role="status">Opening connections…</div>}><ConnectionsView /></Suspense>,
    settings: <Suspense fallback={<div className="app-loading" role="status">Opening settings…</div>}><SettingsCenter /></Suspense>,
  }[page.view];
  const currentProject = visible(data.projects).find(
    (project) => project.id === (page.projectId ?? (["projects", "workbench"].includes(page.view) ? page.id : null)),
  );
  const currentTeam = page.view === 'teams' ? visible(data.teams).find(team => team.id === page.id) : null;
  return (
    <AppContext.Provider value={context}>
      <div className={`rumbo-app ${collapsed ? "sidebar-collapsed" : ""} ${page.view === 'settings' ? 'in-settings' : ''}`}>
        <a
          href="#main-content"
          className="skip-link"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById("main-content")?.focus();
          }}
        >
          Skip to content
        </a>
        <Sidebar
          key={workspace.id}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          mobileOpen={mobileOpen}
          setMobileOpen={setMobileOpen}
          onSearch={() => setCommandOpen(true)}
          onHelp={() => setHelpOpen(true)}
          overlayOpen={Boolean(commandOpen || helpOpen || editor || session || sidebarEditorOpen)}
        />
        <div className="app-main" inert={mobileOpen ? true : undefined}>
          <header className="topbar">
            <IconButton
              label="Open navigation"
              className="icon-button navigation-trigger"
              onClick={() => setMobileOpen(true)}
            >
              <Menu morphTo={mobileOpen ? X : Menu} />
            </IconButton>
            <div className="breadcrumbs">
              <span>{workspace.name}</span>
              <ChevronRight />
              {currentProject ? <>
                <button onClick={() => navigate('projects')}>Projects</button><ChevronRight />
                {page.view === 'projects' ? <strong>{currentProject.name}</strong> : <><button onClick={() => navigate('projects', currentProject.id)}>{currentProject.name}</button><ChevronRight /><strong>{NAV.find(item => item.id === page.view)?.label}</strong></>}
              </> : currentTeam ? <><button onClick={() => navigate('teams')}>Teams</button><ChevronRight /><strong>{currentTeam.name}</strong></> : <strong>{NAV.find(item => item.id === page.view)?.label}</strong>}
            </div>
            <NavigationHistory key={workspace.id} />
            {currentFavorite ? <IconButton label={isFavorite ? "Remove from favorites" : "Add to favorites"} className={`icon-button favorite-toggle ${isFavorite ? "is-favorite" : ""}`} aria-pressed={Boolean(isFavorite)} onClick={() => toggleFavorite(currentFavorite)}><Pin morphTo={isFavorite ? PinOff : Pin} /></IconButton> : null}
            <div className="connection-health">
              <i
                className={`live-dot ${status.error || status.syncError ? "offline" : ""}`}
              />
              {status.pendingMutations
                ? "Saving…"
                : status.syncError
                  ? "Sync interrupted"
                  : "Connected"}
            </div>
          </header>
          {status.error || status.syncError ? (
            <div className="connection-error" role="alert">
              <CircleAlert />
              <span>{(status.error || status.syncError).message}</span>
              <Button
                variant="ghost"
                onClick={() => perform(() => rumboActions.refresh())}
              >
                Retry
              </Button>
              <IconButton
                label="Dismiss error"
                onClick={() => rumboActions.clearError()}
              >
                <X />
              </IconButton>
            </div>
          ) : null}
          <div id="main-content" className="main-scroll" tabIndex={-1}>
            <ScreenBoundary key={`${page.view}-${workspace.id}-${page.projectId ?? "all"}`}>
              <Suspense fallback={<div className="app-loading" role="status">Opening {NAV.find(item => item.id === page.view)?.label?.toLowerCase() || 'page'}…</div>}>
                {view}
              </Suspense>
            </ScreenBoundary>
          </div>
        </div>
        {commandOpen ? (
          <CommandPalette onClose={() => setCommandOpen(false)} />
        ) : null}
        {helpOpen ? <Shortcuts onClose={() => setHelpOpen(false)} /> : null}
        {sidebarEditorOpen ? <SidebarEditor onClose={() => setSidebarEditorOpen(false)} /> : null}
        {shortcutPrefix ? <div className="shortcut-chord" role="status"><kbd>{shortcutPrefix.key.toUpperCase()}</kbd> {shortcutPrefix.key === "g" ? "Go to…" : "Create…"} <span> · Esc to cancel</span></div> : null}
        {editor?.kind === "agent" ? <AgentEditor item={editor.item} defaults={editor.defaults} key={editor.item?.id ?? "new"} onClose={() => setEditor(null)} /> : editor && ['team', 'teamMember', 'document', 'milestone'].includes(editor.kind) ? <WorkspaceEditor {...editor} key={`${editor.kind}-${editor.item?.id ?? 'new'}`} onClose={() => setEditor(null)} /> : editor ? (
          <EntityDialog
            {...editor}
            key={`${editor.kind}-${editor.item?.id ?? "new"}`}
            onClose={() => setEditor(null)}
          />
        ) : null}
        {session ? (
          <SessionDialog defaults={session} onClose={() => setSession(null)} />
        ) : null}
        {toast ? (
          <div
            className={`toast ${toast.type}`}
            role={toast.type === "error" ? "alert" : "status"}
          >
            {toast.type === "error" ? <CircleAlert /> : <CircleCheck />}
            <span>{toast.message}</span>
            {toast.undo ? (
              <button
                onClick={() => {
                  toast.undo();
                  setToast(null);
                }}
              >
                Undo
              </button>
            ) : null}
            <IconButton
              label="Dismiss notification"
              onClick={() => setToast(null)}
            >
              <X />
            </IconButton>
          </div>
        ) : null}
      </div>
    </AppContext.Provider>
  );
}

function FirstRun({ onCreated }) {
  const [name, setName] = useState(""),
    [profile, setProfile] = useState("");
  const { busy, error, execute } = useAsync();
  return (
    <div className="onboarding">
      <aside>
        <div className="onboarding-brand">
          <RumboWordmark width={260} />
        </div>
        <div className="onboarding-message">
          <h1>
            A home for your projects.
            <br />
            <span>A team for your ideas.</span>
          </h1>
          <p>
            Organize the work, bring your AI agents together, and keep every
            conversation connected.
          </p>
          <div className="onboarding-flow">
            <span>Plan</span>
            <ArrowRight />
            <span>Collaborate</span>
            <ArrowRight />
            <span>Build</span>
          </div>
        </div>
        <p className="onboarding-local">
          <i className="live-dot" />
          A home for your projects, conversations, and agents.
        </p>
      </aside>
      <main>
        <Form
          onSubmit={(e) => {
            e.preventDefault();
            execute(async () => {
              if (profile.trim())
                await rumboActions.updateProfile({ name: profile.trim() });
              const workspace = await rumboActions.createWorkspace({
                name: name.trim(),
                description: "",
              });
              onCreated(workspace.id);
            });
          }}
        >
          <div className="onboarding-step">Let’s get you settled</div>
          <h2>Create your workspace</h2>
          <p>
            A space for your projects, conversations, and agents. You can create
            more workspaces later.
          </p>
          <Field label="Your name">
            <input
              autoFocus
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              placeholder="How should we call you?"
              maxLength={100}
            />
          </Field>
          <Field label="Workspace name">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Northstar studio"
              maxLength={100}
            />
          </Field>
          <ErrorMessage error={error} />
          <Button
            type="submit"
            variant="primary"
            busy={busy}
            disabled={!name.trim()}
            icon={ArrowRight}
          >
            Create workspace
          </Button>
          <small>
            No account required. Connect your tools when you’re ready.
          </small>
        </Form>
      </main>
    </div>
  );
}
class ScreenBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div className="app-loading">
        <CircleAlert />
        <h2>This view couldn’t load</h2>
        <p>{this.state.error.message}</p>
        <Button onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </div>
    ) : (
      this.props.children
    );
  }
}

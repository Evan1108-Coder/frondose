import { requestUpdateNavigation, UnsavedUpdatesDialog } from './components/UnsavedUpdates.jsx';
import { notify } from './lib/notifications.js';
import { useGlobalDisplayPreferences } from './lib/display-preferences.js';
import { IconColorsProvider } from './components/IconColors.jsx';
import { FieldDefaultsProvider } from './components/FieldDefaultsProvider.jsx';
import { fieldDefinitionsForWorkspace } from './lib/field-inventory.js';
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
import { ArrowRight, CircleCheck, CircleAlert, X, Menu, RotateCcw, LoaderCircle, Pin, PinOff } from "./components/icons.jsx";
import { talvoriActions, useTalvoriData, useTalvoriStatus } from "./data/useTalvori.js";
import { apiRequest } from './data/api.js';
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
const TalvoriAgent = lazy(() => import('./views/TalvoriAgent.jsx').then(module => ({ default: module.TalvoriAgent })));
import { WorkView, SessionDialog } from "./views/Work.jsx";
import { MemoryView } from "./views/Agents.jsx";
const AgentsView = lazy(() => import('./views/AgentRoster.jsx').then(module => ({ default: module.AgentsView })));
import { Form } from "./components/Form.jsx";
const ConnectionsView = lazy(() => import('./views/AIConnections.jsx').then(module => ({ default: module.AIConnectionsView })));
const SettingsCenter = lazy(() => import('./views/settings/SettingsCenter.jsx').then(module => ({ default: module.SettingsCenter })));
const DocsView = lazy(() => import('./views/Docs.jsx').then(module => ({ default: module.DocsView })));
const FeedbackDialog = lazy(() => import('./components/FeedbackDialog.jsx').then(module => ({ default: module.FeedbackDialog })));
import { TalvoriWordmark, TalvoriSymbol } from "./components/Brand.jsx";
import { parsePage, pageHash } from "./lib/navigation.js";
import { trackInputModality } from "./lib/motion.js";
import { favoriteForPage, favoriteKey, normalizeOrganization, readOrganization, saveOrganization } from "./lib/organization.js";
import { resolveShortcut } from "./lib/shortcuts.js";
import { SidebarEditor } from "./components/SidebarEditor.jsx";
import { NavigationHistory } from './components/NavigationHistory.jsx';
import { Breadcrumbs } from './components/Breadcrumbs.jsx';
import { GlobalToolbar } from './components/GlobalToolbar.jsx';
import './components/sidebar-resize.css';
import { canShowSidebarPreview, clampPagePreview, clampSidebarWidth, normalizeSidebarSize, shouldEnterSidebarPreview, sidebarWidthFromPointer } from './lib/sidebar-size.js';
import { SidebarPagePreview } from './components/SidebarPagePreview.jsx';
import { FocusView } from "./views/Focus.jsx";
import { StarredView } from "./views/Starred.jsx";
import { Home } from './views/Home.jsx';
const OperationsView = lazy(() => import('./views/Operations.jsx').then(module => ({ default: module.OperationsView })));
const DocumentsView = lazy(() => import('./views/WorkspaceContent.jsx').then(m => ({ default: m.DocumentsView })));
const SavedViews = lazy(() => import('./views/WorkspaceContent.jsx').then(m => ({ default: m.SavedViews })));
import { normalizeExperience, readExperience, rememberPage } from './lib/workspace-experience.js';
const Workbench = lazy(() => import('./views/Workbench.jsx').then(module => ({ default: module.Workbench })));
const LibraryView = lazy(() => import('./views/Library.jsx').then(module => ({ default: module.LibraryView })));
const UpdatesView = lazy(() => import('./views/Updates.jsx').then(module => ({ default: module.UpdatesView })));
const SkillsView = lazy(() => import('./views/Skills.jsx').then(module => ({ default: module.SkillsView })));
const WorkflowsView = lazy(() => import('./views/Workflows.jsx').then(module => ({ default: module.WorkflowsView })));
const Reader = lazy(() => import('./views/Reader.jsx').then(module => ({ default: module.Reader })));

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
  useGlobalDisplayPreferences();
  // Include onboarding and error/loading screens, not only the workspace sidebar.
  useEffect(trackInputModality, []);
  const rawData = useTalvoriData(),
    status = useTalvoriStatus();
  const [page, setPage] = useState(readPage);
  const [workspaceId, setWorkspaceId] = usePreference("rumbo.workspace", null),
    [collapsed, setCollapsed] = usePreference("rumbo.sidebar.collapsed", false);
  const [savedSidebarSize, setSavedSidebarSize] = usePreference('rumbo.sidebar.size', null);
  const sidebarSize = normalizeSidebarSize(savedSidebarSize, typeof window === 'undefined' ? 1280 : window.innerWidth);
  const [sidebarPeek, setSidebarPeek] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [previewPlacement, setPreviewPlacement] = useState(null);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const measure = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  useEffect(() => { if (!canShowSidebarPreview(viewport.width, viewport.height)) setPreviewMode(false); }, [viewport.width, viewport.height]);
  const previewActive = previewMode && canShowSidebarPreview(viewport.width, viewport.height) && !['docs', 'reader'].includes(page.view);
  const previewGeometry = previewActive ? clampPagePreview(previewPlacement, viewport.width, viewport.height) : null;
  const resizeSidebar = useCallback((clientX, returnWidth) => {
    if (shouldEnterSidebarPreview(clientX, window.innerWidth, window.innerHeight)) {
      setPreviewMode(true);
      setSidebarPeek(false);
      setSavedSidebarSize(current => ({ ...normalizeSidebarSize(current, window.innerWidth), width: returnWidth ? clampSidebarWidth(returnWidth, window.innerWidth) : normalizeSidebarSize(current, window.innerWidth).width, hidden: false }));
      setCollapsed(false);
      return;
    }
    setPreviewMode(false);
    const width = sidebarWidthFromPointer(clientX, window.innerWidth);
    if (width) {
      setSavedSidebarSize(current => ({ ...normalizeSidebarSize(current, window.innerWidth), width, hidden: false }));
      setCollapsed(false);
    }
  }, [setSavedSidebarSize, setCollapsed]);
  const hideSidebar = useCallback(previousWidth => {
    setPreviewMode(false);
    setSavedSidebarSize(current => ({ ...normalizeSidebarSize(current, window.innerWidth), width: previousWidth ? clampSidebarWidth(previousWidth, window.innerWidth) : normalizeSidebarSize(current, window.innerWidth).width, hidden: true }));
    setSidebarPeek(false);
    setCollapsed(false);
    if (document.documentElement.dataset.inputModality === 'keyboard') requestAnimationFrame(() => document.querySelector('.navigation-trigger')?.focus());
  }, [setSavedSidebarSize, setCollapsed]);
  const restoreSidebar = useCallback(() => { setPreviewMode(false); setSavedSidebarSize(current => ({ ...normalizeSidebarSize(current, window.innerWidth), hidden: false })); setSidebarPeek(false); setCollapsed(false); }, [setSavedSidebarSize, setCollapsed]);
  const [mobileOpen, setMobileOpen] = useState(false),
    [commandOpen, setCommandOpen] = useState(false),
    [helpOpen, setHelpOpen] = useState(false),
    [feedbackOpen, setFeedbackOpen] = useState(false),
    [editor, setEditor] = useState(null),
    [session, setSession] = useState(null);
  const [sidebarEditorOpen, setSidebarEditorOpen] = useState(false);
  const [organizationState, setOrganizationState] = useState(null);
  const [experienceState, setExperienceState] = useState(null);
  const [shortcutPrefix, setShortcutPrefix] = useState(null);
  const chordRef = useRef(null);
  const lastConnectionError = useRef('');
  const navigate = useCallback((view, id = null, options = {}) => {
    const next = pageHash(view, id, options);
    if (location.hash !== next) location.hash = next;
    else setPage(parsePage(next));
  }, []);
  useEffect(() => {
    const message = (status.error || status.syncError)?.message || '';
    if (message && message !== lastConnectionError.current) notify(message, 'error', undefined, {
      actionLabel: 'Retry', action: () => talvoriActions.refresh(),
    });
    // Repeated failed background polls do not restart or resurrect the notice.
    lastConnectionError.current = message;
  }, [status.error, status.syncError]);
  const perform = useCallback(
    async (action, success) => {
      try {
        const result = await action();
        if (success) notify(success);
        return result;
      } catch (error) {
        notify(error.message ?? "Something went wrong.", error.code === 'read_only_demo' ? 'info' : 'error');
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
      requestUpdateNavigation(() => {
        setWorkspaceId(id);
        navigate("overview");
        setEditor(null);
        setSession(null);
      });
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
      connections: (rawData.connections ?? []).map(connection => connection.workspace_states ? { ...connection, state: connection.workspace_states[workspace?.id] || 'not_connected' } : connection),
      workspaces: workspace ? [workspace] : [],
      projects,
      tasks,
      chats,
      runs,
      teams: scoped("teams"),
      team_members: scoped("team_members"),
      area_settings: scoped("area_settings"),
      documents: scoped("documents"),
      milestones: scoped("milestones"),
      workspace_items: scoped("workspace_items"),
      audit_log: scoped("audit_log"),
      ...Object.fromEntries(['skills', 'skill_versions', 'skill_test_runs', 'manual_workflows', 'manual_workflow_versions', 'manual_workflow_runs', 'manual_workflow_step_runs', 'manual_workflow_approvals', 'activity_entries', 'route_workflows', 'outputs', 'output_versions', 'output_comments', 'output_reviews', 'context_snapshots', 'knowledge_entries', 'project_strategies', 'milestone_contracts', 'work_plans', 'chat_collaboration', 'route_schedules'].map(key => [key, scoped(key)])),
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
        await talvoriActions[action](item.id, {
          archived_at: new Date().toISOString(),
        });
        if (page.id === item.id) navigate(page.view, null, { projectId: page.projectId });
        notify(
          `${kind === "task" ? "Route" : kind === "memory" ? "Memory note" : kind[0].toUpperCase() + kind.slice(1)} archived`,
          "success",
          () =>
            perform(
              () => talvoriActions[action](item.id, { archived_at: null }),
              "Restored",
            ),
        );
      });
    },
    [navigate, notify, page, perform],
  );
  useEffect(() => {
    let previous = location.hash;
    const change = () => { const next = location.hash; history.replaceState(null, '', previous || '#/'); requestUpdateNavigation(() => { previous = next; history.replaceState(null, '', next); setPage(readPage()); }); };
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
  if (!rawData && status.loading)
    return (
      <div className="app-loading">
        <TalvoriSymbol size={48} />
        <h1>Talvori</h1>
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
        <h1>Unable to open Talvori</h1>
        <p>{status.error?.message ?? "The Talvori server is unavailable."}</p>
        <Button
          onClick={() => perform(() => talvoriActions.refresh())}
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
    showFeedback: () => { setMobileOpen(false); setFeedbackOpen(true); },
    customizeSidebar: () => { setMobileOpen(false); setSidebarEditorOpen(true); },
    organization, updateOrganization, toggleFavorite, experience, updateExperience,
    sidebarSizing: { width: previewActive ? viewport.width - 24 : sidebarSize.width ?? clampSidebarWidth(280, window.innerWidth), preview: previewActive, hidden: sidebarSize.hidden, peek: sidebarPeek, setPeek: setSidebarPeek, resize: resizeSidebar, hide: hideSidebar, restore: restoreSidebar },
  };
  if (!workspace)
    return (
      <AppContext.Provider value={context}><UnsavedUpdatesDialog />
        <FirstRun onCreated={setWorkspace} />
      </AppContext.Provider>
    );
  const view = {
    overview: <Home />,
    focus: <FocusView />,
    starred: <StarredView />,
    inbox: <InboxView />,
    updates: <UpdatesView />,
    skills: <Suspense fallback={<p role="status">Opening Skills…</p>}><SkillsView /></Suspense>,
    projects: <ProjectsView />,
    teams: <TeamsView />,
    tasks: <RoutesView />,
    chats: <Suspense fallback={<div className="app-loading" role="status">Opening chats…</div>}><ChatsView /></Suspense>,
    'rumbo-agent': <Suspense fallback={<div className="app-loading" role="status">Opening Talvori…</div>}><TalvoriAgent /></Suspense>,
    work: <WorkView />,
    workbench: <Suspense fallback={<div className="app-loading" role="status">Opening workbench…</div>}><Workbench projectId={page.id ?? page.projectId} /></Suspense>,
    library: <Suspense fallback={<div className="app-loading" role="status">Opening library…</div>}><LibraryView selectedId={page.id} /></Suspense>,
    operations: <OperationsView />,
    workflows: <Suspense fallback={<p role="status">Opening Workflows…</p>}><WorkflowsView /></Suspense>,
    documents: <Suspense fallback={<p role="status">Opening documents…</p>}><DocumentsView /></Suspense>,
    views: <Suspense fallback={<p role="status">Opening saved views…</p>}><SavedViews /></Suspense>,
    memory: <MemoryView />,
    agents: <Suspense fallback={<div className="app-loading" role="status">Opening agents…</div>}><AgentsView /></Suspense>,
    connections: <Suspense fallback={<div className="app-loading" role="status">Opening connections…</div>}><ConnectionsView /></Suspense>,
    settings: <Suspense fallback={<div className="app-loading" role="status">Opening settings…</div>}><SettingsCenter /></Suspense>,
  }[page.view];
  const fieldDefinitions = fieldDefinitionsForWorkspace(data);
  return (
    <AppContext.Provider value={context}>
      <FieldDefaultsProvider workspaceId={workspace.id} definitions={fieldDefinitions}><IconColorsProvider><UnsavedUpdatesDialog />
      <div className={`rumbo-app ${rawData.meta?.sampleWorkspace ? 'sample-workspace' : ''} ${collapsed ? "sidebar-collapsed" : ""} ${sidebarSize.hidden ? 'sidebar-auto-hidden' : ''} ${sidebarPeek ? 'sidebar-peek' : ''} ${previewActive ? 'sidebar-preview-mode' : ''} ${page.view === 'settings' ? 'in-settings' : ''} ${page.view === 'docs' ? 'in-docs' : ''} ${page.view === 'reader' ? 'in-reader' : ''}`} style={previewGeometry ? { '--sidebar': `${viewport.width - 24}px`, '--preview-x': `${previewGeometry.x}px`, '--preview-y': `${previewGeometry.y}px`, '--preview-scale': previewGeometry.scale } : sidebarSize.width != null && (!collapsed || page.view === 'settings') ? { '--sidebar': `${sidebarSize.width}px` } : undefined}>
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
        {['docs', 'reader'].includes(page.view) ? <ScreenBoundary key={`${page.view}-${workspace.id}`}><Suspense fallback={<div className="app-loading" role="status">Opening documentation…</div>}>{page.view === 'reader' ? <Reader /> : <DocsView />}</Suspense></ScreenBoundary> : <><Sidebar
          key={workspace.id}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          mobileOpen={mobileOpen}
          setMobileOpen={setMobileOpen}
          onSearch={() => setCommandOpen(true)}
          onHelp={() => setHelpOpen(true)}
          overlayOpen={Boolean(commandOpen || helpOpen || feedbackOpen || editor || session || sidebarEditorOpen)}
          sidebarSizing={context.sidebarSizing}
        />
        {sidebarSize.hidden ? <button type="button" className="sidebar-edge-reveal" aria-label="Show navigation" onPointerEnter={() => setSidebarPeek(true)} onFocus={() => setSidebarPeek(true)} onClick={restoreSidebar} /> : null}
        <div className="app-main" inert={mobileOpen || previewActive && page.view !== 'settings' ? true : undefined}>
          <header className="topbar">
            <IconButton
              label={sidebarSize.hidden ? "Show navigation" : "Open navigation"}
              className="icon-button navigation-trigger"
              onClick={() => matchMedia('(max-width: 800px)').matches ? setMobileOpen(true) : restoreSidebar()}
            >
              <Menu morphTo={mobileOpen ? X : Menu} />
            </IconButton>
            <Breadcrumbs page={page} workspace={workspace} data={data} navigate={navigate} labels={Object.fromEntries(NAV.map(item => [item.id, item.label]))} />
            <NavigationHistory key={workspace.id} />
            {currentFavorite ? <IconButton label={isFavorite ? "Remove from favorites" : "Add to favorites"} className={`icon-button favorite-toggle ${isFavorite ? "is-favorite" : ""}`} aria-pressed={Boolean(isFavorite)} onClick={() => toggleFavorite(currentFavorite)}><Pin morphTo={isFavorite ? PinOff : Pin} /></IconButton> : null}
            <GlobalToolbar onSearch={() => setCommandOpen(true)} />
            <div className="connection-health" role="status" aria-label={status.error || status.syncError ? 'Workspace connection needs attention' : status.pendingMutations ? 'Saving workspace changes' : 'Workspace connected'} title={status.error || status.syncError ? 'Connection needs attention' : 'Connected'}>
              <i
                className={`live-dot ${status.error || status.syncError ? "offline" : ""}`}
              />
              <span className="connection-health-label">{status.pendingMutations
                ? "Saving…"
                : status.syncError
                  ? "Sync interrupted"
                  : status.error
                    ? "Action failed"
                  : "Connected"}</span>
            </div>
          </header>
          <div id="main-content" className="main-scroll" tabIndex={-1}>
            <div className="view-entrance" key={`${page.view}-${page.id ?? 'all'}-${page.section ?? ''}-${workspace.id}-${page.projectId ?? "all"}`}><ScreenBoundary>
              <Suspense fallback={<div className="app-loading" role="status">Opening {NAV.find(item => item.id === page.view)?.label?.toLowerCase() || 'page'}…</div>}>
                {view}
              </Suspense>
            </ScreenBoundary></div>
          </div>
        </div>
        {previewGeometry ? <SidebarPagePreview geometry={previewGeometry} onChange={next => setPreviewPlacement(clampPagePreview(next, window.innerWidth, window.innerHeight))} onOpen={() => { restoreSidebar(); requestAnimationFrame(() => document.getElementById('main-content')?.focus()); }} onExit={restoreSidebar} /> : null}
        </>}
        {feedbackOpen ? <Suspense fallback={<p role="status">Opening feedback…</p>}><FeedbackDialog onClose={() => setFeedbackOpen(false)} /></Suspense> : null}
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
      </div>
      {rawData.meta?.sampleWorkspace ? <aside className="sample-workspace-label" aria-label="Sample workspace information">SAMPLE WORKSPACE · View only · Fictional people, simulated connections & example results · No live AI</aside> : null}
      </IconColorsProvider></FieldDefaultsProvider>
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
          <TalvoriWordmark width={260} />
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
                await talvoriActions.updateProfile({ name: profile.trim() });
              const workspace = await talvoriActions.createWorkspace({
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

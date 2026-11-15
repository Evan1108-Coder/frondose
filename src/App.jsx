import {ContextInputDrops} from './components/ContextInputDrops.jsx';
import {useInterfaceLanguage} from './components/InterfaceLanguage.jsx';
import {interfaceText} from './lib/interface-language.js';
import {TodoBoard} from './views/TodoBoard.jsx';
import {ChecklistCelebration} from './components/ChecklistCelebration.jsx';
import { requestUpdateNavigation, UnsavedUpdatesDialog } from './components/UnsavedUpdates.jsx';
import { useGlobalWorkstationAppearance } from './lib/workstation-appearance.js';
import './components/workstation-appearance.css';
import { DesktopUpdates } from './components/DesktopUpdates.jsx';
import { nativeUpdateCritical, useDesktopUpdates } from './lib/desktop-updates.js';
import { notify } from './lib/notifications.js';
import { WorkspaceSurface } from './components/workspace/WorkspaceSurface.jsx';
import { rememberWorkspaceReturnPage, workspaceSettingsReturnPage } from './lib/workspace-settings.js';
import { requestWorkspaceNavigation } from './lib/workspace-navigation.js';
import { isLocalProduct } from './lib/local-product.js';
import { isWorkspaceStandalonePage } from './lib/workspace-screens.js';
import { isRetiredLocalPage, isLocalCreationAllowed } from './lib/local-navigation.js';
import { HistoricalConversations } from './components/workspace/HistoricalConversations.jsx';
import { useGlobalDisplayPreferences } from './lib/display-preferences.js';
import { IconColorsProvider } from './components/IconColors.jsx';
import { FieldDefaultsProvider } from './components/FieldDefaultsProvider.jsx';
import { fieldDefinitionsForWorkspace } from './lib/field-inventory.js';
import { agentForWorkspace } from './lib/computer-agent-controls.js';
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
import { frondoseActions, useFrondoseData, useFrondoseStatus } from "./data/useFrondose.js";
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
const FrondoseAgent = lazy(() => import('./views/FrondoseAgent.jsx').then(module => ({ default: module.FrondoseAgent })));
import { WorkView, SessionDialog } from "./views/Work.jsx";
import { MemoryView } from "./views/Agents.jsx";
const AgentsView = lazy(() => import('./views/AgentRoster.jsx').then(module => ({ default: module.AgentsView })));
import { Form } from "./components/Form.jsx";
const ConnectionsView = lazy(() => import('./views/AIConnections.jsx').then(module => ({ default: module.AIConnectionsView })));
const SettingsCenter = lazy(() => import('./views/settings/SettingsCenter.jsx').then(module => ({ default: module.SettingsCenter })));
const DocsView = lazy(() => import('./views/Docs.jsx').then(module => ({ default: module.DocsView })));
const FeedbackDialog = lazy(() => import('./components/FeedbackDialog.jsx').then(module => ({ default: module.FeedbackDialog })));
import { FrondoseWordmark, FrondoseSymbol } from "./components/Brand.jsx";
import { parsePage, pageHash } from "./lib/navigation.js";
import { trackInputModality } from "./lib/motion.js";
import { favoriteForPage, favoriteKey, normalizeOrganization, readOrganization, saveOrganization } from "./lib/organization.js";
import { resolveShortcut } from "./lib/shortcuts.js";
import { SidebarEditor } from "./components/SidebarEditor.jsx";
import { NavigationHistory } from './components/NavigationHistory.jsx';
import { GlobalToolbar } from './components/GlobalToolbar.jsx';
import './components/sidebar-resize.css';
import { canShowSidebarPreview, clampPagePreview, clampSidebarWidth, normalizeSidebarSize, shouldEnterSidebarPreview, sidebarWidthFromPointer, SIDEBAR_DEFAULT_WIDTH } from './lib/sidebar-size.js';
import { SidebarPagePreview } from './components/SidebarPagePreview.jsx';
import { FocusView } from "./views/Focus.jsx";
import { StarredView } from "./views/Starred.jsx";
import { Home } from './views/Home.jsx';
const OperationsView = lazy(() => import('./views/Operations.jsx').then(module => ({ default: module.OperationsView })));
const DocumentsView = lazy(() => import('./views/WorkspaceContent.jsx').then(m => ({ default: m.DocumentsView })));
const WorkspaceCommentsView = lazy(() => import('./components/workspace/WorkspaceComments.jsx').then(m => ({ default: m.WorkspaceCommentsView })));
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

function WorkspaceConnectionHealth({status}) {
  const language = useInterfaceLanguage();
  const t = text => interfaceText(text, language);
  const offline = status.error || status.syncError;
  return <div className="connection-health" role="status"
    aria-label={t(offline ? 'Workspace connection needs attention' : status.pendingMutations ? 'Saving workspace changes' : 'Workspace connected')}
    title={t(offline ? 'Connection needs attention' : 'Connected')}>
    <i className={`live-dot ${offline ? 'offline' : ''}`} />
    <span className="connection-health-label">{t(status.pendingMutations ? 'Saving…' : status.syncError ? 'Sync interrupted' : status.error ? 'Action failed' : 'Connected')}</span>
  </div>;
}

export function App() {
  useGlobalWorkstationAppearance();
  const desktopUpdateState = useDesktopUpdates();
  useGlobalDisplayPreferences();
  // Include onboarding and error/loading screens, not only the workspace sidebar.
  useEffect(trackInputModality, []);
  const rawData = useFrondoseData(),
    status = useFrondoseStatus();
  const localEdition = isLocalProduct(rawData);
  const localPage = useCallback(target => localEdition && isRetiredLocalPage(target) ? parsePage('#/workspace') : target, [localEdition]);
  useEffect(() => { document.documentElement.dataset.productEdition = rawData?.meta?.product?.edition || 'compatible'; }, [rawData?.meta?.product?.edition]);
  const [page, setPage] = useState(readPage);
  const [workspaceDestination,setWorkspaceDestination]=useState(null);
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
  const pageLocation = useRef(location.hash);
  const navigate = useCallback((view, id = null, options = {}) => {
    const target = localPage(parsePage(pageHash(view, id, options)));
    const next = pageHash(target.view, target.id, target);
    requestUpdateNavigation(() => requestWorkspaceNavigation(parsePage(next), () => {
      if (location.hash !== next) history.pushState(null, '', next);
      pageLocation.current = next;
      setPage(parsePage(next));
    }));
  }, [localPage]);
  const activateWorkspacePage = useCallback(next => {
    next = localPage(next);
    history.replaceState(null, '', pageHash(next.view, next.id, next));
    pageLocation.current = location.hash;
    setPage(next);
  }, [localPage]);
  useEffect(() => {
    if (!localEdition || !isRetiredLocalPage(page)) return;
    const target = parsePage('#/workspace');
    history.replaceState(null, '', '#/workspace'); pageLocation.current = '#/workspace'; setPage(target);
  }, [localEdition, page]);
  useEffect(() => {
    const message = (status.error || status.syncError)?.message || '';
    if (message && message !== lastConnectionError.current) notify(message, 'error', undefined, {
      actionLabel: 'Retry', action: () => frondoseActions.refresh(),
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
    (kind, item = null, defaults = {}) => {
      if (isLocalProduct(rawData) && !isLocalCreationAllowed(kind)) { window.dispatchEvent(new Event('frondose:new-workspace-tab')); return; }
      setEditor({ kind, item, defaults });
    },
    [rawData?.meta?.product?.edition],
  );
  const startSession = useCallback((defaults = {}) => { if(localEdition){window.dispatchEvent(new Event('frondose:new-workspace-tab'));return;}setSession(defaults); }, [localEdition]);
  const setWorkspace = useCallback(
    (id, onSelected) => {
      requestWorkspaceNavigation(null, () => requestUpdateNavigation(() => {
        setWorkspaceId(id);
        const home = localEdition ? '#/workspace' : '#/overview';
        history.replaceState(null, '', home); pageLocation.current = home; setPage(parsePage(home));
        setEditor(null);
        setSession(null);
        if(typeof onSelected==='function')requestAnimationFrame(onSelected);
      }));
    },
    [localEdition, setWorkspaceId],
  );
  const workspace =
    visible(rawData?.workspaces).find((item) => item.id === workspaceId) ??
    visible(rawData?.workspaces)[0];
  useEffect(() => {
    if (!workspace) return;
    if (!isWorkspaceStandalonePage(page)) rememberWorkspaceReturnPage(localStorage, workspace.id, page);
  }, [workspace?.id, page]);
  const closeSettings = useCallback(() => requestUpdateNavigation(() => {
    const target = localPage(workspaceSettingsReturnPage(localStorage, workspace?.id));
    const hash = pageHash(target.view, target.id, target);
    history.pushState(null, '', hash); pageLocation.current = hash; setPage(target);
  }), [workspace?.id, localPage]);
  const organization = useMemo(() => organizationState && organizationState.workspaceId === workspace?.id ? organizationState.value : readOrganization(localStorage, workspace?.id), [workspace?.id, organizationState]);
  const experience = useMemo(() => experienceState && experienceState.workspaceId === workspace?.id ? experienceState.value : readExperience(localStorage, workspace?.id), [workspace?.id, experienceState]);
  const updateExperience = useCallback(value => {
    if (!workspace) return;
    const next = normalizeExperience(value);
    try { localStorage.setItem(`rumbo.experience.${workspace.id}`, JSON.stringify(next)); setExperienceState({ workspaceId: workspace.id, value: next }); }
    catch { notify('Your browser could not save this preference.', 'error'); }
  }, [workspace?.id, notify]);
  useEffect(() => {
    if (!workspace || isWorkspaceStandalonePage(page)) return;
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
      ).map(item => agentForWorkspace(item, workspace?.id)),
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
        await frondoseActions[action](item.id, {
          archived_at: new Date().toISOString(),
        });
        if (page.id === item.id) navigate(page.view, null, { projectId: page.projectId });
        notify(
          `${kind === "task" ? "Route" : kind === "memory" ? "Memory note" : kind[0].toUpperCase() + kind.slice(1)} archived`,
          "success",
          () =>
            perform(
              () => frondoseActions[action](item.id, { archived_at: null }),
              "Restored",
            ),
        );
      });
    },
    [navigate, notify, page, perform],
  );
  useEffect(() => {
    const change = () => { const target=localPage(parsePage(location.hash)); const next=pageHash(target.view,target.id,target); history.replaceState(null, '', pageLocation.current || '#/'); requestUpdateNavigation(() => requestWorkspaceNavigation(target, () => { pageLocation.current = next; history.replaceState(null, '', next); setPage(target); })); };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, [localPage]);
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
    if (!location.hash || location.hash === '#/') navigate(localEdition ? 'workspace' : rawData.settings?.preferences?.home ?? 'overview');
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
        <FrondoseSymbol size={48} />
        <h1>Frondose</h1>
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
        <h1>Unable to open Frondose</h1>
        <p>{status.error?.message ?? "The Frondose server is unavailable."}</p>
        <Button
          onClick={() => perform(() => frondoseActions.refresh())}
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
    closeSettings,
    closeDocs: closeSettings,
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
    openAgentSession: agent => window.dispatchEvent(new CustomEvent('frondose:open-agent-session', { detail: { agentId: agent.id, providerId: agent.provider, label: agent.name } })),
    sidebarSizing: { width: previewActive ? viewport.width - 24 : sidebarSize.width ?? clampSidebarWidth(localEdition ? 224 : SIDEBAR_DEFAULT_WIDTH, window.innerWidth), preview: previewActive, hidden: sidebarSize.hidden, peek: sidebarPeek, setPeek: setSidebarPeek, resize: resizeSidebar, hide: hideSidebar, restore: restoreSidebar },
  };
  if (!workspace)
    return (
      <AppContext.Provider value={context}><UnsavedUpdatesDialog />
        <FirstRun onCreated={setWorkspace} />
      </AppContext.Provider>
    );
  const renderView = viewPage => localEdition && isRetiredLocalPage(viewPage) ? null : {
    workspace: null,
    todos: localEdition ? <TodoBoard/> : null,
    overview: <Home />,
    focus: <FocusView />,
    starred: <StarredView />,
    inbox: <InboxView />,
    updates: <UpdatesView />,
    skills: <Suspense fallback={<p role="status">Opening Skills…</p>}><SkillsView /></Suspense>,
    projects: <ProjectsView />,
    teams: <TeamsView />,
    tasks: <RoutesView />,
    chats: localEdition ? <HistoricalConversations /> : <Suspense fallback={<div className="app-loading" role="status">Opening chats…</div>}><ChatsView /></Suspense>,
    'rumbo-agent': <Suspense fallback={<div className="app-loading" role="status">Opening Frondose…</div>}>{localEdition ? <AgentsView /> : <FrondoseAgent />}</Suspense>,
    work: <WorkView />,
    workbench: <Suspense fallback={<div className="app-loading" role="status">Opening workbench…</div>}><Workbench projectId={viewPage.id ?? viewPage.projectId} /></Suspense>,
    library: <Suspense fallback={<div className="app-loading" role="status">Opening library…</div>}><LibraryView selectedId={viewPage.id} /></Suspense>,
    operations: <OperationsView />,
    workflows: <Suspense fallback={<p role="status">Opening Workflows…</p>}><WorkflowsView /></Suspense>,
    documents: <Suspense fallback={<p role="status">Opening documents…</p>}><DocumentsView /></Suspense>,
    comments: localEdition ? <Suspense fallback={<p role="status">Opening comments…</p>}><WorkspaceCommentsView /></Suspense> : null,
    views: <Suspense fallback={<p role="status">Opening saved views…</p>}><SavedViews /></Suspense>,
    memory: <MemoryView />,
    agents: <Suspense fallback={<div className="app-loading" role="status">Opening agents…</div>}><AgentsView /></Suspense>,
    connections: <Suspense fallback={<div className="app-loading" role="status">Opening connections…</div>}><ConnectionsView /></Suspense>,
    settings: <Suspense fallback={<div className="app-loading" role="status">Opening settings…</div>}><SettingsCenter /></Suspense>,
    docs: <Suspense fallback={<p role="status">Opening Docs…</p>}><DocsView /></Suspense>,
    reader: <Suspense fallback={<p role="status">Opening document…</p>}><Reader /></Suspense>,
  }[viewPage.view];
  const view = renderView(page);
  const fieldDefinitions = fieldDefinitionsForWorkspace(data);
  return (
    <AppContext.Provider value={context}>
      {localEdition?<ChecklistCelebration workspaceId={workspace.id}/>:null}
      <FieldDefaultsProvider workspaceId={workspace.id} definitions={fieldDefinitions}><IconColorsProvider><UnsavedUpdatesDialog />{localEdition?<ContextInputDrops/>:null}
      {localEdition ? <DesktopUpdates hasOpenEditor={Boolean(editor || session || sidebarEditorOpen)} pendingMutations={Boolean(status.pendingMutations)}/> : null}
      <div inert={nativeUpdateCritical(desktopUpdateState.phase) || undefined} className={`rumbo-app ${localEdition ? 'local-workbench' : ''} ${rawData.meta?.sampleWorkspace ? 'sample-workspace' : ''} ${collapsed ? "sidebar-collapsed" : ""} ${sidebarSize.hidden ? 'sidebar-auto-hidden' : ''} ${sidebarPeek ? 'sidebar-peek' : ''} ${previewActive ? 'sidebar-preview-mode' : ''} ${page.view === 'settings' ? 'in-settings' : ''} ${page.view === 'docs' ? 'in-docs' : ''} ${!localEdition && page.view === 'reader' ? 'in-reader' : ''}`} style={previewGeometry ? { '--sidebar': `${viewport.width - 24}px`, '--preview-x': `${previewGeometry.x}px`, '--preview-y': `${previewGeometry.y}px`, '--preview-scale': previewGeometry.scale } : sidebarSize.width != null && (!collapsed || page.view === 'settings') ? { '--sidebar': `${sidebarSize.width}px` } : undefined}>
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
        {page.view === 'docs' || !localEdition && page.view === 'reader' ? <ScreenBoundary key={`${page.view}-${workspace.id}`}><Suspense fallback={<div className="app-loading" role="status">Opening documentation…</div>}>{page.view === 'reader' ? <Reader /> : <DocsView />}</Suspense></ScreenBoundary> : <><Sidebar
          key={workspace.id}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          mobileOpen={mobileOpen}
          setMobileOpen={setMobileOpen}
          onSearch={() => setCommandOpen(true)}
          onHelp={() => setHelpOpen(true)}
          overlayOpen={Boolean(commandOpen || helpOpen || feedbackOpen || editor || session || sidebarEditorOpen)}
          sidebarSizing={context.sidebarSizing}
          workspaceDestination={workspaceDestination?.workspaceId===workspace.id?workspaceDestination.page:null}
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
            <NavigationHistory key={workspace.id} showControls={false} />
            {currentFavorite ? <IconButton label={isFavorite ? "Remove from favorites" : "Add to favorites"} className={`icon-button favorite-toggle ${isFavorite ? "is-favorite" : ""}`} aria-pressed={Boolean(isFavorite)} onClick={() => toggleFavorite(currentFavorite)}><Pin morphTo={isFavorite ? PinOff : Pin} /></IconButton> : null}
            <div data-workspace-git-toolbar="true" />
            <GlobalToolbar onSearch={() => setCommandOpen(true)} />
            <WorkspaceConnectionHealth status={status} />
          </header>
          {localEdition && !isWorkspaceStandalonePage(page) ? <WorkspaceSurface key={workspace.id} page={page} onActivatePage={activateWorkspacePage} onWorkspaceDestination={setWorkspaceDestination} renderPage={targetPage => <AppContext.Provider value={{ ...context, page: targetPage }}><div className="main-scroll"><ScreenBoundary key={`${workspace.id}:${targetPage.view}:${targetPage.id || ''}`}><Suspense fallback={<div role="status">Opening page…</div>}>{renderView(targetPage)}</Suspense></ScreenBoundary></div></AppContext.Provider>}><div className="main-scroll"><ScreenBoundary key={`${workspace.id}:${page.view}:${page.id || ''}`}><Suspense fallback={<div role="status">Opening page…</div>}>{view}</Suspense></ScreenBoundary></div></WorkspaceSurface> : <div id="main-content" className="main-scroll" tabIndex={-1}>
            <div className="view-entrance" key={`${page.view}-${page.id ?? 'all'}-${page.section ?? ''}-${workspace.id}-${page.projectId ?? "all"}`}><ScreenBoundary>
              <Suspense fallback={<div className="app-loading" role="status">Opening {NAV.find(item => item.id === page.view)?.label?.toLowerCase() || 'page'}…</div>}>
                {view}
              </Suspense>
            </ScreenBoundary></div>
          </div>}
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
          <FrondoseWordmark width={320} />
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
                await frondoseActions.updateProfile({ name: profile.trim() });
              const workspace = await frondoseActions.createWorkspace({
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

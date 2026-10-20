import { useEffect, useMemo, useRef, useState } from "react";
import { House, Inbox, Folder, GitBranch, MessageCircle, Play, Bot, Plug, Settings, Compass, Search, ChevronDown, ChevronRight, Plus, Check, PanelLeft, ArrowRight, X, BookOpen, Keyboard, Users, SquarePen, Pin } from "./icons.jsx";
import { Button, Dialog, IconButton, SearchField, useApp } from "../ui.jsx";
import { byUpdated, initials, val, visible } from "../lib/model.js";
import { TalvoriSymbol } from "./Brand.jsx";
import { AgentIdentity } from './AgentIdentity.jsx';
import { agentVisibleInSidebar } from '../lib/agents.js';
import { Tooltip } from "./Tooltip.jsx";
import { readSidebarPreferences, saveSidebarPreferences } from "../lib/sidebar-preferences.js";
import { SETTINGS_GROUPS } from '../lib/settings-catalog.js';
import { Collapse } from "./Collapse.jsx";
import { UiIcon, ChevronUp, FolderOpen, PanelLeftOpen, PanelLeftClose, Terminal, GitFork, FileText } from "./icons.jsx";
import { NAV_ITEMS, favoriteKey, organizationCounts, resolveFavorite, runningStatuses, showSidebarItem, isSidebarHidden, focusedSidebarHiddenKeys } from "../lib/organization.js";
import { Ellipsis } from './icons.jsx';
import { SHORTCUTS } from "../lib/shortcuts.js";
import { searchCatalog, searchExcerpt } from '../lib/search.js';
import { describePage } from '../lib/workspace-experience.js';
import { parsePage } from '../lib/navigation.js';
import { featureItems } from '../lib/settings-catalog.js';
import { Focus, PanelsTopLeft, NotebookPen, LibraryBig, Workflow, Route, FolderKanban, MessageSquareText, ScrollText } from './icons.jsx';
import { HelpMenu } from './HelpMenu.jsx';
import { useSidebarArrange } from './SidebarArrange.jsx';
import { TeamIconButton } from './TeamAppearance.jsx';
import { areaContactsVisible } from '../lib/areas.js';
import { ColorableNavItem, useIconColors } from './IconColors.jsx';
import { SidebarLayout } from './SidebarLayout.jsx';
import { SidebarResizeHandle } from './SidebarResizeHandle.jsx';
import { entityKey } from '../lib/sidebar-layout.js';
import { sortSidebarEntities, SECTION_LABELS } from '../lib/organization.js';
import { TalvoriAgentOrb } from './TalvoriAgentOrb.jsx';
import { useTalvoriAgentAppearance } from '../lib/talvori-agent-appearance.js';

function TalvoriAgentNavIcon() {
  const { workspace } = useApp();
  const appearance = useTalvoriAgentAppearance(workspace?.id);
  return appearance.image_url ? <img src={appearance.image_url} alt="" draggable="false" style={{ width:20,height:20,objectFit:'contain',flexShrink:0 }} /> : <TalvoriAgentOrb color={appearance.orb_color} compact />;
}
const NAV_ICONS = { 'rumbo-agent': TalvoriAgentNavIcon, starred: Pin, skills: ScrollText, workflows: Workflow, overview: House, focus: Focus, inbox: Inbox, updates: MessageSquareText, teams: Users, projects: FolderKanban, tasks: Route, chats: MessageCircle, work: Play, memory: BookOpen, agents: Bot, connections: Plug, settings: Settings, workbench: Terminal, operations: Workflow, library: LibraryBig, documents: NotebookPen, views: PanelsTopLeft };
export const NAV = NAV_ITEMS.map(item => ({ ...item, icon: NAV_ICONS[item.id] }));
const MORE_DESTINATIONS = [
  ['Work', 'focus', 'updates', 'tasks', 'work', 'workbench', 'workflows', 'operations'],
  ['Organize', 'teams', 'agents', 'chats', 'skills', 'library', 'documents', 'memory', 'views'],
  ['Connect', 'connections', 'settings'],
];

export function Sidebar({
  mobileOpen,
  setMobileOpen,
  collapsed,
  setCollapsed,
  onSearch,
  onHelp,
  overlayOpen,
  sidebarSizing,
}) {
  const {
    data,
    rawData,
    workspace,
    setWorkspace,
    page,
    navigate,
    edit,
    startSession,
    organization, customizeSidebar, toggleFavorite, updateOrganization, notify,
  } = useApp();
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const { colorsFor } = useIconColors();
  const agentAppearance = useTalvoriAgentAppearance(workspace?.id);
  const [createOpen, setCreateOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [itemOptions, setItemOptions] = useState(null);
  useEffect(() => {
    if (overlayOpen) {
      setWorkspaceOpen(false);
      setCreateOpen(false);
    }
  }, [overlayOpen]);
  const placed = new Set([...organization.layout.root, ...organization.layout.groups.flatMap(g => g.items)]);
  const sidebarItems = view => sortSidebarEntities(visible(data[view] ?? []).filter(item => !isSidebarHidden(organization, view, item.id) && !placed.has(entityKey(view, item.id))), organization.entityOrder[view]);
  const projects = sidebarItems('projects');
  const teams = sidebarItems('teams');
  const chats = sortSidebarEntities(sidebarItems('chats').toSorted((a, b) => Number(b.pinned) - Number(a.pinned) || byUpdated(a, b)), organization.entityOrder.chats);
  const recentChats = chats.slice(0, 8);
  const connectedAgent = agent => agentVisibleInSidebar(agent, data.connections);
  const agents = sidebarItems('agents').filter(connectedAgent);
  const optionsButton = (view, item) => <IconButton className="icon-button sidebar-item-options" label={`Options for ${item.name || item.title}`} aria-haspopup="dialog" aria-expanded={itemOptions?.view === view && itemOptions.id === item.id} onClick={() => setItemOptions({ view, id: item.id, title: item.name || item.title })}><Ellipsis /></IconButton>;
  const favorites = organization.favorites.map(reference => resolveFavorite(data, reference)).filter(Boolean);
  const counts = organizationCounts(data, organization);
  const focusedNavigation = organization.navigationMode === 'focused';
  const hiddenRootKeys = focusedSidebarHiddenKeys(organization);
  const layoutOrder = group => organization.order[group];
  const sectionStyle = id => ({ order: layoutOrder('sections').indexOf(id) + 1, display: showSidebarItem(id, organization, counts) ? undefined : "none" });
  const badge = (id, label) => !counts[id] || organization.badges === "none" ? null : organization.badges === "dot" ? <i className="live-dot activity-badge" aria-label={`${counts[id]} ${label}`} /> : <small className="nav-count" aria-label={`${counts[id]} ${label}`}>{counts[id]}</small>;
  const entity = page.view === "tasks" ? data.tasks.find((item) => item.id === page.id)
    : page.view === "chats" ? data.chats.find((item) => item.id === page.id) : null;
  const activeProjectId = page.projectId ?? (["projects", "workbench"].includes(page.view) ? page.id : val(entity, "project_id"));
  const activeProject = projects.find((item) => item.id === activeProjectId);
  const [preferences, setPreferences] = useState(() => {
    const saved = readSidebarPreferences(localStorage, workspace.id);
    if (page.view === 'teams' && page.id && saved.teams[page.id] === undefined) saved.teams[page.id] = true;
    if (activeProjectId && saved.projects[activeProjectId] === undefined && saved.sections.projects)
      saved.projects[activeProjectId] = true;
    return saved;
  });
  const previousProject = useRef(activeProjectId);
  useEffect(() => {
    if (page.view === 'teams' && page.id) setPreferences(current => ({ ...current, sections: { ...current.sections, teams: true }, teams: { ...current.teams, [page.id]: true } }));
  }, [page.view, page.id]);
  useEffect(() => {
    saveSidebarPreferences(localStorage, workspace.id, preferences);
  }, [workspace.id, preferences]);
  useEffect(() => {
    if (activeProjectId && previousProject.current !== activeProjectId) setPreferences((current) => ({ ...current,
      sections: { ...current.sections, projects: true },
      projects: { ...current.projects, [activeProjectId]: true },
    }));
    previousProject.current = activeProjectId;
  }, [activeProjectId]);
  const [isMobile, setIsMobile] = useState(
    () => matchMedia("(max-width: 800px)").matches,
  );
  const sidebarRef = useRef(null);
  const workspaceTriggerRef = useRef(null);
  const createTriggerRef = useRef(null);
  useEffect(() => {
    const media = matchMedia("(max-width: 800px)");
    const change = () => {
      setIsMobile(media.matches);
      if (!media.matches) setMobileOpen(false);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [setMobileOpen]);
  useEffect(() => {
    if (!mobileOpen || !isMobile) return;
    const previous = document.activeElement;
    sidebarRef.current?.querySelector("button")?.focus();
    const key = (event) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = [
        ...sidebarRef.current.querySelectorAll(
          "button:not(:disabled), a[href]",
        ),
      ].filter((item) => item.getClientRects().length && !item.closest("[inert]"));
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault();
        items.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
        event.preventDefault();
        items[0]?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus?.();
    };
  }, [mobileOpen, isMobile, setMobileOpen]);
  const go = (view, id, options) => {
    navigate(view, id, options);
    setMobileOpen(false);
    sidebarSizing?.setPeek(false);
    setWorkspaceOpen(false);
    setCreateOpen(false);
  };
  useEffect(() => {
    if (!workspaceOpen && !createOpen) return;
    const close = (event) => {
      if (!event.target.closest(".workspace-picker")) setWorkspaceOpen(false);
      if (!event.target.closest(".sidebar-create")) setCreateOpen(false);
    };
    const escape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      (workspaceOpen ? workspaceTriggerRef : createTriggerRef).current?.focus();
      setWorkspaceOpen(false);
      setCreateOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape, true);
    };
  }, [workspaceOpen, createOpen]);
  const create = (kind, defaults = {}) => {
    setMobileOpen(false);
    setCreateOpen(false);
    setWorkspaceOpen(false);
    if (kind === "session") startSession(defaults);
    else edit(kind, null, defaults);
  };
  const toggleSection = (section) => setPreferences((current) => ({ ...current,
    sections: { ...current.sections, [section]: !current.sections[section] },
  }));
  const arrange = useSidebarArrange({ organization, updateOrganization, notify, create, toggleFavorite });
  const creationKind = id => ({ projects: 'project', teams: 'team', agents: 'agent', chats: 'chat', tasks: 'task', workspace: 'task', memory: 'memory' })[id];
  const layoutBinding = (id, title) => arrange.bind({ id, title: title ?? SECTION_LABELS[id] ?? NAV.find(n => n.id === id)?.label, group: Object.keys(organization.order).find(group => organization.order[group].includes(id)), kind: creationKind(id) });
  const entityBinding = (view, item) => arrange.bind({ entity: true, group: view, id: item.id, title: item.name || item.title, items: sidebarItems(view).map(i => i.id), kind: ['projects', 'teams'].includes(view) ? 'task' : creationKind(view), defaults: view === 'projects' ? { project_id: item.id } : view === 'teams' ? { team_id: item.id } : {} });
  const toggleProject = (id) => setPreferences((current) => ({ ...current,
    projects: { ...current.projects, [id]: !current.projects[id] },
  }));
  const navItem = (id, label) => {
    if (!showSidebarItem(id, organization, counts)) return null;
    const item = NAV.find((entry) => entry.id === id), Icon = item.icon;
    const itemLabel = label ?? (id === 'rumbo-agent' ? agentAppearance.display_name : item.label);
    const active = page.view === id && ((collapsed && !isMobile) || !activeProject);
    return <Tooltip key={id} label={`${itemLabel}${organization.shortcuts ? ` · G ${item.key}` : ""}`}><ColorableNavItem compact={collapsed && !isMobile} colorId={`main:${id}`} icon={Icon} label={itemLabel} className={active ? 'active' : ''}
      {...layoutBinding(id, itemLabel)} aria-current={active ? "page" : undefined} onClick={() => go(id)}>
      {badge(id, `${itemLabel.toLowerCase()} items`)}
    </ColorableNavItem></Tooltip>;
  };
  const sectionHeader = (section, label, target, onCreate) => <div className="sidebar-section-heading" {...layoutBinding(section, label)}>
    <button className="section-disclosure" aria-label={`${preferences.sections[section] ? "Collapse" : "Expand"} ${label.toLowerCase()}`}
      aria-expanded={preferences.sections[section]} aria-controls={`navigation-${section}`} onClick={() => toggleSection(section)}>
      <span className="disclosure-chevron"><ChevronRight morphTo={preferences.sections[section] ? ChevronDown : ChevronRight} interactive={false} /></span>
    </button>
    {target ? <Tooltip label={`All ${label.toLowerCase()}`}><button className={`section-title ${page.view === target && !page.id && !page.projectId ? "active" : ""}`}
      aria-current={page.view === target && !page.id && !page.projectId ? "page" : undefined}
      onClick={() => go(target)}>{label}</button></Tooltip>
      : <button className="section-title" onClick={() => toggleSection(section)} aria-expanded={preferences.sections[section]}>{label}</button>}
    {!preferences.sections[section] ? badge(section, `${label.toLowerCase()} items`) : null}
    {onCreate ? <IconButton label={`New ${section === "projects" ? "project" : section === "teams" ? "Area" : section === "agents" ? "agent" : "chat"}`} onClick={onCreate}><Plus /></IconButton> : null}
  </div>;
  return (
    <>
      <button
        className={`mobile-scrim ${mobileOpen ? "open" : ""}`}
        onClick={() => setMobileOpen(false)}
        aria-label="Close navigation"
        tabIndex={mobileOpen ? 0 : -1}
      />
      <aside
        ref={sidebarRef}
        data-spacing={organization.density}
        inert={isMobile && !mobileOpen || !isMobile && sidebarSizing?.hidden && !sidebarSizing?.peek ? true : undefined}
        className={`sidebar sidebar-v2 ${mobileOpen ? "mobile-open" : ""} ${collapsed ? "collapsed" : ""}`}
        onPointerLeave={() => { if (sidebarSizing?.hidden) sidebarSizing.setPeek(false); }}
      >
        {!sidebarSizing?.hidden ? <SidebarResizeHandle width={sidebarSizing?.width ?? 280} preview={sidebarSizing?.preview} onResize={sidebarSizing?.resize} onHide={sidebarSizing?.hide} onRestore={sidebarSizing?.restore} /> : null}
        <div className="sidebar-workspace-row">
        <div className="workspace-picker">
          <button
            className="workspace-trigger"
            ref={workspaceTriggerRef}
            aria-label="Switch workspace"
            aria-expanded={workspaceOpen}
            onClick={() => { setWorkspaceOpen(!workspaceOpen); setCreateOpen(false); }}
          >
            {workspace.image_url ? <img className="workspace-picture" src={workspace.image_url} alt="" /> : <TalvoriSymbol size={34} decorative />}
            <span className="workspace-name">{workspace.name}</span>
            <ChevronDown morphTo={workspaceOpen ? ChevronUp : ChevronDown} interactive={false} />
          </button>
          {workspaceOpen ? (
            <div className="popover workspace-options">
              <div className="popover-label">Your workspaces</div>
              {visible(rawData.workspaces).map((item) => (
                <button
                  key={item.id}
                  aria-label={`Switch to ${item.name}`}
                  aria-pressed={item.id === workspace.id}
                  onClick={() => {
                    setWorkspace(item.id);
                    setWorkspaceOpen(false);
                    setMobileOpen(false);
                  }}
                >
                  <span className="workspace-initial" aria-hidden="true">{item.image_url ? <img src={item.image_url} alt="" /> : initials(item.name)}</span>
                  <span>{item.name}</span>
                  {item.id === workspace.id ? <Check /> : null}
                </button>
              ))}
              <div className="menu-divider" />
              <button onClick={() => go("settings", "workspace")}><Settings /><span>Workspace settings</span></button>
              <button onClick={() => { setWorkspaceOpen(false); setMobileOpen(false); onHelp(); }}><Keyboard /><span>Keyboard shortcuts</span></button>
              <button
                onClick={() => create("workspace")}
              >
                <Plus />
                <span>New workspace</span>
              </button>
            </div>
          ) : null}
        </div>
        <div className="sidebar-header-actions">
          <IconButton label={isMobile ? "Close navigation" : collapsed ? "Expand navigation" : "Collapse navigation"}
            onClick={() => isMobile ? setMobileOpen(false) : setCollapsed(!collapsed)}><UiIcon icon={isMobile ? X : collapsed ? PanelLeftOpen : PanelLeftClose} /></IconButton>
          <div className="sidebar-create">
            <IconButton ref={createTriggerRef} label="Create new" aria-expanded={createOpen} onClick={() => { setCreateOpen(!createOpen); setWorkspaceOpen(false); }}><SquarePen /></IconButton>
            {createOpen ? <div className="popover create-options">
              <div className="popover-label">Create in {workspace.name}</div>
              {[["task", "Route", GitBranch], ["project", "Project", Folder], ["team", "Area", Users], ["chat", "Chat", MessageCircle], ["memory", "Memory note", BookOpen], ["session", "Session", Play]].map(([kind, label, Icon]) =>
                <button key={kind} onClick={() => create(kind, activeProject && !["project", "team"].includes(kind) ? { project_id: activeProject.id } : {})}><Icon /><span>{label}</span></button>)}
            </div> : null}
          </div>
        </div>
        </div>
        <nav aria-label="Main navigation">
          <SidebarLayout organization={organization} hiddenRootKeys={hiddenRootKeys} arrange={arrange} renderTab={navItem} updateOrganization={updateOrganization} customizeSidebar={customizeSidebar} renderEntity={({ view, id }) => {
            const item = visible(data[view] ?? []).find(item => item.id === id);
            if (!item || isSidebarHidden(organization, view, id) || view === 'agents' && !connectedAgent(item)) return null;
            const Icon = NAV_ICONS[view];
            if (view === 'teams') return <div className="project-nav-row" {...entityBinding(view, item)}><TeamIconButton team={item} size={19} /><button className="project-nav-name" style={{ color: colorsFor(`entity:teams:${id}`, item.tab_label_color === 'global' ? undefined : item).label || undefined }} onClick={() => go(view, id)}><span>{item.name}</span></button></div>;
            return <ColorableNavItem colorId={`entity:${view}:${id}`} icon={view === 'agents' ? () => <AgentIdentity agent={item} compact /> : Icon} label={item.name || item.title} team={data.teams.find(t => t.id === item.team_id)} {...entityBinding(view, item)} onClick={() => go(view, id)} />;
          }}>
          <div className="nav-group main-nav">
            {layoutOrder('primary').filter(id => showSidebarItem(id, organization, counts)).map((id) => navItem(id))}
          </div>
          <section data-layout-id="agents" className="sidebar-section agents-navigation" style={sectionStyle("agents")}>
            <div className="collapsed-section-link">{navItem("agents")}</div>
            {sectionHeader("agents", "Your Agents", "agents", () => create("agent"))}
            <Collapse id="navigation-agents" className="sidebar-section-content nav-group" open={preferences.sections.agents}>
              {agents.map(agent => {
                const active = data.runs.filter(run => val(run, "agent_id") === agent.id && runningStatuses.has(run.status)).length;
                return <div className="sidebar-entity-row" key={agent.id} {...entityBinding("agents", agent)}><Tooltip label={`${agent.name}${active ? ` · ${active} active sessions` : agent.status === "paused" ? " · Paused" : " · Agent profile"}`}><ColorableNavItem colorId={`entity:agents:${agent.id}`} icon={() => <AgentIdentity agent={agent} compact />} label={agent.name} className={page.view === 'agents' && page.id === agent.id ? 'active' : ''} onClick={() => go('agents', agent.id)}>{active && organization.badges !== 'none' ? organization.badges === 'dot' ? <i className="live-dot" /> : <small className="nav-count">{active}</small> : null}</ColorableNavItem></Tooltip>{optionsButton('agents', agent)}</div>;
              })}
              {!agents.length ? <button className="sidebar-empty-action" onClick={() => create("agent")}><Plus /><span>Create an agent</span></button> : null}
            </Collapse>
          </section>
          <section data-layout-id="teams" className="sidebar-section team-navigation" style={sectionStyle("teams")}>
            <div className="collapsed-section-link">{navItem("teams")}</div>
            {sectionHeader("teams", "Areas", "teams", () => create("team"))}
            <Collapse id="navigation-teams" className="sidebar-section-content nav-group" open={preferences.sections.teams}>
              {teams.map(team => <div className="sidebar-project sidebar-team-group" key={team.id}>
                <div {...entityBinding("teams", team)} className={`project-nav-row ${page.view === 'teams' && page.id === team.id ? 'current-project' : ''}`}>
                  <button className="project-disclosure" aria-expanded={Boolean(preferences.teams[team.id])} aria-label={`${preferences.teams[team.id] ? 'Collapse' : 'Expand'} Area ${team.name}`} aria-controls={`team-navigation-${team.id}`} onClick={() => setPreferences(current => ({ ...current, teams: { ...current.teams, [team.id]: !current.teams[team.id] } }))}><ChevronRight morphTo={preferences.teams[team.id] ? ChevronDown : ChevronRight} interactive={false} /></button>
                  <TeamIconButton team={team} size={19} /><Tooltip label={team.name}><button className="project-nav-name" style={{ color: colorsFor(`team:${team.id}:identity`, team).label || undefined }} onClick={() => go('teams', team.id)}><span>{team.name}</span></button></Tooltip>{optionsButton('teams', team)}
                </div>
                <Collapse className="project-nav-children" id={`team-navigation-${team.id}`} open={Boolean(preferences.teams[team.id])}>
                  {[['overview', 'Overview', House], ['routes', 'Routes', GitBranch], ['projects', 'Projects', Folder], ['resources', 'Resources', FileText], ['documents', 'Documents', BookOpen], ['updates', 'Updates', NAV_ICONS.updates], ['people', 'Contacts', Users]].filter(([section]) => section !== 'people' || areaContactsVisible(data, team.id)).map(([section, label, Icon]) => {
                    const active = page.view === 'teams' && page.id === team.id && (page.section || 'overview') === section;
                    return <ColorableNavItem key={section} colorId={`team:${team.id}:${section}`} team={team} icon={Icon} label={label} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} aria-label={`${team.name} · ${label}`} onClick={() => go('teams', team.id, { section })} />;
                  })}
                </Collapse>
              </div>)}
              {!teams.length ? <button className="sidebar-empty-action" onClick={() => create("team")}><Plus /><span>Create your first Area</span></button> : null}
            </Collapse>
          </section>
          <section data-layout-id="projects" className="sidebar-section project-navigation" style={sectionStyle("projects")}>
            <div className="collapsed-section-link">{navItem("projects")}</div>
            {sectionHeader("projects", "Projects", "projects", () => create("project"))}
            <Collapse id="navigation-projects" className="sidebar-section-content" open={preferences.sections.projects}>
              {projects.map((project) => <div className="sidebar-project" key={project.id}>
                <div {...entityBinding("projects", project)} className={`project-nav-row ${activeProject?.id === project.id ? "current-project" : ""}`}>
                  <button className="project-disclosure" aria-expanded={Boolean(preferences.projects[project.id])}
                    aria-label={`${preferences.projects[project.id] ? "Collapse" : "Expand"} ${project.name}`}
                    aria-controls={`project-navigation-${project.id}`} onClick={() => toggleProject(project.id)}>
                    <span className="disclosure-chevron"><ChevronRight morphTo={preferences.projects[project.id] ? ChevronDown : ChevronRight} interactive={false} /></span>
                  </button>
                  {project.image_url ? <Tooltip label={project.name}><button className="project-nav-name" style={{ color: colorsFor(`entity:projects:${project.id}`, data.teams.find(t => t.id === project.team_id)).label || undefined }} onClick={() => go('projects', project.id)}><img className="project-picture" src={project.image_url} alt="" /><span>{project.name}</span></button></Tooltip> : <ColorableNavItem className="project-nav-name" colorId={`entity:projects:${project.id}`} team={data.teams.find(t => t.id === project.team_id)} icon={preferences.projects[project.id] ? FolderOpen : Folder} label={project.name} onClick={() => go('projects', project.id)} />}
                  {optionsButton('projects', project)}
                </div>
                <Collapse className="project-nav-children" id={`project-navigation-${project.id}`} open={Boolean(preferences.projects[project.id])}>
                  {[["projects", "Overview", House], ["workbench", "Workbench", Terminal], ["tasks", "Routes", GitBranch], ["chats", "Chats", MessageCircle], ["library", "Outputs", FileText], ["memory", "Memory", BookOpen]].map(([view, label, Icon]) => {
                    const active = activeProject?.id === project.id && page.view === view;
                    return <Tooltip key={view} label={`${project.name} · ${label}`}><ColorableNavItem colorId={`project:${project.id}:${view}`} team={data.teams.find(t => t.id === project.team_id)} icon={Icon} label={label} className={active ? 'active' : ''}
                      aria-label={`${project.name} · ${label}`}
                      aria-current={active ? "page" : undefined}
                      onClick={() => ["projects", "workbench"].includes(view) ? go(view, project.id) : go(view, null, { projectId: project.id })}>
                    </ColorableNavItem></Tooltip>;
                  })}
                </Collapse>
              </div>)}
              {!projects.length ? <button className="sidebar-empty-action" onClick={() => create("project")}><Plus /><span>Create your first project</span></button> : null}
            </Collapse>
          </section>
          <section className="sidebar-section workspace-navigation" style={sectionStyle("workspace")}>
            {sectionHeader("workspace", "Workspace")}
            <Collapse id="navigation-workspace" className="sidebar-section-content nav-group" open={(collapsed && !isMobile) || preferences.sections.workspace}>
              {layoutOrder('tools').filter(id => showSidebarItem(id, organization, counts)).map((id) => navItem(id, id === "tasks" ? "All routes" : undefined))}
            </Collapse>
          </section>
          <section className="sidebar-section saved-view-navigation" style={sectionStyle('views')}>
            {navItem('views')}
          </section>
          <section data-layout-id="chats" className="sidebar-section chat-navigation" style={sectionStyle("chats")}>
            <div className="collapsed-section-link">{navItem("chats")}</div>
            {sectionHeader("chats", "Conversations", "chats", () => create("chat"))}
            <Collapse id="navigation-chats" className="sidebar-section-content nav-group" open={preferences.sections.chats}>
              {recentChats.map((chat) => <div className="sidebar-entity-row" key={chat.id} {...entityBinding("chats", chat)}><Tooltip label={chat.title}><ColorableNavItem colorId={`entity:chats:${chat.id}`} icon={chat.pinned ? Pin : MessageCircle} label={chat.title}
                aria-current={page.id === chat.id && (page.view === "chats" || page.view === "rumbo-agent") ? "page" : undefined}
                className={`nav-item sidebar-chat ${page.id === chat.id && (page.view === "chats" || page.view === "rumbo-agent") ? "active" : ""}`}
                onClick={() => go(chat.kind === 'rumbo-agent' ? 'rumbo-agent' : 'chats', chat.id)}>
                </ColorableNavItem></Tooltip>{optionsButton('chats', chat)}</div>)}
              {!chats.length ? <button className="sidebar-empty-action" onClick={() => create("chat")}><Plus /><span>Start a conversation</span></button> : null}
            </Collapse>
          </section>
          </SidebarLayout>
          {focusedNavigation ? <button type="button" className={`sidebar-more-trigger nav-item ${hiddenRootKeys.includes(page.view) ? 'active' : ''}`} aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => { setMobileOpen(false); setMoreOpen(true); }}><Ellipsis aria-hidden="true" /><span>More</span></button> : null}
        </nav>
        <div className="sidebar-bottom">
          <HelpMenu onNavigate={go} onAction={() => setMobileOpen(false)} overlayOpen={overlayOpen} />
        </div>
      </aside>
      {arrange.dialog}
      {moreOpen ? <Dialog title="More in Talvori" subtitle="Every page is still available. Choose All tools in sidebar settings to keep them visible." onClose={() => setMoreOpen(false)} className="sidebar-more-dialog"><div className="sidebar-more-groups">{MORE_DESTINATIONS.map(([title, ...ids]) => <section key={title}><h3>{title}</h3><div>{ids.map(id => { const item = NAV.find(entry => entry.id === id); const Icon = item.icon; return <button type="button" key={id} onClick={() => { setMoreOpen(false); go(id); }}><Icon aria-hidden="true" /><span>{item.label}</span><ArrowRight aria-hidden="true" /></button>; })}</div></section>)}<Button variant="ghost" icon={PanelLeft} onClick={() => { setMoreOpen(false); customizeSidebar(); }}>Customize navigation</Button></div></Dialog> : null}
      {itemOptions ? <Dialog title={itemOptions.title} subtitle="Sidebar options" onClose={() => setItemOptions(null)}><div className="sidebar-item-dialog">
        {itemOptions.view === 'teams' ? <Button icon={Settings} onClick={() => { const teamId = itemOptions.id; setItemOptions(null); go('settings', `team:${teamId}`); }}>Area settings</Button> : null}
        <Button icon={Pin} onClick={() => { toggleFavorite(itemOptions); setItemOptions(null); }}>{favorites.some(item => favoriteKey(item) === favoriteKey(itemOptions)) ? 'Remove from favorites' : 'Add to favorites'}</Button><Button icon={PanelLeftClose} onClick={() => { try { updateOrganization({ ...organization, hiddenItems: [...organization.hiddenItems, { view: itemOptions.view, id: itemOptions.id }] }); setItemOptions(null); notify('Hidden from sidebar. Restore it in Customize sidebar.'); } catch (error) { notify(error.message, 'error'); } }}>Hide from sidebar</Button><p className="organization-note">This does not archive anything or stop active work. You can still find it through search or its collection.</p></div></Dialog> : null}
    </>
  );
}

export function CommandPalette({ onClose }) {
  const { data, navigate, edit, startSession, customizeSidebar, showShortcuts, organization, experience } = useApp();
  const [docArticles, setDocArticles] = useState([]);
  useEffect(() => { let active = true; import('../lib/docs-content.js').then(module => { if (active) setDocArticles(module.DOC_ARTICLES); }); return () => { active = false; }; }, []);
  const [query, setQuery] = useState(""),
    [index, setIndex] = useState(0);
  const resultsRef = useRef(null);
  useEffect(() => {
    resultsRef.current
      ?.querySelector(".selected")
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);
  const catalog = useMemo(
    () => { const entities = new Map(['projects', 'tasks', 'chats', 'agents', 'outputs', 'runs', 'memory_notes', 'documents', 'messages', 'workspace_items'].flatMap(key => data[key] ?? []).map(row => [row.id, row]));
      const chats = new Map(visible(data.chats).map(row => [row.id, row]));
      const projects = new Map(data.projects.map(row => [row.id, row]));
      const versions = new Map((data.output_versions ?? []).map(row => [`${row.output_id}:${row.number}`, row]));
      return [
      ...organization.favorites.map(reference => resolveFavorite(data, reference)).filter(Boolean).map(item => ({ id: `favorite-${favoriteKey(item)}`, type: "Favorite", title: item.title, subtitle: NAV.find(entry => entry.id === item.view)?.label, icon: Pin, run: () => navigate(item.view, item.id) })),
      ...(experience?.recent ?? []).slice(0, 6).flatMap(ref => { const page = parsePage(ref.hash), title = describePage(data, page); return title ? [{ id: `recent-${ref.hash}`, type: 'Recent', title, subtitle: NAV.find(item => item.id === page.view)?.label, icon: NAV_ICONS[page.view] || House, run: () => navigate(page.view, page.id, page) }] : []; }),
      { id: "customize-sidebar", type: "Action", title: "Customize sidebar", subtitle: "Visibility, order, spacing and badges", icon: PanelLeft, run: customizeSidebar },
      { id: "start-session", type: "Action", title: "Start session", subtitle: "Choose an agent and review access before running", icon: Play, run: () => startSession() },
      { id: "keyboard-help", type: "Action", title: "Keyboard shortcuts", subtitle: "Find shortcuts or turn off letter keys", icon: Keyboard, run: showShortcuts },
      ...NAV.map((item) => ({
        ...item,
        type: "Navigate",
        title: item.label,
        subtitle: `Open ${item.label.toLowerCase()}`,
        run: () => navigate(item.id),
      })),
      ...["project", "team", "task", "chat", "agent", "memory"].map((kind) => ({
        id: `create-${kind}`,
        type: "Action",
        title: `New ${kind === "team" ? "Area" : kind === "task" ? "route" : kind === "memory" ? "memory note" : kind}`,
        subtitle: "Create in this workspace",
        icon: Plus,
        run: () => edit(kind),
      })),
      ...visible(data.projects).map((item) => ({
        id: item.id,
        type: "Project",
        title: item.name,
        subtitle: item.description,
        icon: Folder,
        run: () => navigate("projects", item.id),
      })),
      ...SETTINGS_GROUPS.flatMap(([group, sections]) => sections.map(([id, label]) => ({ id: `setting-${id}`, type: 'Settings', title: `${group} · ${label}`, subtitle: 'Configure your workspace', icon: Settings, run: () => navigate('settings', id) }))),
      ...docArticles.map(article => ({ id: `doc-${article.id}`, type: 'Documentation', title: article.title, subtitle: article.description, searchText: article.sections?.map(section => `${section.title} ${section.paragraphs?.join(' ') || ''}`).join(' '), icon: BookOpen, run: () => navigate('docs', article.id) })),
      ...visible(data.teams ?? []).map((item) => ({
        id: item.id,
        type: "Area",
        title: item.name,
        subtitle: item.description,
        icon: Users,
        run: () => navigate("teams", item.id),
      })),
      ...visible(data.tasks).map((item) => ({
        id: item.id,
        type: "Route",
        title: item.title,
        subtitle: item.description,
        icon: GitBranch,
        run: () => navigate("tasks", item.id),
      })),
      ...visible(data.chats).map((item) => ({
        id: item.id,
        type: "Chat",
        title: item.title,
        subtitle: "Open conversation",
        icon: MessageCircle,
        run: () => navigate("chats", item.id),
      })),
      ...visible(data.agents).map((item) => ({
        id: item.id,
        type: "Agent",
        title: item.name,
        subtitle: item.provider,
        icon: Bot,
        run: () => navigate("agents", item.id),
      })),
      ...visible(data.outputs ?? []).map(item => ({ id: item.id, type: 'Output', title: item.title, subtitle: `${item.kind} · ${item.state} · v${item.current_version}`, searchText: versions.get(`${item.id}:${item.current_version}`)?.content, icon: FileText, run: () => navigate('library', item.id) })),
      ...visible(data.runs ?? []).map(item => ({ id: item.id, type: 'Session', title: item.title || 'Untitled session', subtitle: item.status, searchText: item.summary || '', icon: Play, run: () => navigate('work', item.id) })),
      ...visible(data.memory_notes ?? []).map(item => ({ id: item.id, type: 'Memory', title: item.title, subtitle: item.content, icon: BookOpen, run: () => navigate('memory', item.id) })),
      ...visible(data.documents ?? []).map(item => ({ id: item.id, type: 'Document', title: item.title, subtitle: item.content, icon: FileText, run: () => navigate('documents', item.id) })),
      ...featureItems(data, 'saved_view').map(item => ({ id: item.id, type: 'View', title: item.name, subtitle: 'Saved route filters', icon: Compass, run: () => navigate('views', item.id) })),
      ...(data.messages ?? []).filter(item => chats.has(item.chat_id)).map(item => ({ id: item.id, type: 'Message', title: chats.get(item.chat_id).title, subtitle: `${item.sender_name || 'Message'} · ${item.content}`, searchText: item.content, searchOnly: true, icon: MessageCircle, run: () => navigate('chats', item.chat_id, { messageId: item.id }) })),
    ].map(item => { const entity = entities.get(item.id); const projectId = item.type === 'Project' ? item.id : entity?.project_id || chats.get(entity?.chat_id)?.project_id; return { ...item, id: `${item.type}:${item.id}`, projectName: projects.get(projectId)?.name || '', status: entity?.state || entity?.status || '' }; }); },
    [data, navigate, edit, startSession, customizeSidebar, showShortcuts, organization.favorites, experience?.recent, docArticles],
  );
  const results = searchCatalog(catalog, query);
  function execute(item) {
    if (item) {
      onClose();
      item.run();
    }
  }
  return (
    <Dialog title="Search Talvori" onClose={onClose} className="command-dialog">
      <div className="command-search">
        <Search />
        <input
          autoFocus
          aria-label="Search projects, Areas, Routes, chats and actions"
          placeholder="Search anything · try type:output or project:Atlas"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (["ArrowDown", "ArrowUp"].includes(e.key)) {
              e.preventDefault();
              setIndex((i) =>
                Math.max(
                  0,
                  Math.min(
                    results.length - 1,
                    i + (e.key === "ArrowDown" ? 1 : -1),
                  ),
                ),
              );
            }
            if (e.key === "Enter") {
              e.preventDefault();
              execute(results[index]);
            }
          }}
        />
        <kbd>Esc</kbd>
      </div>
      <div className="command-results" ref={resultsRef}>
        <div className="popover-label">
          {query ? `${results.length} results` : "Quick access"}
        </div>
        {results.map((item, i) => (
          <button
            key={item.id}
            className={i === index ? "selected" : ""}
            onMouseEnter={() => setIndex(i)}
            onClick={() => execute(item)}
          >
            <item.icon />
            <span>
              <strong>{item.title}</strong>
              <small>
                {item.type}
                {item.subtitle ? ` · ${searchExcerpt(item.subtitle, query)}` : ""}
              </small>
            </span>
            {item.key ? <kbd>G {item.key}</kbd> : <ArrowRight />}
          </button>
        ))}
        {!results.length ? (
          <p className="command-empty">
            No results. Try a project, route, or action.
          </p>
        ) : null}
      </div>
      <footer className="command-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> to move
        </span>
        <span>
          <kbd>↵</kbd> to open
        </span>
      </footer>
    </Dialog>
  );
}
export function Shortcuts({ onClose }) {
  const { organization, updateOrganization, notify } = useApp();
  const [query, setQuery] = useState("");
  const entries = SHORTCUTS.filter(item => `${item.label} ${item.keys} ${item.group}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <Dialog
      title="Keyboard shortcuts"
      subtitle="Press letter pairs in sequence, not together. Shortcuts never run an agent or approve work."
      onClose={onClose}
      className="shortcut-dialog"
    >
      <div className="shortcut-tools"><SearchField value={query} onChange={setQuery} placeholder="Find a shortcut…" /><label className="shortcut-enable"><input type="checkbox" checked={organization.shortcuts} onChange={event => { try { updateOrganization({ ...organization, shortcuts: event.target.checked }); } catch (error) { notify(error.message, "error"); } }} />Enable letter-key shortcuts outside text fields</label><p className="organization-note">⌘ / Ctrl K and Escape remain available. Turn letter keys off if they conflict with assistive technology.</p></div>
      <div className="shortcut-list">
        {["Essentials", "Create", "Navigate"].map(group => entries.some(item => item.group === group) ? <section key={group}><h3>{group}</h3>{entries.filter(item => item.group === group).map(item => <div key={item.id}><span>{item.label}</span><kbd>{item.keys}</kbd></div>)}</section> : null)}
        {!entries.length ? <p>No shortcuts match your search.</p> : null}
      </div>
    </Dialog>
  );
}

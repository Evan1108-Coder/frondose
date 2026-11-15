import {TodoBoard} from './TodoBoard.jsx';
import { useState } from "react";
import { WorkspaceUpdates } from "./Updates.jsx";
import { ActivityTimeline } from "../components/ActivityTimeline.jsx";
import { Archive, RotateCcw, ArrowLeft, ArrowRight, Pencil, Plus, Users, UserPlus } from "../components/icons.jsx";
import { Button, Empty, IconButton, PageHeader, SearchField, Select, useApp } from "../ui.jsx";
import { frondoseActions } from "../data/useFrondose.js";
import { byUpdated, initials, STATUSES, visible } from "../lib/model.js";
import { teamProjects, teamRoutes } from "../lib/workspace-spaces.js";
import { SpaceArchiveDialog } from "../components/WorkspaceEditor.jsx";
import { DocumentContent } from "../components/DocumentContent.jsx";
import { DocumentsPanel, SpaceTabs } from "./SpaceComponents.jsx";
import { ProjectRow } from "./Overview.jsx";
import { RouteRows } from "./Projects.jsx";
import { TeamResources } from "./TeamResources.jsx";
import "./workspace-spaces.css";
import { TeamIcon, TeamIconButton } from "../components/TeamAppearance.jsx";
import { AreaSettings, useAreaSettings } from '../components/AreaSettings.jsx';
import { areaContactsVisible } from '../lib/areas.js';
import { isLocalProduct } from '../lib/local-product.js';
import { agentReadiness } from '../lib/agents.js';
import { AgentLinks } from '../components/AgentLinks.jsx';

const TABS = [{id:"todos",label:"To Do List"},{ id: "overview", label: "Overview" }, { id: "routes", label: "Routes" }, { id: "projects", label: "Projects" }, { id: "agents", label: "AI agents" }, { id: "resources", label: "Resources" }, { id: "documents", label: "Documents" }, { id: "updates", label: "Updates" }, { id: "people", label: "Contacts" }, { id: 'settings', label: 'Settings' }];

export function TeamsView() {
  const { data, page, navigate, edit, perform, notify } = useApp();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const selected = visible(data.teams).find((team) => team.id === page.id);
  if (selected) return <TeamHub key={selected.id} team={selected} />;
  if (page.id) return <main className="page"><Empty kind="teams" title="Area unavailable" description="This Area may be archived or belong to another workspace." action="All Areas" onAction={() => navigate("teams")} /></main>;
  const allTeams = data.teams ?? [];
  const teams = allTeams.filter((team) => Boolean(team.archived_at) === (filter === "archived") && `${team.name} ${team.description ?? ""}`.toLowerCase().includes(query.toLowerCase())).toSorted(byUpdated);
  const empty = !allTeams.length;
  return <main className="page space-page teams-page">{!empty ? <><PageHeader title="Areas" description="A home for each domain of your work: projects, Routes, knowledge, and agent defaults."><Button variant="primary" icon={Plus} onClick={() => edit("team")}>New Area</Button></PageHeader><div className="space-section-toolbar"><SearchField value={query} onChange={setQuery} placeholder="Search Areas…" /><Select aria-label="Area visibility" value={filter} onChange={setFilter}><option value="active">Active Areas</option><option value="archived">Archived Areas</option></Select><span className="toolbar-count">{teams.length} Areas</span></div></> : null}
    {teams.length ? <div className="team-list"><div className="team-list-heading"><span>Area</span><span>Projects</span><span>Routes</span><span /></div>{teams.map((team) => <div className="team-list-row" key={team.id}><button className="space-row-main" disabled={Boolean(team.archived_at)} onClick={() => navigate("teams", team.id)}><span className="space-team-icon"><TeamIcon team={team} size={24} /></span><span><strong>{team.name}</strong><small>{team.description || "Projects, routes, and shared context"}</small></span></button><span className="team-list-count">{teamProjects(data, team.id).length}<small> projects</small></span><span className="team-list-count">{teamRoutes(data, team.id).length}<small> Routes</small></span>{team.archived_at ? <Button icon={RotateCcw} onClick={() => perform(async () => { await frondoseActions.updateTeam(team.id, { archived_at: null }); notify("Area restored"); })}>Restore</Button> : <IconButton label={`Open ${team.name}`} onClick={() => navigate("teams", team.id)}><ArrowRight /></IconButton>}</div>)}</div> : <Empty compact={!empty} kind={query ? "search" : "teams"} icon={Users} title={query ? "No matching Areas" : filter === "archived" ? "No archived Areas" : "A space for every Area"} description={query ? "Try another Area name or description." : filter === "archived" ? "Areas you archive are kept here and can be restored." : "Organize Product, Engineering, Research, or personal administration. An Area works with or without collaborators."} action={query ? "Clear search" : filter === "active" ? "Create Area" : "Show active Areas"} onAction={() => query ? setQuery("") : filter === "active" ? edit("team") : setFilter("active")} />}
  </main>;
}

function TeamHub({ team }) {
  const { data, page, edit, navigate } = useApp();
  const local = isLocalProduct(data);
  const settings = useAreaSettings(team.id);
  const contactsVisible = areaContactsVisible(data, team.id, settings.value);
  const tabs = TABS.filter(item => (local || item.id !== 'todos') && (!local || item.id !== 'agents') && (item.id !== 'people' || !local && (contactsVisible || page.section === 'people')));
  const defaultAgents = (settings.value?.default_agent_ids ?? []).map(id => data.agents.find(agent => agent.id === id)).filter(agent => agent && !agent.archived_at);
  const tab = tabs.some(item => item.id === page.section) ? page.section : 'overview';
  const setTab = section => navigate('teams', team.id, { section });
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [archiving, setArchiving] = useState(false);
  const projects = teamProjects(data, team.id).toSorted(byUpdated);
  const routes = teamRoutes(data, team.id).toSorted(byUpdated);
  const people = visible(data.team_members).filter((member) => member.team_id === team.id);
  const filteredRoutes = routes.filter((route) => `${route.title} ${route.description ?? ""}`.toLowerCase().includes(query.toLowerCase()) && (status === "all" || route.status === status));
  function primary() {
    if (tab === "people") edit("teamMember", null, { team_id: team.id });
    else if (tab === "projects") edit("project", null, { team_id: team.id });
    else if (tab === "documents") edit("document", null, { team_id: team.id });
    else edit("task", null, { team_id: team.id });
  }
  return <main className="page space-page team-hub"><button className="back-link" onClick={() => navigate("teams")}><ArrowLeft />All Areas</button><PageHeader title={<span className="team-heading-title"><TeamIconButton team={team} size={32} />{team.name}</span>} description={team.description || "A focused space for your work in this Area."}><Button icon={Pencil} onClick={() => edit("team", team)}>Edit Area</Button>{!['todos', 'resources', 'updates', 'settings', 'agents'].includes(tab) ? <Button variant="primary" icon={tab === "people" ? UserPlus : Plus} onClick={primary}>{({ people: "Add contact", projects: "New project", documents: "New document" })[tab] ?? "New route"}</Button> : null}</PageHeader><SpaceTabs label="Area sections" tabs={tabs} value={tab} onChange={setTab} />
    <div className="space-tab-content" role="tabpanel" aria-label={TABS.find((item) => item.id === tab).label}>
      {!local && tab === 'agents' ? <AgentLinks targetType="area" targetId={team.id} existingAgentIds={settings.value?.default_agent_ids || []} /> : null}
      {tab === "overview" ? <div className="space-overview-grid"><div className="space-overview-main"><section className="space-brief"><div className="section-heading"><h2>About this Area</h2><button className="text-button" onClick={() => edit("team", team)}><Pencil />Edit</button></div>{team.description ? <DocumentContent content={team.description} /> : <p className="space-inline-empty">Describe this domain of your work, its goals, and useful context.</p>}</section><TeamResources team={team} compact onViewAll={() => setTab('resources')} /><section><div className="section-heading"><h2>Projects</h2><button className="text-button" onClick={() => edit("project", null, { team_id: team.id })}><Plus />New project</button></div>{projects.length ? <>{projects.slice(0, 4).map((project) => <ProjectRow key={project.id} project={project} />)}{projects.length > 4 ? <button className="text-button space-view-all" onClick={() => setTab("projects")}>All {projects.length} projects <ArrowRight /></button> : null}</> : <p className="space-inline-empty">Give the next initiative a home, with its own brief, milestones, documents, and conversations.</p>}</section><section><div className="section-heading"><h2>Open routes</h2><button className="text-button" onClick={() => setTab("routes")}>All routes <ArrowRight /></button></div>{routes.some((route) => route.status !== "done") ? <RouteRows routes={routes.filter((route) => route.status !== "done").slice(0, 5)} /> : <p className="space-inline-empty">No open routes. New Area routes and routes in Area projects appear here.</p>}</section><ActivityTimeline workspaceId={team.workspace_id} targetType="team" targetId={team.id} /></div><aside className="space-properties">{!local ? <section><h2>Default agents</h2><p className="space-property-hint">Profiles suggested for this Area. Opening this page never starts work.</p><div className="area-agent-preview">{defaultAgents.map(agent => <button key={agent.id} onClick={() => navigate('agents', agent.id)}><strong>{agent.name}</strong><small>{agent.provider} · {agentReadiness(agent, data.connections.find(connection => connection.provider === agent.provider)).label}</small></button>)}</div>{settings.loading ? <p role="status">Loading defaults…</p> : settings.error ? <p className="space-property-hint">Area defaults unavailable. Open settings to retry.</p> : !defaultAgents.length ? <p className="space-inline-empty">No default profiles selected.</p> : null}<button className="text-button" onClick={() => setTab('settings')}>Configure Area defaults <ArrowRight /></button></section> : null}<section><h2>Context and permissions</h2><p className="space-property-hint">{settings.value?.context_pack_ids.length ?? 0} suggested Context Packs. Instructions and references are not permission grants. Work requires reviewed context.</p><button className="text-button" onClick={() => setTab('documents')}>Open documents <ArrowRight /></button></section>{contactsVisible ? <section><h2>Contacts</h2><p className="space-property-hint">{people.length} active contacts. This optional directory does not grant account access.</p><button className="text-button" onClick={() => setTab('people')}>Open Contacts <ArrowRight /></button></section> : null}<section><button className="text-button" onClick={() => setArchiving(true)}><Archive />Archive Area</button></section></aside></div> : null}
      {local && tab === "todos" ? <TodoBoard key={team.id} teamId={team.id} embedded/> : null}
      {tab === "routes" ? <section><div className="space-section-toolbar"><SearchField value={query} onChange={setQuery} placeholder="Search Area Routes…" /><Select aria-label="Area route status" value={status} onChange={setStatus}><option value="all">All statuses</option>{Object.entries(STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><span className="toolbar-count">{filteredRoutes.length} routes</span></div>{filteredRoutes.length ? <RouteRows routes={filteredRoutes} /> : <Empty compact kind={query || status !== "all" ? "search" : "routes"} title={query || status !== "all" ? "No matching routes" : "Give this Area a direction"} description="Routes can belong directly to the Area or to one of its projects." action={query || status !== "all" ? "Clear filters" : "Create route"} onAction={() => query || status !== "all" ? (setQuery(""), setStatus("all")) : edit("task", null, { team_id: team.id })} />}</section> : null}
      {tab === "projects" ? <section>{projects.length ? <div className="project-list">{projects.map((project) => <ProjectRow key={project.id} project={project} />)}</div> : <Empty compact kind="projects" title="Start a focused project" description="A project holds its brief, milestones, routes, documents, and chats in one place." action="Create project" onAction={() => edit("project", null, { team_id: team.id })} />}</section> : null}
      {tab === "documents" ? <DocumentsPanel teamId={team.id} /> : null}
      {tab === "resources" ? <TeamResources team={team} /> : null}
      {tab === "updates" ? <WorkspaceUpdates key={team.id} workspaceId={team.workspace_id} teamId={team.id} /> : null}
      {tab === "people" ? <PeoplePanel teamId={team.id} /> : null}
      {tab === "settings" ? <AreaSettings area={team} state={settings} /> : null}
    </div>{archiving ? <SpaceArchiveDialog kind="team" item={team} onClose={() => setArchiving(false)} onArchived={() => navigate("teams")} /> : null}
  </main>;
}

function PeoplePanel({ teamId }) {
  const { data, edit, perform, notify } = useApp();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [archiving, setArchiving] = useState(null);
  const people = (data.team_members ?? []).filter((member) => member.team_id === teamId && Boolean(member.archived_at) === (filter === "archived") && `${member.name} ${member.email ?? ""} ${member.role ?? ""}`.toLowerCase().includes(query.toLowerCase())).toSorted((a, b) => a.name.localeCompare(b.name));
  return <section className="people-panel"><p className="space-section-note">Area directory — adding a person does not send an invitation or grant account access.</p><div className="space-section-toolbar"><SearchField value={query} onChange={setQuery} placeholder="Search contacts…" /><Select aria-label="Contacts visibility" value={filter} onChange={setFilter}><option value="active">Active contacts</option><option value="archived">Archived contacts</option></Select></div>{people.length ? <div className="people-table"><div className="people-heading"><span>Name</span><span>Role</span><span>Email</span><span /></div>{people.map((person) => <div className="people-row" key={person.id}><button className="space-person-name" onClick={() => edit("teamMember", person)}><span className="space-avatar">{initials(person.name)}</span><strong>{person.name}</strong></button><span className="person-role">{person.role || "—"}</span><span className="person-email">{person.email || "—"}</span><div className="people-actions">{person.archived_at ? <IconButton label={`Restore ${person.name}`} onClick={() => perform(async () => { await frondoseActions.updateTeamMember(person.id, { archived_at: null }); notify("Contact restored"); })}><RotateCcw /></IconButton> : <><IconButton label={`Edit ${person.name}`} onClick={() => edit("teamMember", person)}><Pencil /></IconButton><IconButton label={`Archive ${person.name}`} onClick={() => setArchiving(person)}><Archive /></IconButton></>}</div></div>)}</div> : <Empty compact kind={query ? "search" : "members"} icon={Users} title={query ? "No matching contacts" : filter === "archived" ? "No archived contacts" : "Put names to the work"} description={query ? "Try a name, role, or email address." : "Keep a directory of the people involved, with their roles and contact details."} action={query ? "Clear search" : filter === "active" ? "Add contact" : undefined} onAction={() => query ? setQuery("") : edit("teamMember", null, { team_id: teamId })} />}{archiving ? <SpaceArchiveDialog kind="teamMember" item={archiving} onClose={() => setArchiving(null)} /> : null}</section>;
}

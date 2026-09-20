import { useState } from "react";
import { Archive, RotateCcw, ArrowLeft, ArrowRight, Pencil, Plus, Users, UserPlus } from "../components/icons.jsx";
import { Button, Empty, IconButton, PageHeader, SearchField, Select, useApp } from "../ui.jsx";
import { rumboActions } from "../data/useRumbo.js";
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

const TABS = [{ id: "overview", label: "Overview" }, { id: "routes", label: "Routes" }, { id: "projects", label: "Projects" }, { id: "resources", label: "Resources" }, { id: "documents", label: "Documents" }, { id: "people", label: "People" }];

export function TeamsView() {
  const { data, page, navigate, edit, perform, notify } = useApp();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const selected = visible(data.teams).find((team) => team.id === page.id);
  if (selected) return <TeamHub key={selected.id} team={selected} />;
  if (page.id) return <main className="page"><Empty kind="teams" title="Team unavailable" description="This team may be archived or belong to another workspace." action="All teams" onAction={() => navigate("teams")} /></main>;
  const allTeams = data.teams ?? [];
  const teams = allTeams.filter((team) => Boolean(team.archived_at) === (filter === "archived") && `${team.name} ${team.description ?? ""}`.toLowerCase().includes(query.toLowerCase())).toSorted(byUpdated);
  const empty = !allTeams.length;
  return <main className="page space-page teams-page">{!empty ? <><PageHeader title="Teams" description="Organize people, projects, routes, and shared knowledge."><Button variant="primary" icon={Plus} onClick={() => edit("team")}>New team</Button></PageHeader><div className="space-section-toolbar"><SearchField value={query} onChange={setQuery} placeholder="Search teams…" /><Select aria-label="Team visibility" value={filter} onChange={setFilter}><option value="active">Active teams</option><option value="archived">Archived teams</option></Select><span className="toolbar-count">{teams.length} teams</span></div></> : null}
    {teams.length ? <div className="team-list"><div className="team-list-heading"><span>Team</span><span>Projects</span><span>People</span><span /></div>{teams.map((team) => <div className="team-list-row" key={team.id}><button className="space-row-main" disabled={Boolean(team.archived_at)} onClick={() => navigate("teams", team.id)}><span className="space-team-icon"><TeamIcon team={team} size={24} /></span><span><strong>{team.name}</strong><small>{team.description || "Projects, routes, and shared context"}</small></span></button><span className="team-list-count">{teamProjects(data, team.id).length}<small> projects</small></span><span className="team-list-count">{visible(data.team_members).filter((member) => member.team_id === team.id).length}<small> people</small></span>{team.archived_at ? <Button icon={RotateCcw} onClick={() => perform(async () => { await rumboActions.updateTeam(team.id, { archived_at: null }); notify("Team restored"); })}>Restore</Button> : <IconButton label={`Open ${team.name}`} onClick={() => navigate("teams", team.id)}><ArrowRight /></IconButton>}</div>)}</div> : <Empty compact={!empty} kind={query ? "search" : "teams"} icon={Users} title={query ? "No matching teams" : filter === "archived" ? "No archived teams" : "A space for every team"} description={query ? "Try another team name or description." : filter === "archived" ? "Teams you archive are kept here and can be restored." : "Bring related projects, routes, people, and documents together. Start with a team for the work you do."} action={query ? "Clear search" : filter === "active" ? "Create team" : "Show active teams"} onAction={() => query ? setQuery("") : filter === "active" ? edit("team") : setFilter("active")} />}
  </main>;
}

function TeamHub({ team }) {
  const { data, page, edit, navigate } = useApp();
  const tab = TABS.some(item => item.id === page.section) ? page.section : 'overview';
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
  return <main className="page space-page team-hub"><button className="back-link" onClick={() => navigate("teams")}><ArrowLeft />All teams</button><PageHeader title={<span className="team-heading-title"><TeamIconButton team={team} size={32} />{team.name}</span>} description={team.description || "A shared space for this team’s work."}><Button icon={Pencil} onClick={() => edit("team", team)}>Edit team</Button>{tab !== 'resources' ? <Button variant="primary" icon={tab === "people" ? UserPlus : Plus} onClick={primary}>{({ people: "Add person", projects: "New project", documents: "New document" })[tab] ?? "New route"}</Button> : null}</PageHeader><SpaceTabs label="Team sections" tabs={TABS} value={tab} onChange={setTab} />
    <div className="space-tab-content" role="tabpanel" aria-label={TABS.find((item) => item.id === tab).label}>
      {tab === "overview" ? <div className="space-overview-grid"><div className="space-overview-main"><section className="space-brief"><div className="section-heading"><h2>About this team</h2><button className="text-button" onClick={() => edit("team", team)}><Pencil />Edit</button></div>{team.description ? <DocumentContent content={team.description} /> : <p className="space-inline-empty">Add a description to explain the team’s purpose and the work it owns.</p>}</section><TeamResources team={team} compact onViewAll={() => setTab('resources')} /><section><div className="section-heading"><h2>Projects</h2><button className="text-button" onClick={() => edit("project", null, { team_id: team.id })}><Plus />New project</button></div>{projects.length ? <>{projects.slice(0, 4).map((project) => <ProjectRow key={project.id} project={project} />)}{projects.length > 4 ? <button className="text-button space-view-all" onClick={() => setTab("projects")}>All {projects.length} projects <ArrowRight /></button> : null}</> : <p className="space-inline-empty">Give the next initiative a home, with its own brief, milestones, documents, and conversations.</p>}</section><section><div className="section-heading"><h2>Open routes</h2><button className="text-button" onClick={() => setTab("routes")}>All routes <ArrowRight /></button></div>{routes.some((route) => route.status !== "done") ? <RouteRows routes={routes.filter((route) => route.status !== "done").slice(0, 5)} /> : <p className="space-inline-empty">No open routes. New team routes and routes in team projects appear here.</p>}</section></div><aside className="space-properties"><section><h2>Team directory</h2><p className="space-property-hint">{people.length} {people.length === 1 ? "person" : "people"} in this directory.</p>{people.slice(0, 5).map((person) => <button className="space-person-preview" key={person.id} onClick={() => setTab("people")}><span className="space-avatar">{initials(person.name)}</span><span>{person.name}<small>{person.role || "No role set"}</small></span></button>)}<button className="text-button space-view-all" onClick={() => setTab("people")}>Manage people <ArrowRight /></button></section><section><p className="space-property-hint">Adding a person does not send an invitation or grant account access.</p></section><section><button className="text-button" onClick={() => setArchiving(true)}><Archive />Archive team</button></section></aside></div> : null}
      {tab === "routes" ? <section><div className="space-section-toolbar"><SearchField value={query} onChange={setQuery} placeholder="Search team routes…" /><Select aria-label="Team route status" value={status} onChange={setStatus}><option value="all">All statuses</option>{Object.entries(STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><span className="toolbar-count">{filteredRoutes.length} routes</span></div>{filteredRoutes.length ? <RouteRows routes={filteredRoutes} /> : <Empty compact kind={query || status !== "all" ? "search" : "routes"} title={query || status !== "all" ? "No matching routes" : "Give this team a direction"} description="Routes can belong directly to the team or to one of its projects." action={query || status !== "all" ? "Clear filters" : "Create route"} onAction={() => query || status !== "all" ? (setQuery(""), setStatus("all")) : edit("task", null, { team_id: team.id })} />}</section> : null}
      {tab === "projects" ? <section>{projects.length ? <div className="project-list">{projects.map((project) => <ProjectRow key={project.id} project={project} />)}</div> : <Empty compact kind="projects" title="Start a project together" description="A project holds its brief, milestones, routes, documents, and chats in one place." action="Create project" onAction={() => edit("project", null, { team_id: team.id })} />}</section> : null}
      {tab === "documents" ? <DocumentsPanel teamId={team.id} /> : null}
      {tab === "resources" ? <TeamResources team={team} /> : null}
      {tab === "people" ? <PeoplePanel teamId={team.id} /> : null}
    </div>{archiving ? <SpaceArchiveDialog kind="team" item={team} onClose={() => setArchiving(false)} onArchived={() => navigate("teams")} /> : null}
  </main>;
}

function PeoplePanel({ teamId }) {
  const { data, edit, perform, notify } = useApp();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [archiving, setArchiving] = useState(null);
  const people = (data.team_members ?? []).filter((member) => member.team_id === teamId && Boolean(member.archived_at) === (filter === "archived") && `${member.name} ${member.email ?? ""} ${member.role ?? ""}`.toLowerCase().includes(query.toLowerCase())).toSorted((a, b) => a.name.localeCompare(b.name));
  return <section className="people-panel"><p className="space-section-note">Team directory — adding a person does not send an invitation or grant account access.</p><div className="space-section-toolbar"><SearchField value={query} onChange={setQuery} placeholder="Search people…" /><Select aria-label="People visibility" value={filter} onChange={setFilter}><option value="active">Active people</option><option value="archived">Archived people</option></Select></div>{people.length ? <div className="people-table"><div className="people-heading"><span>Name</span><span>Role</span><span>Email</span><span /></div>{people.map((person) => <div className="people-row" key={person.id}><button className="space-person-name" onClick={() => edit("teamMember", person)}><span className="space-avatar">{initials(person.name)}</span><strong>{person.name}</strong></button><span className="person-role">{person.role || "—"}</span><span className="person-email">{person.email || "—"}</span><div className="people-actions">{person.archived_at ? <IconButton label={`Restore ${person.name}`} onClick={() => perform(async () => { await rumboActions.updateTeamMember(person.id, { archived_at: null }); notify("Person restored"); })}><RotateCcw /></IconButton> : <><IconButton label={`Edit ${person.name}`} onClick={() => edit("teamMember", person)}><Pencil /></IconButton><IconButton label={`Archive ${person.name}`} onClick={() => setArchiving(person)}><Archive /></IconButton></>}</div></div>)}</div> : <Empty compact kind={query ? "search" : "members"} icon={Users} title={query ? "No matching people" : filter === "archived" ? "No archived people" : "Put names to the work"} description={query ? "Try a name, role, or email address." : "Keep a directory of the people involved, with their roles and contact details."} action={query ? "Clear search" : filter === "active" ? "Add person" : undefined} onAction={() => query ? setQuery("") : edit("teamMember", null, { team_id: teamId })} />}{archiving ? <SpaceArchiveDialog kind="teamMember" item={archiving} onClose={() => setArchiving(null)} /> : null}</section>;
}

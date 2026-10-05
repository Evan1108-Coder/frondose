import { requestUpdateNavigation } from '../components/UnsavedUpdates.jsx';
import { WorkflowSelect, LabelPicker } from '../components/WorkProperties.jsx';
import { useEffect, useState } from "react";
import { Archive, ArrowLeft, ArrowRight, BookOpen, MessageCircle, FileText, Folder, GitBranch, GitFork, Pencil, Play, Plus } from "../components/icons.jsx";
import { Button, Empty, PageHeader, SearchField, Select, useApp } from "../ui.jsx";
import { rumboActions } from "../data/useRumbo.js";
import { byUpdated, progress, PROJECT_STATUSES, relative, safeUrl, STATUSES, val, visible } from "../lib/model.js";
import { projectActivity } from "../lib/workspace-spaces.js";
import { DocumentContent } from "../components/DocumentContent.jsx";
import { WorkspaceEditor } from "../components/WorkspaceEditor.jsx";
import { DocumentsPanel, MilestonesPanel, SpaceTabs } from "./SpaceComponents.jsx";
import { RouteRows } from "./Projects.jsx";
import { ProjectStrategy } from '../components/ProjectStrategy.jsx';
import { ProjectTimeline } from '../components/ProjectTimeline.jsx';
import { ActivityFeed } from '../components/ActivityFeed.jsx';
import { ActivityTimeline } from '../components/ActivityTimeline.jsx';
import { ReviewPanel } from '../components/ReviewPanel.jsx';
import { RumboAgentEntryButton } from '../components/RumboAgentEntry.jsx';
import { TemplateInstanceDetails } from '../components/TemplateInstanceDetails.jsx';
import "./workspace-spaces.css";

const TABS = [{ id: "overview", label: "Overview" }, { id: "strategy", label: "Strategy & risks" }, { id: "timeline", label: "Timeline" }, { id: "routes", label: "Routes" }, { id: "documents", label: "Documents" }, { id: "chats", label: "Chats" }, { id: 'changes', label: 'Changes' }, { id: "updates", label: "Updates" }, { id: "activity", label: "Activity" }];

export function ProjectHub({ project }) {
  const { data, edit, navigate, archive, perform, page } = useApp();
  const [tab, setTab] = useState(page.reviewId ? 'changes' : 'overview');
  useEffect(() => { if (page.reviewId) setTab('changes'); }, [page.reviewId]);
  const [query, setQuery] = useState("");
  const [routeStatus, setRouteStatus] = useState("all");
  const [document, setDocument] = useState(null);
  const routes = visible(data.tasks).filter((item) => val(item, "project_id") === project.id).toSorted(byUpdated);
  const chats = visible(data.chats).filter((item) => val(item, "project_id") === project.id).toSorted(byUpdated);
  const memories = visible(data.memory_notes).filter((item) => val(item, "project_id") === project.id);
  const team = (data.teams ?? []).find((item) => item.id === project.team_id);
  const stats = progress(project, data.tasks, data.route_workflows);
  const activity = projectActivity(data, project.id);
  const repo = safeUrl(project.github_url);
  const filteredRoutes = routes.filter((route) => (routeStatus === "all" || route.status === routeStatus) && `${route.title} ${route.description ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  function openActivity(item) {
    if (item.type === "document") setDocument((data.documents ?? []).find((row) => row.id === item.target));
    else navigate({ route: "tasks", chat: "chats", work: "work" }[item.type], item.target, { projectId: project.id });
  }
  return <main className="page space-page project-hub">
    <button className="back-link" onClick={() => navigate("projects")}><ArrowLeft />All projects</button>
    {project.image_url ? <button className="project-picture-edit" aria-label="Change project picture" onClick={() => edit('project', project)}><img className="project-heading-picture" src={project.image_url} alt="" /></button> : null}
    <PageHeader title={project.name} description={project.description || "A shared home for your plans, context, and progress."}><RumboAgentEntryButton source={{ type: 'project', id: project.id }} /><Button icon={Pencil} onClick={() => edit("project", project)}>Edit project</Button><Button variant="primary" icon={Plus} onClick={() => edit("task", null, { project_id: project.id, team_id: project.team_id })}>New route</Button></PageHeader>
    <SpaceTabs label="Project sections" tabs={TABS.map((item) => ({ ...item, count: item.id === "routes" ? routes.length : item.id === "chats" ? chats.length : undefined }))} value={tab} onChange={value => requestUpdateNavigation(() => setTab(value))} />
    <div className="space-section-toolbar"><Button onClick={() => navigate('workbench', project.id)}>Open workbench<ArrowRight /></Button><Button onClick={() => navigate('library', null, { projectId: project.id })}>Project outputs<ArrowRight /></Button></div>
    <div className="space-tab-content" role="tabpanel" aria-label={TABS.find((item) => item.id === tab).label}>
      {tab === 'strategy' ? <ProjectStrategy project={project} /> : null}
      {tab === 'timeline' ? <ProjectTimeline project={project} /> : null}
      {tab === 'changes' ? <ReviewPanel targetType="project" targetId={project.id} projectId={project.id} defaultOpen /> : null}
      {tab === "overview" ? <div className="space-overview-grid"><div className="space-overview-main">
        <section className="space-brief"><div className="section-heading"><h2>Project brief</h2><button className="text-button" onClick={() => edit("project", project)}><Pencil />Edit</button></div>{project.goal ? <DocumentContent content={project.goal} /> : <div className="space-inline-empty"><p>What are you building, and what does success look like? A clear brief keeps the work moving in the same direction.</p><button className="text-button" onClick={() => edit("project", project)}>Write a project brief <ArrowRight /></button></div>}</section>
        <TemplateInstanceDetails workspaceId={project.workspace_id} entityType="projects" entityId={project.id} />
        <MilestonesPanel projectId={project.id} />
        <section><div className="section-heading"><h2>Project memory</h2><button className="text-button" onClick={() => edit("memory", null, { project_id: project.id })}><Plus />Add note</button></div>{memories.length ? <>{memories.slice(0, 3).map((note) => <button className="space-linked-row" key={note.id} onClick={() => edit("memory", note)}><BookOpen /><span><strong>{note.title}</strong><small>{note.content}</small></span><ArrowRight /></button>)}<button className="text-button space-view-all" onClick={() => navigate("memory", null, { projectId: project.id })}>All project memory <ArrowRight /></button></> : <p className="space-inline-empty">Save conventions and decisions that agents can use when you include project memory in a session.</p>}</section><ActivityTimeline workspaceId={project.workspace_id} targetType="project" targetId={project.id} />
      </div><aside className="space-properties" aria-label="Project properties"><section><h2>Project properties</h2><WorkflowSelect kind="project" item={project} onChange={patch => perform(() => rumboActions.updateProject(project.id, patch))} /><LabelPicker kind="project" value={project.labels ?? []} onChange={labels => perform(() => rumboActions.updateProject(project.id, { labels }))} /><dl><div><dt>Reported progress</dt><dd>{project.reported_progress == null ? "Not set" : `${project.reported_progress}%`}<small> · manual update</small></dd></div><div><dt>Area</dt><dd>{team && !team.archived_at ? <button onClick={() => navigate("teams", team.id)}>{team.name}<ArrowRight /></button> : team ? `${team.name} (archived)` : <button onClick={() => edit("project", project)}>No Area</button>}</dd></div><div><dt>Lead</dt><dd><button onClick={() => edit("project", project)}>{project.lead || "Not set"}</button></dd></div><div><dt>Start</dt><dd><button onClick={() => edit("project", project)}>{project.start_date ? new Date(`${project.start_date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Not set"}</button></dd></div><div><dt>Target</dt><dd><button onClick={() => edit("project", project)}>{project.target_date ? new Date(`${project.target_date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Not set"}</button></dd></div></dl></section>
        <section><h3>Route progress</h3>{stats.complete ? <><div className="space-progress-label"><span>{stats.done} of {stats.total} leaf Routes complete</span><span>{stats.percent}%</span></div><div className="progress-track" role="progressbar" aria-label="Completed active leaf Routes" aria-valuenow={stats.percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${stats.percent}%` }} /></div><p className="space-property-hint">Parent Routes are not counted twice. {stats.cancelled} cancelled · {stats.archived} archived leaf Routes excluded.</p></> : <p className="space-property-hint">Progress unavailable: a relationship is restricted or needs repair.</p>}</section>
        <section><h3>Working folder</h3>{project.local_path ? <div className="space-resource"><Folder /><code>{project.local_path}</code></div> : <button className="space-resource" onClick={() => edit("project", project)}><Folder />Link a working folder<Plus /></button>}<h3>Repository</h3>{repo ? <a className="space-resource" href={repo} target="_blank" rel="noreferrer"><GitFork /><span>{repo.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span><ArrowRight /></a> : <button className="space-resource" onClick={() => edit("project", project)}><GitFork />Link a repository<Plus /></button>}</section>
        <section><button className="text-button" onClick={() => archive("project", project)}><Archive />Archive project</button><p className="space-property-hint">Archived projects can be restored in Settings.</p></section>
      </aside></div> : null}
      {tab === "routes" ? <section><div className="space-section-toolbar"><SearchField value={query} onChange={setQuery} placeholder="Search project routes…" /><Select value={routeStatus} onChange={setRouteStatus} aria-label="Project route status"><option value="all">All statuses</option>{Object.entries(STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><span className="toolbar-count">{filteredRoutes.length} routes</span></div>{filteredRoutes.length ? <RouteRows routes={filteredRoutes} projectId={project.id} /> : <Empty compact kind={query || routeStatus !== "all" ? "search" : "routes"} title={query || routeStatus !== "all" ? "No routes match these filters" : "Plan your first route"} description="Break the brief into focused pieces of work." action={query || routeStatus !== "all" ? "Clear filters" : "New route"} onAction={() => query || routeStatus !== "all" ? (setQuery(""), setRouteStatus("all")) : edit("task", null, { project_id: project.id, team_id: project.team_id })} />}</section> : null}
      {tab === "documents" ? <DocumentsPanel projectId={project.id} /> : null}
      {tab === "chats" ? <section><div className="space-section-toolbar"><p className="muted">Conversations linked to this project.</p><Button icon={Plus} onClick={() => edit("chat", null, { project_id: project.id })}>New project chat</Button></div>{chats.length ? chats.map((chat) => <button key={chat.id} className="space-linked-row" onClick={() => navigate("chats", chat.id, { projectId: project.id })}><MessageCircle /><span><strong>{chat.title}</strong><small>{(val(chat, "participant_agent_ids") ?? []).length} agents · Updated {relative(val(chat, "updated_at"))}</small></span><ArrowRight /></button>) : <Empty compact kind="chats" title="Keep the conversation close" description="Discuss the project with your agents and keep its context attached." action="Create project chat" onAction={() => edit("chat", null, { project_id: project.id })} />}</section> : null}
      {tab === "updates" ? <ActivityFeed workspaceId={project.workspace_id} targetType="project" targetId={project.id} /> : null}
      {tab === "activity" ? <ActivityTimeline workspaceId={project.workspace_id} targetType="project" targetId={project.id} /> : null}
    </div>
    {document ? <WorkspaceEditor kind="document" item={document} onClose={() => setDocument(null)} /> : null}
  </main>;
}

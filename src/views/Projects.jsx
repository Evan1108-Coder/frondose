import { useMemo, useState } from "react";
import { AgentLinks } from '../components/AgentLinks.jsx';
import { Plus, ArrowLeft, ArrowRight, Folder, Pencil, Archive, GitBranch, MessageCircle, Play, Menu, LayoutGrid, CircleCheck, Users, ChevronDown, ChevronRight } from "../components/icons.jsx";
import {
  Button,
  Empty,
  PageHeader,
  Priority,
  SearchField,
  Select,
  Status,
  useApp,
} from "../ui.jsx";
import {
  byUpdated,
  dateLabel,
  PRIORITIES,
  PROJECT_STATUSES,
  relative,
  STATUSES,
  val,
  visible,
} from "../lib/model.js";
import { talvoriActions } from "../data/useTalvori.js";
import { ProjectRow } from "./Overview.jsx";
import { Tooltip } from "../components/Tooltip.jsx";
import { ProjectHub } from "./ProjectHub.jsx";
import { WorkflowSelect, LabelPicker, WorkLabels } from '../components/WorkProperties.jsx';
import { RouteWorkflow } from '../components/RouteWorkflow.jsx';
import { featureItems } from '../lib/settings-catalog.js';
import { ActivityFeed } from '../components/ActivityFeed.jsx';
import { ActivityTimeline } from '../components/ActivityTimeline.jsx';
import { ReviewPanel } from '../components/ReviewPanel.jsx';
import { TalvoriAgentEntryButton } from '../components/TalvoriAgentEntry.jsx';
import { TemplateInstanceDetails } from '../components/TemplateInstanceDetails.jsx';
import { routeForestRows } from '../lib/sub-routes.js';
import './route-hierarchy-list.css';

export function ProjectsView() {
  const { data, page, navigate, edit } = useApp();
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"), [labelFilter, setLabelFilter] = useState('all');
  const project = visible(data.projects).find((item) => item.id === page.id);
  if (page.id && project) return <ProjectHub key={project.id} project={project} />;
  if (page.id) return (
    <main className="page">
      <Empty kind="projects" title="Project unavailable"
        description="This project may be archived or belong to another workspace."
        action="All projects" onAction={() => navigate("projects")} />
    </main>
  );
  const projects = visible(data.projects).filter(
    (item) =>
      `${item.name} ${item.description}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (status === "all" || item.status === status || item.workflow_status_id === status) && (labelFilter === 'all' || item.labels?.includes(labelFilter)),
  );
  const isBlank = !projects.length && !query && status === "all" && labelFilter === 'all';
  return (
    <main className="page">
      {!isBlank ? <>
      <PageHeader
        title="Projects"
        description="Give your work a home. Keep the goal, context, and progress together."
      >
        <Button variant="primary" icon={Plus} onClick={() => edit("project")}>
          New project
        </Button>
      </PageHeader>
      <div className="toolbar">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search projects…"
        />
        <Select
          value={status}
          onChange={setStatus}
          aria-label="Filter project status"
        >
          <option value="all">All statuses</option>
          {featureItems(data, 'project_status').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          {Object.entries(PROJECT_STATUSES).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select aria-label="Filter project label" value={labelFilter} onChange={setLabelFilter}><option value="all">All labels</option>{featureItems(data, 'project_label').map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
        <span className="toolbar-count">{projects.length} projects</span>
      </div>
      </> : null}
      {projects.length ? (
        <div className="project-list">
          <div className="table-heading project-table-heading">
            <span>Project</span>
            <span>Routes</span>
            <span>Progress</span>
          </div>
          {projects.toSorted(byUpdated).map((item) => (
            <ProjectRow project={item} key={item.id} />
          ))}
        </div>
      ) : (
        <Empty
          kind={isBlank ? "projects" : "search"}
          actionVariant={isBlank ? "primary" : "secondary"}
          icon={Folder}
          title={
            query || status !== "all" || labelFilter !== "all"
              ? "No matching projects"
              : "Every great project starts somewhere"
          }
          description={
            query || status !== "all" || labelFilter !== "all"
              ? "Try another search or status."
              : "Create a project to connect your plans, conversations, and agents."
          }
          action={
            query || status !== "all" || labelFilter !== "all" ? "Clear filters" : "Create project"
          }
          onAction={() =>
            query || status !== "all" || labelFilter !== "all"
              ? (setQuery(""), setStatus("all"), setLabelFilter('all'))
              : edit("project")
          }
        />
      )}
    </main>
  );
}


export function RouteRows({ routes, projectId }) {
  const { data, page, navigate, perform } = useApp();
  const [collapsed, setCollapsed] = useState(new Set());
  const projectsById = useMemo(() => new Map(visible(data.projects).map((project) => [project.id, project])), [data.projects]);
  const teamsById = useMemo(() => new Map(visible(data.teams).map((team) => [team.id, team])), [data.teams]);
  const routesById = useMemo(() => new Map((data.tasks ?? []).map(route => [route.id, route])), [data.tasks]);
  const rows = useMemo(() => routeForestRows(routes, data.route_workflows, collapsed), [routes, data.route_workflows, collapsed]);
  return (
    <div className="route-table">
      {rows.map(({ route, depth, hasChildren, parentId }) => (
        <div className="route-row" key={route.id} style={{ '--route-depth': depth }}>
          <Tooltip label={route.status === "done" ? "Reopen route" : "Mark complete"}><button
            className="route-complete"
            aria-label={
              route.status === "done"
                ? `Reopen ${route.title}`
                : `Complete ${route.title}`
            }
            onClick={() =>
              perform(() =>
                talvoriActions.updateTask(route.id, {
                  status: route.status === "done" ? "ready" : "done",
                }),
              )
            }
          >
            <Status value={route.status} label="" />
          </button></Tooltip>
          <div className="route-tree-title">
          {hasChildren ? <button className="route-tree-disclosure" aria-label={`${collapsed.has(route.id) ? 'Expand' : 'Collapse'} sub-routes of ${route.title}`} aria-expanded={!collapsed.has(route.id)} onClick={() => setCollapsed(current => { const next = new Set(current); if (next.has(route.id)) next.delete(route.id); else next.add(route.id); return next; })}>{collapsed.has(route.id) ? <ChevronRight /> : <ChevronDown />}</button> : depth ? <span className="route-tree-branch" aria-hidden="true">↳</span> : null}
          <button
            className="route-title"
            onClick={() => navigate("tasks", route.id, { projectId: projectId ?? page.projectId })}
          >
            <strong className={route.status === "done" ? "completed-text" : ""}>
              {route.title}
            </strong>
            <small>
              {parentId && routesById.has(parentId) ? `Sub-route of ${routesById.get(parentId).title}${routesById.get(parentId).archived_at ? ' (archived)' : ''}` : projectsById.get(val(route, "project_id"))?.name ?? teamsById.get(val(route, "team_id"))?.name ?? "Workspace"}
            </small>
            <WorkLabels item={route} />
          </button>
          </div>
          <span className="route-status">
            <Status value={route.status} item={route} />
          </span>
          <Priority value={route.priority} />
          <time className="route-date">
            {val(route, "due_at")
              ? dateLabel(val(route, "due_at"))
              : relative(val(route, "updated_at"))}
          </time>
        </div>
      ))}
    </div>
  );
}

export function RoutesView() {
  const { data, page, edit, navigate, perform } = useApp();
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [layout, setLayout] = useState("list"),
    [sort, setSort] = useState("updated"), [labelFilter, setLabelFilter] = useState('all');
  const project = visible(data.projects).find(
    (item) => item.id === page.projectId,
  );
  const scope = { projectId: page.projectId };
  const defaults = project ? { project_id: project.id } : {};
  const createRoute = () => edit("task", null, defaults);
  if (page.projectId && !project) return (
    <main className="page">
      <Empty kind="projects" title="Project unavailable"
        description="This project may be archived or belong to another workspace. Choose an available project to see its routes."
        action="All projects" onAction={() => navigate("projects")}
        secondaryAction="All routes" onSecondaryAction={() => navigate("tasks")} />
    </main>
  );
  const selected = visible(data.tasks).find(
    (task) => task.id === page.id && (!project || val(task, "project_id") === project.id),
  );
  if (selected) return <RouteDetail route={selected} />;
  if (page.id) return (
    <main className="page">
      <Empty kind="routes" title="Route unavailable"
        description="This route may be archived or outside this project."
        action={project ? "Project routes" : "All routes"}
        onAction={() => navigate("tasks", null, scope)} />
    </main>
  );
  const routes = visible(data.tasks)
    .filter(
      (task) =>
        `${task.title} ${task.description}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (status === "all" || status === "open"
          ? status !== "open" || !['done', 'cancelled'].includes(task.status)
          : task.status === status || task.workflow_status_id === status) && (labelFilter === 'all' || task.labels?.includes(labelFilter)) &&
        (!project || val(task, "project_id") === project.id),
    )
    .toSorted(
      sort === "title"
        ? (a, b) => a.title.localeCompare(b.title)
        : sort === "priority"
          ? (a, b) =>
              ["urgent", "high", "medium", "low", "no_priority"].indexOf(
                a.priority,
              ) -
              ["urgent", "high", "medium", "low", "no_priority"].indexOf(
                b.priority,
              )
          : byUpdated,
    );
  const isBlank = !routes.length && !query && status === "all" && labelFilter === 'all';
  return (
    <main className="page">
      {!isBlank ? <>
      {project ? <button className="back-link" onClick={() => navigate("projects", project.id)}><ArrowLeft />{project.name}</button> : null}
      <PageHeader
        title="Routes"
        description={project ? `Goals and agent work for ${project.name}.` : "Turn an intention into a conversation, a session, and a result."}
      >
        <Button variant="primary" icon={Plus} onClick={createRoute}>
          New route
        </Button>
      </PageHeader>
      <div className="toolbar">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search routes…"
        />
        <Select
          value={status}
          onChange={setStatus}
          aria-label="Filter route status"
        >
          <option value="all">All statuses</option>
          <option value="open">Open routes</option>{featureItems(data, "route_status").map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          {Object.entries(STATUSES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          value={page.projectId ?? "all"}
          onChange={(value) => navigate("tasks", null, { projectId: value === "all" ? null : value })}
          aria-label="Filter by project"
        >
          <option value="all">All projects</option>
          {visible(data.projects).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
        <div className="toolbar-spacer" />
        <Select aria-label="Filter route label" value={labelFilter} onChange={setLabelFilter}><option value="all">All labels</option>{featureItems(data, 'route_label').map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
        <Select value={sort} onChange={setSort} aria-label="Sort routes">
          <option value="updated">Recently updated</option>
          <option value="priority">Priority</option>
          <option value="title">Title</option>
        </Select>
        <div className="segmented">
          <button
            aria-label="List view"
            aria-pressed={layout === "list"}
            className={layout === "list" ? "active" : ""}
            onClick={() => setLayout("list")}
          >
            <Menu />
          </button>
          <button
            aria-label="Board view"
            aria-pressed={layout === "board"}
            className={layout === "board" ? "active" : ""}
            onClick={() => setLayout("board")}
          >
            <LayoutGrid />
          </button>
        </div>
      </div>
      </> : null}
      {routes.length ? (
        layout === "list" ? (
          <>
            <div className="table-heading route-table-heading">
              <span>Route · {routes.length}</span>
              <span>Status</span>
              <span>Priority</span>
              <span>Updated / due</span>
            </div>
            <RouteRows routes={routes} />
          </>
        ) : (
          <div className="route-board">
            {Object.entries(STATUSES).map(([value, label]) => (
              <section
                key={value}
                className="board-column"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/rumbo-route");
                  if (routes.some((route) => route.id === id))
                    perform(() =>
                      talvoriActions.updateTask(id, { status: value }),
                    );
                }}
              >
                <div className="board-heading">
                  <Status value={value} />
                  <span>
                    {routes.filter((route) => route.status === value).length}
                  </span>
                  <button
                    aria-label={`Add route to ${label}`}
                    onClick={() => edit("task", null, { ...defaults, status: value })}
                  >
                    <Plus />
                  </button>
                </div>
                {routes
                  .filter((route) => route.status === value)
                  .map((route) => (
                    <button
                      key={route.id}
                      className="board-card"
                      draggable
                      onDragStart={(e) =>
                        e.dataTransfer.setData("text/rumbo-route", route.id)
                      }
                      onClick={() => navigate("tasks", route.id, scope)}
                    >
                      <strong>{route.title}</strong>
                      <small>
                        {data.projects.find(
                          (item) => item.id === val(route, "project_id"),
                        )?.name ?? "Workspace"}
                      </small>
                      <Priority value={route.priority} />
                    </button>
                  ))}
                <span className="board-drop-hint">Drag routes here</span>
              </section>
            ))}
          </div>
        )
      ) : (
        <Empty
          kind={isBlank ? "routes" : "search"}
          actionVariant={isBlank ? "primary" : "secondary"}
          icon={GitBranch}
          title={
            query || status !== "all" || labelFilter !== "all"
              ? "No routes match these filters"
              : project ? "Give this project a direction" : "Give your work a direction"
          }
          description={query || status !== "all" || labelFilter !== "all" ? "Try another search or status to find the routes you need." : project ? "Create a route to connect a goal with its conversations, agent sessions, and results." : "A route holds the goal, project, conversation, and agent work in one place."}
          action={
            query || status !== "all" || labelFilter !== "all"
              ? "Clear filters"
              : "Create route"
          }
          onAction={() =>
            query || status !== "all" || labelFilter !== "all"
              ? (setQuery(""), setStatus("all"), setLabelFilter("all"))
              : createRoute()
          }
          secondaryAction={project ? "Open project" : undefined}
          onSecondaryAction={project ? () => navigate("projects", project.id) : undefined}
        />
      )}
    </main>
  );
}

function RouteDetail({ route }) {
  const { data, page, edit, navigate, archive, perform, startSession, notify } =
    useApp();
  const project = data.projects.find(
    (item) => item.id === val(route, "project_id"),
  );
  const team = visible(data.teams).find((item) => item.id === val(route, "team_id"));
  const chats = visible(data.chats).filter(
    (chat) => val(chat, "task_id") === route.id,
  );
  const runs = data.runs
    .filter((run) => val(run, "task_id") === route.id)
    .toSorted(byUpdated);
  return (
    <main className="page">
      <button className="back-link" onClick={() => navigate("tasks", null, { projectId: page.projectId })}>
        <ArrowLeft />
        {page.projectId ? "Project routes" : "All routes"}
      </button>
      <PageHeader
        title={route.title}
        description={project?.name ?? team?.name ?? "Workspace route"}
      >
        <Button icon={Pencil} onClick={() => edit("task", route)}>
          Edit route
        </Button>
        <TalvoriAgentEntryButton source={{ type: 'task', id: route.id }} />
        <Button
          variant="primary"
          icon={Play}
          onClick={() =>
            startSession({
              task_id: route.id,
              project_id: project?.id,
              chat_id: chats[0]?.id,
            })
          }
        >
          Start session
        </Button>
      </PageHeader>
      <div className="route-flow">
        <span className="active">
          <GitBranch />
          Intent
        </span>
        <ArrowRight />
        <button
          onClick={() =>
            chats[0]
              ? navigate("chats", chats[0].id, { projectId: project?.id })
              : edit("chat", null, {
                  title: route.title,
                  project_id: project?.id,
                  task_id: route.id,
                })
          }
        >
          <MessageCircle />
          Conversation
        </button>
        <ArrowRight />
        <button
          onClick={() =>
            runs[0]
              ? navigate("work", runs[0].id)
              : startSession({ task_id: route.id })
          }
        >
          <Play />
          Agent work
        </button>
        <ArrowRight />
        <span className={route.status === "done" ? "active" : ""}>
          <CircleCheck />
          Result
        </span>
      </div>
      <div className="project-detail-grid">
        <div className="project-main">
          <RouteWorkflow task={route} />
          <section className="description-section">
            <h2>What needs to happen</h2>
            <p className="prose">
              {route.description ||
                "Add a description, context, or acceptance criteria to help your agents understand this route."}
            </p>
            {!route.description ? (
              <button
                className="text-button"
                onClick={() => edit("task", route)}
              >
                Add details <ArrowRight />
              </button>
            ) : null}
          </section>
          <TemplateInstanceDetails workspaceId={route.workspace_id} entityType="tasks" entityId={route.id} />
          <section>
            <div className="section-heading">
              <h2>Conversations</h2>
              <button
                className="text-button"
                onClick={() =>
                  edit("chat", null, {
                    project_id: project?.id,
                    task_id: route.id,
                  })
                }
              >
                <Plus />
                New chat
              </button>
            </div>
            {chats.length ? (
              chats.map((chat) => (
                <button
                  key={chat.id}
                  className="simple-row"
                  onClick={() => navigate("chats", chat.id, { projectId: project?.id })}
                >
                  <MessageCircle />
                  <span>
                    <strong>{chat.title}</strong>
                    <small>{relative(val(chat, "updated_at"))}</small>
                  </span>
                  <ArrowRight />
                </button>
              ))
            ) : (
              <p className="section-empty">
                No conversation yet. Start a chat to discuss this route.
              </p>
            )}
          </section>
          <section>
            <div className="section-heading">
              <h2>Work sessions</h2>
              <span className="muted">{runs.length}</span>
            </div>
            {runs.length ? (
              runs.map((run) => (
                <button
                  key={run.id}
                  className="simple-row"
                  onClick={() => navigate("work", run.id)}
                >
                  <Play />
                  <span>
                    <strong>{run.title}</strong>
                    <small>
                      {run.agent_name} ·{" "}
                      {run.mode === "live" ? "Live" : "Simulation"} ·{" "}
                      {relative(val(run, "created_at"))}
                    </small>
                  </span>
                  <Status value={run.status} />
                </button>
              ))
            ) : (
              <p className="section-empty">
                No sessions yet. Choose an agent and review the context before
                starting.
              </p>
            )}
          </section>
          <ActivityFeed workspaceId={route.workspace_id} targetType="route" targetId={route.id} />
          <ActivityTimeline workspaceId={route.workspace_id} targetType="route" targetId={route.id} />
          <ReviewPanel targetType="route" targetId={route.id} projectId={route.project_id} />
        </div>
        <aside className="detail-aside">
          <section>
            <h3>Properties</h3>
            <p>Reported progress: <strong>{route.reported_progress == null ? 'Not set' : `${route.reported_progress}%`}</strong><br /><small>Manual assessment from published updates; separate from sub-route completion.</small></p>
            <WorkflowSelect item={route} onChange={patch => perform(() => talvoriActions.updateTask(route.id, patch))} />
            <LabelPicker value={route.labels ?? []} onChange={labels => perform(() => talvoriActions.updateTask(route.id, { labels }))} />
            <Select
              label="Priority"
              value={route.priority}
              onChange={(value) =>
                perform(() =>
                  talvoriActions.updateTask(route.id, { priority: value }),
                )
              }
            >
              {Object.entries(PRIORITIES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <AgentLinks targetType="route" targetId={route.id} existingAgentIds={val(route, 'assignee_agent_ids') || []} />
            <dl>
              <div>
                <dt>Due date</dt>
                <dd>{dateLabel(val(route, "due_at"))}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{relative(val(route, "updated_at"))}</dd>
              </div>
            </dl>
          </section>
          {team ? <button className="resource-link" onClick={() => navigate("teams", team.id)}><Users /><span>{team.name}</span><ArrowRight /></button> : null}
          {project ? (
            <button
              className="resource-link"
              onClick={() => navigate("projects", project.id)}
            >
              <Folder />
              <span>{project.name}</span>
              <ArrowRight />
            </button>
          ) : null}
          <Button
            variant="ghost"
            icon={Archive}
            onClick={() => archive("task", route)}
          >
            Archive route
          </Button>
        </aside>
      </div>
    </main>
  );
}

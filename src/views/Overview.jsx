import { useState } from "react";
import { Plus, ArrowRight, Folder, MessageCircle, GitBranch, CircleCheck, ShieldCheck, Clock, Inbox, Plug } from "../components/icons.jsx";
import { Button, Empty, PageHeader, Priority, Status, useApp } from "../ui.jsx";
import {
  activeRun,
  activityItems,
  progress,
  relative,
  val,
  visible,
} from "../lib/model.js";
import { rumboActions } from "../data/useRumbo.js";
import { WorkLabels } from '../components/WorkProperties.jsx';
import { AccessApprovalInbox } from '../components/AccessApprovalInbox.jsx';

export function ProjectRow({ project }) {
  const { data, navigate } = useApp();
  const stats = progress(project, data.tasks, data.route_workflows);
  return (
    <button
      className="project-row"
      onClick={() => navigate("projects", project.id)}
    >
      <span className="project-symbol">
        {project.image_url ? <img src={project.image_url} className="project-picture" alt="" /> : <Folder />}
      </span>
      <span className="row-copy">
        <strong>{project.name}</strong>
        <WorkLabels item={project} />
        <small>
          {project.description ||
            project.goal ||
            "Add a goal and start planning."}
        </small>
      </span>
      <span className="row-meta">
        {stats.routeCount} {stats.routeCount === 1 ? "route" : "routes"}
      </span>
      <span className="project-progress" title={stats.complete ? `${stats.done} of ${stats.total} active leaf Routes complete; parents are not counted twice` : 'Progress unavailable: a relationship is restricted or needs repair'}>
        <span className="progress-track">
          <i style={{ width: `${stats.percent ?? 0}%` }} />
        </span>
        <small>{stats.percent === null ? '—' : `${stats.percent}%`}</small>
      </span>
      <ArrowRight className="row-arrow" />
    </button>
  );
}
export function ActivityList({ limit = 8, compact = true }) {
  const { data, navigate } = useApp();
  const items = activityItems(data).slice(0, limit);
  return items.length ? (
    <div className="activity-list">
      {items.map((item) => (
        <button
          className="activity-item"
          key={item.id}
          onClick={() => navigate(item.type, item.target)}
        >
          <span className="activity-icon">
            {item.type === "chats" ? (
              <MessageCircle />
            ) : item.type === "tasks" ? (
              <GitBranch />
            ) : (
              <Clock />
            )}
          </span>
          <span>
            <strong>{item.title}</strong>
            <small>{item.detail ?? "Session activity"}</small>
          </span>
          <time>{relative(item.time)}</time>
        </button>
      ))}
    </div>
  ) : (
    <Empty
      compact={compact}
      kind="work"
      title="Your activity starts here"
      description="Updates from projects, conversations, and agents will appear here."
      action={compact ? undefined : "Explore routes"}
      onAction={() => navigate("tasks")}
    />
  );
}
export function Overview() {
  const { data, edit, navigate, workspace } = useApp();
  const [tab, setTab] = useState("workspace");
  const projects = visible(data.projects),
    tasks = visible(data.tasks);
  const isNewWorkspace =
    !projects.length &&
    !tasks.length &&
    !visible(data.chats).length &&
    !data.runs.length;
  const pending = data.approvals.filter(
    (approval) => approval.status === "pending",
  );
  const active = data.runs.filter(activeRun);
  const upNext = tasks
    .filter((task) => !["done", "backlog"].includes(task.status))
    .sort(
      (a, b) =>
        (({ urgent: 0, high: 1, medium: 2, low: 3, no_priority: 4 })[
          a.priority
        ] ?? 4) -
        ({ urgent: 0, high: 1, medium: 2, low: 3, no_priority: 4 }[
          b.priority
        ] ?? 4),
    )
    .slice(0, 5);
  return (
    <main className="page overview-page">
      <PageHeader
        title="Overview"
        description="A clear view of your work, and what needs you."
      >
        {!isNewWorkspace ? (
          <Button variant="primary" icon={Plus} onClick={() => edit("task")}>
            New route
          </Button>
        ) : null}
      </PageHeader>
      <div className="tabs" role="tablist" aria-label="Overview">
        <button
          role="tab"
          aria-selected={tab === "workspace"}
          className={tab === "workspace" ? "active" : ""}
          onClick={() => setTab("workspace")}
        >
          Workspace
        </button>
        <button
          role="tab"
          aria-selected={tab === "activity"}
          className={tab === "activity" ? "active" : ""}
          onClick={() => setTab("activity")}
        >
          Activity
        </button>
      </div>
      {tab === "activity" ? (
        <section className="activity-page">
          <ActivityList limit={40} compact={false} />
        </section>
      ) : isNewWorkspace ? (
        <Empty
          kind="projects"
          title="Make room for your next idea"
          description={`Start a project in ${workspace.name}. Give it a goal, map out the work, and bring your agents along.`}
          action="Create project"
          onAction={() => edit("project")}
          secondaryAction="Connect your tools"
          onSecondaryAction={() => navigate("connections")}
        />
      ) : (
        <div className="overview-grid">
          <div className="overview-main">
            <section>
              <div className="section-heading">
                <h2>
                  Your projects <span>{projects.length || ""}</span>
                </h2>
                <button
                  className="text-button"
                  onClick={() => navigate("projects")}
                >
                  View all <ArrowRight />
                </button>
              </div>
              {projects.length ? (
                projects
                  .slice(0, 4)
                  .map((project) => (
                    <ProjectRow key={project.id} project={project} />
                  ))
              ) : (
                <Empty
                  compact
                  kind="projects"
                  title="Give your work a home"
                  description="Keep related routes, conversations, and project decisions together."
                  action="Create project"
                  onAction={() => edit("project")}
                />
              )}
            </section>
            <section className="up-next">
              <div className="section-heading">
                <h2>
                  Up next <span>{upNext.length || ""}</span>
                </h2>
                <button
                  className="text-button"
                  onClick={() => navigate("tasks")}
                >
                  View all <ArrowRight />
                </button>
              </div>
              {upNext.length ? (
                upNext.map((task) => (
                  <button
                    key={task.id}
                    className="up-next-row"
                    onClick={() => navigate("tasks", task.id)}
                  >
                    <Status value={task.status} label="" />
                    <span className="row-copy">
                      <strong>{task.title}</strong>
                      <small>
                        {task.description ||
                          "Open route to add context and start work."}
                      </small>
                    </span>
                    <span className="row-meta">
                      {projects.find(
                        (project) => project.id === val(task, "project_id"),
                      )?.name ?? "Workspace"}
                    </span>
                    <Priority value={task.priority} />
                  </button>
                ))
              ) : (
                <Empty
                  compact
                  kind="routes"
                  icon={GitBranch}
                  title="A little clarity goes a long way"
                  description="Move a route to Ready and it will show up here."
                  action="Plan a route"
                  onAction={() => edit("task")}
                />
              )}
            </section>
          </div>
          <aside className="overview-aside">
            <section className="attention-panel">
              <div className="section-heading">
                <h2>Needs your attention</h2>
                {pending.length ? (
                  <span className="count">{pending.length}</span>
                ) : null}
              </div>
              {pending.length ? (
                pending.slice(0, 2).map((approval) => (
                  <div className="attention-item" key={approval.id}>
                    <div className="attention-label">
                      <ShieldCheck />
                      <span>Permission request</span>
                      <time>{relative(val(approval, "created_at"))}</time>
                    </div>
                    <h3>{approval.title}</h3>
                    <p>{approval.detail}</p>
                    <Button
                      onClick={() => navigate("work", val(approval, "run_id"))}
                    >
                      Review session
                    </Button>
                  </div>
                ))
              ) : (
                <div className="all-clear">
                  <CircleCheck />
                  <strong>You’re all caught up</strong>
                  <p>
                    Agent requests and decisions will appear here when they need
                    you.
                  </p>
                </div>
              )}
              <div className="section-divider" />
              <div className="section-heading">
                <h2>Recent activity</h2>
                <button
                  className="text-button"
                  onClick={() => setTab("activity")}
                  aria-label="View all activity"
                >
                  <ArrowRight />
                </button>
              </div>
              <ActivityList limit={4} />
            </section>
            <button
              className="connection-nudge"
              onClick={() => navigate(active.length ? "work" : "connections")}
            >
              <span className="activity-icon">
                <Plug />
              </span>
              <span>
                <strong>
                  {active.length
                    ? `${active.length} active ${active.length === 1 ? "session" : "sessions"}`
                    : "Bring your tools together"}
                </strong>
                <small>
                  {active.length
                    ? "See what your agents are doing"
                    : "Connect agents, repositories, and files"}
                </small>
              </span>
              <ArrowRight />
            </button>
          </aside>
        </div>
      )}
    </main>
  );
}

export function InboxView() {
  const { data, navigate, perform, notify } = useApp();
  const [tab, setTab] = useState("unread");
  const readIds = data.settings?.inbox?.readIds ?? [];
  const approvals = data.approvals.filter((item) => item.status === "pending");
  const notifications = data.settings?.notifications ?? {};
  const completed = data.runs.filter(
    (run) =>
      ["completed", "failed", "stopped"].includes(run.status) &&
      (run.status === "completed"
        ? notifications.runCompleted !== false
        : run.status === "failed"
          ? notifications.runFailed !== false
          : true),
  );
  const items = completed.filter(
    (run) => tab === "all" || !readIds.includes(run.id),
  );
  const markRead = (ids) =>
    perform(async () => {
      await rumboActions.updateSettings({
        inbox: { readIds: [...new Set([...readIds, ...ids])] },
      });
      notify("Inbox updated");
    });
  return (
    <main className="page">
      <PageHeader
        title="Inbox"
        description="Decisions, approvals, and updates that need your attention."
      >
        <Button
          icon={CircleCheck}
          disabled={!completed.some((run) => !readIds.includes(run.id))}
          onClick={() => markRead(completed.map((run) => run.id))}
        >
          Mark all read
        </Button>
      </PageHeader>
      <AccessApprovalInbox />
      <div className="tabs">
        <button
          className={tab === "unread" ? "active" : ""}
          onClick={() => setTab("unread")}
        >
          Unread{" "}
          <span>
            {approvals.length +
              completed.filter((run) => !readIds.includes(run.id)).length}
          </span>
        </button>
        <button
          className={tab === "all" ? "active" : ""}
          onClick={() => setTab("all")}
        >
          All updates
        </button>
      </div>
      <div className="inbox-list">
        {approvals.map((approval) => (
          <div key={approval.id} className="inbox-row">
            <span className="activity-icon warning">
              <ShieldCheck />
            </span>
            <div className="row-copy">
              <strong>{approval.title}</strong>
              <small>{approval.detail}</small>
            </div>
            <time>{relative(val(approval, "created_at"))}</time>
            <Button onClick={() => navigate("work", val(approval, "run_id"))}>
              Review
            </Button>
          </div>
        ))}
        {items.map((run) => (
          <div
            key={run.id}
            className={`inbox-row ${readIds.includes(run.id) ? "read" : ""}`}
          >
            <span className="activity-icon">
              <CircleCheck />
            </span>
            <button
              className="row-copy link-copy"
              onClick={() => {
                markRead([run.id]);
                navigate("work", run.id);
              }}
            >
              <strong>{run.title}</strong>
              <small>
                {run.agent_name ?? run.provider} · {run.status}
                {run.mode !== "live" ? " · Simulation" : ""}
              </small>
            </button>
            <time>{relative(val(run, "updated_at"))}</time>
            {!readIds.includes(run.id) ? (
              <Button variant="ghost" onClick={() => markRead([run.id])}>
                Mark read
              </Button>
            ) : (
              <span className="muted">Read</span>
            )}
          </div>
        ))}
        {!items.length && !approvals.length ? (
          <Empty
            kind="inbox"
            icon={Inbox}
            title="Nothing needs your attention"
            description="Session results and permission requests arrive here, so you can review the work without following every step."
            action="Open live work"
            onAction={() => navigate("work")}
            secondaryAction={tab === "unread" && completed.length ? "View all updates" : undefined}
            onSecondaryAction={() => setTab("all")}
          />
        ) : null}
      </div>
    </main>
  );
}

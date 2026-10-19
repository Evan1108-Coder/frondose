import { ReviewPanel } from '../components/ReviewPanel.jsx';
import { SkillFromRunButton } from '../components/SkillFromRun.jsx';
import { ContextInspector } from '../components/ContextInspector.jsx';
import { CapturedRunContextButton } from '../components/CapturedRunContext.jsx';
import { NativeToolActivity, NativeToolsChoice } from '../components/NativeToolActivity.jsx';
import { ActivityTypeIcon } from '../components/ActivityTypeIcon.jsx';
import { runActivityType } from '../lib/activity-icons.js';
import { lazy, Suspense, useState } from "react";
import { Play, Square, Terminal, ShieldCheck, Check, X, ArrowRight, Download, Clock, MessageCircle, FileText, Plus, FlaskConical, Pencil, Pin, PinOff, Archive, RotateCcw } from "../components/icons.jsx";
import { talvoriActions } from "../data/useTalvori.js";
import { Form } from "../components/Form.jsx";
import { agentReadiness } from "../lib/agents.js";
import {
  Button,
  Dialog,
  Empty,
  ErrorMessage,
  Field,
  PageHeader,
  ProviderIcon,
  Select,
  Status,
  useApp,
  useAsync,
} from "../ui.jsx";
import {
  activeRun,
  byUpdated,
  download,
  relative,
  val,
  visible,
} from "../lib/model.js";
const RunUsageButton = lazy(() => import('../components/RunUsage.jsx').then(module => ({ default: module.RunUsageButton })));

export function SessionDialog({ defaults = {}, onClose }) {
  const { data, workspace, navigate, notify } = useApp();
  const agents = visible(data.agents).filter(
    (agent) =>
      agent.status !== "paused" && ["codex", "claude"].includes(agent.provider),
  );
  const chat = visible(data.chats).find((item) => item.id === defaults.chat_id);
  const initialTask = visible(data.tasks).find((task) => task.id === (val(chat, "task_id") ?? defaults.task_id));
  const [agentId, setAgentId] = useState(() => {
    if (defaults.agent_id) return defaults.agent_id;
    const id = defaults.agent_id ?? val(initialTask, "assignee_agent_ids")?.[0];
    return agents.some((agent) => agent.id === id) ? id : (agents[0]?.id ?? "");
  });
  const [taskId, setTaskId] = useState(initialTask?.id ?? "");
  const [projectId, setProjectId] = useState(() => val(initialTask, "project_id") ?? val(chat, "project_id") ?? defaults.project_id ?? (!chat ? val(agents.find(item => item.id === agentId), "default_project_id") : "") ?? "");
  const [mode, setMode] = useState(defaults.mode === "live" ? "live" : "mock");
  const [permission, setPermission] = useState("read-only");
  const [prompt, setPrompt] = useState(
    defaults.prompt ?? initialTask?.description ?? "",
  );
  const [includeMemory, setIncludeMemory] = useState(true),
    [includeChat, setIncludeChat] = useState(true);
  const [reviewedContext, setReviewedContext] = useState(null);
  const [nativeTools, setNativeTools] = useState(false);
  const { busy, error, execute } = useAsync();
  const agent = agents.find((item) => item.id === agentId);
  const task = visible(data.tasks).find((item) => item.id === taskId);
  const compatibleTasks = visible(data.tasks).filter(
    (item) =>
      (!projectId || val(item, "project_id") === projectId) && (!chat ||
      (val(chat, "task_id")
        ? item.id === val(chat, "task_id")
        : !val(chat, "project_id") ||
          val(item, "project_id") === val(chat, "project_id"))),
  );
  const project = visible(data.projects).find(
    (item) =>
      item.id ===
      (val(task, "project_id") ?? projectId),
  );
  const provider = agent?.provider ?? "codex";
  const connection = data.connections.find(
    (item) => item.provider === provider && (!val(agent, "provider_connection_id") || item.id === val(agent, "provider_connection_id")),
  );
  const readiness = agentReadiness(agent, connection);
  const messages = data.messages
    .filter((item) => val(item, "chat_id") === chat?.id)
    .slice(-20);
  const notes = visible(data.memory_notes).filter(
    (note) =>
      !val(note, "project_id") || val(note, "project_id") === project?.id,
  );
  const cwd = val(project, "local_path") || val(agent, "working_directory");
  const effectivePermission = provider === "claude" || val(agent, "permission_policy") === "read-only" || data.settings?.agentDefaults?.approvalMode === "read_only" ? "read-only" : permission;
  const inspectionRequest = mode === "live" && agent && prompt.trim() ? {
    workspace_id: workspace.id, project_id: project?.id ?? null, task_id: taskId || null,
    chat_id: chat?.id ?? null, agent_id: agent.id, prompt: prompt.trim(), work_mode: "project",
    permission_mode: effectivePermission, include_memory: includeMemory && val(agent, "memory_policy") !== "none", include_chat: includeChat, native_tools: nativeTools,
    attachments: [], source_message_id: null, context_pack_ids: [], area_id: val(project, "team_id") || val(task, "team_id") || null,
    ...(cwd ? { cwd } : {}),
  } : null;
  const inspectionKey = JSON.stringify([inspectionRequest, agent?.version ?? null]);
  const contextReady = reviewedContext?.key === inspectionKey && Date.parse(reviewedContext.result.expires_at) > Date.now();
  async function start(event) {
    event.preventDefault();
    await execute(async () => {
      if (agentId && !agent) throw new Error("This agent is no longer available. Choose another profile.");
      if (taskId && !task || projectId && !project) throw new Error("The selected route or project is no longer available.");
      if (defaults.chat_id && !chat) throw new Error("This chat is no longer available.");
      if (mode === "live" && (!readiness.canStartLive || !cwd)) throw new Error("Connect this agent and choose a project with a working folder before starting live work.");
      if (mode === "live" && !contextReady) throw new Error("Inspect the current context and choose Use this context before starting a live session.");
      const result = await talvoriActions.startSession({
        workspace_id: workspace.id,
        project_id: project?.id ?? null,
        task_id: taskId || null,
        chat_id: chat?.id ?? null,
        agent_id: agentId || null,
        provider,
        title: task?.title ?? chat?.title ?? "Agent session",
        prompt: prompt.trim(),
        include_memory: includeMemory && val(agent, "memory_policy") !== "none",
        include_chat: includeChat,
        native_tools: mode === "live" && nativeTools,
        mode,
        work_mode: "project",
        permissionMode: effectivePermission,
        ...(mode === "live" ? { context_inspection_id: reviewedContext.result.id, context_pack_ids: [], area_id: inspectionRequest.area_id } : {}),
        ...(cwd ? { cwd } : {}),
        scenario: "approval",
        requiresApproval: true,
      });
      notify(mode === "live" ? "Live session started" : "Simulation started");
      onClose();
      navigate("work", result.run?.id ?? result.id);
    });
  }
  return (
    <Dialog
      title="Start a session"
      subtitle="Choose your agent, review the context, then begin."
      onClose={onClose}
      wide
    >
      <Form onSubmit={start}>
        <div className="form-fields">
          <div className="session-mode">
            <button
              type="button"
              className={mode === "mock" ? "active" : ""}
              onClick={() => setMode("mock")}
            >
              <FlaskConical />
              <span>
                <strong>Simulation</strong>
                <small>Try the workflow. No AI or file changes.</small>
              </span>
              {mode === "mock" ? <Check /> : null}
            </button>
            <button
              type="button"
              className={mode === "live" ? "active" : ""}
              onClick={() => setMode("live")}
            >
              <Terminal />
              <span>
                <strong>Live agent</strong>
                <small>
                  Use your connected provider and its usage allowance.
                </small>
              </span>
              {mode === "live" ? <Check /> : null}
            </button>
          </div>
          <div className="form-grid">
            <Select label="Agent" value={agentId} onChange={setAgentId}>
              {agents.length ? (
                agents.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.provider}
                  </option>
                ))
              ) : (
                <option value="">Codex simulator</option>
              )}
            </Select>
            <Select label="Project" value={projectId} disabled={Boolean(val(chat, "project_id") || val(chat, "task_id"))} onChange={(value) => { setProjectId(value); setTaskId(""); }}>
              <option value="">No project · use agent folder</option>
              {visible(data.projects).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
            <Select
              label="Route"
              value={taskId}
              disabled={Boolean(val(chat, "task_id"))}
              onChange={(value) => {
                setTaskId(value);
                const next = data.tasks.find((item) => item.id === value);
                if (next) setProjectId(val(next, "project_id") ?? "");
                if (!prompt && next) setPrompt(next.description);
              }}
            >
              <option value="">Standalone session</option>
              {compatibleTasks.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </Select>
          </div>
          <Field label="What should the agent do?">
            <textarea
              data-field-default-key="session.new.prompt"
              data-field-default-page="Start a session"
              data-field-default-label="What should the agent do?"
              data-field-default-mode="create"
              autoFocus
              required
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the outcome you want, and any constraints…"
            />
          </Field>
          <div className="context-review">
            <h3>Context choices</h3>
            <p>{project?.name ?? "Workspace context"}{cwd ? <code>{cwd}</code> : <span>No working folder selected</span>}</p>
            {agent?.instructions ? (
              <p className="muted">Agent instructions: {agent.instructions}</p>
            ) : null}
            {agent ? <p className="muted">Profile v{agent.version ?? 1} · Model: {agent.model || "Provider default"}{val(agent, "reasoning_effort") ? ` · Reasoning: ${val(agent, "reasoning_effort")}` : ""}. Availability depends on the connected provider.</p> : null}
            <label>
              <input
                type="checkbox"
                checked={includeMemory && val(agent, "memory_policy") !== "none"}
                disabled={val(agent, "memory_policy") === "none"}
                onChange={(e) => setIncludeMemory(e.target.checked)}
              />
              {val(agent, "memory_policy") === "none" ? "Saved memory disabled by this profile" : `${notes.length} memory ${notes.length === 1 ? "note" : "notes"}`}
            </label>
            <label>
              <input
                type="checkbox"
                checked={includeChat}
                onChange={(e) => setIncludeChat(e.target.checked)}
              />
              {messages.length} recent chat{" "}
              {messages.length === 1 ? "message" : "messages"} and text
              attachments
            </label>
          </div>
          {mode === "live" ? (
            <>
              <Select
                label="Working permissions"
                value={
                  provider === "claude" ||
                  val(agent, "permission_policy") === "read-only" ||
                  data.settings?.agentDefaults?.approvalMode === "read_only"
                    ? "read-only"
                    : permission
                }
                onChange={setPermission}
              >
                <option value="read-only">
                  Read only · inspect and suggest
                </option>
                {provider !== "claude" &&
                val(agent, "permission_policy") !== "read-only" &&
                data.settings?.agentDefaults?.approvalMode !== "read_only" ? (
                  <option value="workspace-write">
                    Allow changes inside the linked project
                  </option>
                ) : null}
              </Select>
              <div className="session-disclosure">
                <ShieldCheck />
                <p>
                  {readiness.canStartLive
                    ? "Your connected provider will receive the prompt and selected context. The provider controls usage and billing."
                    : `Connect ${provider === "codex" ? "Codex" : "Claude"} in Connections before starting live work.`}
                  {!cwd
                    ? " Link a working folder to the project or agent first."
                    : ""}
                </p>
              </div>
              <NativeToolsChoice checked={nativeTools} disabled={busy} onChange={value => { setNativeTools(value); setReviewedContext(null); }} />
              <ContextInspector key={`session-context:${agent?.id}:${agent?.version ?? 0}`} request={inspectionRequest} onReviewed={result => setReviewedContext({ key: inspectionKey, result })} onInvalidated={() => setReviewedContext(null)} />
            </>
          ) : (
            <p className="form-note">
              This simulation produces sample events and an approval request. It
              does not contact an AI provider, execute commands, or change
              files.
            </p>
          )}
          <ErrorMessage error={error} />
        </div>
        <footer className="dialog-footer">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="primary"
            icon={Play}
            busy={busy}
            disabled={
              !prompt.trim() ||
              Boolean(agentId && !agent) ||
              (mode === "live" && (!readiness.canStartLive || !cwd || !contextReady))
            }
          >
            {mode === "live" ? "Start live session" : "Start simulation"}
          </Button>
        </footer>
      </Form>
    </Dialog>
  );
}

function Approval({ approval, run }) {
  const { notify } = useApp();
  const { busy, error, execute } = useAsync();
  const decide = (decision) =>
    execute(async () => {
      await talvoriActions.resolveApproval(run.id, approval.id, decision);
      notify(decision === "approve" ? "Request approved" : "Request denied");
    });
  return (
    <section className="approval-card">
      <div className="approval-icon">
        <ShieldCheck />
      </div>
      <div>
        <h3>{approval.title}</h3>
        <p>{approval.detail}</p>
        <small>
          {run.mode === "live"
            ? "This affects the current live session."
            : "Simulation only. No command will execute."}
        </small>
        <ErrorMessage error={error} />
        <div className="approval-actions">
          <Button icon={X} disabled={busy} onClick={() => decide("deny")}>
            Deny
          </Button>
          <Button
            variant="primary"
            icon={Check}
            busy={busy}
            onClick={() => decide("approve")}
          >
            Approve
          </Button>
        </div>
      </div>
    </section>
  );
}

export function WorkView() {
  const { data, workspace, page, navigate, startSession, perform, notify, organization, toggleFavorite } = useApp();
  const [filter, setFilter] = useState("all");
  const [rename, setRename] = useState(null);
  const [archive, setArchive] = useState(null);
  const [draftTitle, setDraftTitle] = useState('');
  const runs = data.runs
    .toSorted(byUpdated)
    .filter((run) => filter === 'archived' ? Boolean(run.archived_at) : !run.archived_at && (filter === 'all' || filter === 'active' && activeRun(run) || filter === 'finished' && !activeRun(run)));
  const run = runs.find((item) => item.id === page.id) ?? runs[0];
  const starred = item => organization.favorites.some(favorite => favorite.view === 'work' && favorite.id === item.id);
  const updateRun = (item, patch, message) => perform(() => talvoriActions.updateRun(item.id, patch), message);
  const approvals = data.approvals.filter(
    (item) => val(item, "run_id") === run?.id && item.status === "pending",
  );
  const events = data.events
    .filter((item) => val(item, "run_id") === run?.id)
    .toSorted((a, b) => a.sequence - b.sequence);
  const files = events
    .filter(
      (event) => event.type === "file.changed" || event.type === "file_change",
    )
    .map((event) => event.payload)
    .filter((item) => item?.path);
  const output = events
    .filter((event) =>
      [
        "agent.message",
        "agent.output",
        "agent.response",
        "run.output",
      ].includes(event.type),
    )
    .map(
      (event) => event.payload?.text ?? event.payload?.content ?? event.summary,
    )
    .join("\n\n");
  return (
    <main className="page work-page">
      <PageHeader
        title="Runs"
        description="See what’s happening, review requests, and keep every session in view."
      >
        {data.runs.length ? (
          <Button variant="primary" icon={Play} onClick={() => startSession()}>
            Start session
          </Button>
        ) : null}
      </PageHeader>
      <div className="tabs">
        {[
          ["all", "All sessions"],
          ["active", "Active"],
          ["finished", "Finished"],
          ["archived", "Archived"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={filter === id ? "active" : ""}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {data.runs.length ? (
        <div className="work-layout">
          <aside className="session-list">
            {runs.map((item) => (
              <div key={item.id} className={`session-list-row ${item.id === run?.id ? "active" : ""}`}>
              <button className={`session-list-item ${item.id === run?.id ? "active" : ""}`} onClick={() => navigate("work", item.id)}>
                <ProviderIcon provider={item.provider} />
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.agent_name ?? item.provider} ·{" "}
                    {item.mode === "live" ? "Live" : "Simulation"}
                  </small>
                  <Status value={item.status} />
                </span>
              </button>
              <div className="session-list-actions"><button aria-label={`Rename ${item.title}`} onClick={() => { setRename(item); setDraftTitle(item.title); }}><Pencil /></button><button aria-label={`${starred(item) ? 'Unstar' : 'Star'} ${item.title}`} aria-pressed={starred(item)} onClick={() => toggleFavorite({ view: 'work', id: item.id })}>{starred(item) ? <PinOff /> : <Pin />}</button><button aria-label={`${item.archived_at ? 'Restore' : 'Delete'} ${item.title}`} onClick={() => item.archived_at ? updateRun(item, { archived_at: null }, 'Run restored') : setArchive(item)}>{item.archived_at ? <RotateCcw /> : <Archive />}</button></div>
              </div>
            ))}
            {!runs.length ? (
              <p className="section-empty">No sessions in this view.</p>
            ) : null}
          </aside>
          <section className="session-detail">
            {run ? (
              <>
                <div className="session-detail-heading">
                  <div>
                    <span className="mini-label">
                      {run.mode === "live"
                        ? "Live session"
                        : "Simulation"}
                    </span>
                    <h2>{run.title}</h2>
                  </div>
                  <div>
                    <SkillFromRunButton run={run} />
                    <CapturedRunContextButton run={run} />
                    <Suspense fallback={<span>Loading usage control…</span>}><RunUsageButton key={run.id} run={run} /></Suspense>
                    <Button
                      icon={Download}
                      onClick={() => {
                        download(`talvori-session-${run.id}.json`, {
                          run,
                          events,
                        });
                        notify("Session exported");
                      }}
                    >
                      Export
                    </Button>
                    {activeRun(run) ? (
                      <Button
                        icon={Square}
                        onClick={() =>
                          perform(
                            () => talvoriActions.stopRun(run.id),
                            "Session stopped",
                          )
                        }
                      >
                        Stop
                      </Button>
                    ) : (
                      <Button
                        icon={Play}
                        onClick={() =>
                          startSession({
                            task_id: val(run, "task_id"),
                            project_id: val(run, "project_id"),
                            chat_id: val(run, "chat_id"),
                            prompt: run.prompt,
                          })
                        }
                      >
                        Run again
                      </Button>
                    )}
                  </div>
                </div>
                <div className="session-properties">
                  <div>
                    <span>Status</span>
                    <Status value={run.status} />
                  </div>
                  <div>
                    <span>Agent</span>
                    <strong>{run.agent_name ?? run.provider}</strong>
                  </div>
                  <div>
                    <span>Started</span>
                    <strong>
                      {relative(
                        val(run, "started_at") ?? val(run, "created_at"),
                      )}
                    </strong>
                  </div>
                </div>
                {val(run, "chat_id") ? (
                  <button
                    className="text-button"
                    onClick={() => navigate("chats", val(run, "chat_id"))}
                  >
                    <MessageCircle />
                    Open linked conversation <ArrowRight />
                  </button>
                ) : null}
                {approvals.map((approval) => (
                  <Approval key={approval.id} approval={approval} run={run} />
                ))}
                <div className="session-timeline">
                  <div className="section-heading">
                    <h3>Activity</h3>
                    <span className="muted">{events.length} events</span>
                  </div>
                  {events.length ? (
                    events.map((event) => (
                      <div key={event.id} className="event-row">
                        <span className="event-marker">
                          <ActivityTypeIcon workspaceId={workspace.id} type={runActivityType(event)} size={15} />
                        </span>
                        <div>
                          <strong>{event.summary}</strong>
                          {event.payload?.command ? (
                            <code>{event.payload.command}</code>
                          ) : null}
                          {event.type?.includes("error") &&
                          event.payload?.message ? (
                            <p className="error-text">
                              {event.payload.message}
                            </p>
                          ) : null}
                        </div>
                        <time>
                          {new Date(
                            val(event, "created_at"),
                          ).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </time>
                      </div>
                    ))
                  ) : (
                    <p className="section-empty">
                      Waiting for the first event…
                    </p>
                  )}
                </div>
                {output ? (
                  <section className="session-output">
                    <h3>Agent output</h3>
                    <pre>{output}</pre>
                  </section>
                ) : null}
                <ReviewPanel targetType="run" targetId={run.id} projectId={val(run, 'project_id')} />
                {run.mode === 'live' ? <NativeToolActivity key={run.id} runId={run.id} /> : null}
                {files.length ? (
                  <section>
                    <div className="section-heading">
                      <h3>
                        {run.mode === "live"
                          ? "File activity"
                          : "Simulated file activity"}
                      </h3>
                    </div>
                    {files.map((file, index) => (
                      <div className="resource-link" key={index}>
                        <FileText />
                        <code>{file.path}</code>
                        <span>{file.change ?? "modified"}</span>
                      </div>
                    ))}
                  </section>
                ) : null}
                {run.mode !== "live" ? (
                  <div className="session-disclosure">
                    <FlaskConical />
                    <p>
                      This is a simulated session. All activity is illustrative;
                      no files or provider accounts were used.
                    </p>
                  </div>
                ) : null}
              </>
            ) : (
              <Empty
                compact
                kind="work"
                icon={Clock}
                title="No sessions in this view"
                description="Your other sessions are still in All sessions."
                action="View all sessions"
                onAction={() => setFilter("all")}
              />
            )}
          </section>
        </div>
      ) : (
        <Empty
          kind="work"
          icon={Terminal}
          title="Your agents’ work, in the open"
          description="Start a session to see its activity, output, and approval requests. Try a simulation first or connect a live agent."
          action="Start session"
          onAction={() => startSession()}
          secondaryAction="Connect an agent"
          onSecondaryAction={() => navigate("connections")}
        />
      )}
      {rename ? <Dialog title="Rename run" onClose={() => setRename(null)}><Field label="Run name"><input autoFocus maxLength={200} value={draftTitle} onChange={event => setDraftTitle(event.target.value)} /></Field><div className="dialog-footer"><Button onClick={() => setRename(null)}>Cancel</Button><Button variant="primary" disabled={!draftTitle.trim()} onClick={async () => { if (await updateRun(rename, { title: draftTitle.trim() }, 'Run renamed')) setRename(null); }}>Save name</Button></div></Dialog> : null}
      {archive ? <Dialog title="Delete run?" onClose={() => setArchive(null)}><p>This moves the run to Archived. Its events and review history remain available, and you can restore it later.</p>{activeRun(archive) ? <p>Stop this active run before archiving it.</p> : null}<div className="dialog-footer"><Button onClick={() => setArchive(null)}>Cancel</Button><Button disabled={activeRun(archive)} onClick={async () => { if (await updateRun(archive, { archived_at: true }, 'Run archived')) { setArchive(null); navigate('work'); } }}>Move to Archived</Button></div></Dialog> : null}
    </main>
  );
}

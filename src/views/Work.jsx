import { ReviewPanel } from '../components/ReviewPanel.jsx';
import { useState } from "react";
import { Play, Square, Terminal, ShieldCheck, Check, X, ArrowRight, Download, Clock, MessageCircle, FileText, Plus, FlaskConical } from "../components/icons.jsx";
import { rumboActions } from "../data/useRumbo.js";
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
  const [projectId, setProjectId] = useState(val(initialTask, "project_id") ?? val(chat, "project_id") ?? defaults.project_id ?? "");
  const [mode, setMode] = useState(defaults.mode === "live" ? "live" : "mock");
  const [permission, setPermission] = useState("read-only");
  const [prompt, setPrompt] = useState(
    defaults.prompt ?? initialTask?.description ?? "",
  );
  const [includeMemory, setIncludeMemory] = useState(true),
    [includeChat, setIncludeChat] = useState(true);
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
    (item) => item.provider === provider,
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
  async function start(event) {
    event.preventDefault();
    await execute(async () => {
      if (agentId && !agent) throw new Error("This agent is no longer available. Choose another profile.");
      if (taskId && !task || projectId && !project) throw new Error("The selected route or project is no longer available.");
      if (defaults.chat_id && !chat) throw new Error("This chat is no longer available.");
      if (mode === "live" && (!readiness.canStartLive || !cwd)) throw new Error("Connect this agent and choose a project with a working folder before starting live work.");
      const result = await rumboActions.startSession({
        workspace_id: workspace.id,
        project_id: project?.id ?? null,
        task_id: taskId || null,
        chat_id: chat?.id ?? null,
        agent_id: agentId || null,
        provider,
        title: task?.title ?? chat?.title ?? "Agent session",
        prompt: prompt.trim(),
        include_memory: includeMemory,
        include_chat: includeChat,
        mode,
        permissionMode:
          provider === "claude" ||
          data.settings?.agentDefaults?.approvalMode === "read_only"
            ? "read-only"
            : permission,
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
              autoFocus
              required
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the outcome you want, and any constraints…"
            />
          </Field>
          <div className="context-review">
            <h3>Context included</h3>
            <p>{project?.name ?? "Workspace context"}{cwd ? <code>{cwd}</code> : <span>No working folder selected</span>}</p>
            {agent?.instructions ? (
              <p className="muted">Agent instructions: {agent.instructions}</p>
            ) : null}
            <label>
              <input
                type="checkbox"
                checked={includeMemory}
                onChange={(e) => setIncludeMemory(e.target.checked)}
              />
              {notes.length} memory {notes.length === 1 ? "note" : "notes"}
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
              (mode === "live" && (!readiness.canStartLive || !cwd))
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
      await rumboActions.resolveApproval(run.id, approval.id, decision);
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
  const { data, page, navigate, startSession, perform, notify } = useApp();
  const [filter, setFilter] = useState("all");
  const runs = data.runs
    .toSorted(byUpdated)
    .filter((run) =>
      filter === "all" || filter === "active"
        ? filter !== "active" || activeRun(run)
        : !activeRun(run),
    );
  const run = runs.find((item) => item.id === page.id) ?? runs[0];
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
        title="Live work"
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
              <button
                key={item.id}
                className={`session-list-item ${item.id === run?.id ? "active" : ""}`}
                onClick={() => navigate("work", item.id)}
              >
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
                    <Button
                      icon={Download}
                      onClick={() => {
                        download(`rumbo-session-${run.id}.json`, {
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
                            () => rumboActions.stopRun(run.id),
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
                          <i />
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
    </main>
  );
}

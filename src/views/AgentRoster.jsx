import { useEffect, useRef, useState } from "react";
import { Plus, Pencil, Ellipsis, Copy, Pause, Play, Archive, ArrowLeft, ArrowUpRight, Folder, Plug, FlaskConical, MessageCircle, ShieldCheck, Terminal, Pin, PinOff } from "../components/icons.jsx";
import { Button, Dialog, Empty, ErrorMessage, IconButton, PageHeader, SearchField, Select, Status, useApp, useAsync } from "../ui.jsx";
import { AgentIdentity } from "../components/AgentIdentity.jsx";
import { rumboActions } from "../data/useRumbo.js";
import { AGENT_PROVIDERS, agentReadiness, summarizeAgent } from "../lib/agents.js";
import { relative, val, visible } from "../lib/model.js";
import { ConnectionDialog } from "./Connections.jsx";
import "./agents-page.css";

function Readiness({ readiness }) {
  return <span className={`agent-readiness is-${readiness.state}`}><i aria-hidden="true" />{readiness.label}</span>;
}

function AgentMenu({ agent, onEdit, onDuplicate, onPause, onArchive, busy, active }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null), trigger = useRef(null), menu = useRef(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector("button:not(:disabled)")?.focus();
    const outside = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); };
  }, [open]);
  function close() { setOpen(false); trigger.current?.focus(); }
  function action(callback) { close(); callback(); }
  return <div className="agent-menu" ref={root}>
    <button className="icon-button" ref={trigger} aria-label={`Actions for ${agent.name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><Ellipsis /></button>
    {open ? <div className="agent-menu-panel" role="menu" aria-label={`${agent.name} actions`} ref={menu} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const items = [...menu.current.querySelectorAll("button:not(:disabled)")];
        const index = items.indexOf(document.activeElement);
        items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    }}>
      <button role="menuitem" onClick={() => action(onEdit)}><Pencil />Edit agent</button>
      <button role="menuitem" onClick={() => action(onDuplicate)}><Copy />Duplicate</button>
      <button role="menuitem" disabled={busy} onClick={() => action(onPause)}><Pause morphTo={agent.status === "paused" ? Play : Pause} />{agent.status === "paused" ? "Resume agent" : "Pause agent"}</button>
      <div className="agent-menu-divider" />
      <button role="menuitem" disabled={active || busy} onClick={() => action(onArchive)}><Archive />Archive agent</button>
      {active ? <small className="agent-menu-hint">Stop active sessions before archiving.</small> : null}
    </div> : null}
  </div>;
}

function ArchiveAgentDialog({ agent, onClose }) {
  const { notify, navigate, perform } = useApp();
  const { busy, error, execute } = useAsync();
  return <Dialog title={`Archive ${agent.name}?`} subtitle="The profile will be hidden, not deleted." onClose={() => { if (!busy) onClose(); }}>
    <div className="form-fields"><p className="agent-dialog-copy">{!val(agent, "workspace_id") ? "This shared profile will be hidden in every workspace. " : ""}Session history and provider connections stay intact. You can restore this agent from Settings → Archive.</p><ErrorMessage error={error} /></div>
    <footer className="dialog-footer"><Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" icon={Archive} busy={busy} onClick={() => execute(async () => {
      await rumboActions.updateAgent(agent.id, { archived_at: new Date().toISOString() });
      onClose(); navigate("agents");
      notify(`${agent.name} archived`, "success", () => perform(() => rumboActions.updateAgent(agent.id, { archived_at: null }), "Agent restored"));
    })}>Archive agent</Button></footer>
  </Dialog>;
}

function AgentDetail({ agent, summary, onConnect, onPause, onDuplicate, busy }) {
  const { data, workspace, edit, navigate, startSession, organization, toggleFavorite } = useApp();
  const chatAction = useAsync();
  const favorite = organization.favorites.some(item => item.view === "agents" && item.id === agent.id);
  const [tab, setTab] = useState("overview");
  const { readiness, provider, activeRuns, runs, projects, chats, connection } = summary;
  return <aside className="agent-detail" aria-label={`${agent.name} details`}>
    <header className="agent-detail-header">
      <div className="agent-detail-title"><AgentIdentity agent={agent} /><div><h2>{agent.name}</h2><p>{provider.name}{!val(agent, "workspace_id") ? " · Shared across workspaces" : ""}{activeRuns.length ? ` · ${activeRuns.length} active ${activeRuns.length === 1 ? "session" : "sessions"}` : ""}</p></div></div>
      <IconButton label={`Edit ${agent.name}`} onClick={() => edit("agent", agent)}><Pencil /></IconButton>
    </header>
    <div className="agent-detail-quick-actions"><Button icon={MessageCircle} busy={chatAction.busy} onClick={() => chatAction.execute(async () => {
      const existing = visible(data.chats).filter(chat => !val(chat, "project_id") && !val(chat, "task_id") && (val(chat, "participant_agent_ids") ?? []).length === 1 && val(chat, "participant_agent_ids")[0] === agent.id).sort((a, b) => String(val(b, "updated_at")).localeCompare(String(val(a, "updated_at"))))[0];
      const chat = existing ?? await rumboActions.createChat({ workspace_id: workspace.id, title: `Chat with ${agent.name}`, participant_agent_ids: [agent.id] });
      navigate("chats", chat.id);
    })}>Chat with agent</Button><Button icon={favorite ? PinOff : Pin} aria-pressed={favorite} onClick={() => toggleFavorite({ view: "agents", id: agent.id })}>{favorite ? "Unfavorite" : "Favorite"}</Button><ErrorMessage error={chatAction.error} /></div>
    <div className="agent-detail-tabs" role="tablist" aria-label="Agent details">
      {["overview", "sessions"].map((value) => <button key={value} role="tab" id={`agent-tab-${value}`} aria-controls={`agent-panel-${value}`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={(event) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "overview" : event.key === "End" ? "sessions" : value === "overview" ? "sessions" : "overview"; setTab(next); event.currentTarget.parentElement.querySelector(`#agent-tab-${next}`)?.focus(); }
      }}>{value === "overview" ? "Overview" : "Sessions"}{value === "sessions" && runs.length ? <span>{runs.length}</span> : null}</button>)}
    </div>
    <div className="agent-detail-content" role="tabpanel" id={`agent-panel-${tab}`} aria-labelledby={`agent-tab-${tab}`}>
      {tab === "overview" ? <>
        <section className="agent-detail-section"><h3>Instructions</h3>{agent.instructions ? <p className="agent-instruction-copy">{agent.instructions}</p> : <><p>No instructions yet. Tell this agent how to approach its work.</p><button className="text-button" onClick={() => edit("agent", agent)}>Add instructions <ArrowUpRight /></button></>}</section>
        <section className="agent-detail-section"><h3><Folder />Working folder</h3><p className="agent-folder">{val(agent, "working_directory") || "Choose with each session"}</p><small>A linked project folder takes precedence.</small></section>
        <section className="agent-detail-section agent-connection-section"><h3><Plug />Connection</h3><Readiness readiness={readiness} /><p>{readiness.description}</p>
          {val(connection, "account_label") && readiness.canStartLive ? <small>{val(connection, "account_label")}</small> : null}
          <div className="agent-launch-actions">
            {readiness.action === "start" ? <Button icon={Play} onClick={() => startSession({ agent_id: agent.id, mode: "live" })}>Start session</Button>
              : readiness.action === "resume" ? <Button icon={Play} busy={busy} onClick={onPause}>Resume agent</Button>
                : readiness.action === "configure" ? <Button icon={Pencil} onClick={() => edit("agent", agent)}>Choose a supported provider</Button>
                  : <Button icon={Plug} onClick={() => onConnect(agent.provider)}>Connect {provider.name}</Button>}
            {readiness.canSimulate ? <button className="text-button agent-simulate" onClick={() => startSession({ agent_id: agent.id, mode: "mock" })}><FlaskConical />Try a simulation</button> : null}
          </div>
          {AGENT_PROVIDERS[agent.provider] ? <p className="agent-permission-note"><ShieldCheck />{agent.provider === "claude" ? "Read-only in Rumbo. Project editing is not supported yet." : "Choose read-only or project-edit access before each live session."}</p> : null}
        </section>
        {projects.length || chats.length ? <section className="agent-detail-section agent-linked-work"><h3>Linked work</h3>{projects.slice(0, 3).map((project) => <button key={project.id} onClick={() => navigate("projects", project.id)}><Folder /><span>{project.name}</span><ArrowUpRight /></button>)}{chats.slice(0, 3).map((chat) => <button key={chat.id} onClick={() => navigate("chats", chat.id)}><MessageCircle /><span>{chat.title}</span><ArrowUpRight /></button>)}</section> : null}
      </> : <>
        {runs.length ? <div className="agent-session-list">{runs.map((run) => <button key={run.id} onClick={() => navigate("work", run.id)}><span className="agent-session-title">{run.mode === "live" ? <Terminal /> : <FlaskConical />}<strong>{run.title}</strong><ArrowUpRight /></span><span className="agent-session-meta"><span>{run.mode === "live" ? "Live" : "Simulation"} · {relative(val(run, "created_at"))}</span><Status value={run.status} /></span></button>)}</div> : <div className="agent-sessions-empty"><Terminal /><h3>No sessions yet</h3><p>Work started with this profile will appear here. Try a simulation to see the workflow without using an AI account.</p>{readiness.canSimulate ? <Button icon={FlaskConical} onClick={() => startSession({ agent_id: agent.id, mode: "mock" })}>Try a simulation</Button> : null}</div>}
        <p className="agent-history-note">Only this workspace’s sessions linked to this profile are shown. Older sessions without an agent ID remain in Live work.</p>
      </>}
    </div>
    <footer className="agent-detail-footer"><button className="text-button" disabled={busy} onClick={onPause}><Pause morphTo={agent.status === "paused" ? Play : Pause} />{agent.status === "paused" ? "Resume agent" : "Pause agent"}</button><button className="text-button" onClick={onDuplicate}><Copy />Duplicate</button></footer>
  </aside>;
}

export function AgentsView() {
  const { data, page, edit, navigate, notify, organization } = useApp();
  const [query, setQuery] = useState(""), [filter, setFilter] = useState("all");
  const [connectionProvider, setConnectionProvider] = useState(null), [archiveAgent, setArchiveAgent] = useState(null);
  const { busy, error, execute } = useAsync();
  const agents = visible(data.agents).sort((a, b) => a.name.localeCompare(b.name));
  const summaries = new Map(agents.map((agent) => [agent.id, summarizeAgent(agent, data)]));
  const filtered = agents.filter((agent) => {
    const state = summaries.get(agent.id).readiness.state;
    return `${agent.name} ${agent.provider} ${agent.description || ""}`.toLowerCase().includes(query.trim().toLowerCase()) &&
      (filter === "all" || filter === state || filter === "setup" && !["ready", "paused"].includes(state) || filter === "working" && summaries.get(agent.id).activeRuns.length > 0 || filter === "favorites" && organization.favorites.some(item => item.view === "agents" && item.id === agent.id));
  });
  const selected = filtered.find((agent) => agent.id === page.id) ?? filtered[0];
  const unavailable = page.id && !agents.some((agent) => agent.id === page.id);
  function duplicate(agent) { edit("agent", null, { name: `${agent.name} copy`, provider: agent.provider, description: agent.description || "", instructions: agent.instructions || "", working_directory: val(agent, "working_directory") || "" }); }
  function pause(agent) { return execute(async () => { const status = agent.status === "paused" ? "available" : "paused"; await rumboActions.updateAgent(agent.id, { status }); notify(status === "paused" ? `${agent.name} paused. Existing sessions continue.` : `${agent.name} is available for new sessions.`); }); }
  return <main className={`page agents-page ${page.id ? "has-agent-selection" : ""}`}>
    <PageHeader title="Agents" description="Shape how your agents work. Keep their setup and activity in one place.">{agents.length ? <Button variant="primary" icon={Plus} onClick={() => edit("agent")}>New agent</Button> : null}</PageHeader>
    <section className="agent-provider-strip" aria-label="Provider connections">
      <div className="agent-provider-summaries">{Object.entries(AGENT_PROVIDERS).map(([id, provider]) => {
        const connection = data.connections.find((item) => item.provider === id);
        const readiness = agentReadiness({ id, provider: id, status: "available" }, connection);
        return <button key={id} className="agent-provider-summary" onClick={() => setConnectionProvider(id)} aria-label={`Manage ${provider.name} connection`}><AgentIdentity compact provider={id} /><strong>{provider.name}</strong><span className={`agent-connection-label is-${readiness.state}`}><i aria-hidden="true" />{readiness.canStartLive ? "Connected" : readiness.state === "connecting" ? "Signing in" : readiness.state === "not_installed" ? "Not installed" : "Not connected"}</span></button>;
      })}</div>
      <button className="text-button" onClick={() => navigate("connections")}>Manage connections <ArrowUpRight /></button>
    </section>
    <ErrorMessage error={error} />
    {!agents.length ? <Empty kind="agents" title="Give your first agent a purpose" description="Create a profile with instructions and a default folder. Connect its provider when you’re ready for live work, or try a simulation first." action="Create an agent" onAction={() => edit("agent")} />
      : unavailable ? <Empty kind="agents" title="Agent unavailable" description="This agent may be archived or belong to another workspace. Your other profiles are still available." action="All agents" onAction={() => navigate("agents")} secondaryAction="Open archive" onSecondaryAction={() => navigate("settings", "archive")} />
        : <div className="agent-workspace">
          <section className="agent-roster" aria-label="Agent roster">
            <div className="agent-roster-toolbar"><SearchField value={query} onChange={(value) => { setQuery(value); if (page.id) navigate("agents"); }} placeholder="Search agents…" /><Select aria-label="Filter agents" value={filter} onChange={(value) => { setFilter(value); if (page.id) navigate("agents"); }}><option value="all">All agents</option><option value="favorites">Favorites</option><option value="working">Working now</option><option value="ready">Ready</option><option value="setup">Needs setup</option><option value="paused">Paused</option></Select></div>
            <div className="agent-roster-table">
              <div className="agent-roster-labels"><span>Agent <small>{filtered.length}</small></span><span>Status</span><span /></div>
              {filtered.length ? filtered.map((agent) => {
                const summary = summaries.get(agent.id);
                return <div className={`agent-roster-row ${selected?.id === agent.id ? "is-selected" : ""}`} key={agent.id}>
                  <button className="agent-row-main" onClick={() => navigate("agents", agent.id)} aria-label={`Open ${agent.name}`} aria-current={selected?.id === agent.id ? "true" : undefined}>
                    <AgentIdentity agent={agent} /><span className="agent-row-copy"><strong>{agent.name}</strong><span>{summary.provider.name}{agent.description ? ` · ${agent.description}` : " · Custom agent profile"}</span></span>
                    <Readiness readiness={summary.readiness} />
                  </button>
                  <AgentMenu agent={agent} busy={busy} active={summary.activeRuns.length > 0} onEdit={() => edit("agent", agent)} onDuplicate={() => duplicate(agent)} onPause={() => pause(agent)} onArchive={() => setArchiveAgent(agent)} />
                </div>;
              }) : <div className="agent-search-empty"><h3>No matching agents</h3><p>Try a different name, provider, or status.</p><Button onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</Button></div>}
            </div>
            <p className="agent-roster-note"><ShieldCheck />Profiles share their provider connection, but keep separate instructions and session history.</p>
          </section>
          {selected ? <div className="agent-inspector"><button className="agent-mobile-back text-button" onClick={() => navigate("agents")}><ArrowLeft />All agents</button><AgentDetail key={selected.id} agent={selected} summary={summaries.get(selected.id)} onConnect={setConnectionProvider} onPause={() => pause(selected)} onDuplicate={() => duplicate(selected)} busy={busy} /></div> : null}
        </div>}
    {connectionProvider ? <ConnectionDialog provider={connectionProvider} onClose={() => setConnectionProvider(null)} /> : null}
    {archiveAgent ? <ArchiveAgentDialog agent={archiveAgent} onClose={() => setArchiveAgent(null)} /> : null}
  </main>;
}

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Plus, Pencil, Ellipsis, Copy, Pause, Play, Archive, ArrowLeft, ArrowUpRight, Folder, Plug, FlaskConical, MessageCircle, ShieldCheck, Terminal, Pin, PinOff, Download } from "../components/icons.jsx";
import { Button, Dialog, Empty, ErrorMessage, IconButton, PageHeader, SearchField, Select, Status, useApp, useAsync } from "../ui.jsx";
import { AgentIdentity } from "../components/AgentIdentity.jsx";
import { frondoseActions } from "../data/useFrondose.js";
import { apiRequest } from "../data/api.js";
import { AgentMemoryPanel } from "../components/AgentMemoryPanel.jsx";
import { agentDefaultChoices, duplicateAgentDefinition, exportAgentDefinition, parseAgentDefinition } from "../lib/agent-editor.js";
import { AGENT_PROVIDERS, agentReadiness, summarizeAgent } from "../lib/agents.js";
import { isScopedAiProvider } from '../lib/ai-providers.js';
import { download, relative, val, visible } from "../lib/model.js";
import { ConnectionDialog } from "./Connections.jsx";
import "./agents-page.css";
const AgentProfileHistory = lazy(() => import('../components/AgentProfileHistory.jsx').then(module => ({ default: module.AgentProfileHistory })));
const AgentUsageDisclosure = lazy(() => import('../components/RunUsage.jsx').then(module => ({ default: module.AgentUsageDisclosure })));
const AgentRunnerSettings = lazy(() => import('../components/AgentRunnerSettings.jsx').then(module => ({ default: module.AgentRunnerSettings })));

function Readiness({ readiness }) {
  return <span className={`agent-readiness is-${readiness.state}`}><i aria-hidden="true" />{readiness.label}</span>;
}

function AgentMenu({ agent, onEdit, onDuplicate, onExport, onPause, onArchive, busy, active }) {
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
      <button role="menuitem" onClick={() => action(onExport)}><Download />Export definition</button>
      <button role="menuitem" disabled={busy} onClick={() => action(onPause)}><Pause morphTo={agent.status === "paused" ? Play : Pause} />{agent.status === "paused" ? "Resume agent" : "Pause agent"}</button>
      <div className="agent-menu-divider" />
      <button role="menuitem" disabled={active || busy} onClick={() => action(onArchive)}><Archive />Archive agent</button>
      {active ? <small className="agent-menu-hint">Stop active sessions before archiving.</small> : null}
    </div> : null}
  </div>;
}

function ImportAgentDialog({ onClose, onImport }) {
  const [definition, setDefinition] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  return <Dialog title="Import an agent definition" subtitle="Review the profile before saving. Importing never starts work." onClose={() => !busy && onClose()}><div className="agent-import-fields"><p>Only name, role, provider, instructions, model preferences, memory policy, and expected output text are imported. Accounts, credentials, folders, Area/project/Context Pack references, and permissions are never restored. Imports start read-only and unbound.</p><label>Frondose agent JSON file<input type="file" accept=".json,application/json" disabled={busy} onChange={async event => {
    const file = event.target.files?.[0]; setDefinition(null); setError(null); if (!file) return;
    if (file.size > 250000) { setError(new Error("Choose a definition smaller than 250 KB.")); return; }
    setBusy(true); try { setDefinition(parseAgentDefinition(await file.text())); } catch (problem) { setError(problem); } finally { setBusy(false); }
  }} /></label>{definition ? <p role="status"><strong>{definition.name}</strong> · {definition.provider}. Ready to review in the profile editor.</p> : null}<ErrorMessage error={error} /></div><footer className="dialog-footer"><Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!definition || busy} onClick={() => onImport(definition)}>Review imported profile</Button></footer></Dialog>;
}

function AgentSkills({ agentId, workspaceId, navigate }) {
  const [state, setState] = useState({ loading: true, skills: [], error: null });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, skills: [], error: null });
    apiRequest(`/api/skills?workspace_id=${encodeURIComponent(workspaceId)}`, { signal: controller.signal }).then(({ result }) => setState({ loading: false, skills: (result ?? []).filter(skill => skill.preferred_agent_id === agentId), error: null })).catch(error => { if (!controller.signal.aborted) setState({ loading: false, skills: [], error }); });
    return () => controller.abort();
  }, [agentId, workspaceId, retry]);
  return <section className="agent-detail-section agent-linked-work"><h3>Preferred Skills</h3><p>Versioned capabilities that name this profile as their preferred agent. Being preferred does not grant tools or start work.</p><ErrorMessage error={state.error} />{state.loading ? <p role="status">Loading Skills…</p> : state.error ? <Button onClick={() => setRetry(value => value + 1)}>Retry Skills</Button> : state.skills.length ? state.skills.map(skill => <button key={skill.id} onClick={() => navigate("skills", skill.id)}><span>{skill.name} · v{skill.version} · {skill.state}</span><ArrowUpRight /></button>) : <p>No Skills name this agent yet.</p>}<Button onClick={() => navigate("skills")}>Manage Skills</Button></section>;
}

const DETAIL_TABS = [{ id: "overview", label: "Overview" }, { id: "context", label: "Context & Skills" }, { id: "sessions", label: "Runs & outputs" }];

function ArchiveAgentDialog({ agent, onClose }) {
  const { notify, navigate, perform } = useApp();
  const { busy, error, execute } = useAsync();
  return <Dialog title={`Archive ${agent.name}?`} subtitle="The profile will be hidden, not deleted." onClose={() => { if (!busy) onClose(); }}>
    <div className="form-fields"><p className="agent-dialog-copy">{!val(agent, "workspace_id") ? "This shared profile will be hidden in every workspace. " : ""}Session history and provider connections stay intact. You can restore this agent from Settings → Archive.</p><ErrorMessage error={error} /></div>
    <footer className="dialog-footer"><Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" icon={Archive} busy={busy} onClick={() => execute(async () => {
      await frondoseActions.updateAgent(agent.id, { archived_at: new Date().toISOString() });
      onClose(); navigate("agents");
      notify(`${agent.name} archived`, "success", () => perform(() => frondoseActions.updateAgent(agent.id, { archived_at: null }), "Agent restored"));
    })}>Archive agent</Button></footer>
  </Dialog>;
}

function AgentDetail({ agent, summary, onConnect, onPause, onDuplicate, busy }) {
  const { data, workspace, edit, navigate, startSession, organization, toggleFavorite } = useApp();
  const chatAction = useAsync();
  const favorite = organization.favorites.some(item => item.view === "agents" && item.id === agent.id);
  const [tab, setTab] = useState("overview");
  const [historyOpen, setHistoryOpen] = useState(false);
  const { readiness, provider, activeRuns, runs, projects, chats, connection, outputs, failedRuns } = summary;
  const choices = agentDefaultChoices(data, val(agent, "workspace_id"), val(agent, "default_area_id"));
  const defaultArea = choices.areas.find(area => area.id === val(agent, "default_area_id"));
  const defaultProject = choices.projects.find(project => project.id === val(agent, "default_project_id"));
  const packs = val(agent, "context_source_ids") ?? [];
  return <aside className="agent-detail" aria-label={`${agent.name} details`}>
    <header className="agent-detail-header">
      <div className="agent-detail-title"><AgentIdentity agent={agent} /><div><h2>{agent.name}</h2><p>{provider.name}{agent.version ? ` · Profile v${agent.version}` : " · Version not recorded"}{!val(agent, "workspace_id") ? " · Shared across workspaces" : ""}{activeRuns.length ? ` · ${activeRuns.length} active ${activeRuns.length === 1 ? "session" : "sessions"}` : ""}</p></div></div>
      <IconButton label={`Edit ${agent.name}`} onClick={() => edit("agent", agent)}><Pencil /></IconButton>
    </header>
    <div className="agent-detail-quick-actions"><Button icon={MessageCircle} busy={chatAction.busy} onClick={() => chatAction.execute(async () => {
      const existing = visible(data.chats).filter(chat => !val(chat, "project_id") && !val(chat, "task_id") && (val(chat, "participant_agent_ids") ?? []).length === 1 && val(chat, "participant_agent_ids")[0] === agent.id).sort((a, b) => String(val(b, "updated_at")).localeCompare(String(val(a, "updated_at"))))[0];
      const chat = existing ?? await frondoseActions.createChat({ workspace_id: workspace.id, title: `Chat with ${agent.name}`, participant_agent_ids: [agent.id] });
      navigate("chats", chat.id);
    })}>Chat with agent</Button><Button icon={favorite ? PinOff : Pin} aria-pressed={favorite} onClick={() => toggleFavorite({ view: "agents", id: agent.id })}>{favorite ? "Unfavorite" : "Favorite"}</Button><ErrorMessage error={chatAction.error} /></div>
    <div className="agent-detail-tabs" role="tablist" aria-label="Agent details">
      {DETAIL_TABS.map(({ id: value, label }, index) => <button key={value} role="tab" id={`agent-tab-${value}`} aria-controls={`agent-panel-${value}`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={(event) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = DETAIL_TABS[event.key === "Home" ? 0 : event.key === "End" ? DETAIL_TABS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + DETAIL_TABS.length) % DETAIL_TABS.length].id; setTab(next); event.currentTarget.parentElement.querySelector(`#agent-tab-${next}`)?.focus(); }
      }}>{label}{value === "sessions" && runs.length ? <span>{runs.length}</span> : null}</button>)}
    </div>
    <div className="agent-detail-content" role="tabpanel" id={`agent-panel-${tab}`} aria-labelledby={`agent-tab-${tab}`}>
      {tab === "overview" ? <>
        <section className="agent-detail-section"><h3>Purpose</h3><p>{agent.role || "No role defined"}</p>{agent.description ? <small>{agent.description}</small> : null}</section>
        <section className="agent-detail-section"><h3>Instructions</h3>{agent.instructions ? <p className="agent-instruction-copy">{agent.instructions}</p> : <><p>No instructions yet. Tell this agent how to approach its work.</p><button className="text-button" onClick={() => edit("agent", agent)}>Add instructions <ArrowUpRight /></button></>}<Button onClick={() => setHistoryOpen(true)}>Compare content history</Button></section>
        <section className="agent-detail-section"><h3>Execution defaults</h3><dl className="agent-default-list"><div><dt>Model</dt><dd>{agent.model || "Provider default"}</dd></div><div><dt>Reasoning</dt><dd>{agent.provider === "codex" ? val(agent, "reasoning_effort") || "Provider default" : "Not supported in Frondose"}</dd></div><div><dt>Permissions</dt><dd>{val(agent, "permission_policy") === "read-only" ? "Read-only" : "Review required"}</dd></div></dl><small>Provider support is checked at launch, not when this page opens. Instructions and defaults never grant access.</small><h3 className="agent-output-heading">Expected output</h3><p className="agent-instruction-copy">{val(agent, "output_behavior") || "Not defined. Set a format, evidence requirements, and stopping condition in the profile."}</p></section>
        <section className="agent-detail-section"><h3><Folder />Working folder</h3><p className="agent-folder">{val(agent, "working_directory") || "Choose with each session"}</p><small>A linked project folder takes precedence.</small></section>
        <section className="agent-detail-section agent-computer-settings-section"><details><summary>Computer connection</summary><Suspense fallback={<p role="status">Loading computer settings…</p>}><AgentRunnerSettings agentId={agent.id} workspaceId={workspace.id} /></Suspense></details></section>
        {projects.length || chats.length ? <section className="agent-detail-section agent-linked-work"><h3>Linked work</h3>{projects.slice(0, 3).map((project) => <button key={project.id} onClick={() => navigate("projects", project.id)}><Folder /><span>{project.name}</span><ArrowUpRight /></button>)}{chats.slice(0, 3).map((chat) => <button key={chat.id} onClick={() => navigate("chats", chat.id)}><MessageCircle /><span>{chat.title}</span><ArrowUpRight /></button>)}</section> : null}
      </> : tab === "context" ? <>
        <section className="agent-detail-section"><h3>Default context</h3><dl className="agent-default-list"><div><dt>Area</dt><dd>{defaultArea?.name || (val(agent, "default_area_id") ? "Unavailable reference" : "No default")}</dd></div><div><dt>Project</dt><dd>{defaultProject?.name || (val(agent, "default_project_id") ? "Unavailable reference" : "No default")}</dd></div><div><dt>Memory</dt><dd>{val(agent, "memory_policy") === "none" ? "Saved memory excluded" : "Eligible reviewed memory only"}</dd></div></dl><p>Context Inspector resolves configured Area and profile Context Packs from currently accessible sources. Review included, excluded, and truncated content before launch. Saved defaults never broaden access.</p><h3 className="agent-output-heading">Context Packs</h3>{packs.length ? <ul>{packs.map(id => <li key={id}>{choices.packs.find(pack => pack.id === id)?.name || "Unavailable Context Pack"}</li>)}</ul> : <p>No Context Packs selected.</p>}<Button onClick={() => edit("agent", agent)}>Edit context preferences</Button></section>
        <AgentSkills agentId={agent.id} workspaceId={workspace.id} navigate={navigate} />
        <section className="agent-detail-section"><AgentMemoryPanel agentId={agent.id} workspaceId={workspace.id} projectId={val(agent, "default_project_id")} /></section>
        <section className="agent-detail-section"><h3>Tools and connections</h3><p>{provider.permissions}. File access is selected for each run. Native tool access and external actions require their own server-checked scope and approval.</p><Button onClick={() => navigate("connections")}>Manage shared connections</Button></section>
      </> : <>
        <section className="agent-detail-section"><h3>Run health</h3><p>{activeRuns.length} active · {failedRuns.length} failed · {runs.length} recorded</p><small>A completed run is not an accepted output. Recorded usage below is separate from account billing.</small></section>
        <Suspense fallback={<p role="status">Loading usage controls…</p>}><AgentUsageDisclosure key={`${workspace.id}:${agent.id}`} agentId={agent.id} workspaceId={workspace.id} /></Suspense>
        {runs.length ? <div className="agent-session-list">{runs.map((run) => <button key={run.id} onClick={() => navigate("work", run.id)}><span className="agent-session-title">{run.mode === "live" ? <Terminal /> : <FlaskConical />}<strong>{run.title}</strong><ArrowUpRight /></span><span className="agent-session-meta"><span>{run.mode === "live" ? "Live" : "Simulation"} · {relative(val(run, "created_at"))} · {val(run, "agent_profile_version") ? `Profile v${val(run, "agent_profile_version")}` : "Profile version not recorded"}</span><Status value={run.status} /></span></button>)}</div> : <div className="agent-sessions-empty"><Terminal /><h3>No sessions yet</h3><p>Work started with this profile will appear here. Try a simulation to see the workflow without using an AI account.</p>{readiness.canSimulate ? <Button icon={FlaskConical} onClick={() => startSession({ agent_id: agent.id, mode: "mock" })}>Try a simulation</Button> : null}</div>}
        <section className="agent-detail-section agent-linked-work"><h3>Linked outputs</h3>{outputs.length ? outputs.map(output => <button key={output.id} onClick={() => navigate("library", output.id)}><span>{output.title} · v{output.current_version} · {output.state}</span><ArrowUpRight /></button>) : <p>No outputs are linked to this agent’s recorded runs.</p>}</section>
        <p className="agent-history-note">Only this workspace’s sessions linked to this profile are shown. Older sessions without an agent ID remain in Runs.</p>
      </>}
    </div>
    <footer className="agent-detail-footer"><button className="text-button" disabled={busy} onClick={onPause}><Pause morphTo={agent.status === "paused" ? Play : Pause} />{agent.status === "paused" ? "Resume agent" : "Pause agent"}</button><button className="text-button" onClick={onDuplicate}><Copy />Duplicate</button></footer>
    {historyOpen ? <Suspense fallback={<p role="status">Opening content history…</p>}><AgentProfileHistory key={agent.id} agent={agent} onClose={() => setHistoryOpen(false)} /></Suspense> : null}
  </aside>;
}

export function AgentsView() {
  const { data, page, edit, navigate, notify, organization, workspace } = useApp();
  const [query, setQuery] = useState(""), [filter, setFilter] = useState("all");
  const [connectionProvider, setConnectionProvider] = useState(null), [archiveAgent, setArchiveAgent] = useState(null);
  const [importing, setImporting] = useState(false);
  const { busy, error, execute } = useAsync();
  const agents = visible(data.agents).filter(agent => !agent.personal_agent).sort((a, b) => a.name.localeCompare(b.name));
  const personalSelection = page.id && visible(data.agents).some(agent => agent.id === page.id && agent.personal_agent);
  useEffect(() => { if (personalSelection) navigate('rumbo-agent'); }, [personalSelection, navigate]);
  const summaries = new Map(agents.map((agent) => [agent.id, summarizeAgent(agent, data)]));
  const filtered = agents.filter((agent) => {
    const state = summaries.get(agent.id).readiness.state;
    return `${agent.name} ${agent.provider} ${agent.role || ""} ${agent.description || ""}`.toLowerCase().includes(query.trim().toLowerCase()) &&
      (filter === "all" || filter === state || filter === "setup" && !["ready", "paused"].includes(state) || filter === "working" && summaries.get(agent.id).activeRuns.length > 0 || filter === "favorites" && organization.favorites.some(item => item.view === "agents" && item.id === agent.id));
  });
  const selected = filtered.find((agent) => agent.id === page.id) ?? filtered[0];
  const unavailable = page.id && !agents.some((agent) => agent.id === page.id);
  function duplicate(agent) { try { edit("agent", null, duplicateAgentDefinition(agent)); notify("Review the copy. Connection, folders, and context references are not copied; permissions start read-only."); } catch (problem) { notify(problem.message, "error"); } }
  function exportDefinition(agent) { download(`${agent.name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || "agent"}.frondose-agent.json`, exportAgentDefinition(agent)); notify("Definition exported without account, folder, context, or permission references. Review instruction text before sharing."); }
  function pause(agent) { return execute(async () => { const status = agent.status === "paused" ? "available" : "paused"; await frondoseActions.updateAgent(agent.id, { status }); notify(status === "paused" ? `${agent.name} paused. Existing sessions continue.` : `${agent.name} is available for new sessions.`); }); }
  return <main className={`page agents-page ${page.id ? "has-agent-selection" : ""}`}>
    <PageHeader title="Your Agents" description="Specialized agents for your workspace. Your personal Frondose is managed in its own tab."><Button onClick={() => setImporting(true)}>Import definition</Button>{agents.length ? <Button variant="primary" icon={Plus} onClick={() => edit("agent")}>New agent</Button> : null}</PageHeader>
    {!page.id ? <section className="agent-provider-strip" aria-label="Provider connections">
      <div className="agent-provider-summaries">{Object.entries(AGENT_PROVIDERS).filter(([id]) => ['codex', 'claude', 'copilot'].includes(id) || data.connections.some(item => item.provider === id)).map(([id, provider]) => {
        const connection = data.connections.find((item) => item.provider === id);
        const readiness = agentReadiness({ id, provider: id, workspace_id: workspace.id, status: "available" }, connection);
        return <button key={id} className="agent-provider-summary" onClick={() => isScopedAiProvider(id) ? navigate('connections', id) : setConnectionProvider(id)} aria-label={`Manage ${provider.name} connection`}><AgentIdentity compact provider={id} /><strong>{provider.name}</strong><span className={`agent-connection-label is-${readiness.state}`}><i aria-hidden="true" />{readiness.state === "sample" ? "Connected · sample" : readiness.canStartLive ? "Connected" : readiness.state === "connecting" ? "Signing in" : readiness.state === "not_installed" ? "Not installed" : "Not connected"}</span></button>;
      })}</div>
      <button className="text-button" onClick={() => navigate("connections")}>Manage connections <ArrowUpRight /></button>
    </section> : null}
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
                  <AgentMenu agent={agent} busy={busy} active={summary.activeRuns.length > 0} onEdit={() => edit("agent", agent)} onDuplicate={() => duplicate(agent)} onExport={() => exportDefinition(agent)} onPause={() => pause(agent)} onArchive={() => setArchiveAgent(agent)} />
                </div>;
              }) : <div className="agent-search-empty"><h3>No matching agents</h3><p>Try a different name, provider, or status.</p><Button onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</Button></div>}
            </div>
          </section>
          {selected ? <div className="agent-inspector"><button className="agent-mobile-back text-button" onClick={() => navigate("agents")}><ArrowLeft />All agents</button><AgentDetail key={selected.id} agent={selected} summary={summaries.get(selected.id)} onConnect={setConnectionProvider} onPause={() => pause(selected)} onDuplicate={() => duplicate(selected)} busy={busy} /></div> : null}
        </div>}
    {connectionProvider ? <ConnectionDialog provider={connectionProvider} onClose={() => setConnectionProvider(null)} /> : null}
    {archiveAgent ? <ArchiveAgentDialog agent={archiveAgent} onClose={() => setArchiveAgent(null)} /> : null}
    {importing ? <ImportAgentDialog onClose={() => setImporting(false)} onImport={definition => { setImporting(false); edit("agent", null, definition); }} /> : null}
  </main>;
}

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIcon as Activity,
  Archive,
  ArrowRight,
  Bell,
  CaretDown,
  CaretRight,
  Check,
  CheckCircle,
  ChatsCircle,
  CircleNotch,
  Clock,
  Code,
  Command,
  Compass,
  Copy,
  Database,
  DotsThree,
  File,
  Files,
  FolderOpen,
  Gear,
  GitBranch,
  GithubLogo,
  HardDrives,
  Hash,
  House,
  Tray as Inbox,
  Kanban,
  LinkSimple,
  ListChecks,
  MagnifyingGlass,
  NavigationArrow,
  Note,
  Paperclip,
  Pause,
  Play,
  Plus,
  Robot,
  RocketLaunch,
  ShieldCheck,
  SidebarSimple,
  SlidersHorizontal,
  Sparkle,
  Spinner,
  Stop,
  TerminalWindow,
  UserCircle,
  Users,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { rumboActions, useRumboData, useRumboStatus } from "./data/useRumbo.js";

const NAV_ITEMS = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "projects", label: "Projects", icon: Kanban },
  { id: "tasks", label: "Routes", icon: ListChecks },
  { id: "chats", label: "Chats", icon: ChatsCircle },
  { id: "work", label: "Live work", icon: Activity },
  { id: "agents", label: "Agents", icon: Robot },
  { id: "connections", label: "Connections", icon: LinkSimple },
  { id: "settings", label: "Settings", icon: Gear },
];

const STATIC_AGENTS = [
  { id: "codex", name: "Codex", provider: "OpenAI", status: "offline", detail: "Not connected", icon: TerminalWindow, tone: "sage" },
  { id: "claude", name: "Claude", provider: "Anthropic API", status: "offline", detail: "Connection required", icon: Sparkle, tone: "sand" },
];

const STATUS_LABELS = {
  backlog: "Parking lot",
  ready: "Up next",
  in_progress: "Moving",
  review: "Check",
  blocked: "Paused",
  done: "Complete",
  active: "Active",
  needs_input: "Your call",
  running: "Running",
  completed: "Completed",
  stopped: "Stopped",
  offline: "Offline",
};

function field(object, camel, snake = camel) {
  return object?.[camel] ?? object?.[snake] ?? null;
}

function relativeTime(value) {
  if (!value) return "now";
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function humanizeContent(value = "") {
  return String(value).replace(/\b[A-Z]{2,6}-\d+\b/g, "the linked work item");
}

function entityId(item) {
  return item?.id ?? "";
}

function IconButton({ label, children, className = "", ...props }) {
  return (
    <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

function StatusDot({ status = "offline" }) {
  return <span className={`status-dot status-${status}`} aria-hidden="true" />;
}

function ProviderGlyph({ provider, size = "md" }) {
  const normalized = String(provider ?? "").replace("google-drive", "google_drive");
  const Icon = normalized === "github" ? GithubLogo : normalized === "google_drive" ? HardDrives : normalized === "claude" ? Sparkle : TerminalWindow;
  return <span className={`provider-glyph provider-${normalized} glyph-${size}`}><Icon weight="regular" /></span>;
}

function AppShellLoading() {
  return (
    <div className="loading-screen">
      <div className="brand-mark"><NavigationArrow weight="fill" /></div>
      <Spinner className="spin" />
      <span>Opening your local workspace</span>
    </div>
  );
}

function FirstRun() {
  const [workspaceName, setWorkspaceName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function createFirstWorkspace(event) {
    event.preventDefault();
    if (!workspaceName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await rumboActions.createWorkspace({ name: workspaceName.trim(), description: "My local Rumbo workspace" });
    } catch (cause) {
      setError(cause?.message ?? "Rumbo could not create the workspace.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="first-run-shell">
      <aside className="first-run-intro">
        <div className="first-run-brand"><span className="brand-mark"><NavigationArrow weight="fill" /></span><strong>Rumbo</strong></div>
        <div className="first-run-promise"><span className="eyebrow">A workspace for AI workers</span><h1>Give every project a clear route.</h1><p>Connect conversations, files, decisions, and live agent work without losing control of what each provider can access.</p></div>
        <div className="first-run-privacy"><ShieldCheck /><span><strong>Local from the first click</strong><small>Your workspace starts empty and stays on this Mac.</small></span></div>
      </aside>
      <main className="first-run-main">
        <div className="first-run-top"><span>New local installation</span><span className="source-pill source-local"><StatusDot status="running" />Local API</span></div>
        <form className="first-run-card" onSubmit={createFirstWorkspace}>
          <span className="step-number">01</span>
          <span className="eyebrow">Create your starting point</span>
          <h2>Name your workspace</h2>
          <p>A workspace keeps related projects, chats, routes, files, and AI workers together. You can add more later.</p>
          <label>Workspace name<input autoFocus value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="For example, Personal or Studio" /></label>
          <div className="first-run-connectors"><span><GithubLogo />GitHub</span><span><HardDrives />Drive</span><span><TerminalWindow />Codex</span><span><Sparkle />Claude</span></div>
          <small>All providers are disconnected. Rumbo will ask before opening any authorization flow.</small>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="primary-action" type="submit" disabled={!workspaceName.trim() || saving}>{saving ? <Spinner className="spin" /> : <ArrowRight />}{saving ? "Creating…" : "Create workspace"}</button>
        </form>
      </main>
    </div>
  );
}

function Sidebar({ activeView, setActiveView, workspace, workspaces, activeWorkspaceId, setActiveWorkspaceId, projects, collapsed, setCollapsed, inboxCount, onNew, onNewWorkspace }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  return (
    <aside className={`primary-sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <div className="sidebar-brand">
        <div className="brand-mark"><NavigationArrow weight="fill" /></div>
        {collapsed ? null : <strong>Rumbo</strong>}
        <IconButton label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="collapse-toggle" onClick={() => setCollapsed((value) => !value)}>
          <SidebarSimple />
        </IconButton>
      </div>

      <button className="workspace-switcher" aria-label="Switch workspace" aria-expanded={workspaceMenuOpen} onClick={() => setWorkspaceMenuOpen((value) => !value)}>
        <span className="workspace-badge">{workspace?.name?.slice(0, 1) ?? "N"}</span>
        {collapsed ? null : <><span>{workspace?.name ?? "Northstar"}</span><CaretDown className="push-right" /></>}
      </button>
      {workspaceMenuOpen ? <div className="workspace-menu">{workspaces.map((item) => <button key={item.id} className={item.id === activeWorkspaceId ? "is-active" : ""} onClick={() => { setActiveWorkspaceId(item.id); setWorkspaceMenuOpen(false); }}><span className="workspace-badge">{item.name.slice(0, 1)}</span><span>{item.name}</span>{item.id === activeWorkspaceId ? <Check /> : null}</button>)}<button onClick={() => { onNewWorkspace(); setWorkspaceMenuOpen(false); }}><Plus /><span>New workspace</span></button></div> : null}

      <nav className="sidebar-nav" aria-label="Workspace navigation">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`nav-row ${activeView === id ? "is-active" : ""}`} onClick={() => setActiveView(id)} aria-label={label} aria-current={activeView === id ? "page" : undefined}>
            <Icon weight={activeView === id ? "fill" : "regular"} />
            {collapsed ? null : <span>{label}</span>}
            {!collapsed && id === "inbox" && inboxCount > 0 ? <span className="nav-count">{inboxCount}</span> : null}
          </button>
        ))}
        <button className={`nav-row mobile-more ${["agents", "connections", "settings"].includes(activeView) ? "is-active" : ""}`} aria-label="More navigation" onClick={() => setMobileMenuOpen((value) => !value)}><DotsThree /></button>
      </nav>

      {mobileMenuOpen ? <div className="mobile-nav-menu">{NAV_ITEMS.slice(5).map(({ id, label, icon: Icon }) => <button key={id} onClick={() => { setActiveView(id); setMobileMenuOpen(false); }}><Icon /><span>{label}</span></button>)}</div> : null}

      {collapsed ? null : (
        <div className="sidebar-projects">
          <div className="section-label-row"><span>Pinned projects</span><IconButton label="Create project" onClick={onNew}><Plus /></IconButton></div>
          {projects.slice(0, 3).map((project, index) => (
            <button key={project.id} className="project-shortcut" onClick={() => setActiveView("projects")}>
              <span className={`project-glyph project-${index}`}><Compass /></span>
              <span>{project.name}</span>
              <span className="muted-count">{index === 0 ? 4 : 0}</span>
            </button>
          ))}
        </div>
      )}

      <div className="sidebar-footer">
        {collapsed ? <StatusDot status="running" /> : (
          <div className="local-card">
            <div><StatusDot status="running" /><strong>Local workspace</strong></div>
            <span>Data stays on this Mac</span>
          </div>
        )}
      </div>
    </aside>
  );
}

function Topbar({ activeView, onNew, onSearch, source, pending, profile, workspaceName }) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        <span>{workspaceName}</span><CaretRight /><strong>{NAV_ITEMS.find((item) => item.id === activeView)?.label}</strong>
      </div>
      <button className="search-trigger" onClick={onSearch}>
        <MagnifyingGlass />
        <span>Search Rumbo</span>
        <kbd>⌘ K</kbd>
      </button>
      <div className="topbar-actions">
        <span className={`source-pill ${source === "server" ? "source-local" : "source-demo"}`}>
          <StatusDot status={source === "server" ? "running" : "needs_input"} />
          {source === "server" ? "Local API" : "Demo fallback"}
        </span>
        {pending ? <Spinner className="spin muted" /> : null}
        <button className="new-button" onClick={onNew}><Plus weight="bold" />New</button>
        {profile?.avatar_url ? <img className="avatar avatar-small" src={profile.avatar_url} alt={profile?.name ?? "Profile"} /> : <span className="avatar avatar-small avatar-placeholder" aria-label={profile?.name ?? "Profile"}><UserCircle /></span>}
      </div>
    </header>
  );
}

function ChatRail({ chats, messages, selectedChatId, setSelectedChatId, projects, tasks, runs, onCreate }) {
  const grouped = useMemo(() => ({
    pinned: chats.filter((chat) => chat.pinned),
    project: chats.filter((chat) => !chat.pinned && field(chat, "projectId", "project_id")),
  }), [chats]);

  const previewFor = (chatId) => {
    const last = messages.filter((message) => field(message, "chatId", "chat_id") === chatId).at(-1);
    return humanizeContent(field(last, "body", "content") ?? "No messages yet");
  };

  return (
    <aside className="chat-rail">
      <div className="rail-heading"><div><span className="eyebrow">Conversation space</span><h1>Chats</h1></div><IconButton label="New chat" onClick={onCreate}><Plus /></IconButton></div>
      <div className="chat-list-scroll">
        <span className="rail-section-label">Pinned</span>
        {grouped.pinned.map((chat) => (
          <ChatListItem key={chat.id} chat={chat} active={chat.id === selectedChatId} preview={previewFor(chat.id)} onClick={() => setSelectedChatId(chat.id)} project={projects.find((item) => item.id === field(chat, "projectId", "project_id"))} task={tasks.find((item) => item.id === field(chat, "taskId", "task_id"))} />
        ))}
        <span className="rail-section-label">Projects</span>
        {grouped.project.map((chat) => (
          <ChatListItem key={chat.id} chat={chat} active={chat.id === selectedChatId} preview={previewFor(chat.id)} onClick={() => setSelectedChatId(chat.id)} project={projects.find((item) => item.id === field(chat, "projectId", "project_id"))} />
        ))}
        <span className="rail-section-label">Direct</span>
        {STATIC_AGENTS.map((agent) => {
          const latestRun = runs.find((run) => run.provider === agent.id);
          const currentStatus = latestRun?.status ?? agent.status;
          const detail = latestRun ? (currentStatus === "completed" ? "Last run completed" : currentStatus === "needs_input" ? "Waiting for approval" : STATUS_LABELS[currentStatus] ?? currentStatus) : agent.detail;
          return <button className="direct-chat" key={agent.id}>
            <ProviderGlyph provider={agent.id} />
            <span><strong>{agent.name}</strong><small><StatusDot status={currentStatus} />{detail}</small></span>
          </button>;
        })}
      </div>
      <button className="rail-new-chat" onClick={onCreate}><Plus />New chat</button>
    </aside>
  );
}

function ChatListItem({ chat, active, preview, onClick, project, task }) {
  return (
    <button className={`chat-list-item ${active ? "is-active" : ""}`} onClick={onClick}>
      <span className="chat-kind"><Hash /></span>
      <span className="chat-list-copy">
        <strong>{chat.title}</strong>
        <small>{preview}</small>
      </span>
      <span className="chat-list-meta">{relativeTime(field(chat, "updatedAt", "updated_at"))}</span>
      {task ? <span className="linked-dot" title={`Linked to ${task.title}`} /> : null}
    </button>
  );
}

function MessageAvatar({ senderType, senderId, senderName }) {
  if (senderType === "user" || senderId === "local" || senderName === "Evan") return <img className="avatar" src="/assets/evan-avatar.png" alt="Evan" />;
  if (senderType === "system") return <span className="message-system-avatar"><Compass /></span>;
  return <ProviderGlyph provider={String(senderId).includes("claude") ? "claude" : "codex"} size="lg" />;
}

function ChatView({ data, selectedChatId, setSelectedChatId, onOpenWork, onCreateChat }) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);
  const chats = data.chats ?? [];
  const projects = data.projects ?? [];
  const tasks = data.tasks ?? [];
  const messages = data.messages ?? [];
  const runs = data.runs ?? [];
  const approvals = data.approvals ?? [];
  const selectedChat = chats.find((chat) => chat.id === selectedChatId) ?? chats[0];
  const projectId = field(selectedChat, "projectId", "project_id");
  const taskId = field(selectedChat, "taskId", "task_id");
  const project = projects.find((item) => item.id === projectId) ?? projects[0];
  const task = tasks.find((item) => item.id === taskId);
  const chatMessages = messages.filter((message) => field(message, "chatId", "chat_id") === selectedChat?.id);
  const linkedRun = runs.find((run) => field(run, "chatId", "chat_id") === selectedChat?.id) ?? runs[0];
  const pendingApproval = approvals.find((approval) => field(approval, "runId", "run_id") === linkedRun?.id && approval.status === "pending");

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [chatMessages.length]);

  async function sendMessage(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !selectedChat) return;
    setSending(true);
    try {
      await rumboActions.createMessage(selectedChat.id, {
        content,
        body: content,
        sender_type: "user",
        senderType: "user",
        sender_id: "local",
        senderId: "profile_local",
        sender_name: "Evan",
      });
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-workspace">
      <ChatRail chats={chats} messages={messages} selectedChatId={selectedChat?.id} setSelectedChatId={setSelectedChatId} projects={projects} tasks={tasks} runs={runs} onCreate={onCreateChat} />

      <section className="conversation-panel">
        <header className="conversation-header">
          <div className="conversation-title-line"><span className="room-symbol"><ChatsCircle weight="fill" /></span><h2>{selectedChat?.title ?? "New conversation"}</h2><CaretDown /></div>
          <select className="mobile-chat-select" aria-label="Select chat" value={selectedChat?.id ?? ""} onChange={(event) => setSelectedChatId(event.target.value)}>
            {chats.map((chat) => <option key={chat.id} value={chat.id}>{chat.title}</option>)}
          </select>
          <div className="conversation-links">
            <button><span>Workspace</span>{data.workspaces?.[0]?.name ?? "Workspace"}</button>
            {project ? <button><span>Project</span>{project.name}</button> : null}
            {task ? <button><span>Work item</span>{task.title}</button> : null}
          </div>
          <div className="conversation-header-actions">
            <div className="avatar-stack"><img src="/assets/evan-avatar.png" alt="Evan" /><span className="stack-agent"><TerminalWindow /></span><span className="stack-agent stack-sand"><Sparkle /></span></div>
            <IconButton label="Notifications"><Bell /></IconButton>
            <IconButton label="More options"><DotsThree /></IconButton>
          </div>
        </header>

        <div className="message-scroll">
          <div className="context-notice"><ShieldCheck /><span>This room uses a local context snapshot. Provider accounts are not contacted in demo runs.</span><button>Review context</button></div>
          {chatMessages.map((message) => (
            <Message key={message.id} message={message} run={linkedRun} project={project} task={task} onOpenWork={onOpenWork} />
          ))}
          {linkedRun ? <RunCard run={linkedRun} task={task} project={project} approval={pendingApproval} onOpen={onOpenWork} /> : null}
          {pendingApproval ? <ApprovalCard approval={pendingApproval} run={linkedRun} /> : null}
          <div ref={messagesEndRef} />
        </div>

        <form className="composer" onSubmit={sendMessage}>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Message ${selectedChat?.title ?? "this chat"}`} rows={2} onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
          }} />
          <div className="composer-tools">
            <div><IconButton type="button" label="Attach file"><Paperclip /></IconButton><IconButton type="button" label="Mention agent"><Users /></IconButton><button type="button" className="context-button"><FolderOpen />Add context<CaretDown /></button></div>
            <div className="send-hint"><span>⌘ Enter</span><button className="send-button" type="submit" disabled={!draft.trim() || sending}>{sending ? <Spinner className="spin" /> : <ArrowRight weight="bold" />}</button></div>
          </div>
        </form>
      </section>

      <ContextPanel data={data} project={project} task={task} run={linkedRun} onOpenWork={onOpenWork} />
    </div>
  );
}

function Message({ message }) {
  const senderType = field(message, "senderType", "sender_type") ?? "user";
  const senderId = field(message, "senderId", "sender_id");
  const senderName = field(message, "senderName", "sender_name") ?? (senderType === "agent" ? "Codex" : senderType === "system" ? "Rumbo" : "Evan");
  const content = humanizeContent(field(message, "body", "content") ?? "");
  if (senderType === "system") {
    return <div className="system-message"><MessageAvatar senderType={senderType} /><span>{content}</span><time>{relativeTime(field(message, "createdAt", "created_at"))}</time></div>;
  }
  return (
    <article className="message-row">
      <MessageAvatar senderType={senderType} senderId={senderId} senderName={senderName} />
      <div className="message-body">
        <div className="message-meta"><strong>{senderName}</strong><time>{new Date(field(message, "createdAt", "created_at") ?? Date.now()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>{senderType === "agent" ? <span className="agent-state"><StatusDot status="running" />Agent</span> : null}</div>
        <p>{content}</p>
      </div>
    </article>
  );
}

function RunCard({ run, task, project, onOpen }) {
  const status = run.status ?? "running";
  const changed = field(run, "filesChanged", "files_changed") ?? ["src/popup/Popup.jsx", "src/popup/popup.css"];
  const current = field(run, "currentAction", "current_action") ?? (status === "needs_input" ? "Waiting for approval" : status === "completed" ? "Finished locally" : "Preparing implementation");
  return (
    <article className="embedded-run-card">
      <div className="embedded-card-heading">
        <ProviderGlyph provider={run.provider ?? "codex"} />
        <div><span>Agent run</span><strong>{run.title ?? task?.title ?? "SourceLens work"}</strong></div>
        <span className={`status-chip chip-${status}`}><StatusDot status={status} />{STATUS_LABELS[status] ?? status}</span>
      </div>
      <div className="run-grid">
        <div><span>Work item</span><strong>{task?.title ?? "Unlinked work"}</strong></div>
        <div><span>Current action</span><strong>{current}</strong></div>
        <div><span>Mode</span><strong>Safe demo</strong></div>
      </div>
      <div className="file-pills">{changed.slice(0, 3).map((file) => <span key={file}><File />{String(file).split("/").at(-1)}</span>)}</div>
      <button className="secondary-action full-width" onClick={onOpen}>Open live work<ArrowRight /></button>
    </article>
  );
}

function ApprovalCard({ approval, run }) {
  const [resolving, setResolving] = useState(false);
  async function resolve(decision) {
    setResolving(true);
    try { await rumboActions.resolveApproval(run.id, approval.id, decision); }
    finally { setResolving(false); }
  }
  return (
    <article className="approval-card">
      <div className="approval-icon"><ShieldCheck /></div>
      <div className="approval-copy"><span>Permission request</span><strong>{approval.title}</strong><p>{approval.detail}</p><small>Mock only · no command or provider request will run</small></div>
      <div className="approval-actions"><button onClick={() => resolve("deny")} disabled={resolving}>Deny</button><button className="approve" onClick={() => resolve("approve")} disabled={resolving}>{resolving ? <Spinner className="spin" /> : "Approve once"}</button></div>
    </article>
  );
}

function ContextPanel({ data, project, task, run, onOpenWork }) {
  const connections = data.connections ?? [];
  const relatedTasks = (data.tasks ?? []).filter((item) => field(item, "projectId", "project_id") === project?.id).slice(0, 3);
  return (
    <aside className="context-panel">
      <div className="context-heading"><div><span className="eyebrow">Linked knowledge</span><h2>Context</h2></div><IconButton label="Close context"><X /></IconButton></div>
      <ContextSection title="Active work" count={run ? 1 : 0}>
        {run ? <button className="active-work-row" onClick={onOpenWork}><ProviderGlyph provider={run.provider} /><span><strong>{run.agent_name ?? "Codex"}</strong><small>{run.title}</small></span><span className="run-percent">{run.status === "needs_input" ? "Input" : STATUS_LABELS[run.status] ?? run.status}</span></button> : <EmptyCompact text="No active work in this chat" />}
      </ContextSection>
      <ContextSection title="Related work" count={relatedTasks.length}>
        <div className="compact-list">{relatedTasks.map((item) => <button key={item.id}><span className={`task-state state-${item.status}`} /><span>{project?.name ?? "Project"}</span><strong>{item.title}</strong><small>{STATUS_LABELS[item.status] ?? item.status}</small></button>)}</div>
      </ContextSection>
      <ContextSection title="Selected files" count={3}>
        <div className="file-list"><button><Code /><span><strong>Popup.jsx</strong><small>src/popup/Popup.jsx</small></span></button><button><Code /><span><strong>popup.css</strong><small>src/popup/popup.css</small></span></button><button><Note /><span><strong>product-notes.md</strong><small>docs/product-notes.md</small></span></button></div>
      </ContextSection>
      <ContextSection title="Project memory" count={4}>
        <div className="memory-note"><Compass /><p><strong>Privacy rule</strong><span>Keep permissions minimal and page content local unless explicitly saved.</span></p></div>
      </ContextSection>
      <ContextSection title="Connections" count={connections.length}>
        <ConnectionMiniList connections={connections} />
      </ContextSection>
    </aside>
  );
}

function ContextSection({ title, count, children }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="context-section">
      <button className="context-section-title" onClick={() => setOpen((value) => !value)}>{open ? <CaretDown /> : <CaretRight />}<span>{title}</span><small>{count}</small><Plus className="context-plus" /></button>
      {open ? <div className="context-section-content">{children}</div> : null}
    </section>
  );
}

function ConnectionMiniList({ connections }) {
  const ordered = ["github", "google-drive", "google_drive", "codex", "claude"];
  return (
    <div className="connection-mini-list">
      {ordered.map((provider) => connections.find((item) => item.provider === provider)).filter(Boolean).filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index).map((connection) => (
        <div key={connection.id}><ProviderGlyph provider={connection.provider} /><span><strong>{field(connection, "displayName", "display_name") ?? connection.name}</strong><small>{connection.state === "not_connected" ? "Available" : connection.mode === "demo" || connection.demo ? "Demo state" : "Local"}</small></span><span className={`connection-state state-${connection.state ?? connection.status}`}><StatusDot status={(connection.state ?? connection.status) === "not_connected" ? "offline" : (connection.state ?? connection.status) === "demo" ? "needs_input" : "running"} />{String(connection.state ?? connection.status).replaceAll("_", " ")}</span></div>
      ))}
    </div>
  );
}

function GenericView({ view, data, setActiveView, setSelectedChatId, onNew }) {
  if (view === "inbox") return <InboxView data={data} setActiveView={setActiveView} />;
  if (view === "projects") return <ProjectsView data={data} setActiveView={setActiveView} onNew={onNew} />;
  if (view === "tasks") return <TasksView data={data} setActiveView={setActiveView} setSelectedChatId={setSelectedChatId} onNew={onNew} />;
  if (view === "work") return <WorkView data={data} />;
  if (view === "agents") return <AgentsView data={data} />;
  if (view === "connections") return <ConnectionsView data={data} />;
  if (view === "settings") return <SettingsView data={data} />;
  return null;
}

function PageHeader({ eyebrow, title, description, action, onAction, children }) {
  return (
    <header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{children ?? (action ? <button className="primary-action" onClick={onAction}><Plus />{action}</button> : null)}</header>
  );
}

function InboxView({ data, setActiveView }) {
  const approvals = (data.approvals ?? []).filter((item) => item.status === "pending");
  const runs = data.runs ?? [];
  const completedRuns = runs.filter((run) => run.status === "completed");
  return (
    <main className="page-view">
      <PageHeader eyebrow="Attention queue" title="Inbox" description="Only decisions, failures, and results that need you." />
      <div className="filter-row"><button className="filter-chip is-active">All</button><button className="filter-chip">Your calls</button><button className="filter-chip">Results</button><button className="filter-chip">Connections</button><span className="push-right">{approvals.length + completedRuns.length} open</span></div>
      {!approvals.length && !runs.length ? <EmptyState icon={Inbox} title="Nothing needs you yet" text="Approvals, completed work, and connection notices will appear here." /> : <>
        {approvals.length ? <section className="ledger-section"><h2>Your calls <span>{approvals.length}</span></h2>{approvals.map((approval) => <button className="ledger-row attention" key={approval.id} onClick={() => setActiveView("work")}><span className="ledger-icon"><ShieldCheck /></span><span><strong>{approval.title}</strong><small>{approval.detail}</small></span><span className="ledger-link">Approval required</span><time>{relativeTime(field(approval, "createdAt", "created_at"))}</time><ArrowRight /></button>)}</section> : null}
        {runs.length ? <section className="ledger-section"><h2>Agent work <span>{runs.length}</span></h2>{runs.map((run) => <button className="ledger-row" key={run.id} onClick={() => setActiveView("work")}><ProviderGlyph provider={run.provider} /><span><strong>{run.title}</strong><small>{field(run, "currentAction", "current_action") ?? "Local run"}</small></span><span className="ledger-link">Attached route</span><span className={`status-chip chip-${run.status}`}><StatusDot status={run.status} />{STATUS_LABELS[run.status]}</span><ArrowRight /></button>)}</section> : null}
      </>}
    </main>
  );
}

function ProjectsView({ data, setActiveView, onNew }) {
  const projects = data.projects ?? [];
  const tasks = data.tasks ?? [];
  return (
    <main className="page-view">
      <PageHeader eyebrow="Workspace portfolio" title="Projects" description="Goals, context, conversations, and agent work in one place." action="New project" onAction={() => onNew("project")} />
      <div className="view-toolbar"><div><button className="toolbar-button is-active"><Files />Overview</button><button className="toolbar-button"><ListChecks />All projects</button></div><div><button className="toolbar-button"><SlidersHorizontal />Filter</button><button className="toolbar-button"><CaretDown />Updated</button></div></div>
      <div className="project-grid">{projects.map((project) => {
        const projectTasks = tasks.filter((task) => field(task, "projectId", "project_id") === project.id);
        const done = projectTasks.filter((task) => task.status === "done").length;
        return <article className="project-card" key={project.id}><div className="project-card-top"><span className="large-project-glyph"><Compass /></span><span className="status-chip chip-running"><StatusDot status="running" />Active</span><IconButton label="Project menu"><DotsThree /></IconButton></div><h2>{project.name}</h2><p>{project.summary ?? project.description}</p><div className="progress-track"><span style={{ width: `${project.progress ?? 42}%` }} /></div><div className="project-stats"><span>{projectTasks.length} work items</span><span>{done} done</span><span>{project.progress ?? 42}%</span></div><div className="project-links"><button onClick={() => setActiveView("tasks")}><ListChecks />Routes</button><button onClick={() => setActiveView("chats")}><ChatsCircle />Chats</button><button onClick={() => setActiveView("work")}><Activity />Live work</button></div></article>;
      })}<button className="empty-project-card" onClick={() => onNew("project")}><Plus /><strong>Create a project</strong><span>Connect goals, conversations, work, and agents.</span></button></div>
    </main>
  );
}

function TasksView({ data, setActiveView, setSelectedChatId, onNew }) {
  const tasks = data.tasks ?? [];
  const project = data.projects?.[0];
  const [filter, setFilter] = useState("all");
  const visible = filter === "all" ? tasks : tasks.filter((task) => task.status === filter);
  return (
    <main className="page-view">
      <PageHeader eyebrow="Connected work paths" title="Routes" description="Follow each piece of work from intent to conversation, agent, and result." action="New route" onAction={() => onNew("task")} />
      <div className="view-toolbar"><div className="segmented-control">{["all", "backlog", "ready", "in_progress", "review"].map((item) => <button className={filter === item ? "is-active" : ""} key={item} onClick={() => setFilter(item)}>{item === "all" ? "All" : STATUS_LABELS[item]}</button>)}</div><div><button className="toolbar-button"><SlidersHorizontal />Filter</button><button className="toolbar-button"><ListChecks />List</button></div></div>
      {visible.length ? <div className="route-list">{visible.map((task) => {
        const linkedChat = (data.chats ?? []).find((chat) => field(chat, "taskId", "task_id") === task.id);
        const linkedRun = (data.runs ?? []).find((run) => field(run, "taskId", "task_id") === task.id);
        const assigned = (field(task, "assigneeIds", "assignee_agent_ids") ?? []).length > 0;
        return <button className="route-card" key={task.id} onClick={() => { if (linkedChat) setSelectedChatId(linkedChat.id); setActiveView(linkedChat ? "chats" : "work"); }}>
          <div className="route-heading"><span className={`task-state state-${task.status}`} /><div><small>{project?.name ?? "Project"} route</small><strong>{task.title}</strong></div><span className={`status-chip chip-${task.status}`}><StatusDot status={task.status} />{STATUS_LABELS[task.status] ?? task.status}</span><ArrowRight /></div>
          <div className="route-path">
            <span className="route-node"><Compass /><small>Intent</small><strong>{task.description || "Project goal attached"}</strong></span><i><ArrowRight /></i>
            <span className="route-node"><ChatsCircle /><small>Conversation</small><strong>{linkedChat?.title ?? "Add a chat"}</strong></span><i><ArrowRight /></i>
            <span className="route-node"><Robot /><small>Worker</small><strong>{assigned ? "Codex" : "Choose agent"}</strong></span><i><ArrowRight /></i>
            <span className="route-node"><Activity /><small>Result</small><strong>{linkedRun ? STATUS_LABELS[linkedRun.status] ?? linkedRun.status : "Not started"}</strong></span>
          </div>
          <div className="route-footer"><span className={`priority priority-${task.priority}`}>{task.priority} priority</span><time>Updated {relativeTime(field(task, "updatedAt", "updated_at"))} ago</time><span>{linkedChat ? "Open route context" : "Continue setup"}</span></div>
        </button>;
      })}</div> : <EmptyState icon={ListChecks} title="No routes yet" text="Create a route to connect intent, conversation, worker, and result." />}
    </main>
  );
}

function WorkView({ data }) {
  const runs = data.runs ?? [];
  const tasks = data.tasks ?? [];
  const approvals = data.approvals ?? [];
  const [selectedRunId, setSelectedRunId] = useState(runs[0]?.id);
  const run = runs.find((item) => item.id === selectedRunId) ?? runs[0];
  const task = tasks.find((item) => item.id === field(run, "taskId", "task_id")) ?? tasks.find((item) => ["ready", "in_progress", "backlog"].includes(item.status)) ?? tasks[0];
  const approval = approvals.find((item) => field(item, "runId", "run_id") === run?.id && item.status === "pending");
  const runEvents = (data.events ?? []).filter((event) => field(event, "runId", "run_id") === run?.id).toSorted((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
  return (
    <main className="page-view work-page">
      <PageHeader eyebrow="Local runtime" title="Live work" description="See what every worker is doing, what changed, and where input is needed."><button className="primary-action" disabled={!task} title={task ? "Start a safe local simulation" : "Create a work item first"} onClick={() => task && rumboActions.startRun(task.id, { scenario: "approval", provider: "codex", requiresApproval: true, workspace_id: field(task, "workspaceId", "workspace_id"), project_id: field(task, "projectId", "project_id") })}><Play />{task ? "Start demo run" : "No work available"}</button></PageHeader>
      <div className="work-layout"><section className="run-list"><div className="panel-subhead"><span>Sessions</span><small>{runs.length} local</small></div>{runs.map((item) => <button className={`run-list-item ${item.id === run?.id ? "is-active" : ""}`} key={item.id} onClick={() => setSelectedRunId(item.id)}><ProviderGlyph provider={item.provider} /><span><strong>{item.title}</strong><small>{field(item, "currentAction", "current_action") ?? item.status}</small></span><span className={`status-chip chip-${item.status}`}><StatusDot status={item.status} />{STATUS_LABELS[item.status] ?? item.status}</span></button>)}<button className="rail-new-chat"><Archive />Archived sessions</button></section><section className="run-detail">{run ? <><div className="run-detail-head"><div><span className="eyebrow">{run.mode ?? "mock"} run</span><h2>{run.title}</h2><p>{task?.title ?? "SourceLens work"}</p></div><div><button className="secondary-action" onClick={() => rumboActions.stopRun(run.id)} disabled={["completed", "stopped", "failed"].includes(run.status)}><Stop />Stop</button><IconButton label="More run actions"><DotsThree /></IconButton></div></div><div className="run-summary-grid"><div><span>Status</span><strong><StatusDot status={run.status} />{STATUS_LABELS[run.status]}</strong></div><div><span>Agent</span><strong>{run.agent_name ?? "Codex"}</strong></div><div><span>Started</span><strong>{relativeTime(field(run, "startedAt", "started_at"))} ago</strong></div><div><span>Environment</span><strong>Local · safe demo</strong></div></div>{approval ? <ApprovalCard approval={approval} run={run} /> : null}<div className="terminal-panel"><div className="terminal-head"><span><TerminalWindow />Activity timeline</span><span>Authoritative local events</span></div><div className="terminal-lines">{runEvents.length ? runEvents.map((event) => <p className={event.type?.includes("approval") ? "terminal-warning" : ""} key={event.id}><time>{new Date(field(event, "createdAt", "created_at") ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>{event.type?.includes("approval") ? <ShieldCheck /> : event.type?.includes("file") ? <File /> : <CheckCircle />}<span>{event.summary}</span></p>) : <p><time>—</time><CircleNotch /><span>No events recorded for this run.</span></p>}</div></div><div className="changed-files"><div className="panel-subhead"><span>Changed files</span><small>Demo artifacts</small></div><button><File /><span><strong>src/popup/Popup.jsx</strong><small>Proposed in the local simulation</small></span><span className="diff-add">+84</span><span className="diff-remove">−12</span></button><button><File /><span><strong>src/popup/popup.css</strong><small>Proposed in the local simulation</small></span><span className="diff-add">+64</span><span className="diff-remove">−9</span></button></div></> : <EmptyState icon={Activity} title="No runs yet" text="Start a safe demo run from a work item." />}</section></div>
    </main>
  );
}

function AgentsView({ data }) {
  return (
    <main className="page-view"><PageHeader eyebrow="Worker directory" title="Agents" description="Configure who can work, which tools they can use, and when they must ask." action="Add agent" />
      <div className="agent-grid">{STATIC_AGENTS.map((agent) => <article className="agent-card" key={agent.id}><div className="agent-card-head"><ProviderGlyph provider={agent.id} size="lg" /><span className={`status-chip chip-${agent.status}`}><StatusDot status={agent.status} />{STATUS_LABELS[agent.status]}</span><IconButton label="Agent menu"><DotsThree /></IconButton></div><h2>{agent.name}</h2><p>{agent.provider}</p><div className="capability-pills"><span>Code</span><span>Terminal</span><span>Review</span></div><dl><div><dt>Working access</dt><dd>Selected folders</dd></div><div><dt>Approval mode</dt><dd>Ask every time</dd></div><div><dt>Memory</dt><dd>Project only</dd></div></dl><button className="secondary-action full-width">Configure agent<ArrowRight /></button></article>)}<article className="agent-card agent-explainer"><Compass /><h2>Provider-aware by design</h2><p>Rumbo keeps each provider’s real capabilities and permission model instead of pretending they are identical.</p><button className="secondary-action">Read local guide</button></article></div>
    </main>
  );
}

function ConnectionsView({ data }) {
  const connections = data.connections ?? [];
  const [probing, setProbing] = useState(null);
  const [probeResults, setProbeResults] = useState({});
  const [setupResults, setSetupResults] = useState({});
  async function probe(connection) {
    setProbing(connection.id);
    const provider = connection.provider === "google_drive" ? "google-drive" : connection.provider;
    try {
      const response = await fetch(`/api/connections/${provider}/probe`);
      const result = await response.json();
      setProbeResults((current) => ({ ...current, [connection.id]: result.probe ?? result }));
    } catch {
      setProbeResults((current) => ({ ...current, [connection.id]: { state: "demo_only", note: "Local API unavailable; no account was contacted." } }));
    } finally { setProbing(null); }
  }
  async function loadSetup(connection) {
    const provider = connection.provider === "google_drive" ? "google-drive" : connection.provider;
    const response = await fetch(`/api/connections/${provider}/setup`);
    const payload = await response.json();
    setSetupResults((current) => ({ ...current, [connection.id]: payload.setup }));
  }
  return (
    <main className="page-view"><PageHeader eyebrow="External context" title="Connections" description="Bring in repositories, selected files, and AI workers without hiding what access is granted." />
      <div className="safety-banner"><ShieldCheck /><div><strong>Account-safe prototype</strong><p>Connection checks only inspect local availability. They never open login, read credentials, or run paid requests.</p></div></div>
      <div className="connection-grid">{connections.map((connection) => {
        const name = field(connection, "displayName", "display_name") ?? connection.name;
        const result = probeResults[connection.id];
        const setup = setupResults[connection.id];
        return <article className="connection-card" key={connection.id}><div className="connection-card-head"><ProviderGlyph provider={connection.provider} size="lg" /><div><h2>{name}</h2><span>{connection.category?.replace("_", " ")}</span></div><span className={`demo-badge ${connection.state === "not_connected" ? "is-disconnected" : ""}`}>{connection.mode === "demo" ? "Demo" : "Not connected"}</span></div><p>{connection.description ?? connection.detail}</p><div className="connection-details"><span>Authentication</span><strong>{field(connection, "authMethod", "auth_method")?.replaceAll("_", " ") ?? "Provider managed"}</strong><span>Current state</span><strong>{result?.state?.replaceAll("_", " ") ?? connection.state ?? connection.status}</strong></div>{result ? <div className="probe-result"><CheckCircle /><span><strong>{result.installed === true ? "Detected locally" : result.state?.replaceAll("_", " ")}</strong><small>{result.note ?? result.version}</small></span></div> : null}{setup ? <div className="setup-result"><strong>{setup.state.replaceAll("_", " ")}</strong><p>{setup.resourcePolicy}</p>{setup.missing.length ? <span>Needs: {setup.missing.join(", ")}</span> : <span>{setup.startReason}</span>}{setup.callbackUrl ? <code>{setup.callbackUrl}</code> : null}</div> : null}<div className="connection-card-actions"><button className="secondary-action" onClick={() => probe(connection)} disabled={probing === connection.id}>{probing === connection.id ? <><Spinner className="spin" />Checking…</> : <><MagnifyingGlass />Check locally</>}</button><button className="secondary-action" onClick={() => loadSetup(connection)}><Gear />Setup details</button></div>{connection.provider === "claude" ? <small className="legal-note">Claude requires Anthropic API or supported cloud credentials. Subscription OAuth is not offered.</small> : null}</article>;
      })}</div>
    </main>
  );
}

function SettingsView({ data }) {
  const [section, setSection] = useState("profile");
  const [name, setName] = useState(data.profile?.name ?? "You");
  const [saved, setSaved] = useState(false);
  const sections = [{ id: "profile", label: "Profile", icon: UserCircle }, { id: "appearance", label: "Appearance", icon: Sparkle }, { id: "notifications", label: "Notifications", icon: Bell }, { id: "permissions", label: "Agent permissions", icon: ShieldCheck }, { id: "storage", label: "Local storage", icon: Database }, { id: "diagnostics", label: "Diagnostics", icon: Activity }];
  async function saveProfile(event) { event.preventDefault(); await rumboActions.updateProfile({ name }); setSaved(true); setTimeout(() => setSaved(false), 1800); }
  return (
    <main className="page-view"><PageHeader eyebrow="Rumbo preferences" title="Settings" description="Account, workspace, provider, and local-system controls." />
      <div className="settings-layout"><aside className="settings-nav">{sections.map(({ id, label, icon: Icon }) => <button key={id} className={section === id ? "is-active" : ""} onClick={() => setSection(id)}><Icon />{label}</button>)}</aside><section className="settings-panel">
        {section === "profile" ? <><div className="settings-heading"><h2>Local profile</h2><p>Your identity inside this Rumbo installation.</p></div><form className="settings-form" onSubmit={saveProfile}><div className="profile-row"><span className="avatar avatar-large avatar-placeholder"><UserCircle /></span><div><strong>No profile image</strong><small>Add one when you are ready</small><button type="button" className="text-button">Choose image</button></div></div><label>Display name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Email<input value="Local profile — no cloud account" disabled /></label><div className="form-actions"><span>{saved ? <><Check />Saved locally</> : null}</span><button className="primary-action" type="submit">Save changes</button></div></form></> : null}
        {section === "appearance" ? <SettingsToggles title="Appearance" description="Tune the interface without changing project data." sectionKey="appearance" settings={data.settings} rows={[{ label: "Compact density", key: "density", trueValue: "compact", falseValue: "comfortable" }, { label: "Reduce motion", key: "reduceMotion" }, { label: "Show agent events in chat", key: "showAgentEventsInChat" }]} /> : null}
        {section === "notifications" ? <SettingsToggles title="Notifications" description="Control which local events enter your attention queue." sectionKey="notifications" settings={data.settings} rows={[{ label: "Agent needs input", key: "agentNeedsInput" }, { label: "Run completed", key: "runCompleted" }, { label: "Run failed", key: "runFailed" }, { label: "Mentions", key: "mentions" }]} /> : null}
        {section === "permissions" ? <SettingsToggles title="Agent permissions" description="Provider-specific permissions are preserved and shown before every sensitive action." sectionKey="agentDefaults" settings={data.settings} rows={[{ label: "Require command approval", key: "approvalMode", trueValue: "ask", falseValue: "allow" }, { label: "Limit access to linked folders", key: "restrictFolders" }, { label: "Preserve raw event diagnostics", key: "preserveRawEvents" }]} /> : null}
        {section === "storage" ? <StorageSettings /> : null}
        {section === "diagnostics" ? <Diagnostics data={data} /> : null}
      </section></div>
    </main>
  );
}

function SettingsToggles({ title, description, rows, sectionKey, settings }) {
  const section = settings?.[sectionKey] ?? {};
  const [saving, setSaving] = useState(null);
  async function setValue(row, checked) {
    setSaving(row.key);
    try {
      await rumboActions.updateSettings({
        [sectionKey]: {
          ...section,
          [row.key]: checked ? (row.trueValue ?? true) : (row.falseValue ?? false),
        },
      });
    } finally { setSaving(null); }
  }
  return <><div className="settings-heading"><h2>{title}</h2><p>{description}</p></div><div className="toggle-list">{rows.map((row) => {
    const current = section[row.key];
    const checked = row.trueValue === undefined ? Boolean(current) : current === row.trueValue;
    return <label key={row.key}><span><strong>{row.label}</strong><small>{saving === row.key ? "Saving locally…" : "Applies only to this local workspace"}</small></span><input type="checkbox" checked={checked} onChange={(event) => setValue(row, event.target.checked)} /><span className="switch" /></label>;
  })}</div></>;
}

function StorageSettings() {
  return <><div className="settings-heading"><h2>Local storage</h2><p>Rumbo stores its SQLite database and context snapshots on this Mac.</p></div><div className="storage-card"><Database /><div><strong>rumbo.sqlite</strong><span>/Users/EvanLu/Rumbo/.rumbo/rumbo.sqlite</span></div><span>Ready</span></div><div className="settings-actions-list"><button><Archive /><span><strong>Export workspace archive</strong><small>Plans, chats, memory, and run summaries</small></span><ArrowRight /></button><button><Copy /><span><strong>Back up local database</strong><small>Create a timestamped copy</small></span><ArrowRight /></button><button className="danger-row"><WarningCircle /><span><strong>Reset demo data</strong><small>Remove local prototype records and reseed</small></span><ArrowRight /></button></div></>;
}

function Diagnostics({ data }) {
  return <><div className="settings-heading"><h2>Diagnostics</h2><p>Local runtime details without secrets or provider credentials.</p></div><dl className="diagnostics-grid"><div><dt>Data mode</dt><dd>{data.meta?.localOnly ? "Local SQLite" : "Demo fallback"}</dd></div><div><dt>API version</dt><dd>{data.meta?.apiVersion ?? 1}</dd></div><div><dt>Workspaces</dt><dd>{data.workspaces?.length ?? 0}</dd></div><div><dt>Projects</dt><dd>{data.projects?.length ?? 0}</dd></div><div><dt>Work items</dt><dd>{data.tasks?.length ?? 0}</dd></div><div><dt>Chats</dt><dd>{data.chats?.length ?? 0}</dd></div></dl><button className="secondary-action"><Files />Open local logs</button></>;
}

function EmptyCompact({ text }) { return <div className="empty-compact">{text}</div>; }
function EmptyState({ icon: Icon, title, text }) { return <div className="empty-state"><Icon /><strong>{title}</strong><p>{text}</p></div>; }

function CommandPalette({ open, onClose, setActiveView, onNew }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 0); else setQuery(""); }, [open]);
  if (!open) return null;
  const actions = [...NAV_ITEMS.map((item) => ({ label: `Go to ${item.label}`, icon: item.icon, run: () => setActiveView(item.id) })), { label: "Create work item", icon: Plus, run: onNew }, { label: "Start a safe demo run", icon: Play, run: () => setActiveView("work") }].filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette"><div className="command-input"><MagnifyingGlass /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pages and actions…" /><kbd>Esc</kbd></div><div className="command-results"><span>Actions</span>{actions.map(({ label, icon: Icon, run }) => <button key={label} onClick={() => { run(); onClose(); }}><Icon /><span>{label}</span><ArrowRight /></button>)}</div></div></div>;
}

function CreateModal({ open, onClose, data, activeWorkspaceId, initialKind = "task" }) {
  const [kind, setKind] = useState(initialKind);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setKind(initialKind); }, [initialKind, open]);
  if (!open) return null;
  async function submit(event) {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      if (kind === "workspace") await rumboActions.createWorkspace({ name: title, description });
      else if (kind === "task") await rumboActions.createTask({ workspace_id: activeWorkspaceId, workspaceId: activeWorkspaceId, project_id: data.projects?.[0]?.id, projectId: data.projects?.[0]?.id, title, description, status: "backlog", priority: "medium" });
      else if (kind === "project") await rumboActions.createProject({ workspace_id: activeWorkspaceId, workspaceId: activeWorkspaceId, name: title, description, status: "active" });
      else await rumboActions.createChat({ workspace_id: activeWorkspaceId, workspaceId: activeWorkspaceId, project_id: data.projects?.[0]?.id, projectId: data.projects?.[0]?.id, title, kind: "project", pinned: false });
      setTitle(""); setDescription(""); onClose();
    } finally { setSaving(false); }
  }
  const kindLabel = kind === "task" ? "work item" : kind;
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="create-modal" role="dialog" aria-modal="true" aria-labelledby="create-modal-title" onSubmit={submit}><div className="create-modal-head"><div><span className="eyebrow">{kind === "workspace" ? "New local workspace" : `Create in ${data.workspaces?.[0]?.name ?? "workspace"}`}</span><h2 id="create-modal-title">Start something new</h2></div><IconButton type="button" label="Close" onClick={onClose}><X /></IconButton></div><div className="create-kind">{[{ id: "workspace", label: "Workspace", icon: House }, { id: "project", label: "Project", icon: Compass }, { id: "task", label: "Work item", icon: ListChecks }, { id: "chat", label: "Chat", icon: ChatsCircle }].map(({ id, label, icon: Icon }) => <button type="button" className={kind === id ? "is-active" : ""} key={id} onClick={() => setKind(id)}><Icon />{label}</button>)}</div><label>Title<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`${kindLabel[0].toUpperCase()}${kindLabel.slice(1)} title`} /></label><label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What should happen, and why?" rows={4} /></label>{kind !== "workspace" ? <div className="create-properties"><button type="button"><Compass />{data.projects?.[0]?.name ?? "No project"}<CaretDown /></button>{kind === "task" ? <><button type="button"><CircleNotch />Backlog<CaretDown /></button><button type="button"><Robot />Unassigned<CaretDown /></button></> : null}</div> : null}<div className="form-actions"><span>Saved to local SQLite</span><button className="primary-action" type="submit" disabled={!title.trim() || saving}>{saving ? <Spinner className="spin" /> : <Plus />}{saving ? "Creating…" : `Create ${kindLabel}`}</button></div></form></div>;
}

export function App() {
  const data = useRumboData();
  const status = useRumboStatus();
  const [activeView, setActiveView] = useState("chats");
  const [selectedChatId, setSelectedChatId] = useState(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState("task");

  function openCreate(kind = "task") {
    setCreateKind(kind);
    setCreateOpen(true);
  }

  useEffect(() => {
    function onKeyDown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen((value) => !value); }
      if (event.key === "Escape") { setCommandOpen(false); setCreateOpen(false); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!activeWorkspaceId && data?.workspaces?.length) setActiveWorkspaceId(data.workspaces[0].id);
  }, [activeWorkspaceId, data?.workspaces]);

  const activeWorkspace = data?.workspaces?.find((item) => item.id === activeWorkspaceId) ?? data?.workspaces?.[0];
  const activeId = activeWorkspace?.id;
  const scopedProjects = (data?.projects ?? []).filter((item) => field(item, "workspaceId", "workspace_id") === activeId);
  const scopedTasks = (data?.tasks ?? []).filter((item) => field(item, "workspaceId", "workspace_id") === activeId);
  const scopedChats = (data?.chats ?? []).filter((item) => field(item, "workspaceId", "workspace_id") === activeId);
  const scopedChatIds = new Set(scopedChats.map((item) => item.id));
  const scopedRuns = (data?.runs ?? []).filter((item) => field(item, "workspaceId", "workspace_id") === activeId);
  const scopedRunIds = new Set(scopedRuns.map((item) => item.id));
  const scopedData = { ...(data ?? {}), workspaces: activeWorkspace ? [activeWorkspace] : [], projects: scopedProjects, tasks: scopedTasks, chats: scopedChats, messages: (data?.messages ?? []).filter((item) => scopedChatIds.has(field(item, "chatId", "chat_id"))), runs: scopedRuns, approvals: (data?.approvals ?? []).filter((item) => scopedRunIds.has(field(item, "runId", "run_id"))), events: (data?.events ?? []).filter((item) => scopedRunIds.has(field(item, "runId", "run_id"))) };

  useEffect(() => {
    if (!scopedChats.some((chat) => chat.id === selectedChatId)) setSelectedChatId(scopedChats[0]?.id ?? null);
  }, [activeId, scopedChats, selectedChatId]);

  if (status.loading && !data) return <AppShellLoading />;
  if (!data) return <div className="fatal-state"><WarningCircle /><h1>Rumbo could not open local data</h1><p>{status.error?.message ?? "The local workspace is unavailable."}</p><button className="primary-action" onClick={() => rumboActions.refresh()}>Try again</button></div>;
  if (!data.workspaces?.length) return <FirstRun />;

  const approvals = scopedData.approvals.filter((item) => item.status === "pending");
  return (
    <div className="rumbo-app">
      <Sidebar activeView={activeView} setActiveView={setActiveView} workspace={activeWorkspace} workspaces={data.workspaces ?? []} activeWorkspaceId={activeId} setActiveWorkspaceId={setActiveWorkspaceId} projects={scopedProjects} collapsed={collapsed} setCollapsed={setCollapsed} inboxCount={approvals.length} onNew={() => openCreate("task")} onNewWorkspace={() => openCreate("workspace")} />
      <div className="app-column">
        <Topbar activeView={activeView} onNew={() => openCreate("task")} onSearch={() => setCommandOpen(true)} source={status.source} pending={status.pendingMutations} profile={data.profile} workspaceName={activeWorkspace?.name ?? "Workspace"} />
        <div className="app-content">
          {activeView === "chats" ? (scopedChats.length ? <ChatView data={scopedData} selectedChatId={selectedChatId} setSelectedChatId={setSelectedChatId} onOpenWork={() => setActiveView("work")} onCreateChat={() => openCreate("chat")} /> : <div className="page-view"><EmptyState icon={ChatsCircle} title="No chats in this workspace" text="Create a project chat to start organizing work." /><button className="primary-action centered-action" onClick={() => openCreate("chat")}><Plus />New chat</button></div>) : <GenericView view={activeView} data={scopedData} setActiveView={setActiveView} setSelectedChatId={setSelectedChatId} onNew={openCreate} />}
        </div>
      </div>
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} setActiveView={setActiveView} onNew={() => openCreate("task")} />
      <CreateModal open={createOpen} onClose={() => setCreateOpen(false)} data={scopedData} activeWorkspaceId={activeId} initialKind={createKind} />
      <div className="screen-reader-status" aria-live="polite">{status.refreshing ? "Refreshing local data" : status.error ? status.error.message : ""}</div>
    </div>
  );
}

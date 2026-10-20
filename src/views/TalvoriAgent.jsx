import { useEffect, useMemo, useRef, useState } from 'react';
import { Conversation } from './Chats.jsx';
import { ArrowUp, Archive, Download, Ellipsis, MessageCircle, Paperclip, Pencil, Pin, PinOff, Plus, Search, X } from '../components/icons.jsx';
import { EmptyIllustration } from '../components/EmptyState.jsx';
import { Form } from '../components/Form.jsx';
import TechText from '../components/TechText.jsx';
import { TalvoriAgentOrb, TalvoriAgentColorChoice } from '../components/TalvoriAgentOrb.jsx';
import { apiRequest, talvoriApi } from '../data/api.js';
import { refreshTalvori, talvoriActions } from '../data/useTalvori.js';
import { ACTIVE_CHAT_RUNS, indexChatActivity, persistComposer, restoreComposer } from '../lib/chats.js';
import { consumeTalvoriAgentEntry, peekTalvoriAgentEntry, talvoriAgentSourceLabel } from '../lib/talvori-agent-entry.js';
import { announceTalvoriAgentAppearance } from '../lib/talvori-agent-appearance.js';
import { EXECUTION_PROVIDERS } from '../lib/ai-providers.js';
import { agentReadiness } from '../lib/agents.js';
import { containsDraggedFiles, readComposerFiles } from '../lib/composer-files.js';
import { download, relative, val, visible } from '../lib/model.js';
import { Button, Dialog, ErrorMessage, Field, IconButton, SearchField, Select, useApp } from '../ui.jsx';
import './talvori-agent.css';
import { AssistantActivity } from '../components/AssistantActivity.jsx';
import { ScheduledWorkSettings } from './settings/ScheduledWorkSettings.jsx';
import { pageHash } from '../lib/navigation.js';
import { hasConnectedAssistantAI } from '../lib/assistant-connection.js';

function draftStorage() { try { return sessionStorage; } catch { return undefined; } }
function creationKey(workspaceId) { return `rumbo-agent:create:${workspaceId}`; }
function savedCreation(workspaceId) {
  try {
    const value = JSON.parse(draftStorage()?.getItem(creationKey(workspaceId)) || 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const provider = EXECUTION_PROVIDERS.includes(value.provider) ? value.provider : '';
    const instruction = typeof value.instruction === 'string' && value.instruction.length <= 10000 ? value.instruction : '';
    const model = typeof value.model === 'string' && value.model.length <= 512 ? value.model : '';
    const source = value.source && ['document', 'update', 'task', 'project'].includes(value.source.type) && typeof value.source.id === 'string' ? { type: value.source.type, id: value.source.id } : null;
    const request_id = typeof value.request_id === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(value.request_id) ? value.request_id : undefined;
    const agent_id = typeof value.agent_id === 'string' ? value.agent_id : '';
    return { provider, instruction, model, source, agent_id, ...(request_id ? { request_id } : {}) };
  } catch { return null; }
}
function saveCreation(workspaceId, value) { try { draftStorage()?.setItem(creationKey(workspaceId), JSON.stringify(value)); } catch {} }
function clearCreation(workspaceId) { try { draftStorage()?.removeItem(creationKey(workspaceId)); } catch {} }
function asList(value) { return Array.isArray(value) ? value : []; }
function responseState(result) {
  const value = result || {};
  return {
    ...value,
    providers: asList(value.providers || value.readiness),
    profiles: asList(value.profiles).length ? asList(value.profiles) : asList(value.providers).map(item => item?.agent).filter(Boolean),
    preferences: value.preferences || {},
    models: value.models && typeof value.models === 'object' ? value.models : {},
  };
}
function providerId(item) { return item?.provider || item?.id || ''; }
function providerReady(item) { return item?.connected === true; }

function ConnectionRequired({ compact = false, onConnect }) {
  return compact ? <div className="rumbo-agent-connection-notice" role="status"><span>Connect AI to use Talvori. History and saved work remain readable.</span><Button onClick={onConnect}>Connect AI</Button></div> : <div className="rumbo-agent-disconnected"><EmptyIllustration kind="connections" /><h1>Connect AI to use Talvori</h1><p>Connect a supported account in AI Connections first. Talvori cannot answer, start work or run event subscriptions without a ready AI connection. Your saved conversations remain available from the conversation menu.</p><Button variant="primary" onClick={onConnect}>Connect AI</Button></div>;
}

function AgentHeader({ currentChat, chats, onChat, onNew, onOptions, onSettings, identity }) {
  const { page } = useApp();
  const section = page.section || 'conversation';
  return <><header className="rumbo-agent-header">
    <div className="rumbo-agent-identity"><IconButton label="Chat options" disabled={!currentChat} onClick={onOptions}><Ellipsis /></IconButton><TalvoriAgentOrb compact color={identity?.orb_color} /><strong>{identity?.display_name || 'Talvori'}</strong></div>
    <div className="rumbo-agent-header-actions"><Button variant="ghost" onClick={onSettings}>Preferences</Button><Select aria-label="Current Talvori conversation" value={currentChat?.id || ''} onChange={onChat}><option value="">New conversation</option>{chats.map(chat => <option key={chat.id} value={chat.id}>{chat.title}</option>)}</Select><Button icon={Plus} onClick={onNew}>New chat</Button></div>
  </header><nav className="assistant-section-nav" aria-label="Talvori sections">{[['conversation', 'Conversation'], ['activity', 'Activity'], ['scheduled', 'Scheduled']].map(([id, label]) => <a key={id} href={pageHash('rumbo-agent', currentChat?.id || null, { section: id })} aria-current={section === id ? 'page' : undefined}>{label}</a>)}</nav></>;
}

function AgentOnboarding({ workspaceId, initial, onComplete, onExit }) {
  const [form, setForm] = useState({ display_name: initial?.display_name || 'Talvori', orb_color: initial?.orb_color || 'blue', purpose: initial?.purpose || '', guidelines: initial?.guidelines || '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState(null);
  async function finish(event) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await apiRequest('/api/talvori-agent/preferences', { method: 'PATCH', body: { workspace_id: workspaceId, preferences: { ...form, onboarding_complete: true } } });
      const preferences = response.result?.preferences || response.result;
      announceTalvoriAgentAppearance(workspaceId, preferences);
      onComplete(preferences);
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }
  const patch = (field, value) => setForm(current => ({ ...current, [field]: value }));
  return <section className="rumbo-agent-onboarding" aria-labelledby="rumbo-onboarding-title"><button type="button" className="rumbo-agent-onboarding-exit" onClick={onExit}>Not now <X /></button>
    <div className="rumbo-agent-onboarding-art"><div className="rumbo-agent-onboarding-code" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <span key={i}>0L1I 8X24 3A9F E7C2 0D81 4B6A 9C12</span>)}</div><TalvoriAgentOrb color={form.orb_color} /><TalvoriAgentColorChoice value={form.orb_color} onChange={color => patch('orb_color', color)} label="Choose your Agent color" /></div>
    <div className="rumbo-agent-onboarding-content"><h1 id="rumbo-onboarding-title">Make it yours.</h1><p className="rumbo-agent-onboarding-lead">Complete this setup before using Talvori in a conversation or mention. Give it a clear role; you can change these choices later in Settings.</p>
      <Form onSubmit={finish} className="rumbo-agent-onboarding-form"><label><span>Agent name</span><input autoFocus required minLength={1} maxLength={60} value={form.display_name} onChange={event => patch('display_name', event.target.value)} placeholder="Talvori" /></label><label><span>What should it help you with?</span><textarea required maxLength={500} rows={2} value={form.purpose} onChange={event => patch('purpose', event.target.value)} placeholder="e.g. Plan work and explain progress across this workspace" /></label><label><span>Guidelines</span><textarea required maxLength={4000} rows={4} value={form.guidelines} onChange={event => patch('guidelines', event.target.value)} placeholder="e.g. Be concise, cite sources when available, and ask before making changes" /></label><ErrorMessage error={error} /><Button type="submit" variant="primary" busy={busy} disabled={!form.display_name.trim() || !form.purpose.trim() || !form.guidelines.trim()}>Finish setup <ArrowUp /></Button></Form>
      <p className="rumbo-agent-onboarding-footnote">Setup does not connect an AI account or start a run. Your guidelines appear in reviewed context and never override permissions.</p>
    </div>
  </section>;
}

function connectedProfiles(data) {
  return visible(data.agents).filter(agent => agentReadiness(agent, data.connections.find(connection => connection.provider === agent.provider && (!val(agent, 'provider_connection_id') || connection.id === val(agent, 'provider_connection_id')))).canStartLive);
}

function AssistantControls({ composer, change, agent, blocked }) {
  const { data } = useApp();
  return <div className="rumbo-agent-controls"><Select aria-label="Message recipient" value={composer.recipient} disabled={blocked} onChange={recipient => change({ recipient, model: '', reasoning: '', permission: 'conversation', nativeTools: false })}>{!agent ? <option value="">Choose an agent</option> : !connectedProfiles(data).some(item => item.id === agent.id) ? <option value={agent.id} disabled>{agent.name} · connection needed</option> : null}{connectedProfiles(data).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></div>;
}

function ChatActions({ chat, active, onClose, onRename, onPin, onArchive, onExport, onDelete }) {
  return <Dialog title="Conversation options" subtitle={chat.title} onClose={onClose}><div className="dialog-body rumbo-agent-action-list">
    <Button icon={Pencil} onClick={onRename}>Rename conversation</Button>
    <Button icon={chat.pinned ? PinOff : Pin} onClick={onPin}>{chat.pinned ? 'Unpin conversation' : 'Pin conversation'}</Button>
    <Button icon={Download} onClick={onExport}>Export as Markdown</Button>
    <Button icon={Archive} disabled={active} onClick={onArchive}>{active ? 'Stop active work before archiving' : 'Archive conversation'}</Button>
    <Button icon={X} variant="danger" disabled={active} onClick={onDelete}>{active ? 'Stop active work before deleting' : 'Delete conversation'}</Button>
  </div></Dialog>;
}

function RenameDialog({ chat, busy, error, onClose, onSave }) {
  const [title, setTitle] = useState(chat.title);
  return <Dialog title="Rename conversation" onClose={onClose}><Form onSubmit={event => { event.preventDefault(); onSave(title.trim()); }}><Field label="Conversation name"><input autoFocus required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} /></Field><ErrorMessage error={error} /><footer className="dialog-footer"><Button disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy} disabled={!title.trim() || title.trim() === chat.title}>Rename</Button></footer></Form></Dialog>;
}

function HistoryDialog({ chats, onClose, onOpen, onOptions }) {
  const [query, setQuery] = useState('');
  const shown = chats.filter(chat => chat.title.toLowerCase().includes(query.trim().toLowerCase()));
  return <Dialog title="Talvori history" subtitle="Search your real saved conversations. Opening one does not start a provider run." onClose={onClose}><div className="dialog-body rumbo-agent-history-dialog"><SearchField value={query} onChange={setQuery} label="Search Talvori history" placeholder="Search conversations…" /><div>{shown.map(chat => <article key={chat.id}><button onClick={() => onOpen(chat.id)}><MessageCircle /><span><strong>{chat.title}</strong><small>{relative(val(chat, 'updated_at'))}</small></span></button><IconButton label={`Options for ${chat.title}`} onClick={() => onOptions(chat)}><Ellipsis /></IconButton></article>)}{!shown.length ? <p>No matching conversations.</p> : null}</div></div></Dialog>;
}

export function TalvoriAgent() {
  const { data, workspace, page, navigate, archive, notify } = useApp();
  const [agentState, setAgentState] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(null);
  const [draft, setDraft] = useState(() => peekTalvoriAgentEntry(workspace.id)?.instruction || savedCreation(workspace.id)?.instruction || '');
  const [draftFiles, setDraftFiles] = useState([]), [draggingFiles, setDraggingFiles] = useState(false);
  const [provider, setProvider] = useState(''), [createdChat, setCreatedChat] = useState(null), [busy, setBusy] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [actions, setActions] = useState(null), [rename, setRename] = useState(null), [confirmDelete, setConfirmDelete] = useState(null), [historyOpen, setHistoryOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const composers = useRef(new Map());
  const createRequest = useRef(null);
  const fileRef = useRef(null), dragDepth = useRef(0);
  const workspaceRef = useRef(workspace.id);
  workspaceRef.current = workspace.id;
  const [, refreshComposer] = useState(0);
  const index = useMemo(() => indexChatActivity(data.messages, data.runs), [data.messages, data.runs]);
  const connectionRevision = useMemo(() => JSON.stringify(asList(data.connections).map(item => [item.provider, item.state, item.status, item.connected, item.updated_at, item.workspace_states])), [data.connections]);
  const savedChats = visible(data.chats).filter(chat => chat.kind === 'rumbo-agent' && chat.workspace_id === workspace.id).toSorted((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.updated_at).localeCompare(String(a.updated_at)));
  const chats = createdChat && !savedChats.some(chat => chat.id === createdChat.id) ? [createdChat, ...savedChats] : savedChats;
  const currentChat = chats.find(chat => chat.id === page.id) || (createdChat?.id === page.id ? createdChat : null);
  const pending = peekTalvoriAgentEntry(workspace.id);
  const restoredSource = pending ? pending.source : savedCreation(workspace.id)?.source || null;
  const actionChat = actions ? chats.find(chat => chat.id === actions.id) : null;
  const renameChat = rename ? chats.find(chat => chat.id === rename.id) : null;
  const deleteChat = confirmDelete ? chats.find(chat => chat.id === confirmDelete.id) : null;
  const activeFor = chat => (index.runsByChat.get(chat.id) || []).some(run => ACTIVE_CHAT_RUNS.has(run.status));
  const connectedAgents = connectedProfiles(data);
  const defaultProvider = agentState?.providers.find(item => providerId(item) === provider && providerReady(item)) || agentState?.providers.find(providerReady);
  const builtIn = connectedAgents.find(item => item.id.startsWith('rumbo_agent_')) || (defaultProvider ? { id: 'talvori-default', name: agentState?.preferences.display_name || 'Talvori', provider: providerId(defaultProvider), builtIn: true } : null);
  const recipients = builtIn ? [builtIn, ...connectedAgents.filter(item => item.id !== builtIn.id)] : connectedAgents;
  const requestedAgentId = selectedAgentId || pending?.agentId || '';
  // An addressed handoff must never silently fall back to another identity.
  const selectedAgent = requestedAgentId ? recipients.find(item => item.id === requestedAgentId) : builtIn || recipients[0];

  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null); setAgentState(null); setProvider('');
    apiRequest(`/api/talvori-agent?workspace_id=${encodeURIComponent(workspace.id)}`, { signal: controller.signal })
      .then(response => { if (controller.signal.aborted) return; const next = responseState(response.result), saved = savedCreation(workspace.id); const requested = next.providers.find(item => providerId(item) === saved?.provider); const preferred = next.providers.find(item => providerId(item) === next.preferences.provider && providerReady(item)); const selected = requested || preferred || next.providers.find(providerReady); setSelectedAgentId(current => current || peekTalvoriAgentEntry(workspace.id)?.agentId || saved?.agent_id || ''); setAgentState(next); setProvider(providerId(selected) || ''); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspace.id, connectionRevision, reload]);

  useEffect(() => { const entry = peekTalvoriAgentEntry(workspace.id), saved = savedCreation(workspace.id); setDraft(entry?.instruction || saved?.instruction || ''); setSelectedAgentId(entry?.agentId || saved?.agent_id || ''); }, [workspace.id, pending]);
  useEffect(() => { composers.current = new Map(); createRequest.current = null; setCreatedChat(null); setDraftFiles([]); setDraggingFiles(false); dragDepth.current = 0; setActions(null); setRename(null); setConfirmDelete(null); setHistoryOpen(false); }, [workspace.id]);
  useEffect(() => {
    if (!agentState || agentState.workspace_id !== workspace.id) return;
    if (!draft.trim()) { clearCreation(workspace.id); return; }
    const entry = peekTalvoriAgentEntry(workspace.id), prior = savedCreation(workspace.id), identity = { provider: selectedAgent?.provider || provider, source: entry ? entry.source : prior?.source || null, instruction: draft, model: '', agent_id: requestedAgentId || selectedAgent?.id || '' };
    const same = prior && JSON.stringify({ provider: prior.provider, source: prior.source, instruction: prior.instruction, model: prior.model, agent_id: prior.agent_id }) === JSON.stringify(identity);
    saveCreation(workspace.id, { ...identity, ...(same && prior.request_id ? { request_id: prior.request_id } : {}) });
  }, [workspace.id, agentState, provider, selectedAgent?.id, requestedAgentId, pending, draft]);

  async function attachFiles(files) {
    if (!files?.length) return;
    const requestWorkspace = workspace.id;
    try {
      const next = await readComposerFiles(files, draftFiles);
      if (workspaceRef.current === requestWorkspace) { setDraftFiles(next); setError(null); }
    } catch (cause) { if (workspaceRef.current === requestWorkspace) setError(cause); }
  }
  function onFileInput(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    void attachFiles(files);
  }
  function fileDragEnter(event) {
    if (!containsDraggedFiles(event)) return;
    event.preventDefault(); dragDepth.current += 1; setDraggingFiles(true);
  }
  function fileDragLeave() {
    if (!dragDepth.current) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDraggingFiles(false);
  }
  function fileDrop(event) {
    if (!containsDraggedFiles(event) && !event.dataTransfer?.files?.length) return;
    event.preventDefault(); dragDepth.current = 0; setDraggingFiles(false);
    void attachFiles(event.dataTransfer.files);
  }

  async function createChat(event) {
    event?.preventDefault();
    if (loading || !hasConnectedAssistantAI(agentState)) { navigate('connections'); return; }
    if (!draft.trim() || !selectedAgent || busy) return;
    const requestWorkspace = workspace.id; setBusy(true); setError(null);
    try {
      const entry = peekTalvoriAgentEntry(workspace.id), prior = savedCreation(workspace.id), source = entry ? entry.source : prior?.source || null;
      const identity = { provider: selectedAgent.provider, source, instruction: draft.trim(), model: '', agent_id: selectedAgent.id };
      const requestId = prior?.request_id && JSON.stringify({ provider: prior.provider, source: prior.source, instruction: prior.instruction, model: prior.model, agent_id: prior.agent_id }) === JSON.stringify(identity) ? prior.request_id : crypto.randomUUID();
      createRequest.current = requestId; saveCreation(workspace.id, { ...identity, request_id: requestId });
      const { result } = await apiRequest('/api/talvori-agent/chats', { method: 'POST', body: { workspace_id: workspace.id, provider: selectedAgent.provider, ...(!selectedAgent.builtIn ? { agent_id: selectedAgent.id } : {}), request_id: requestId, ...(source ? { source } : {}) } });
      const chat = result.chat || result, profile = result.agent || selectedAgent;
      if (workspaceRef.current !== requestWorkspace) { consumeTalvoriAgentEntry(requestWorkspace); clearCreation(requestWorkspace); await refreshTalvori(); return; }
      const composer = restoreComposer(chat, data.agents, draftStorage());
      Object.assign(composer, { text: draft.trim(), files: draftFiles, recipient: profile?.id || composer.recipient, model: '', reasoning: '', memory: agentState.preferences.include_memory !== false, includeChat: agentState.preferences.include_chat !== false, includeWorkspace: agentState.preferences.include_workspace !== false, contextPackIds: asList(agentState.preferences.context_pack_ids), nativeTools: false });
      composers.current.set(chat.id, composer); persistComposer(chat.id, composer, draftStorage()); setCreatedChat(chat); consumeTalvoriAgentEntry(workspace.id); setDraft(''); setDraftFiles([]);
      createRequest.current = null; clearCreation(workspace.id); await refreshTalvori(); setCreatedChat(null); navigate('rumbo-agent', chat.id); notify('Conversation created. Your message is ready to send.');
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }

  async function mutateChat(callback, message) {
    if (busy) return false; setBusy(true); setError(null);
    try { await callback(); await refreshTalvori(); setActions(null); setRename(null); setConfirmDelete(null); if (message) notify(message); return true; }
    catch (cause) { setError(cause); return false; }
    finally { setBusy(false); }
  }

  async function exportChat(chat) {
    if (busy) return; setBusy(true); setError(null);
    try { const result = (await talvoriApi.exportChat(chat.id)).result; download(result.filename, result.markdown, 'text/markdown'); setActions(null); notify('Conversation exported'); }
    catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }

  const connectionMissing = !loading && Boolean(agentState) && !hasConnectedAssistantAI(agentState);
  const readOnlySection = ['activity', 'scheduled'].includes(page.section);
  const header = <><AgentHeader currentChat={currentChat} chats={chats} identity={agentState?.preferences} onChat={id => navigate('rumbo-agent', id || null)} onNew={() => navigate('rumbo-agent')} onOptions={() => currentChat && setActions(currentChat)} onSettings={() => navigate('settings', 'rumbo-agent')} />{connectionMissing && (currentChat || readOnlySection) ? <ConnectionRequired compact onConnect={() => navigate('connections')} /> : null}</>;
  if (connectionMissing && !currentChat && !readOnlySection) return <main className="rumbo-agent-page">{header}<section className="rumbo-agent-start"><ConnectionRequired onConnect={() => navigate('connections')} /></section></main>;
  if (page.section === 'activity' || page.section === 'scheduled') return <main className="rumbo-agent-page">{header}<div className="assistant-section-panel" key={`${workspace.id}:${page.section}`}>{page.section === 'activity' ? <AssistantActivity /> : <ScheduledWorkSettings embedded />}</div></main>;
  if (currentChat && (loading || !agentState)) return <main className="rumbo-agent-page rumbo-agent-conversation">{header}<section className="rumbo-agent-start">{loading ? <p className="rumbo-agent-loading" role="status">Loading model and context preferences…</p> : <div className="rumbo-agent-disconnected"><h1>Conversation settings unavailable</h1><p>Your saved conversation and history have not been changed. Retry before editing or sending so Talvori can apply the correct model and context defaults.</p><ErrorMessage error={error} /><Button variant="primary" onClick={() => setReload(value => value + 1)}>Retry</Button></div>}</section></main>;
  if (currentChat) return <main className="rumbo-agent-page rumbo-agent-conversation"><Conversation key={currentChat.id} chat={currentChat} index={index} composers={composers.current} scope={{ projectId: val(currentChat, 'project_id') || null }} onComposerChange={() => refreshComposer(value => value + 1)} assistant={{ header, preferences: agentState?.preferences || {}, renderControls: props => <AssistantControls {...props} /> }} />{error ? <ErrorMessage error={error} /> : null}{actionChat ? <ChatActions chat={actionChat} active={activeFor(actionChat)} onClose={() => setActions(null)} onRename={() => { setRename(actionChat); setActions(null); }} onPin={() => mutateChat(() => talvoriActions.updateChat(actionChat.id, { pinned: !actionChat.pinned }), actionChat.pinned ? 'Conversation unpinned' : 'Conversation pinned')} onExport={() => exportChat(actionChat)} onArchive={() => { setActions(null); archive('chat', actionChat); }} onDelete={() => { setConfirmDelete(actionChat); setActions(null); }} /> : null}{renameChat ? <RenameDialog chat={renameChat} busy={busy} error={error} onClose={() => setRename(null)} onSave={title => mutateChat(() => talvoriActions.updateChat(renameChat.id, { title }), 'Conversation renamed')} /> : null}{deleteChat ? <Dialog title="Delete this conversation?" subtitle={deleteChat.title} onClose={() => !busy && setConfirmDelete(null)}><p className="rumbo-agent-destructive-copy">This permanently removes the conversation and its saved history. Source-bound conversations may need to be archived instead so their provenance remains intact.</p><ErrorMessage error={error} /><footer className="dialog-footer"><Button disabled={busy} onClick={() => setConfirmDelete(null)}>Cancel</Button><Button variant="danger" busy={busy} onClick={async () => { if (await mutateChat(() => talvoriApi.deleteChat(deleteChat.id), 'Conversation deleted')) navigate('rumbo-agent'); }}>Delete conversation</Button></footer></Dialog> : null}</main>;
  if (!loading && !agentState && error) return <main className="rumbo-agent-page">{header}<section className="rumbo-agent-start"><div className="rumbo-agent-disconnected"><h1>Talvori settings unavailable</h1><p>Your saved conversations remain available from the conversation menu. Retry before creating a draft so Talvori can apply the correct model and context defaults.</p><ErrorMessage error={error} /><Button variant="primary" onClick={() => setReload(value => value + 1)}>Retry</Button></div></section></main>;
  if (!loading && agentState && !agentState.preferences.onboarding_complete) return <main className="rumbo-agent-page rumbo-agent-onboarding-page"><AgentOnboarding key={workspace.id} workspaceId={workspace.id} initial={agentState.preferences} onComplete={preferences => { if (workspaceRef.current === workspace.id) setAgentState(current => ({ ...current, preferences })); }} onExit={() => navigate('today')} /></main>;

  const connected = Boolean(selectedAgent);
  return <main className="rumbo-agent-page">{header}<section className="rumbo-agent-start">
    {loading ? <p className="rumbo-agent-loading" role="status">Checking available AI models…</p> : !agentState?.providers.length || !agentState.providers.some(providerReady) ? <div className="rumbo-agent-disconnected"><EmptyIllustration kind="connections" /><h1>Connect an AI model</h1><p>Your Talvori conversations remain readable. Connect a supported account in AI Connections before creating a conversation.</p><Button variant="primary" onClick={() => navigate('connections')}>Open Connections</Button></div> : <><h1 className="rumbo-agent-hero-title"><TechText text="What would you like to work on?" fontSize={52} fontWeight={650} color={document.documentElement.dataset.theme === "light" ? "#202129" : "#f3f4f7"} accentColor="#8585ff" reach={125} specks={8} labels={false} draggable={false} /></h1><Form className={`rumbo-agent-compose${draggingFiles ? ' rumbo-agent-compose--dragging' : ''}`} onSubmit={createChat} onDragEnter={fileDragEnter} onDragOver={event => { if (containsDraggedFiles(event)) event.preventDefault(); }} onDragLeave={fileDragLeave} onDrop={fileDrop}>{draggingFiles ? <div className="rumbo-agent-compose-drop-hint" aria-hidden="true">Drop files to attach</div> : null}{draftFiles.length ? <div className="rumbo-agent-compose-files" aria-label="Attached files">{draftFiles.map((file, index) => <span key={`${file.name}-${index}`}><Paperclip /><span title={file.name}>{file.name}</span><IconButton label={`Remove ${file.name}`} onClick={() => setDraftFiles(current => current.filter((_, i) => i !== index))}><X /></IconButton></span>)}</div> : null}<Field label="Request"><textarea data-field-default-key="rumbo-agent.new.request" data-field-default-page="Talvori new conversation" data-field-default-label="Request" data-field-default-mode="create" autoFocus maxLength={10000} placeholder="Ask Talvori…" value={draft} onChange={event => setDraft(event.target.value)} /></Field><div className="rumbo-agent-compose-tools"><TalvoriAgentOrb compact color={agentState.preferences.orb_color} /><Select aria-label="Agent" value={selectedAgent?.id || requestedAgentId || ''} disabled={busy} onChange={id => { setSelectedAgentId(id); const identity = recipients.find(item => item.id === id); setProvider(identity?.provider || ''); }}><option value="">Choose an agent</option>{requestedAgentId && !selectedAgent ? <option value={requestedAgentId} disabled>Selected agent unavailable · choose another</option> : null}{recipients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select><input ref={fileRef} type="file" hidden multiple onChange={onFileInput} accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.json,.js,.jsx,.ts,.tsx,.css,.html,.csv,.py,.rs,.go,.yaml,.yml,.sql,.xml,.sh" /><IconButton label="Attach files" onClick={() => fileRef.current?.click()}><Paperclip /></IconButton>{restoredSource ? <span className="rumbo-agent-source">Selected {talvoriAgentSourceLabel(restoredSource.type)} · access checked when sending</span> : null}<IconButton label="Create conversation" type="submit" disabled={busy || !connected || !draft.trim()}><ArrowUp /></IconButton></div></Form></>}{error ? <ErrorMessage error={error} /> : null}
    {chats.length ? <section className="rumbo-agent-recents"><div><h2>Recent conversations</h2><Button icon={Search} variant="ghost" onClick={() => setHistoryOpen(true)}>Search history</Button></div>{chats.slice(0, 6).map(chat => <article key={chat.id}><button className="rumbo-agent-chat-link" onClick={() => navigate('rumbo-agent', chat.id)}><MessageCircle /><strong>{chat.title}</strong></button><time>{relative(val(chat, 'updated_at'))}</time><IconButton label={`Options for ${chat.title}`} onClick={() => setActions(chat)}><Ellipsis /></IconButton></article>)}</section> : !loading ? <p className="rumbo-agent-no-history">No Talvori conversations yet.</p> : null}
  </section>{historyOpen ? <HistoryDialog chats={chats} onClose={() => setHistoryOpen(false)} onOpen={id => { setHistoryOpen(false); navigate('rumbo-agent', id); }} onOptions={chat => { setHistoryOpen(false); setActions(chat); }} /> : null}{actionChat ? <ChatActions chat={actionChat} active={activeFor(actionChat)} onClose={() => setActions(null)} onRename={() => { setRename(actionChat); setActions(null); }} onPin={() => mutateChat(() => talvoriActions.updateChat(actionChat.id, { pinned: !actionChat.pinned }), actionChat.pinned ? 'Conversation unpinned' : 'Conversation pinned')} onExport={() => exportChat(actionChat)} onArchive={() => { setActions(null); archive('chat', actionChat); }} onDelete={() => { setConfirmDelete(actionChat); setActions(null); }} /> : null}{renameChat ? <RenameDialog chat={renameChat} busy={busy} error={error} onClose={() => setRename(null)} onSave={title => mutateChat(() => talvoriActions.updateChat(renameChat.id, { title }), 'Conversation renamed')} /> : null}{deleteChat ? <Dialog title="Delete this conversation?" subtitle={deleteChat.title} onClose={() => !busy && setConfirmDelete(null)}><p className="rumbo-agent-destructive-copy">This permanently removes the conversation and its saved history. Source-bound conversations may need to be archived instead so their provenance remains intact.</p><ErrorMessage error={error} /><footer className="dialog-footer"><Button disabled={busy} onClick={() => setConfirmDelete(null)}>Cancel</Button><Button variant="danger" busy={busy} onClick={() => mutateChat(() => talvoriApi.deleteChat(deleteChat.id), 'Conversation deleted')}>Delete conversation</Button></footer></Dialog> : null}</main>;
}

export default TalvoriAgent;

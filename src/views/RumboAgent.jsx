import { useEffect, useMemo, useRef, useState } from 'react';
import { Conversation } from './Chats.jsx';
import { ArrowUp, Archive, Bot, Download, Ellipsis, MessageCircle, Pencil, Pin, PinOff, Plus, Search, X } from '../components/icons.jsx';
import { EmptyIllustration } from '../components/EmptyState.jsx';
import { Form } from '../components/Form.jsx';
import { apiRequest, rumboApi } from '../data/api.js';
import { refreshRumbo, rumboActions } from '../data/useRumbo.js';
import { ACTIVE_CHAT_RUNS, indexChatActivity, persistComposer, restoreComposer } from '../lib/chats.js';
import { consumeRumboAgentEntry, peekRumboAgentEntry, rumboAgentSourceLabel } from '../lib/rumbo-agent-entry.js';
import { download, relative, val, visible } from '../lib/model.js';
import { Button, Dialog, ErrorMessage, Field, IconButton, ProviderIcon, SearchField, Select, Toggle, useApp } from '../ui.jsx';
import './rumbo-agent.css';

function draftStorage() { try { return sessionStorage; } catch { return undefined; } }
function creationKey(workspaceId) { return `rumbo-agent:create:${workspaceId}`; }
function savedCreation(workspaceId) {
  try {
    const value = JSON.parse(draftStorage()?.getItem(creationKey(workspaceId)) || 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const provider = ['codex', 'claude'].includes(value.provider) ? value.provider : '';
    const instruction = typeof value.instruction === 'string' && value.instruction.length <= 10000 ? value.instruction : '';
    const model = typeof value.model === 'string' && value.model.length <= 512 ? value.model : '';
    const source = value.source && ['document', 'update', 'task', 'project'].includes(value.source.type) && typeof value.source.id === 'string' ? { type: value.source.type, id: value.source.id } : null;
    const request_id = typeof value.request_id === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(value.request_id) ? value.request_id : undefined;
    return { provider, instruction, model, source, ...(request_id ? { request_id } : {}) };
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
function modelId(item) { return typeof item === 'string' ? item : item?.id || item?.model || ''; }
function modelLabel(item) { return typeof item === 'string' ? item : item?.label || item?.name || item?.id || item?.model || ''; }

function AgentHeader({ currentChat, chats, onChat, onNew, onOptions, onSettings }) {
  return <header className="rumbo-agent-header">
    <div className="rumbo-agent-identity"><IconButton label="Chat options" disabled={!currentChat} onClick={onOptions}><Ellipsis /></IconButton><span className="rumbo-agent-mark"><Bot /></span><strong>Rumbo Agent</strong></div>
    <div className="rumbo-agent-header-actions"><Button variant="ghost" onClick={onSettings}>Preferences</Button><Select aria-label="Current Rumbo Agent conversation" value={currentChat?.id || ''} onChange={onChat}><option value="">New conversation</option>{chats.map(chat => <option key={chat.id} value={chat.id}>{chat.title}</option>)}</Select><Button icon={Plus} onClick={onNew}>New chat</Button></div>
  </header>;
}

function configuredModels(provider) { return asList(provider?.models).filter(item => modelId(item)); }

function AssistantControls({ context, composer, change, agent, blocked, onProvider }) {
  const providers = context.providers, selectedProvider = agent?.provider || context.preferences.provider || '';
  const provider = providers.find(item => providerId(item) === selectedProvider);
  const models = configuredModels(provider);
  const selectedModel = composer.model ?? context.preferences.model ?? '';
  const customModel = Boolean(selectedModel && !models.some(item => modelId(item) === selectedModel));
  return <div className="rumbo-agent-controls">
    <span className="rumbo-agent-provider"><ProviderIcon provider={selectedProvider || 'codex'} /><Select aria-label="Rumbo Agent provider" value={selectedProvider} disabled={blocked} onChange={onProvider}><option value="">Choose model provider</option>{providers.map(item => <option key={providerId(item)} value={providerId(item)} disabled={!providerReady(item)}>{item.label || item.name || providerId(item)}{providerReady(item) ? '' : ' · unavailable'}</option>)}</Select></span>
    <Select aria-label="Configured Rumbo Agent model" value={selectedModel} disabled={blocked || !selectedProvider} onChange={model => change({ model })}><option value="">{provider?.models?.find(item => !modelId(item))?.label || 'Connection default'}</option>{models.map(item => <option key={modelId(item)} value={modelId(item)} title={modelId(item)}>{modelLabel(item)}</option>)}{customModel ? <option value={selectedModel} title={selectedModel}>{selectedModel} · unverified</option> : null}</Select>
    <details className="rumbo-agent-model-options"><summary>Model options</summary><div><Field label="Custom model ID"><input className="rumbo-agent-custom-model" placeholder="Optional provider model ID" value={selectedModel} disabled={blocked || !selectedProvider} onChange={event => change({ model: event.target.value })} /></Field><Field label="Reasoning effort"><Select value={composer.reasoning || ''} disabled={blocked || !selectedProvider} onChange={reasoning => change({ reasoning })}><option value="">Provider default</option>{asList(provider?.reasoning_efforts).filter(Boolean).map(value => <option key={value} value={value}>{value}</option>)}</Select></Field></div></details>
    <span className="rumbo-agent-context-label">Context is reviewed before sending</span>
    {context.preferences.native_tools ? <span className="rumbo-agent-context-label">Tools are suggested only; select them in context review</span> : null}
  </div>;
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
  return <Dialog title="Rumbo Agent history" subtitle="Search your real saved conversations. Opening one does not start a provider run." onClose={onClose}><div className="dialog-body rumbo-agent-history-dialog"><SearchField value={query} onChange={setQuery} label="Search Rumbo Agent history" placeholder="Search conversations…" /><div>{shown.map(chat => <article key={chat.id}><button onClick={() => onOpen(chat.id)}><MessageCircle /><span><strong>{chat.title}</strong><small>{relative(val(chat, 'updated_at'))}</small></span></button><IconButton label={`Options for ${chat.title}`} onClick={() => onOptions(chat)}><Ellipsis /></IconButton></article>)}{!shown.length ? <p>No matching conversations.</p> : null}</div></div></Dialog>;
}

export function RumboAgent() {
  const { data, workspace, page, navigate, archive, notify } = useApp();
  const [agentState, setAgentState] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(null);
  const [draft, setDraft] = useState(() => peekRumboAgentEntry(workspace.id)?.instruction || savedCreation(workspace.id)?.instruction || '');
  const [provider, setProvider] = useState(''), [draftModel, setDraftModel] = useState(''), [createdChat, setCreatedChat] = useState(null), [busy, setBusy] = useState(false);
  const [actions, setActions] = useState(null), [rename, setRename] = useState(null), [confirmDelete, setConfirmDelete] = useState(null), [historyOpen, setHistoryOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const composers = useRef(new Map());
  const createRequest = useRef(null);
  const workspaceRef = useRef(workspace.id);
  workspaceRef.current = workspace.id;
  const [, refreshComposer] = useState(0);
  const index = useMemo(() => indexChatActivity(data.messages, data.runs), [data.messages, data.runs]);
  const connectionRevision = useMemo(() => JSON.stringify(asList(data.connections).map(item => [item.provider, item.state, item.status, item.connected, item.updated_at])), [data.connections]);
  const savedChats = visible(data.chats).filter(chat => chat.kind === 'rumbo-agent' && chat.workspace_id === workspace.id).toSorted((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.updated_at).localeCompare(String(a.updated_at)));
  const chats = createdChat && !savedChats.some(chat => chat.id === createdChat.id) ? [createdChat, ...savedChats] : savedChats;
  const currentChat = chats.find(chat => chat.id === page.id) || (createdChat?.id === page.id ? createdChat : null);
  const pending = peekRumboAgentEntry(workspace.id);
  const restoredSource = pending ? pending.source : savedCreation(workspace.id)?.source || null;
  const actionChat = actions ? chats.find(chat => chat.id === actions.id) : null;
  const renameChat = rename ? chats.find(chat => chat.id === rename.id) : null;
  const deleteChat = confirmDelete ? chats.find(chat => chat.id === confirmDelete.id) : null;
  const activeFor = chat => (index.runsByChat.get(chat.id) || []).some(run => ACTIVE_CHAT_RUNS.has(run.status));

  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null); setAgentState(null); setProvider(''); setDraftModel('');
    apiRequest(`/api/rumbo-agent?workspace_id=${encodeURIComponent(workspace.id)}`, { signal: controller.signal })
      .then(response => { if (controller.signal.aborted) return; const next = responseState(response.result), saved = savedCreation(workspace.id); const requested = next.providers.find(item => providerId(item) === saved?.provider); const preferred = next.providers.find(item => providerId(item) === next.preferences.provider && providerReady(item)); const selected = requested || preferred || next.providers.find(providerReady); setAgentState(next); setProvider(providerId(selected) || ''); setDraftModel(requested ? saved.model || '' : preferred ? next.preferences.model || '' : ''); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspace.id, connectionRevision, reload]);

  useEffect(() => { const entry = peekRumboAgentEntry(workspace.id); setDraft(entry?.instruction || savedCreation(workspace.id)?.instruction || ''); }, [workspace.id]);
  useEffect(() => { composers.current = new Map(); createRequest.current = null; setCreatedChat(null); setActions(null); setRename(null); setConfirmDelete(null); setHistoryOpen(false); }, [workspace.id]);
  useEffect(() => {
    if (!agentState || agentState.workspace_id !== workspace.id) return;
    if (!draft.trim()) { clearCreation(workspace.id); return; }
    const entry = peekRumboAgentEntry(workspace.id), prior = savedCreation(workspace.id), identity = { provider, source: entry ? entry.source : prior?.source || null, instruction: draft, model: draftModel };
    const same = prior && JSON.stringify({ provider: prior.provider, source: prior.source, instruction: prior.instruction, model: prior.model }) === JSON.stringify(identity);
    saveCreation(workspace.id, { ...identity, ...(same && prior.request_id ? { request_id: prior.request_id } : {}) });
  }, [workspace.id, agentState, provider, draftModel, draft]);

  async function createChat(event) {
    event?.preventDefault();
    if (!draft.trim() || !provider || busy) return;
    const requestWorkspace = workspace.id; setBusy(true); setError(null);
    try {
      const entry = peekRumboAgentEntry(workspace.id), prior = savedCreation(workspace.id), source = entry ? entry.source : prior?.source || null;
      const identity = { provider, source, instruction: draft.trim(), model: draftModel };
      const requestId = prior?.request_id && JSON.stringify({ provider: prior.provider, source: prior.source, instruction: prior.instruction, model: prior.model }) === JSON.stringify(identity) ? prior.request_id : crypto.randomUUID();
      createRequest.current = requestId; saveCreation(workspace.id, { ...identity, request_id: requestId });
      const { result } = await apiRequest('/api/rumbo-agent/chats', { method: 'POST', body: { workspace_id: workspace.id, provider, request_id: requestId, ...(source ? { source } : {}) } });
      const chat = result.chat || result, profile = result.agent || agentState.profiles.find(item => item.provider === provider);
      if (workspaceRef.current !== requestWorkspace) { consumeRumboAgentEntry(requestWorkspace); clearCreation(requestWorkspace); await refreshRumbo(); return; }
      const composer = restoreComposer(chat, data.agents, draftStorage());
      Object.assign(composer, { text: draft.trim(), recipient: profile?.id || composer.recipient, model: draftModel, reasoning: provider === agentState.preferences.provider ? agentState.preferences.reasoning_effort || '' : '', memory: agentState.preferences.include_memory !== false, includeChat: agentState.preferences.include_chat !== false, includeWorkspace: agentState.preferences.include_workspace !== false, contextPackIds: asList(agentState.preferences.context_pack_ids), nativeTools: false });
      composers.current.set(chat.id, composer); persistComposer(chat.id, composer, draftStorage()); setCreatedChat(chat); consumeRumboAgentEntry(workspace.id); setDraft('');
      createRequest.current = null; clearCreation(workspace.id); await refreshRumbo(); setCreatedChat(null); navigate('rumbo-agent', chat.id); notify('Conversation created. Review its model and exact context before sending.');
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }

  async function chooseProvider(nextProvider, change, blocked) {
    if (blocked || !nextProvider || busy) return;
    const requestWorkspace = workspace.id; setBusy(true); setError(null);
    try {
      const { result } = await apiRequest('/api/rumbo-agent/profile', { method: 'POST', body: { workspace_id: workspace.id, provider: nextProvider } });
      const profile = result.agent;
      if (!profile) throw new Error('Rumbo did not return the selected provider profile.');
      if (workspaceRef.current !== requestWorkspace) { await refreshRumbo(); return; }
      setAgentState(current => ({ ...current, profiles: [...current.profiles.filter(item => item.id !== profile.id && item.provider !== nextProvider), profile], providers: current.providers.map(item => providerId(item) === nextProvider ? { ...item, agent: profile, agent_id: profile.id } : item), preferences: { ...current.preferences, provider: nextProvider, model: '', reasoning_effort: '' } }));
      await refreshRumbo();
      change({ recipient: profile.id, model: '', reasoning: '' });
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }

  async function mutateChat(callback, message) {
    if (busy) return false; setBusy(true); setError(null);
    try { await callback(); await refreshRumbo(); setActions(null); setRename(null); setConfirmDelete(null); if (message) notify(message); return true; }
    catch (cause) { setError(cause); return false; }
    finally { setBusy(false); }
  }

  async function exportChat(chat) {
    if (busy) return; setBusy(true); setError(null);
    try { const result = (await rumboApi.exportChat(chat.id)).result; download(result.filename, result.markdown, 'text/markdown'); setActions(null); notify('Conversation exported'); }
    catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }

  const header = <AgentHeader currentChat={currentChat} chats={chats} onChat={id => navigate('rumbo-agent', id || null)} onNew={() => navigate('rumbo-agent')} onOptions={() => currentChat && setActions(currentChat)} onSettings={() => navigate('settings', 'rumbo-agent')} />;
  if (currentChat && (loading || !agentState)) return <main className="rumbo-agent-page rumbo-agent-conversation">{header}<section className="rumbo-agent-start">{loading ? <p className="rumbo-agent-loading" role="status">Loading model and context preferences…</p> : <div className="rumbo-agent-disconnected"><h1>Conversation settings unavailable</h1><p>Your saved conversation and history have not been changed. Retry before editing or sending so Rumbo can apply the correct model and context defaults.</p><ErrorMessage error={error} /><Button variant="primary" onClick={() => setReload(value => value + 1)}>Retry</Button></div>}</section></main>;
  if (currentChat) return <main className="rumbo-agent-page rumbo-agent-conversation"><Conversation key={currentChat.id} chat={currentChat} index={index} composers={composers.current} scope={{ projectId: val(currentChat, 'project_id') || null }} onComposerChange={() => refreshComposer(value => value + 1)} assistant={{ header, preferences: agentState?.preferences || {}, renderControls: props => <AssistantControls context={agentState || responseState()} {...props} onProvider={value => chooseProvider(value, props.change, props.blocked)} /> }} />{error ? <ErrorMessage error={error} /> : null}{actionChat ? <ChatActions chat={actionChat} active={activeFor(actionChat)} onClose={() => setActions(null)} onRename={() => { setRename(actionChat); setActions(null); }} onPin={() => mutateChat(() => rumboActions.updateChat(actionChat.id, { pinned: !actionChat.pinned }), actionChat.pinned ? 'Conversation unpinned' : 'Conversation pinned')} onExport={() => exportChat(actionChat)} onArchive={() => { setActions(null); archive('chat', actionChat); }} onDelete={() => { setConfirmDelete(actionChat); setActions(null); }} /> : null}{renameChat ? <RenameDialog chat={renameChat} busy={busy} error={error} onClose={() => setRename(null)} onSave={title => mutateChat(() => rumboActions.updateChat(renameChat.id, { title }), 'Conversation renamed')} /> : null}{deleteChat ? <Dialog title="Delete this conversation?" subtitle={deleteChat.title} onClose={() => !busy && setConfirmDelete(null)}><p className="rumbo-agent-destructive-copy">This permanently removes the conversation and its saved history. Source-bound conversations may need to be archived instead so their provenance remains intact.</p><ErrorMessage error={error} /><footer className="dialog-footer"><Button disabled={busy} onClick={() => setConfirmDelete(null)}>Cancel</Button><Button variant="danger" busy={busy} onClick={async () => { if (await mutateChat(() => rumboApi.deleteChat(deleteChat.id), 'Conversation deleted')) navigate('rumbo-agent'); }}>Delete conversation</Button></footer></Dialog> : null}</main>;
  if (!loading && !agentState && error) return <main className="rumbo-agent-page">{header}<section className="rumbo-agent-start"><div className="rumbo-agent-disconnected"><h1>Rumbo Agent settings unavailable</h1><p>Your saved conversations remain available from the conversation menu. Retry before creating a draft so Rumbo can apply the correct model and context defaults.</p><ErrorMessage error={error} /><Button variant="primary" onClick={() => setReload(value => value + 1)}>Retry</Button></div></section></main>;

  const selectedProvider = agentState?.providers.find(item => providerId(item) === provider), connected = providerReady(selectedProvider);
  const models = configuredModels(selectedProvider);
  const customDraftModel = Boolean(draftModel && !models.some(item => modelId(item) === draftModel));
  return <main className="rumbo-agent-page">{header}<section className="rumbo-agent-start">
    {loading ? <p className="rumbo-agent-loading" role="status">Checking available AI models…</p> : !agentState?.providers.length || !agentState.providers.some(providerReady) ? <div className="rumbo-agent-disconnected"><EmptyIllustration kind="connections" /><h1>Connect an AI model</h1><p>Your Rumbo Agent conversations remain readable. Connect Codex or Claude before creating a new provider-backed conversation.</p><Button variant="primary" onClick={() => navigate('connections')}>Open Connections</Button></div> : <><h1>What would you like to work on?</h1><Form className="rumbo-agent-compose" onSubmit={createChat}><Field label="Request"><textarea autoFocus maxLength={10000} placeholder="Ask Rumbo…" value={draft} onChange={event => setDraft(event.target.value)} /></Field><div className="rumbo-agent-compose-tools"><span><ProviderIcon provider={provider || 'codex'} /><Select aria-label="AI model provider" value={provider} onChange={value => { setProvider(value); setDraftModel(value === agentState?.preferences.provider ? agentState.preferences.model || '' : ''); }}><option value="">Choose provider</option>{agentState?.providers.map(item => <option key={providerId(item)} value={providerId(item)} disabled={!providerReady(item)}>{item.label || item.name || providerId(item)}{providerReady(item) ? '' : ' · unavailable'}</option>)}</Select></span><Select aria-label="Configured AI model" value={draftModel} disabled={!provider} onChange={setDraftModel}><option value="">{selectedProvider?.models?.find(item => !modelId(item))?.label || 'Connection default'}</option>{models.map(item => <option key={modelId(item)} value={modelId(item)} title={modelId(item)}>{modelLabel(item)}</option>)}{customDraftModel ? <option value={draftModel} title={draftModel}>{draftModel} · unverified</option> : null}</Select><details className="rumbo-agent-model-options"><summary>Custom model</summary><div><Field label="Custom model ID"><input value={draftModel} disabled={!provider} placeholder="Optional provider model ID" onChange={event => setDraftModel(event.target.value)} /></Field></div></details>{restoredSource ? <span className="rumbo-agent-source">Selected {rumboAgentSourceLabel(restoredSource.type)} · access checked at context review</span> : null}<IconButton label="Create conversation for context review" type="submit" disabled={busy || !connected || !draft.trim()}><ArrowUp /></IconButton></div></Form><p className="rumbo-agent-boundary">Creating a conversation does not contact the provider. Add files after creation, then review exact context before sending.{agentState.preferences.native_tools ? ' Your native-tools preference is only a suggestion; select and review tools in the conversation.' : ''}</p></>}{error ? <ErrorMessage error={error} /> : null}
    {chats.length ? <section className="rumbo-agent-recents"><div><h2>Recent conversations</h2><Button icon={Search} variant="ghost" onClick={() => setHistoryOpen(true)}>Search history</Button></div>{chats.slice(0, 6).map(chat => <article key={chat.id}><button className="rumbo-agent-chat-link" onClick={() => navigate('rumbo-agent', chat.id)}><MessageCircle /><strong>{chat.title}</strong></button><time>{relative(val(chat, 'updated_at'))}</time><IconButton label={`Options for ${chat.title}`} onClick={() => setActions(chat)}><Ellipsis /></IconButton></article>)}</section> : !loading ? <p className="rumbo-agent-no-history">No Rumbo Agent conversations yet.</p> : null}
  </section>{historyOpen ? <HistoryDialog chats={chats} onClose={() => setHistoryOpen(false)} onOpen={id => { setHistoryOpen(false); navigate('rumbo-agent', id); }} onOptions={chat => { setHistoryOpen(false); setActions(chat); }} /> : null}{actionChat ? <ChatActions chat={actionChat} active={activeFor(actionChat)} onClose={() => setActions(null)} onRename={() => { setRename(actionChat); setActions(null); }} onPin={() => mutateChat(() => rumboActions.updateChat(actionChat.id, { pinned: !actionChat.pinned }), actionChat.pinned ? 'Conversation unpinned' : 'Conversation pinned')} onExport={() => exportChat(actionChat)} onArchive={() => { setActions(null); archive('chat', actionChat); }} onDelete={() => { setConfirmDelete(actionChat); setActions(null); }} /> : null}{renameChat ? <RenameDialog chat={renameChat} busy={busy} error={error} onClose={() => setRename(null)} onSave={title => mutateChat(() => rumboActions.updateChat(renameChat.id, { title }), 'Conversation renamed')} /> : null}{deleteChat ? <Dialog title="Delete this conversation?" subtitle={deleteChat.title} onClose={() => !busy && setConfirmDelete(null)}><p className="rumbo-agent-destructive-copy">This permanently removes the conversation and its saved history. Source-bound conversations may need to be archived instead so their provenance remains intact.</p><ErrorMessage error={error} /><footer className="dialog-footer"><Button disabled={busy} onClick={() => setConfirmDelete(null)}>Cancel</Button><Button variant="danger" busy={busy} onClick={() => mutateChat(() => rumboApi.deleteChat(deleteChat.id), 'Conversation deleted')}>Delete conversation</Button></footer></Dialog> : null}</main>;
}

export default RumboAgent;

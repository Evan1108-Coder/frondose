import { ReviewPanel } from '../components/ReviewPanel.jsx';
import { ContextInspector } from '../components/ContextInspector.jsx';
import { NativeToolActivity, NativeToolsChoice } from '../components/NativeToolActivity.jsx';
import { useChatFollow } from '../lib/use-chat-follow.js';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Archive, BookOpen, MessageCircle, Ellipsis, Download, Folder, GitBranch, Info, Search, Paperclip, Pencil, Plus, Pin, PanelLeft, X, Link, FileText, GitFork, Clock } from "../components/icons.jsx";
import { rumboActions, refreshRumbo } from '../data/useRumbo.js';
import { apiRequest } from '../data/api.js';
import { Button, Dialog, Empty, ErrorMessage, Field, IconButton, ProviderIcon, SearchField, Select, Toggle, useApp } from '../ui.jsx';
import { UiIcon, PinOff, Check, Copy } from '../components/icons.jsx';
import { customEmojis } from '../lib/custom-emojis.js';
import { getReaction, reactionKey } from '../lib/reaction-catalog.js';
import { Form } from '../components/Form.jsx';
import { ChatMessage, ChatRunStatus } from '../components/ChatMessage.jsx';
import { AgentMemoryPanel } from '../components/AgentMemoryPanel.jsx';
import { CommandLibrary, SlashCommandMenu } from '../components/SlashCommandMenu.jsx';
import { byUpdated, download, relative, val, visible } from '../lib/model.js';
import { agentReadiness } from '../lib/agents.js';
import { ACTIVE_CHAT_RUNS, chatMarkdown, indexChatActivity, matchingChats, turnBlocker, restoreComposer, persistComposer, messageLink, quotedMessage, threadMessages } from '../lib/chats.js';
import { parseSlashCommand, searchCommands } from '../lib/commands.js';
import { prepareRumboAgentEntry } from '../lib/rumbo-agent-entry.js';
import './chats-page.css';
const ReactionPicker = lazy(() => import('../components/ReactionPicker.jsx'));
const ActivityFeed = lazy(() => import('../components/ActivityFeed.jsx').then(module => ({ default: module.ActivityFeed })));

const CHAT_COMMANDS = Object.freeze([
  'help', 'rumbo', 'agent', 'ask', 'reply', 'update', 'context', 'sources', 'remember', 'attach', 'clear',
  'chat.new', 'route.new', 'request.new', 'project.new', 'document.new', 'inbox', 'focus', 'workbench',
  'connections', 'settings', 'runs', 'permissions', 'status', 'priority', 'due', 'route.block', 'chat.export',
  'summarize', 'translate', 'format', 'run', 'continue', 'retry', 'review', 'compare', 'test', 'explain',
  'investigate', 'implement', 'research', 'codex.ask', 'codex.implement', 'codex.review', 'codex.test',
  'codex.explain', 'codex.fix', 'codex.document', 'codex.continue', 'claude.ask', 'claude.analyze',
  'claude.implement', 'claude.review', 'claude.compare', 'claude.document', 'claude.continue',
]);

function draftStorage() { try { return sessionStorage; } catch { return undefined; } }

export function ChatsView() {
  const { data, page, navigate, edit } = useApp();
  const [query, setQuery] = useState('');
  const [, refreshComposers] = useState(0);
  const composers = useRef(new Map());
  const index = useMemo(() => indexChatActivity(data.messages, data.runs), [data.messages, data.runs]);
  const project = visible(data.projects).find(item => item.id === page.projectId);
  const scope = { projectId: page.projectId };
  const chats = visible(data.chats).filter(item => !page.projectId || val(item, 'project_id') === project?.id)
    .toSorted((a, b) => Number(b.pinned) - Number(a.pinned) || byUpdated(a, b));
  const chat = chats.find(item => item.id === page.id);
  const create = () => edit('chat', null, project ? { project_id: project.id } : {});
  const filtered = matchingChats(chats, index.messagesByChat, query);
  useEffect(() => { setQuery(''); }, [page.projectId]);
  useEffect(() => {
    if (page.id && chat?.kind === 'rumbo-agent') navigate('rumbo-agent', chat.id, { messageId: page.messageId || null });
  }, [page.id, page.messageId, chat?.id, chat?.kind, navigate]);
  if (page.projectId && !project) return <main className="page"><Empty kind="projects" title="Project unavailable" description="This project may be archived or belong to another workspace." action="All chats" onAction={() => navigate('chats')} /></main>;
  if (page.id && !chat) return <main className="page"><Empty kind="chats" title="Conversation unavailable" description="This chat may be archived or outside this project." action="All chats" onAction={() => navigate('chats', null, scope)} /></main>;
  if (!chats.length) return <main className="page"><Empty kind="chats" title={project ? 'Start the project conversation' : 'Your conversations, connected'} description="Keep ideas, decisions, and agent work in the same conversation. Link a project to bring its context along." action="Create chat" onAction={create} secondaryAction={project ? 'Open project' : 'Explore projects'} onSecondaryAction={() => navigate('projects', project?.id || null)} /></main>;
  if (chat) return <main className="chat-single-page"><Conversation key={chat.id} chat={chat} index={index} composers={composers.current} scope={scope} onToggleList={() => navigate('chats', null, scope)} onComposerChange={() => refreshComposers(value => value + 1)} /></main>;
  const groups = query ? [['Search results', filtered]] : [['Pinned', filtered.filter(item => item.pinned)], ['Recent', filtered.filter(item => !item.pinned)]];
  return <main className="chat-overview-page"><header className="chat-overview-heading"><div><h1>Conversations</h1>{project ? <button className="chat-scope-link" onClick={() => navigate('projects', project.id)}><Folder />{project.name}</button> : <p>Your conversations and their connected work.</p>}</div><Button icon={Plus} onClick={create}>New conversation</Button></header>
    <SearchField value={query} onChange={setQuery} placeholder="Search conversations and messages…" label="Search conversations" />
    <div className="chat-overview-list">{groups.map(([label, items]) => items.length ? <section key={label}><h2>{label}</h2>{items.map(item => {
      const messages = index.messagesByChat.get(item.id) || [], last = messages.at(-1);
      const active = (index.runsByChat.get(item.id) || []).some(run => ACTIVE_CHAT_RUNS.has(run.status));
      const linked = data.projects.find(project => project.id === val(item, 'project_id'));
      return <button className="chat-overview-row" key={item.id} onClick={() => navigate(item.kind === 'rumbo-agent' ? 'rumbo-agent' : 'chats', item.id, scope)}><UiIcon icon={item.pinned ? Pin : MessageCircle} /><span><strong>{item.title}</strong><small>{last?.content || 'No messages yet'}</small><em>{linked?.name || 'Workspace conversation'}{active ? ' · Working' : ''}</em></span><time>{relative(val(item, 'updated_at'))}</time></button>;
    })}</section> : null)}{!filtered.length ? <div className="chat-list-empty"><Search /><p>No matching conversations</p><Button variant="ghost" onClick={() => setQuery('')}>Clear search</Button></div> : null}</div>
  </main>;
}

export function Conversation({ chat, index, composers, scope = {}, onComposerChange = () => {}, onToggleList, assistant }) {
  const { data, navigate, edit, archive, perform, notify } = useApp();
  const agents = visible(data.agents);
  if (!composers.has(chat.id)) {
    const draft = restoreComposer(chat, agents, draftStorage());
    if (assistant && !draft.turn && !draft.text && !draft.hasSavedPreferences) Object.assign(draft, {
      model: assistant.preferences?.model || '', reasoning: assistant.preferences?.reasoning_effort || '',
      memory: assistant.preferences?.include_memory !== false, includeChat: assistant.preferences?.include_chat !== false,
      includeWorkspace: assistant.preferences?.include_workspace !== false,
      contextPackIds: assistant.preferences?.context_pack_ids || [],
    });
    composers.set(chat.id, draft);
  }
  const composer = composers.get(chat.id);
  const [, render] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const [contextOpen, setContextOpen] = useState(false), [optionsOpen, setOptionsOpen] = useState(false), [preview, setPreview] = useState(null);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [reviewedContext, setReviewedContext] = useState(null), [retryDraft, setRetryDraft] = useState(null), [reviewedRetry, setReviewedRetry] = useState(null);
  const [retryNativeTools, setRetryNativeTools] = useState(false), [nativeActivityOpen, setNativeActivityOpen] = useState(false), [nativeRunId, setNativeRunId] = useState('');
  const [updatesDirty, setUpdatesDirty] = useState(false), [updatesPending, setUpdatesPending] = useState(false), [discardUpdates, setDiscardUpdates] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0), [commandLibraryOpen, setCommandLibraryOpen] = useState(false), [commandQuery, setCommandQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false), [search, setSearch] = useState(''), [retrying, setRetrying] = useState(null);
  const [threadId, setThreadId] = useState(null), [bookmarksOnly, setBookmarksOnly] = useState(false), [messageOptions, setMessageOptions] = useState(null);
  const [selectionMode, setSelectionMode] = useState(false), [selectedIds, setSelectedIds] = useState(() => new Set());
  const [emojiPicker, setEmojiPicker] = useState(false);
  const [reactionMessage, setReactionMessage] = useState(null), [reactionPending, setReactionPending] = useState(null), [reactionError, setReactionError] = useState(null);
  const reacting = useRef(false);
  const [composeDialog, setComposeDialog] = useState(null), [actionTitle, setActionTitle] = useState(''), [destination, setDestination] = useState('');
  const [contextSources, setContextSources] = useState([]), [contextQuery, setContextQuery] = useState(''), [collaborationError, setCollaborationError] = useState(null), [actionBusy, setActionBusy] = useState(false);
  const listRef = useRef(null), inputRef = useRef(null), fileRef = useRef(null), mounted = useRef(true), sending = useRef(false);
  const messages = index.messagesByChat.get(chat.id) || [], runs = index.runsByChat.get(chat.id) || [];
  const active = runs.find(run => ACTIVE_CHAT_RUNS.has(run.status));
  const orphan = runs.filter(run => !val(run, 'source_message_id')).at(-1);
  const task = data.tasks.find(item => item.id === val(chat, 'task_id'));
  const project = data.projects.find(item => item.id === (val(chat, 'project_id') || val(task, 'project_id')));
  const agent = agents.find(item => item.id === composer.recipient);
  const connection = data.connections.find(item => item.provider === agent?.provider && (!val(agent, 'provider_connection_id') || item.id === val(agent, 'provider_connection_id')));
  const readiness = agent ? agentReadiness(agent, connection) : null;
  const folder = val(project, 'local_path') || val(agent, 'working_directory');
  const notes = visible(data.memory_notes).filter(note => !val(note, 'project_id') || val(note, 'project_id') === project?.id);
  const collaboration = (data.chat_collaboration || []).find(item => item.chat_id === chat.id) || { version: 0, bookmarks: [], drafts: [], branch: null };
  const bookmarks = new Set(collaboration.bookmarks || []);
  const replies = useMemo(() => { const map = new Map(); for (const message of messages) if (message.metadata?.reply_to) map.set(message.metadata.reply_to, (map.get(message.metadata.reply_to) || 0) + 1); return map; }, [messages]);
  const contextChoices = [...visible(data.documents).map(item => ({ kind: 'document', id: item.id, title: item.title, project_id: val(item, 'project_id') })), ...visible(data.memory_notes).map(item => ({ kind: 'memory', id: item.id, title: item.title, project_id: val(item, 'project_id') })), ...visible(data.workspace_items || []).filter(item => item.kind === 'context_pack').map(item => ({ kind: 'pack', id: item.id, title: item.name }))];
  const blocker = composer.recipient !== 'note' && !agent ? 'This agent is no longer available. Choose another agent or save a note.' : turnBlocker({ agent, readiness, folder, activeRun: active, files: composer.files, permission: composer.permission });
  const inThread = threadMessages(messages, threadId);
  const shownMessages = inThread.filter(message => (!search.trim() || message.content?.toLowerCase().includes(search.trim().toLowerCase())) && (!bookmarksOnly || bookmarks.has(message.id)));
  const selectedMessages = messages.filter(message => selectedIds.has(message.id));
  const replyMessage = messages.find(item => item.id === composer.replyTo);
  const connectedProviders = (data.connections || []).filter(item => item.status === 'connected' || item.connected).map(item => item.provider);
  const slashVisible = composer.text.trimStart().startsWith('/') && !composer.text.trimStart().startsWith('//') && !composer.text.includes('\n');
  const slashResults = slashVisible ? searchCommands(composer.text.trimStart().slice(1), { context: 'chat' }).slice(0, 10) : [];
  const readOnlyProfile = agent?.provider === 'claude' || val(agent, 'permission_policy') === 'read-only' || data.settings?.agentDefaults?.approvalMode === 'read_only';
  const effectivePermission = composer.permission === 'conversation' || readOnlyProfile ? 'read-only' : composer.permission;
  const includeMemory = composer.memory && val(agent, 'memory_policy') !== 'none';
  const sentAttachments = composer.context ? [{ name: `rumbo-context-${composer.context.id}.md`, type: 'text/markdown', content: composer.context.content, rumbo_context_snapshot: composer.context.id }, ...composer.files] : [...composer.files];
  const assistantOptions = assistant ? { model: composer.model || '', reasoning_effort: composer.reasoning || '', include_chat: composer.includeChat !== false, include_workspace: composer.includeWorkspace !== false, context_pack_ids: composer.contextPackIds || [] } : {};
  const inspectionRequest = agent && (composer.text.trim() || composer.files.length) && !slashVisible ? {
    workspace_id: val(chat, 'workspace_id'), project_id: project?.id ?? null, task_id: task?.id ?? null,
    chat_id: chat.id, agent_id: agent.id, prompt: composer.text.trim() || 'Shared attachments',
    work_mode: composer.permission === 'conversation' ? 'conversation' : 'project', permission_mode: effectivePermission,
    include_memory: includeMemory, include_chat: true, native_tools: composer.nativeTools === true, attachments: sentAttachments, source_message_id: null,
    context_pack_ids: [], area_id: val(project, 'team_id') || val(task, 'team_id') || null,
    ...assistantOptions,
    ...(composer.permission !== 'conversation' && folder ? { cwd: folder } : {}),
  } : null;
  const inspectionKey = JSON.stringify([inspectionRequest, agent?.version ?? null]);
  const contextReady = reviewedContext?.key === inspectionKey && Date.parse(reviewedContext.result.expires_at) > Date.now();
  const recoveringTurn = Boolean(composer.turn);
  const retryAgent = retryDraft ? agents.find(item => item.id === val(retryDraft.run, 'agent_id')) : null;
  const retryRequest = retryDraft && retryAgent ? {
    workspace_id: val(chat, 'workspace_id'), project_id: project?.id ?? null, task_id: task?.id ?? null,
    chat_id: chat.id, agent_id: retryAgent.id, prompt: retryDraft.message.content.trim(),
    source_message_id: retryDraft.message.id, work_mode: val(retryDraft.run, 'work_mode') || 'project', permission_mode: 'read-only',
    ...(typeof retryDraft.message.metadata?.include_workspace === 'boolean' ? { include_workspace: retryDraft.message.metadata.include_workspace } : {}),
    ...(typeof retryDraft.message.metadata?.model === 'string' ? { model: retryDraft.message.metadata.model, reasoning_effort: retryDraft.message.metadata.reasoning_effort || '' } : {}),
    include_memory: composer.memory && val(retryAgent, 'memory_policy') !== 'none', include_chat: true, native_tools: retryNativeTools,
    attachments: [], context_pack_ids: [], area_id: val(project, 'team_id') || val(task, 'team_id') || null,
  } : null;
  const retryInspectionKey = JSON.stringify([retryRequest, retryAgent?.version ?? null]);
  const retryContextReady = reviewedRetry?.key === retryInspectionKey && Date.parse(reviewedRetry.result.expires_at) > Date.now();
  const { atBottom, scrollToEnd, setFollowing: setAtBottom } = useChatFollow(listRef, `${messages.length}:${runs.map(run => run.status).join(',')}:${search}`, data.settings?.appearance?.reduceMotion);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    function followLink() {
      const id = new URLSearchParams(location.hash.split('?')[1] || '').get('message');
      if (id && messages.some(message => message.id === id)) { setSearch(''); setBookmarksOnly(false); setThreadId(null); setAtBottom(false); requestAnimationFrame(() => document.getElementById(`message-${id}`)?.scrollIntoView({ block: 'center' })); }
    }
    followLink(); window.addEventListener('hashchange', followLink);
    return () => window.removeEventListener('hashchange', followLink);
  }, [chat.id, messages.length]);
  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.style.height = 'auto';
    inputRef.current.style.height = `${Math.min(220, Math.max(78, inputRef.current.scrollHeight))}px`;
  }, [composer.text]);
  function change(changes) {
    Object.assign(composer, changes);
    composer.version += 1;
    composer.turn = null;
    if (Object.hasOwn(changes, 'recipient')) setReviewedContext(null);
    persistComposer(chat.id, composer, draftStorage());
    setError(null);
    render(version => version + 1);
  }
  async function collaborationAction(action, body = {}) {
    setActionBusy(true); setCollaborationError(null);
    try {
      const response = await apiRequest(`/api/chat-collaboration/${encodeURIComponent(chat.id)}`, { method: 'POST', body: { workspace_id: val(chat, 'workspace_id'), version: collaboration.version, action, ...body } });
      await refreshRumbo();
      return response.result;
    } catch (cause) { setCollaborationError(cause); if (cause.status === 409) await refreshRumbo(); throw cause; }
    finally { if (mounted.current) setActionBusy(false); }
  }
  function messageReactions(id) { return reactionPending?.messageId === id ? reactionPending.values : collaboration.reactions?.[id] || []; }
  async function reactTo(message, reaction) {
    if (reacting.current || actionBusy) return;
    reacting.current = true; setReactionError(null);
    const previous = collaboration.reactions?.[message.id] || [], key = reactionKey(reaction);
    const enabled = !previous.some(item => reactionKey(item) === key);
    const values = previous.filter(item => reactionKey(item) !== key);
    if (enabled) values.push(reaction);
    setReactionPending({ messageId: message.id, values });
    try {
      await collaborationAction('reaction', { message_id: message.id, reaction_id: reaction.id, color: reaction.color, enabled });
      if (mounted.current) setReactionMessage(null);
    } catch (cause) { if (mounted.current) setReactionError(cause); }
    finally { reacting.current = false; if (mounted.current) setReactionPending(null); }
  }
  function toggleSelection(message) {
    setSelectedIds(previous => { const next = new Set(previous); if (next.has(message.id)) next.delete(message.id); else next.add(message.id); return next; });
  }
  function stopSelection() { setSelectionMode(false); setSelectedIds(new Set()); }
  function jump(id) {
    setSearch(''); setBookmarksOnly(false); setThreadId(null); setAtBottom(false);
    requestAnimationFrame(() => { const el = document.getElementById(`message-${id}`); el?.scrollIntoView({ block: 'center' }); el?.focus({ preventScroll: true }); });
  }
  function reply(message, quote = false) {
    change({ replyTo: message.id, ...(quote ? { text: `${composer.text}${composer.text ? '\n\n' : ''}${quotedMessage(message, message.selectedText || window.getSelection()?.toString() || '')}` } : {}) });
    setMessageOptions(null); inputRef.current?.focus();
  }
  async function inspectContext(id) {
    await perform(async () => { const response = await apiRequest(`/api/chat-collaboration/${encodeURIComponent(chat.id)}/snapshots/${encodeURIComponent(id)}?workspace_id=${encodeURIComponent(val(chat, 'workspace_id'))}`); setPreview({ name: 'Context snapshot', type: 'text/markdown', content: response.result.content }); });
  }
  async function queueDraft() {
    if (composer.files.length) { setError(new Error('Follow-up drafts store text and selected context. Remove file attachments before saving a draft.')); return; }
    try {
      await collaborationAction('draft', { content: composer.text, recipient: composer.recipient, permission: composer.permission, reply_to: composer.replyTo, context_snapshot_id: composer.context?.id });
      change({ text: '', replyTo: null, context: null }); notify('Follow-up saved. It will not send automatically.');
    } catch {}
  }
  async function loadDraft(draft) {
    if (composer.text || composer.files.length || composer.turn) { setError(new Error('Save or clear the current composer before loading a follow-up draft.')); return; }
    try {
      let context = null;
      if (draft.context_snapshot_id) context = (await apiRequest(`/api/chat-collaboration/${encodeURIComponent(chat.id)}/snapshots/${encodeURIComponent(draft.context_snapshot_id)}?workspace_id=${encodeURIComponent(val(chat, 'workspace_id'))}`)).result;
      change({ text: draft.content, recipient: draft.recipient, permission: draft.permission, replyTo: draft.reply_to || null, context });
      notify('Draft loaded. Review it, then send explicitly.'); inputRef.current?.focus();
    } catch (cause) { setError(cause); }
  }
  async function attach(event) {
    const files = [...event.target.files];
    event.target.value = '';
    try {
      const next = await Promise.all(files.map(async file => {
        if (file.size > 350_000) throw new Error(`${file.name} is too large. Choose a file under 350 KB.`);
        let content;
        if (/^image\/(png|jpeg|gif|webp)$/.test(file.type)) content = await new Promise((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('The file could not be read.')); reader.readAsDataURL(file);
        });
        else if (file.type.startsWith('text/') || /\.(txt|md|json|js|jsx|ts|tsx|css|html|csv|py|rs|go|yaml|yml|xml|sql|sh)$/i.test(file.name)) content = await file.text();
        else throw new Error('Choose a text file, code file, or PNG, JPEG, WebP, or GIF image.');
        return { name: file.name, type: file.type || 'text/plain', size: file.size, content };
      }));
      const combined = [...composer.files, ...next];
      if (new TextEncoder().encode(JSON.stringify(combined)).length > 650_000) throw new Error('These attachments are too large together. Send them separately.');
      Object.assign(composer, { files: combined, turn: null, version: composer.version + 1 });
      persistComposer(chat.id, composer, draftStorage());
      if (mounted.current) { render(version => version + 1); setError(null); }
    } catch (cause) { if (mounted.current) setError(cause); else notify(cause.message, 'error'); }
  }
  async function send(event) {
    event.preventDefault();
    if (sending.current || composer.sending || (!composer.text.trim() && !composer.files.length)) return;
    const slash = parseSlashCommand(composer.text);
    if (slash) {
      if (slash.type === 'unknown') { setError(new Error(`Unknown command /${slash.name}. Use /help to search Rumbo commands.`)); return; }
      if (slash.error) { setError(new Error(slash.error)); return; }
      await executeSlashCommand(slash.command, slash.argv, { submitted: true });
      return;
    }
    if (blocker) { setError(new Error(blocker)); return; }
    if (composer.context && composer.files.length >= 20) { setError(new Error('The context snapshot uses one attachment slot. Remove a file before sending.')); return; }
    if (agent && !recoveringTurn && !contextReady) { setError(new Error('Inspect the current context and choose Use this context before sending to an agent.')); return; }
    sending.current = true; composer.sending = true; setBusy(true); setError(null);
    const text = composer.text.trim() || 'Shared attachments', files = [...composer.files], version = composer.version;
    const context = composer.context;
    const sentFiles = sentAttachments;
    const metadata = { reply_to: composer.replyTo || undefined, context_snapshot_id: context?.id };
    const recipient = composer.recipient;
    if (recipient !== 'note' && !composer.turn) composer.turn = crypto.randomUUID();
    persistComposer(chat.id, composer, draftStorage());
    try {
      const response = recipient === 'note' ? await rumboActions.createMessage(chat.id, {
        content: text, sender_type: 'user', sender_id: 'local', sender_name: data.profile?.name || 'You', attachments: sentFiles, metadata: { delivery: 'note', ...metadata },
      }) : await rumboActions.sendChatTurn(chat.id, {
        content: text, attachments: sentFiles, agent_id: recipient, client_turn_id: composer.turn, ...metadata,
        work_mode: composer.permission === 'conversation' ? 'conversation' : 'project', permission_mode: effectivePermission, include_memory: includeMemory, include_chat: true, native_tools: composer.nativeTools === true,
        ...(contextReady ? { context_inspection_id: reviewedContext.result.id } : {}), context_pack_ids: [], area_id: inspectionRequest?.area_id ?? null,
        ...assistantOptions,
        ...(composer.permission !== 'conversation' && folder ? { cwd: folder } : {}),
      });
      if (composer.version === version) { composer.text = ''; composer.version += 1; composer.turn = null; composer.replyTo = null; composer.context = null; }
      composer.nativeTools = false;
      composer.files = composer.files.filter(file => !files.includes(file));
      persistComposer(chat.id, composer, draftStorage());
      const result = response?.result || response;
      if (result?.error) notify(`Message saved. ${result.error.message}`, 'error');
      if (mounted.current) { setReviewedContext(null); render(value => value + 1); setAtBottom(true); inputRef.current?.focus(); }
    } catch (cause) {
      // Keep the same turn key on retries after an uncertain network result.
      if (cause.status && cause.status < 500) { composer.turn = null; persistComposer(chat.id, composer, draftStorage()); }
      if (mounted.current) { setError(cause); if (cause.status && cause.status < 500) setReviewedContext(null); }
      else notify(`Could not confirm delivery in ${chat.title}: ${cause.message}`, 'error');
    } finally { sending.current = false; composer.sending = false; onComposerChange(); if (mounted.current) setBusy(false); }
  }

  async function executeSlashCommand(command, argv = [], { submitted = false } = {}) {
    const args = argv.join(' ').trim();
    const findAgent = value => agents.find(item => [item.name, item.provider, item.id].some(candidate => String(candidate || '').toLowerCase() === value.toLowerCase()));
    setError(null);
    if (command.id === 'rumbo') {
      prepareRumboAgentEntry({ workspaceId: val(chat, 'workspace_id'), source: task ? { type: 'task', id: task.id } : project ? { type: 'project', id: project.id } : null, instruction: args });
      navigate('rumbo-agent');
      return;
    }
    if (command.startsAgent) {
      const providerAgent = command.connection ? agents.find(item => item.provider === command.connection) : null;
      const namedAgent = argv[0] ? findAgent(argv[0]) : null;
      const selected = namedAgent || providerAgent || agent;
      if (!selected) { setError(new Error(`Choose an agent before preparing ${command.command}.`)); return; }
      const instruction = namedAgent ? argv.slice(1).join(' ') : args;
      change({
        recipient: selected.id,
        permission: command.write && selected.provider === 'codex' && folder ? 'workspace-write' : command.write && folder ? 'read-only' : 'conversation',
        text: instruction || command.description,
      });
      notify(`${command.command} prepared for ${selected.name}. Review the message and access level before sending.`);
      inputRef.current?.focus();
      return;
    }
    if (!CHAT_COMMANDS.includes(command.id)) {
      if (command.connection) {
        notify(`${command.command} is registered for ${command.connection}, but its external executor is not available yet.`, 'error');
        navigate('connections');
      } else if (submitted) setError(new Error(`${command.command} is in Rumbo’s command catalog, but it is not executable in chat yet.`));
      else change({ text: `${command.command} ` });
      return;
    }
    if (command.id === 'help') { setCommandQuery(args); setCommandLibraryOpen(true); return; }
    if (command.id === 'agent') {
      if (!args) { change({ text: '/agent ' }); return; }
      const selected = findAgent(args);
      if (!selected) { setError(new Error(`No agent named “${args}” is available in this workspace.`)); return; }
      change({ recipient: selected.id, permission: 'conversation', text: '' }); notify(`${selected.name} selected for the next message.`); return;
    }
    if (command.id === 'ask') {
      const selected = argv[0] ? findAgent(argv[0]) : null;
      const instruction = selected ? argv.slice(1).join(' ') : args;
      if (selected) change({ recipient: selected.id, permission: 'conversation', text: instruction });
      else change({ text: instruction });
      inputRef.current?.focus(); return;
    }
    if (command.id === 'reply') {
      if (!threadId && !composer.replyTo) setError(new Error('Choose Reply on a message first, then use /reply in that thread.'));
      else change({ text: args });
      return;
    }
    if (command.id === 'update') { change({ text: `${args ? `${args[0].toUpperCase()}${args.slice(1)} update` : 'Progress update'}\n\n` }); inputRef.current?.focus(); return; }
    if (['summarize', 'translate', 'format'].includes(command.id)) { change({ text: `${command.description}${args ? `\n\n${args}` : ''}` }); inputRef.current?.focus(); return; }
    if (command.id === 'context' || command.id === 'sources') { setContextOpen(true); return; }
    if (command.id === 'remember') { edit('memory', null, { title: project ? `${project.name} memory` : 'Workspace memory', content: args, project_id: project?.id }); return; }
    if (command.id === 'attach') { fileRef.current?.click(); return; }
    if (command.id === 'clear') { change({ text: '', files: [], replyTo: null, context: null }); return; }
    if (command.id === 'chat.new') { edit('chat', null, project ? { project_id: project.id } : {}); return; }
    if (command.id === 'route.new') { edit('task', null, { title: args || undefined, description: args || undefined, project_id: project?.id }); return; }
    if (command.id === 'request.new') { navigate('settings', 'requests'); return; }
    if (command.id === 'project.new') { edit('project', null, { name: args || undefined }); return; }
    if (command.id === 'document.new') { navigate('documents'); return; }
    if (command.id === 'inbox') { navigate('inbox'); return; }
    if (command.id === 'focus') { navigate('focus'); return; }
    if (command.id === 'workbench') { navigate('workbench', project?.id || null, project ? { projectId: project.id } : {}); return; }
    if (command.id === 'connections') { navigate('connections'); return; }
    if (command.id === 'settings') { navigate('settings', args || null); return; }
    if (command.id === 'runs') { navigate('work'); return; }
    if (command.id === 'permissions') { setContextOpen(true); return; }
    if (command.id === 'chat.export') { exportChat(); return; }
    if (['status', 'priority', 'due', 'route.block'].includes(command.id)) {
      if (!task) { setError(new Error(`${command.command} needs a Route-linked conversation.`)); return; }
      const patch = command.id === 'route.block' ? { status: 'blocked' } : command.id === 'status' ? { status: args } : command.id === 'priority' ? { priority: args } : { due_at: args || null };
      if (command.id !== 'route.block' && !args) { setError(new Error(`Add a value after ${command.command}.`)); return; }
      await perform(() => rumboActions.updateTask(task.id, patch), `${task.title} updated.`);
      change({ text: '' }); return;
    }
  }

  function selectSlash(command) {
    const parsed = parseSlashCommand(composer.text);
    const exact = parsed?.type === 'command' && parsed.command.id === command.id;
    if (!exact && command.usage.includes('[')) { change({ text: `${command.command} ` }); inputRef.current?.focus(); return; }
    executeSlashCommand(command, exact ? parsed.argv : []);
  }
  function retry(message, run) {
    if (retrying || active) return;
    setRetryDraft({ message, run }); setRetryNativeTools(Boolean(composer.retryKeys[message.id]) && composer.retryNativeTools?.[message.id] === true); setReviewedRetry(null); setError(null);
  }
  async function retryReviewed() {
    if (!retryDraft || !retryContextReady) { setError(new Error('Inspect and use the regenerated context before retrying.')); return; }
    const { message, run } = retryDraft;
    if (retrying || active) return;
    setRetrying(run.id); setError(null);
    composer.retryKeys[message.id] ||= crypto.randomUUID();
    composer.retryNativeTools ||= {}; composer.retryNativeTools[message.id] = retryRequest.native_tools;
    persistComposer(chat.id, composer, draftStorage());
    try {
const response = await rumboActions.sendChatTurn(chat.id, { agent_id: val(run, 'agent_id'), source_message_id: message.id, client_turn_id: composer.retryKeys[message.id], work_mode: val(run, 'work_mode') || 'project', permission_mode: 'read-only', include_memory: retryRequest.include_memory, include_chat: true, ...(typeof retryRequest.include_workspace === 'boolean' ? { include_workspace: retryRequest.include_workspace } : {}), native_tools: retryRequest.native_tools, context_inspection_id: reviewedRetry.result.id, ...(typeof message.metadata?.model === 'string' ? { model: message.metadata.model, reasoning_effort: message.metadata.reasoning_effort || '' } : {}), context_pack_ids: [], area_id: retryRequest.area_id });
      delete composer.retryKeys[message.id];
      delete composer.retryNativeTools[message.id];
      persistComposer(chat.id, composer, draftStorage());
      if (response?.error) notify(response.error.message, 'error');
      if (mounted.current) { setRetryDraft(null); setReviewedRetry(null); }
    } catch (cause) { if (cause.status && cause.status < 500) { delete composer.retryKeys[message.id]; delete composer.retryNativeTools[message.id]; persistComposer(chat.id, composer, draftStorage()); } if (mounted.current) setError(cause); }
    finally { if (mounted.current) setRetrying(null); }
  }
  function exportChat() { download(`${chat.title.replace(/[^a-z0-9]+/gi, '-') || 'conversation'}.md`, chatMarkdown(chat, messages), 'text/markdown'); setOptionsOpen(false); notify('Chat exported'); }
  async function submitAction(event) {
    event.preventDefault();
    try {
      if (composeDialog.type === 'move') {
        await collaborationAction('move', { project_id: destination || null, confirmed: true });
        change({ context: null, memory: false, permission: 'conversation', turn: null });
        navigate('chats', chat.id); notify('Conversation moved. Review the new context before sending.');
      } else if (composeDialog.type === 'output') {
        setActionBusy(true);
        await apiRequest('/api/workflow/outputs', { method: 'POST', body: { workspace_id: val(chat, 'workspace_id'), project_id: destination || null, chat_id: chat.id, source_message_id: composeDialog.message.id, title: actionTitle, content: composeDialog.message.content, kind: 'document', author_name: val(composeDialog.message, 'sender_name') || 'You' } });
        await refreshRumbo(); notify('Output created in Library. Review its exact version there.');
      } else {
        const result = await collaborationAction(composeDialog.type, { message_id: composeDialog.message.id, title: actionTitle, project_id: destination || undefined });
        if (composeDialog.type === 'branch') { navigate('chats', result.chat_id); notify('Branch created from reference messages. No agent was started.'); }
        else { navigate('projects', result.project_id); notify('Project document created with its source link.'); }
      }
      setComposeDialog(null);
    } catch (cause) { setCollaborationError(cause); }
    finally { setActionBusy(false); }
  }
  function openAction(type, message) {
    setMessageOptions(null); setOptionsOpen(false); setCollaborationError(null);
    setActionTitle(type === 'branch' ? `${chat.title} · branch`.slice(0, 160) : message?.content?.split('\n').find(Boolean)?.replace(/^#+\s*/, '').slice(0, 100) || chat.title);
    setDestination(project?.id || ''); setComposeDialog({ type, message });
  }
  return <section className="chat-thread" aria-label={chat.title} onKeyDown={event => { if (selectionMode && event.key === 'Escape' && !event.defaultPrevented && !event.target.closest('[role="dialog"]')) { event.preventDefault(); stopSelection(); } }}>
    {assistant ? assistant.header : <header className="chat-thread-header">
      <IconButton label="All conversations" onClick={onToggleList}><ArrowLeft /></IconButton>
      <div className="chat-thread-title"><h2>{chat.title}</h2><div>{project ? <button onClick={() => navigate('projects', project.id)}><Folder />{project.name}</button> : <span>Workspace conversation</span>}{task ? <><span>/</span><button onClick={() => navigate('tasks', task.id)}>{task.title}</button></> : null}</div></div>
      <div className="chat-thread-tools"><IconButton label={searchOpen ? 'Close message search' : 'Search messages'} onClick={() => { setSearchOpen(!searchOpen); setSearch(''); }} aria-pressed={searchOpen}><Search morphTo={searchOpen ? X : Search} /></IconButton><Button icon={PanelLeft} onClick={() => setContextOpen(true)}>Context</Button><IconButton label="Conversation options" onClick={() => setOptionsOpen(true)}><Ellipsis /></IconButton></div>
    </header>}
    <div className="chat-thread-navigation"><button className={!bookmarksOnly && !threadId ? 'selected' : ''} onClick={() => { setBookmarksOnly(false); setThreadId(null); }}>Conversation</button><button className={bookmarksOnly ? 'selected' : ''} onClick={() => { setBookmarksOnly(!bookmarksOnly); setThreadId(null); }}><Pin />Bookmarks{bookmarks.size ? ` · ${bookmarks.size}` : ''}</button><button aria-haspopup="dialog" onClick={() => { setNativeRunId(active?.id || runs.filter(run => run.mode === 'live').at(-1)?.id || ''); setNativeActivityOpen(true); }}>Native tools</button><button aria-haspopup="dialog" onClick={() => setUpdatesOpen(true)}><MessageCircle />Updates</button>{collaboration.drafts.length ? <button onClick={() => setComposeDialog({ type: 'drafts' })}><Clock />Follow-ups · {collaboration.drafts.length}</button> : null}{collaboration.branch ? <span><GitFork />Branched reference</span> : null}</div>
    {threadId ? <div className="chat-thread-banner"><MessageCircle /><span>Thread · {inThread.length - 1} replies</span><button onClick={() => { setThreadId(null); change({ replyTo: null }); }}>Back to conversation</button></div> : null}
    {searchOpen ? <div className="chat-message-search"><SearchField label="Search messages in conversation" placeholder="Find a message…" value={search} onChange={setSearch} /><span>{search ? `${shownMessages.length} results` : 'Search this conversation'}</span></div> : null}
    {selectionMode ? <div className="chat-selection-bar" role="region" aria-label="Selected messages"><strong aria-live="polite">{selectedMessages.length} selected</strong><button onClick={() => setSelectedIds(new Set(shownMessages.map(message => message.id)))}>Select visible</button><Button variant="ghost" icon={Copy} disabled={!selectedMessages.length} onClick={() => perform(async () => { await navigator.clipboard.writeText(chatMarkdown(chat, selectedMessages)); notify(`${selectedMessages.length} messages copied`); })}>Copy</Button><Button variant="ghost" icon={Download} disabled={!selectedMessages.length} onClick={() => { download('selected-messages.md', chatMarkdown(chat, selectedMessages), 'text/markdown'); notify('Selected messages exported'); }}>Export</Button><IconButton label="Cancel message selection" onClick={stopSelection}><X /></IconButton></div> : null}
    <div className="chat-thread-messages" ref={listRef} tabIndex={0} aria-label="Chat messages">
      {shownMessages.length ? <div className="chat-message-flow">{shownMessages.map(message => <ChatMessage key={message.id} message={message} chat={chat} project={project} run={index.runsByMessage.get(message.id)} onRetry={index.runsByMessage.has(message.id) ? () => retry(message, index.runsByMessage.get(message.id)) : undefined} retrying={retrying === index.runsByMessage.get(message.id)?.id} onPreview={setPreview} bookmarked={bookmarks.has(message.id)} onBookmark={() => perform(() => collaborationAction('bookmark', { message_id: message.id, enabled: !bookmarks.has(message.id) }))} onReply={() => reply(message)} onOptions={() => setMessageOptions(message)} replyMessage={messages.find(item => item.id === message.metadata?.reply_to)} onJump={jump} replyCount={replies.get(message.id) || 0} onThread={() => { setThreadId(message.id); setBookmarksOnly(false); setSearch(''); reply(message); }} onContext={() => inspectContext(message.metadata.context_snapshot_id)} selectionMode={selectionMode} selected={selectedIds.has(message.id)} onSelect={() => toggleSelection(message)} reactions={messageReactions(message.id)} reactionBusy={Boolean(reactionPending) || actionBusy} onReact={() => { setReactionError(null); setReactionMessage(message); }} onToggleReaction={reaction => reactTo(message, reaction)} />)}
        {orphan && !search ? <ChatRunStatus run={orphan} /> : null}
      </div> : <Empty compact kind={search || bookmarksOnly ? 'search' : 'chats'} title={bookmarksOnly ? 'Keep important messages close' : search ? 'No matching messages' : 'A shared place to think'} description={bookmarksOnly ? 'Bookmark a decision or useful answer from its message actions.' : search ? 'Try another word or clear the search.' : 'Ask a connected agent to work, or save a note for later. Your project and route stay linked here.'} action={search ? 'Clear search' : undefined} onAction={() => setSearch('')} />}
    </div>
    {!atBottom && messages.length > 2 ? <div className="chat-jump"><Button icon={ArrowDown} onClick={scrollToEnd}>Latest messages</Button></div> : null}
    <div className="chat-compose-area">
      <Form className="chat-compose" onSubmit={send}>
        <ErrorMessage error={error} />
        {!composeDialog && !contextOpen ? <ErrorMessage error={collaborationError} /> : null}
        {replyMessage ? <div className="chat-composer-reply"><MessageCircle /><span>Replying to {val(replyMessage, 'sender_name')}<small>{replyMessage.content.slice(0, 150)}</small></span><IconButton label="Cancel reply" onClick={() => change({ replyTo: null })}><X /></IconButton></div> : null}
        {composer.context ? <div className="chat-context-tray"><FileText /><button type="button" onClick={() => setPreview({ name: 'Selected context snapshot', content: composer.context.content, type: 'text/markdown' })}>{composer.context.sources?.length || 0} sources · inspect exact snapshot</button><IconButton label="Remove selected context" onClick={() => change({ context: null })}><X /></IconButton></div> : null}
        {composer.files.length ? <div className="chat-compose-files">{composer.files.map((file, index) => <span key={`${file.name}-${index}`}><Paperclip /><button type="button" onClick={() => setPreview(file)}>{file.name}</button><IconButton label={`Remove ${file.name}`} onClick={() => change({ files: composer.files.filter((_, i) => i !== index) })}><X /></IconButton></span>)}</div> : null}
        <SlashCommandMenu text={composer.text} context="chat" activeIndex={slashIndex} onActiveIndexChange={setSlashIndex} onSelect={selectSlash} executableCommandIds={CHAT_COMMANDS} connections={connectedProviders} />
        <textarea ref={inputRef} aria-label="Message" value={composer.text} maxLength={100000} placeholder={agent ? `Ask ${agent.name}…` : 'Write a note or type / for commands…'} onChange={event => { setSlashIndex(0); change({ text: event.target.value }); }} onKeyDown={event => {
          if (slashVisible && slashResults.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setSlashIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + slashResults.length) % slashResults.length); return; }
          if (slashVisible && event.key === 'Escape') { event.preventDefault(); change({ text: `/${composer.text.trimStart()}` }); return; }
          if (slashVisible && slashResults.length && (event.key === 'Tab' || event.key === 'Enter') && !event.shiftKey && !event.metaKey && !event.ctrlKey) { event.preventDefault(); selectSlash(slashResults[Math.min(slashIndex, slashResults.length - 1)]); return; }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && (data.settings?.preferences?.sendKey !== 'modifier' || event.metaKey || event.ctrlKey)) { event.preventDefault(); if (!busy) event.currentTarget.form.requestSubmit(); }
        }} />
        {agent ? <details><summary>{assistant ? 'Review context' : 'Context review'} · {contextReady ? 'ready' : recoveringTurn ? 'delivery recovery' : 'required'}</summary><div className="chat-context-content" style={{ maxHeight: 'min(45vh, 420px)', overflowY: 'auto' }}><NativeToolsChoice checked={composer.nativeTools === true} disabled={busy || composer.sending || recoveringTurn} onChange={value => { change({ nativeTools: value }); setReviewedContext(null); }} /><ContextInspector key={`chat-context:${chat.id}:${agent.id}:${agent.version ?? 0}`} request={inspectionRequest} onReviewed={result => setReviewedContext({ key: inspectionKey, result })} onInvalidated={() => setReviewedContext(null)} />{recoveringTurn ? <p>An earlier delivery is unconfirmed. Resending keeps the same turn ID to recover it without duplicating work. If the server never received it, context is regenerated. Inspect again to require a newly reviewed context.</p> : null}</div></details> : null}
        <div className="chat-compose-controls"><div className="chat-compose-target">
          {assistant ? assistant.renderControls?.({ composer, change, agent, blocked: busy || composer.sending || Boolean(composer.turn) || Boolean(active) }) : <Select aria-label="Message recipient" value={composer.recipient} onChange={value => change({ recipient: value, permission: 'conversation' })}><option value="note">Note · only saved here</option>{agents.map(item => <option key={item.id} value={item.id}>{item.name}{agentReadiness(item, data.connections.find(c => c.provider === item.provider && (!val(item, 'provider_connection_id') || c.id === val(item, 'provider_connection_id')))).canStartLive ? '' : ' · Not ready'}</option>)}</Select>}
          {agent ? <Select aria-label="Agent access" value={composer.permission === 'conversation' ? 'conversation' : effectivePermission} onChange={value => change({ permission: value })}><option value="conversation">Discuss · no folder needed</option><option value="read-only">Inspect project · read only</option>{agent.provider === 'codex' && !readOnlyProfile ? <option value="workspace-write">Execute · project coding</option> : null}</Select> : null}
          <input ref={fileRef} type="file" hidden multiple onChange={attach} accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.json,.js,.jsx,.ts,.tsx,.css,.html,.csv,.py,.rs,.go,.yaml,.yml,.sql,.xml,.sh" />
          {!assistant ? <IconButton label="Insert emoji" onClick={() => setEmojiPicker(true)}><span aria-hidden="true">☺</span></IconButton> : null}
          <IconButton label="Attach files" onClick={() => fileRef.current?.click()}><Paperclip /></IconButton>
          <IconButton label="Select context sources" onClick={() => setContextOpen(true)}><BookOpen /></IconButton>
          {!assistant ? <IconButton label="Save follow-up draft without sending" disabled={!composer.text.trim() || busy || actionBusy || Boolean(composer.turn)} onClick={queueDraft}><Clock /></IconButton> : null}
        </div><Button type="submit" variant="primary" icon={ArrowUp} busy={busy || composer.sending} disabled={(!composer.text.trim() && !composer.files.length) || Boolean(blocker) || Boolean(agent && !slashVisible && !recoveringTurn && !contextReady)} aria-label={agent ? `Send to ${agent.name}` : 'Save note'}>{agent ? effectivePermission === 'workspace-write' ? 'Start work' : recoveringTurn ? 'Retry delivery' : 'Send' : 'Save note'}</Button></div>
      </Form>
      {blocker ? <div className="chat-compose-notice"><Info /><p>{blocker}</p>{agent && !readiness?.canStartLive ? <button onClick={() => navigate(readiness?.action === 'connect' ? 'connections' : 'agents', readiness?.action === 'connect' ? null : agent.id)}>Review setup</button> : !folder && agent ? <button onClick={() => project ? edit('project', project) : edit('agent', agent)}>Set folder</button> : null}</div> : assistant ? null : <div className="chat-compose-caption"><span>{agent ? contextReady ? 'Context reviewed. Sending is a separate action.' : recoveringTurn ? 'Unconfirmed delivery · keep the same turn ID when retrying.' : 'Open Context review, inspect, and use the context before sending.' : 'Notes stay in this conversation. No agent is contacted.'}</span><span>{data.settings?.preferences?.sendKey === 'modifier' ? 'Cmd / Ctrl + Enter' : 'Enter'} to send · Shift + Enter for a new line</span></div>}
    </div>
    {retryDraft ? <Dialog title="Review retry context" subtitle="Retrying creates a new bounded attempt. Context is regenerated from current accessible sources; the original message stays unchanged." wide onClose={() => { if (!retrying) { setRetryDraft(null); setReviewedRetry(null); } }}><div className="dialog-body chat-context-content"><ErrorMessage error={error} /><NativeToolsChoice checked={retryNativeTools} disabled={Boolean(retrying) || Boolean(composer.retryKeys[retryDraft.message.id])} onChange={value => { setRetryNativeTools(value); setReviewedRetry(null); }} />{composer.retryKeys[retryDraft.message.id] ? <p>An earlier retry delivery is unconfirmed. Its native-tool choice stays fixed while recovering the same turn.</p> : null}{retryAgent ? <ContextInspector key={`retry-context:${retryDraft.message.id}:${retryAgent.version ?? 0}`} request={retryRequest} onReviewed={result => setReviewedRetry({ key: retryInspectionKey, result })} onInvalidated={() => setReviewedRetry(null)} /> : <p>This message’s agent is unavailable. Restore or configure the profile before retrying.</p>}</div><footer className="dialog-footer"><Button disabled={Boolean(retrying)} onClick={() => { setRetryDraft(null); setReviewedRetry(null); }}>Cancel</Button><Button variant="primary" busy={Boolean(retrying)} disabled={!retryContextReady || Boolean(active)} onClick={retryReviewed}>Retry message</Button></footer></Dialog> : null}
    {updatesOpen ? <Dialog title="Conversation updates" subtitle="Progress and decisions about this conversation. Updates are separate from chat messages and never contact an agent." wide onClose={() => { if (updatesPending) notify('Resolve the pending update request before closing.'); else if (updatesDirty) setDiscardUpdates(true); else setUpdatesOpen(false); }}><div className="dialog-body" style={{ padding: 'clamp(12px, 3vw, 24px)' }}><Suspense fallback={<p role="status">Opening conversation updates…</p>}><ActivityFeed key={chat.id} workspaceId={val(chat, 'workspace_id')} targetType="chat" targetId={chat.id} onDirtyChange={setUpdatesDirty} onPendingChange={setUpdatesPending} /></Suspense></div></Dialog> : null}
    {nativeActivityOpen ? <Dialog title="Conversation native tools" subtitle="Choose one recorded run. Reading tool records or reviewing a proposal never launches an agent." wide onClose={() => setNativeActivityOpen(false)}><div className="native-tool-decision"><Select label="Recorded conversation run" value={nativeRunId} onChange={setNativeRunId}><option value="">Choose run…</option>{runs.filter(run => run.mode === 'live').map(run => <option key={run.id} value={run.id}>{run.title || run.id} · {run.status} · {relative(run.created_at)}</option>)}</Select>{nativeRunId && runs.some(run => run.id === nativeRunId && run.mode === 'live') ? <NativeToolActivity key={nativeRunId} runId={nativeRunId} /> : <p>No run selected. Simulations do not invoke native tools.</p>}</div></Dialog> : null}
    {discardUpdates ? <Dialog title="Discard this update draft?" onClose={() => setDiscardUpdates(false)}><div className="dialog-body" style={{ padding: 24 }}><p>This unsaved text will be lost. Published updates and saved drafts stay unchanged.</p><div className="form-submit-row"><Button onClick={() => setDiscardUpdates(false)}>Keep editing</Button><Button variant="danger" onClick={() => { setDiscardUpdates(false); setUpdatesDirty(false); setUpdatesOpen(false); }}>Discard draft</Button></div></div></Dialog> : null}
    {contextOpen ? <Dialog title="Chat context" subtitle="Know what travels with this conversation." className="chat-context-dialog" onClose={() => setContextOpen(false)}><div className="dialog-body chat-context-content">
      <ErrorMessage error={collaborationError} />
      <AgentMemoryPanel workspaceId={val(chat, 'workspace_id')} agentId={agent?.id} projectId={project?.id} />
      <section><h3>Selected sources</h3><p>Choose documents, memory, or a context pack. Rumbo saves an immutable text snapshot and includes it as a text attachment only when you explicitly send. Selecting sources never contacts an agent.</p><SearchField label="Filter context sources" placeholder="Find documents, memory, or packs…" value={contextQuery} onChange={setContextQuery} /><div className="chat-source-list">{contextChoices.filter(item => item.title.toLowerCase().includes(contextQuery.toLowerCase())).map(item => {
        const key = `${item.kind}:${item.id}`, selected = contextSources.some(source => `${source.kind}:${source.id}` === key);
        return <label key={key}><input type="checkbox" checked={selected} onChange={() => setContextSources(values => selected ? values.filter(source => `${source.kind}:${source.id}` !== key) : [...values, { kind: item.kind, id: item.id }])} /><span>{item.title}<small>{item.kind === 'pack' ? 'Context pack' : item.kind === 'memory' ? 'Memory note' : 'Document'}{item.project_id && item.project_id !== project?.id ? ' · another project in this workspace' : ''}</small></span></label>;
      })}{!contextChoices.length ? <p>No sources yet. Add a project document, memory note, or context pack to select it here.</p> : null}</div><Button disabled={!contextSources.length} busy={actionBusy} onClick={async () => { try { const context = await collaborationAction('context', { sources: contextSources }); change({ context }); setContextOpen(false); notify('Context snapshot attached to the composer. Review it before sending.'); } catch {} }}>Snapshot {contextSources.length || 'selected'} sources</Button></section>
      <section><h3>Connected work</h3>{project ? <button className="chat-context-link" onClick={() => { setContextOpen(false); navigate('projects', project.id); }}><Folder />{project.name}</button> : <p>No project linked.</p>}{task ? <button className="chat-context-link" onClick={() => navigate('tasks', task.id)}><GitBranch />{task.title}</button> : null}<Button icon={Pencil} onClick={() => { setContextOpen(false); edit('chat', chat); }}>Edit chat details</Button></section>
      <ReviewPanel targetType="chat" targetId={chat.id} projectId={project?.id} />
      <section><h3>Agents in this chat</h3>{agents.filter(item => (val(chat, 'participant_agent_ids') || []).includes(item.id)).map(item => <button className="chat-context-link" key={item.id} onClick={() => navigate('agents', item.id)}><ProviderIcon provider={item.provider} />{item.name}</button>)}<p>The composer chooses who receives each message. Other agents are not contacted automatically.</p></section>
      <section><h3>Working folder · optional for chat</h3><p className="chat-folder">{folder || 'No folder linked. General chat works without one.'}</p><p>Choose project access in the composer to inspect or code in project files. That mode requires a linked folder; General chat only uses the context you send.</p>{agent || project ? <Button icon={Folder} onClick={() => { setContextOpen(false); project ? edit('project', project) : edit('agent', agent); }}>{folder ? 'Change folder' : 'Link folder for project work'}</Button> : null}</section>
      <section><Toggle label="Include saved memory" description={val(agent, 'memory_policy') === 'none' ? 'This profile excludes saved memory.' : 'Eligible notes can be included; inspect the exact selection and any limits before sending.'} checked={includeMemory} disabled={val(agent, 'memory_policy') === 'none'} onChange={value => change({ memory: value })} />{notes.map(note => <button className="chat-context-link" key={note.id} onClick={() => { setContextOpen(false); edit('memory', note); }}><BookOpen />{note.title}</button>)}</section>
      <section><h3>Attachments</h3><p>Text and code files can be sent to agents: up to 20 files, 100,000 characters each. Agent context uses at most 16 KB per file and 32 KB total. Full files remain saved here. Images are stored in notes only; they are not sent to CLI providers.</p></section>
    </div><footer className="dialog-footer"><Button onClick={() => setContextOpen(false)}>Done</Button></footer></Dialog> : null}
    {commandLibraryOpen ? <Dialog title="Rumbo commands" subtitle="Search the full command language. Catalog-only commands are visible without pretending their executor exists." wide onClose={() => setCommandLibraryOpen(false)}><CommandLibrary context="chat" query={commandQuery} onQueryChange={setCommandQuery} executableCommandIds={CHAT_COMMANDS} connections={connectedProviders} onChoose={command => { setCommandLibraryOpen(false); selectSlash(command); }} /></Dialog> : null}
    {optionsOpen ? <Dialog title="Conversation options" onClose={() => setOptionsOpen(false)}><div className="dialog-body chat-options">
      <Button icon={Pencil} onClick={() => { setOptionsOpen(false); edit('chat', chat); }}>Edit conversation details</Button>
      <Button icon={Folder} onClick={() => openAction('move')}>Move to another project</Button>
      <Button icon={chat.pinned ? PinOff : Pin} onClick={() => perform(async () => { await rumboActions.updateChat(chat.id, { pinned: !chat.pinned }); setOptionsOpen(false); }, chat.pinned ? 'Chat unpinned' : 'Chat pinned')}>{chat.pinned ? 'Unpin conversation' : 'Pin conversation'}</Button>
      <Button icon={Download} onClick={exportChat}>Export as Markdown</Button>
      <Button icon={Archive} onClick={() => { setOptionsOpen(false); archive('chat', chat); }}>Archive conversation</Button>
    </div></Dialog> : null}
    {messageOptions ? <Dialog title="Message actions" subtitle="Keep decisions connected to the work they inform." onClose={() => setMessageOptions(null)}><div className="dialog-body chat-options">
      <Button icon={Check} onClick={() => { setSelectionMode(true); setSelectedIds(previous => new Set([...previous, messageOptions.id])); setMessageOptions(null); }}>Select message</Button>
      <Button icon={Plus} onClick={() => { setReactionMessage(messageOptions); setReactionError(null); setMessageOptions(null); }}>React to message</Button>
      <Button icon={MessageCircle} onClick={() => reply(messageOptions)}>Reply to message</Button>
      <Button icon={Pencil} onClick={() => reply(messageOptions, true)}>Quote in composer</Button>
      <Button icon={Link} onClick={() => perform(async () => { await navigator.clipboard.writeText(messageLink(chat.id, messageOptions.id, `${location.origin}${location.pathname}`)); notify('Message link copied'); setMessageOptions(null); })}>Copy message link</Button>
      <Button icon={GitFork} onClick={() => openAction('branch', messageOptions)}>Branch conversation from here</Button>
      <Button icon={FileText} onClick={() => openAction('output', messageOptions)}>Save as an output</Button>
      <Button icon={BookOpen} onClick={() => openAction('document', messageOptions)}>Create project document</Button>
      <Button icon={GitBranch} onClick={() => { edit('task', null, { title: messageOptions.content.slice(0, 90), description: `${messageOptions.content}\n\nSource: ${messageLink(chat.id, messageOptions.id)}`, project_id: project?.id }); setMessageOptions(null); }}>Create route from message</Button>
      <Button icon={BookOpen} onClick={() => { edit('memory', null, { title: `From ${chat.title}`, content: `${messageOptions.content}\n\nSource: ${messageLink(chat.id, messageOptions.id)}`, project_id: project?.id }); setMessageOptions(null); }}>Save message to memory</Button>
    </div></Dialog> : null}
    {emojiPicker ? <Suspense fallback={null}><ReactionPicker emojiOnly title="Insert emoji" onClose={() => setEmojiPicker(false)} onSelect={value => { const item = getReaction(value.id, customEmojis(data.workspace_items, chat.workspace_id)); if (!item) return; const start = inputRef.current?.selectionStart ?? composer.text.length, end = inputRef.current?.selectionEnd ?? start; const text = item.shortcode ?? item.glyph; change({ text: composer.text.slice(0, start) + text + composer.text.slice(end) }); setEmojiPicker(false); requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(start + text.length, start + text.length); }); }} /></Suspense> : null}
    {reactionMessage ? <Suspense fallback={<Dialog title="Loading reactions" onClose={() => setReactionMessage(null)}><div className="dialog-body">Preparing the icon and emoji library…</div></Dialog>}><ReactionPicker onClose={() => setReactionMessage(null)} onSelect={reaction => reactTo(reactionMessage, reaction)} selected={messageReactions(reactionMessage.id)} busy={Boolean(reactionPending) || actionBusy} error={reactionError} /></Suspense> : null}
    {composeDialog && composeDialog.type !== 'drafts' ? <Dialog title={composeDialog.type === 'branch' ? 'Branch conversation' : composeDialog.type === 'move' ? 'Move conversation' : composeDialog.type === 'output' ? 'Create output' : 'Create project document'} subtitle={composeDialog.type === 'branch' ? 'History through this message becomes reference notes in a new chat. The original stays unchanged. Provider sessions and running work are not resumed or copied.' : composeDialog.type === 'move' ? 'The old Route link is removed. Future sends use the destination project’s context. Existing messages, attachments, and snapshots stay in the history.' : 'Preserve this message as a reusable result with a link to its source.'} onClose={() => { if (!actionBusy) setComposeDialog(null); }}><Form onSubmit={submitAction}><div className="dialog-body chat-action-form"><ErrorMessage error={collaborationError} />
      {composeDialog.type !== 'move' ? <Field label="Title"><input required maxLength={160} value={actionTitle} onChange={event => setActionTitle(event.target.value)} autoFocus /></Field> : null}
      {composeDialog.type !== 'branch' ? <Field label="Project"><Select aria-label="Destination project" value={destination} onChange={setDestination}><option value="">{composeDialog.type === 'document' ? 'Choose a project' : 'Workspace · no project'}</option>{visible(data.projects).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field> : null}
      {composeDialog.type === 'move' ? <p className="chat-action-warning">Selected composer context will be cleared and automatic memory inclusion will be turned off. Review saved drafts and old messages before sending them to an agent in the new project.</p> : null}
    </div><footer className="dialog-footer"><Button onClick={() => setComposeDialog(null)} disabled={actionBusy}>Cancel</Button><Button type="submit" variant="primary" busy={actionBusy} disabled={composeDialog.type === 'document' && !destination || composeDialog.type === 'move' && Boolean(active)}>{composeDialog.type === 'move' ? 'Confirm move' : composeDialog.type === 'branch' ? 'Create branch' : 'Create'}</Button></footer></Form></Dialog> : null}
    {composeDialog?.type === 'drafts' ? <Dialog title="Follow-up drafts" subtitle="Nothing here runs automatically. Load a draft, review its recipient and access, then send it yourself." onClose={() => setComposeDialog(null)}><div className="dialog-body chat-followups"><ErrorMessage error={collaborationError} />{collaboration.drafts.map(draft => <section key={draft.id}><p>{draft.content}</p><small>{draft.recipient === 'note' ? 'Note' : agents.find(item => item.id === draft.recipient)?.name || 'Unavailable agent'} · {draft.permission === 'conversation' ? 'Discuss' : draft.permission === 'read-only' ? 'Inspect project' : 'Execute coding'}{draft.context_snapshot_id ? ' · selected context' : ''}</small><div><Button onClick={async () => { await loadDraft(draft); setComposeDialog(null); }}>Load into composer</Button><Button variant="ghost" disabled={actionBusy} onClick={() => perform(() => collaborationAction('remove-draft', { draft_id: draft.id }), 'Draft removed')}>Remove draft</Button></div></section>)}{!collaboration.drafts.length ? <p>No follow-up drafts saved.</p> : null}</div></Dialog> : null}
    {preview ? <Dialog title={preview.name} subtitle="Attachment preview" wide className="chat-attachment-dialog" onClose={() => setPreview(null)}><div className="dialog-body">{preview.type?.startsWith('image/') && /^data:image\/(png|jpeg|gif|webp);base64,/.test(preview.content) ? <img src={preview.content} alt={preview.name} /> : <pre>{typeof preview.content === 'string' ? preview.content : 'Content unavailable'}</pre>}</div><footer className="dialog-footer"><Button onClick={() => setPreview(null)}>Close</Button></footer></Dialog> : null}
  </section>;
}

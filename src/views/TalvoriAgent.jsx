import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, Plus } from '../components/icons.jsx';
import { TalvoriAgentOrb } from '../components/TalvoriAgentOrb.jsx';
import { AssistantActivity } from '../components/AssistantActivity.jsx';
import { apiRequest } from '../data/api.js';
import { refreshTalvori } from '../data/useTalvori.js';
import { persistComposer, restoreComposer } from '../lib/chats.js';
import { consumeTalvoriAgentEntry, peekTalvoriAgentEntry } from '../lib/talvori-agent-entry.js';
import { agentReadiness } from '../lib/agents.js';
import { hasConnectedAssistantAI, selectedAssistantConnection } from '../lib/assistant-connection.js';
import { pageHash } from '../lib/navigation.js';
import { relative, val, visible } from '../lib/model.js';
import { Button, ErrorMessage, useApp } from '../ui.jsx';
import { ScheduledWorkSettings } from './settings/ScheduledWorkSettings.jsx';
import { TalvoriAgentPreferences } from './settings/TalvoriAgentPreferences.jsx';
import './talvori-agent.css';

function draftStorage() { try { return sessionStorage; } catch { return undefined; } }
const creationKey = workspaceId => `rumbo-agent:create:${workspaceId}`;
function savedCreation(workspaceId) {
  try { const saved = JSON.parse(draftStorage()?.getItem(creationKey(workspaceId)) || 'null'); return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : null; } catch { return null; }
}

/** Personal-assistant setup and recorded work; all chatting lives in Conversations. */
export function TalvoriAgent() {
  const { data, workspace, page, navigate, notify } = useApp();
  const [state, setState] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(null), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const workspaceRef = useRef(workspace.id), creation = useRef(null);
  workspaceRef.current = workspace.id;
  const revision = useMemo(() => JSON.stringify((data.connections || []).map(item => [item.id, item.state, item.connected, item.updated_at, item.workspace_states])), [data.connections]);
  const section = page.section || 'conversation';
  const preferences = state?.preferences || {};
  const selected = selectedAssistantConnection(state);
  const ready = hasConnectedAssistantAI(state);
  const chats = visible(data.chats).filter(chat => chat.kind === 'rumbo-agent' && chat.workspace_id === workspace.id).toSorted((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  const restored = savedCreation(workspace.id);
  const pending = peekTalvoriAgentEntry(workspace.id) || (restored?.instruction || restored?.source ? { instruction: restored.instruction, source: restored.source, ...(restored.agent_id && restored.agent_id !== 'talvori-default' ? { agentId: restored.agent_id } : {}) } : null);
  const requestedAgent = pending?.agentId ? visible(data.agents).find(agent => agent.id === pending.agentId) : null;
  const requestedPersonal = requestedAgent?.id.startsWith('rumbo_agent_');
  const requestedReady = requestedAgent && (!requestedPersonal || ready && requestedAgent.provider === selected?.provider) && agentReadiness(requestedAgent, (data.connections || []).find(item => item.provider === requestedAgent.provider && item.id === val(requestedAgent, 'provider_connection_id'))).canStartLive;

  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setState(null); setError(null); creation.current = null;
    apiRequest(`/api/talvori-agent?workspace_id=${encodeURIComponent(workspace.id)}`, { signal: controller.signal }).then(response => { if (!controller.signal.aborted) setState(response.result); }).catch(cause => { if (!controller.signal.aborted) setError(cause); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspace.id, revision, reload]);

  // Old saved links remain useful without retaining a second chat surface.
  useEffect(() => { if (page.id) navigate('chats', page.id, page.messageId ? { messageId: page.messageId } : {}); }, [page.id, page.messageId, navigate]);

  function stageDraft(chat, agent, draft) {
    const composer = restoreComposer(chat, data.agents, draftStorage());
    const occupied = Boolean(composer.text.trim() || composer.files.length || composer.turn || composer.context || composer.replyTo || composer.sending);
    if (!occupied && !requestedAgent && !composer.hasSavedPreferences) Object.assign(composer, { model: preferences.model || '', reasoning: preferences.reasoning_effort || '', includeWorkspace: preferences.include_workspace !== false, includeChat: preferences.include_chat !== false, memory: preferences.include_memory !== false, contextPackIds: preferences.context_pack_ids || [] });
    if (!occupied && typeof draft?.instruction === 'string' && draft.instruction) Object.assign(composer, { text: draft.instruction.slice(0, 10000), recipient: agent?.id || composer.recipient });
    if (!composer.turn) composer.nativeTools = false;
    if (occupied && draft?.instruction) notify('Your existing conversation draft was kept. The new instruction did not replace it.');
    persistComposer(chat.id, composer, draftStorage());
  }

  async function openConversation({ forceNew = false } = {}) {
    if (busy || loading || !state) return;
    if (pending?.agentId && !requestedReady) { setError(new Error('The addressed agent is unavailable. Connect that agent’s selected account; Talvori will not substitute another identity.')); return; }
    if (!pending?.agentId && (!ready || !preferences.onboarding_complete)) { setError(new Error('Choose and save Talvori’s AI connection and complete its purpose and guidelines first.')); return; }
    const targetProvider = requestedAgent?.provider || selected.provider;
    const targetAgent = requestedAgent || selected.agent;
    const previous = savedCreation(workspace.id);
    const draft = pending || previous;
    const hasDraft = Boolean(draft?.instruction || draft?.source);
    const existing = !forceNew && !hasDraft && targetAgent ? chats.find(chat => (val(chat, 'participant_agent_ids') || []).includes(targetAgent.id)) : null;
    if (existing) { stageDraft(existing, targetAgent, null); navigate('chats', existing.id); return; }
    setBusy(true); setError(null); const requestWorkspace = workspace.id;
    try {
      const source = draft?.source && ['document', 'update', 'task', 'project'].includes(draft.source.type) && typeof draft.source.id === 'string' ? { type: draft.source.type, id: draft.source.id } : null;
      const identity = JSON.stringify({ workspaceId: requestWorkspace, provider: targetProvider, agentId: requestedAgent?.id || null, source });
      if (!creation.current || creation.current.identity !== identity) creation.current = { identity, id: previous?.creation_identity === identity && /^[A-Za-z0-9_-]{8,120}$/.test(previous?.request_id || '') ? previous.request_id : crypto.randomUUID() };
      try { draftStorage()?.setItem(creationKey(requestWorkspace), JSON.stringify({ instruction: draft?.instruction || '', source, provider: targetProvider, agent_id: requestedAgent?.id || '', creation_identity: identity, request_id: creation.current.id })); } catch {}
      const response = await apiRequest('/api/talvori-agent/chats', { method: 'POST', body: { workspace_id: requestWorkspace, provider: targetProvider, ...(requestedAgent ? { agent_id: requestedAgent.id } : {}), request_id: creation.current.id, ...(source ? { source } : {}) } });
      const { chat, agent } = response.result || response;
      if (workspaceRef.current !== requestWorkspace) return;
      stageDraft(chat, agent, draft);
      consumeTalvoriAgentEntry(requestWorkspace); try { draftStorage()?.removeItem(creationKey(requestWorkspace)); } catch {}
      await refreshTalvori(); navigate('chats', chat.id); if (hasDraft) notify('Your draft is ready in Conversations. Nothing has been sent.');
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  }

  const canOpen = !loading && Boolean(state) && (pending?.agentId ? requestedReady : ready && preferences.onboarding_complete);
  return <main className="rumbo-agent-page talvori-setup-page"><header className="rumbo-agent-header"><div className="rumbo-agent-identity">{preferences.image_url ? <img className="talvori-setup-picture" src={preferences.image_url} alt="" /> : <TalvoriAgentOrb compact color={preferences.orb_color} />}<strong>{preferences.display_name || 'Talvori'}</strong></div><div className="rumbo-agent-header-actions"><Button icon={MessageCircle} disabled={!canOpen} busy={busy} onClick={() => openConversation()}>{pending?.agentId ? `Open draft for ${requestedAgent?.name || 'agent'}` : 'Open conversation'}</Button><Button icon={Plus} disabled={loading || !ready || !preferences.onboarding_complete || Boolean(pending?.agentId)} busy={busy} onClick={() => openConversation({ forceNew: true })}>New conversation</Button></div></header>
    <nav className="assistant-section-nav" aria-label="Talvori sections">{[['conversation', 'Setup'], ['activity', 'Activity'], ['scheduled', 'Scheduled']].map(([id, label]) => <a key={id} href={pageHash('rumbo-agent', null, { section: id })} aria-current={section === id ? 'page' : undefined}>{label}</a>)}</nav>
    <ErrorMessage error={error} />
    {loading ? <p className="rumbo-agent-loading" role="status">Loading Talvori…</p> : !state ? <section className="talvori-setup-content"><h1>Talvori is unavailable</h1><Button onClick={() => setReload(value => value + 1)}>Retry</Button></section> : <>
      {!ready ? <div className="rumbo-agent-connection-notice" role="status"><span>{preferences.provider_selected ? 'Talvori’s selected AI connection needs to be reconnected. Saved work remains readable.' : 'Choose Talvori’s AI connection in Setup. Connected accounts are never selected automatically.'}</span>{preferences.provider_selected ? <Button onClick={() => navigate('connections', preferences.provider)}>Reconnect AI</Button> : section !== 'conversation' ? <Button onClick={() => navigate('rumbo-agent')}>Choose connection</Button> : null}</div> : null}
      {section === 'activity' || section === 'scheduled' ? <div className="assistant-section-panel" key={`${workspace.id}:${section}`}>{section === 'activity' ? <AssistantActivity /> : <ScheduledWorkSettings embedded />}</div> : <section className="talvori-setup-content"><div className="talvori-setup-intro"><h1>Your Talvori</h1><p>Set its identity and choose the AI account it uses. Talk with Talvori in Conversations; follow work in Activity or manage timed and event-triggered work in Scheduled.</p></div><TalvoriAgentPreferences embedded initialState={state} onSaved={next => setState(current => ({ ...current, preferences: next }))} />{chats.length ? <section className="talvori-setup-history"><h2>Recent conversations</h2>{chats.slice(0, 6).map(chat => <button key={chat.id} onClick={() => navigate('chats', chat.id)}><span><MessageCircle />{chat.title}</span><time>{relative(chat.updated_at)}</time></button>)}</section> : null}</section>}
    </>}
  </main>;
}

export default TalvoriAgent;

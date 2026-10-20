import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { Button, ErrorMessage, Field, Select, useApp } from '../ui.jsx';
import { ArrowRight, MessageCircle, RotateCw } from './icons.jsx';
import { coordinationDestination, coordinationRequest } from '../lib/run-coordination.js';
import { val, visible } from '../lib/model.js';
import './run-coordination.css';

export function RunCoordination({ run }) {
  const { data, navigate } = useApp();
  const [state, setState] = useState({ loading: true, items: [], error: null });
  const [kind, setKind] = useState('steer'), [content, setContent] = useState('');
  const [chatId, setChatId] = useState(''), [agentId, setAgentId] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [revision, setRevision] = useState(0);
  const pending = useRef(null), inFlight = useRef(false), current = useRef(run.id);
  current.current = run.id;
  const chats = visible(data.chats).filter(item => val(item, 'workspace_id') === val(run, 'workspace_id'));
  const agents = visible(data.agents).filter(item => !val(item, 'workspace_id') || val(item, 'workspace_id') === val(run, 'workspace_id'));
  const targetChat = chats.find(item => item.id === chatId);
  const targetAgents = targetChat?.kind === 'rumbo-agent' ? agents.filter(item => (val(targetChat, 'participant_agent_ids') || []).includes(item.id)) : agents;
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, items: [], error: null });
    apiRequest(`/api/runs/${encodeURIComponent(run.id)}/coordination`, { signal: controller.signal }).then(({ result }) => {
      if (!controller.signal.aborted) setState({ loading: false, items: result.items || [], error: null });
    }).catch(problem => { if (!controller.signal.aborted) setState({ loading: false, items: [], error: problem }); });
    return () => controller.abort();
  }, [run.id, revision]);
  useEffect(() => { setContent(''); setChatId(''); setAgentId(''); setError(null); pending.current = null; }, [run.id]);
  async function save(event) {
    event.preventDefault();
    if (inFlight.current) return;
    const sourceId = run.id;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const fields = { kind, content: content.trim(), ...(kind === 'handoff' ? { target_chat_id: chatId, target_agent_id: agentId } : {}) };
      const signature = JSON.stringify([sourceId, fields]);
      if (pending.current?.signature !== signature) pending.current = { signature, requestId: crypto.randomUUID() };
      await apiRequest(`/api/runs/${encodeURIComponent(sourceId)}/coordination`, { method: 'POST', body: coordinationRequest(fields, pending.current.requestId) });
      if (current.current === sourceId) { setContent(''); pending.current = null; setRevision(value => value + 1); }
    } catch (problem) { if (current.current === sourceId) setError(problem); }
    finally { inFlight.current = false; if (current.current === sourceId) setBusy(false); }
  }
  return <section className="run-coordination" aria-labelledby={`coordination-title-${run.id}`}>
    <header><div><h3 id={`coordination-title-${run.id}`}>Steering &amp; handoffs</h3><p>Queue a next-turn instruction without interrupting this run. Nothing here starts another paid run.</p></div><Button icon={RotateCw} disabled={busy || state.loading} onClick={() => setRevision(value => value + 1)}>Refresh messages</Button></header>
    <ErrorMessage error={state.error} />
    {state.loading ? <p role="status">Loading coordination messages…</p> : null}
    {!state.loading && !state.error && !state.items.length ? <p className="muted">No steering or handoff messages recorded yet.</p> : null}
    {state.items.map(item => {
      const destination = coordinationDestination(item);
      const chat = chats.find(row => row.id === item.target_chat_id), agent = agents.find(row => row.id === item.target_agent_id);
      return <article key={item.id}><div className="run-coordination-meta"><strong>{item.kind === 'steer' ? 'Queued steering' : 'Agent handoff'}{item.author_type === 'agent' ? ' · From agent' : ''}</strong><span>{item.state === 'prepared' ? 'Draft prepared' : 'Awaiting reviewed next turn'}</span><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></div><p className="run-coordination-content">{item.content}</p><small>{agent?.name || 'Named agent'} · {chat?.title || 'Destination conversation'}</small>{item.state === 'prepared' ? <small>Sending and recipient completion are managed in Conversations, not tracked by this draft record.</small> : null}{item.can_prepare ? <Button icon={ArrowRight} onClick={() => navigate('chats', destination.chatId, destination.options)}>Review next-turn draft</Button> : null}</article>;
    })}
    {run.chat_id && run.agent_id && !state.loading && !state.error ? <form onSubmit={save} className="run-coordination-form">
      <Select label="Message type" value={kind} onChange={setKind} disabled={busy}><option value="steer">Steer this agent’s next turn</option><option value="handoff">Handoff to a conversation &amp; agent</option></Select>
      {kind === 'handoff' ? <div className="run-coordination-targets"><Select label="Destination conversation" value={chatId} onChange={value => { setChatId(value); setAgentId(''); }} disabled={busy}><option value="">Choose a conversation…</option>{chats.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</Select><Select label="Recipient agent" value={agentId} onChange={setAgentId} disabled={busy || !chatId}><option value="">Choose an agent…</option>{targetAgents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></div> : null}
      <Field label={kind === 'steer' ? 'Next-turn instruction' : 'Handoff message'}><textarea data-field-default-key="run.coordination.message" data-field-default-page="Active work" data-field-default-label="Steering or handoff message" data-field-default-mode="create" rows={3} maxLength={10000} value={content} onChange={event => setContent(event.target.value)} disabled={busy} placeholder="Describe what should happen next…" /></Field>
      <ErrorMessage error={error} /><div className="run-coordination-submit"><p>This is not live mid-turn injection. Review the draft and send it from Conversations when ready.</p><Button icon={MessageCircle} type="submit" busy={busy} disabled={!content.trim() || kind === 'handoff' && (!chatId || !agentId)}>Queue message</Button></div>
    </form> : null}
  </section>;
}

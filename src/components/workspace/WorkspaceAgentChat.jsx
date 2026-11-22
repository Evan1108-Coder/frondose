import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../data/api.js';
import { Button, Dialog, ErrorMessage } from '../../ui.jsx';
import { DocumentContent } from '../DocumentContent.jsx';
import { useUnsavedUpdate } from '../UnsavedUpdates.jsx';
import { consumeContextDrag, isWorkspaceContextDrag } from '../../lib/workspace-context-drop.js';
import { loadContextPreview } from '../../lib/context-preview.js';
import { formatSupportAgentDay, groupSupportRows } from '../../lib/support-logs.js';

export function WorkspaceAgentChat({ workspaceId, binding, initialConversationId }) {
  const [data, setData] = useState(null), [selected, setSelected] = useState(initialConversationId || ''), [provider, setProvider] = useState('codex');
  const [title, setTitle] = useState(''), [prompt, setPrompt] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(null), [review, setReview] = useState(false), [uncertain, setUncertain] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const lock = useRef(false), mounted = useRef(true), input = useRef(null), request = useRef(null), epoch = useRef(0);
  const [activityLoading, setActivityLoading] = useState(false), [activityPreview, setActivityPreview] = useState(null);
  const activityRequest = useRef(null);
  useUnsavedUpdate(Boolean(prompt.trim() || title.trim()), busy);
  const conversation = data?.conversation?.id === selected ? data.conversation : null;
  const running = conversation?.turns.some(turn => ['starting','running','needs-input','needs-cleanup'].includes(turn.status));
  async function checkDelivery(){
    setBusy(true);setError(null);
    try{const{result}=await apiRequest('/api/workspace-agent-chat?'+new URLSearchParams({workspace_id:workspaceId,id:selected}));setData(result);if(result.conversation?.turns.some(turn=>turn.request_id===request.current)){setUncertain(false);setPrompt('');request.current=null;}else setError(Error('No matching receipt was returned. This check did not send or retry a prompt. Keep the draft until delivery can be resolved.'));}catch(cause){setError(cause);}finally{setBusy(false);}
  }
  const providerName=id=>data?.providers?.find(agent=>agent.id===id)?.title || ({codex:'Codex',claude:'Claude Code',pi:'Pi',omp:'Oh My Pi'})[id] || id;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); let timer; setData(null);
    async function load() {
      try { const { result } = await apiRequest('/api/workspace-agent-chat?' + new URLSearchParams({ workspace_id: workspaceId, ...(selected ? { id: selected } : {}) }), { signal: controller.signal }); if (!controller.signal.aborted) { setData(result); timer = setTimeout(load, result.conversation?.turns.some(turn => ['starting','running','needs-input'].includes(turn.status)) ? 700 : 5000); } }
      catch (cause) {
        if (controller.signal.aborted) return;
        if (cause.status === 404 && cause.code === 'workspace_agent_chat_error' && selected && !lock.current) {
          setSelected(''); setDeleting(null); setReview(false); setUncertain(false);
          request.current = null; epoch.current++;
        } else timer = setTimeout(load, 5000);
        setError(cause);
      }
    }
    void load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [workspaceId, selected, binding?.version]);
  useEffect(() => () => {
    activityRequest.current?.abort();
    activityRequest.current = null;
  }, [workspaceId, selected, binding?.version]);
  async function previewActivity(support = false) {
    if (activityRequest.current) return;
    const controller = new AbortController();
    activityRequest.current = controller;
    const target = input.current, expected = epoch.current;
    setActivityLoading(true); setError(null);
    try {
      const endpoint = support ? '/api/support-logs' : '/api/workspace-activity?' + new URLSearchParams({ workspace_id: workspaceId, limit: '15' });
      const { result } = await apiRequest(endpoint, { signal: controller.signal });
      if (!controller.signal.aborted) {
        const days = support ? groupSupportRows(result.rows) : null;
        const [day, rows] = days?.[0] ?? ['', []];
        setActivityPreview({ text: support ? formatSupportAgentDay(day, rows) : result.text, target, expected, days, day });
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause);
    } finally {
      if (activityRequest.current === controller) activityRequest.current = null;
      if (mounted.current) setActivityLoading(false);
    }
  }
  function appendActivity() {
    if (!activityPreview?.text || activityPreview.target !== input.current || activityPreview.expected !== epoch.current || running) {
      setError(Error('The message changed. Review the activity again before adding it.')); setActivityPreview(null); return;
    }
    const next = [prompt, activityPreview.text].filter(Boolean).join('\n\n');
    if (next.length > 24000) { setError(Error('The activity would exceed the message limit. Shorten your draft and try again.')); setActivityPreview(null); return; }
    setPrompt(next); epoch.current++; setActivityPreview(null);
  }
  async function action(kind, payload) {
    if (lock.current) return; lock.current = true; setBusy(true); setError(null); const root = binding?.version;
    try {
      const { result } = await apiRequest('/api/workspace-agent-chat/' + kind, { method: 'POST', body: { workspace_id: workspaceId, expected_binding_version: root, confirmed: true, id: selected, ...payload } });
      if (!mounted.current) return;
      if (kind === 'create') { setSelected(result.id); setTitle(''); }
      if (kind === 'delete') { setDeleting(null); setSelected(''); request.current = null; epoch.current++; }
      if (kind === 'send') { setData(old => ({ ...old, conversation: result })); setPrompt(''); epoch.current++; request.current = null; setReview(false); setUncertain(false); }
      if (kind === 'decision') setData(old => ({ ...old, conversation: { ...old.conversation, approvals: old.conversation.approvals.filter(a => a.id !== payload.approval_id) } }));
    } catch (cause) { if (mounted.current) { setError(cause); if (kind === 'send') { setReview(false); setUncertain(true); } } }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function drop(event) {
    if (!isWorkspaceContextDrag(event.dataTransfer)) return; event.preventDefault(); event.stopPropagation();
    const source = consumeContextDrag(event.dataTransfer, workspaceId), expected = epoch.current, target = input.current;
    if (!source || !target) return;
    try { const text = await loadContextPreview(apiRequest, workspaceId, source); if (!mounted.current || expected !== epoch.current || input.current !== target) throw Error('The target changed while reading the reference. Drop it again.'); setPrompt(value => (value + '\n\n' + text).slice(0,24000)); epoch.current++; }
    catch (cause) { setError(cause); }
  }
  return <div className="workspace-agent-chat"><h2>Chat</h2>{conversation?.provider==='claude'&&data?.providers?.find(p=>p.id==='claude')?.structuredConfigured===false?<p role="status">Structured Claude Chat needs FRONDOSE_CLAUDE_API_KEY configured on this host. The unmodified terminal and external app keep their own sign-in.</p>:null}<p>Uses your installed agent. Pi and Oh My Pi share this text-only Chat; use Terminal for their tools. Sending may incur provider charges.</p><ErrorMessage error={deleting ? null : error}/>
  {!binding ? <p>Link a workspace directory to create a conversation or send a message. You can still read and delete saved conversations.</p> : null}
  <div className="workstation-actions">
    <label>Conversation<select data-field-defaults-exclude="true" disabled={busy || Boolean(prompt.trim())} value={selected} onChange={e => { setSelected(e.target.value); setUncertain(false); }}><option value="">Choose a conversation</option>{data?.conversations?.map(row => <option key={row.id} value={row.id}>{row.title} · {providerName(row.provider)}</option>)}</select></label>
    {conversation ? <Button variant="danger" disabled={busy || running || uncertain || Boolean(prompt.trim())} onClick={() => { setError(null); setDeleting({ id: conversation.id, title: conversation.title, revision: conversation.revision }); }}>Delete conversation</Button> : null}
  </div>
  {binding ? <div className="workstation-actions"><label>Provider<select data-field-defaults-exclude="true" disabled={busy} value={provider} aria-label="Chat agent" onChange={e => setProvider(e.target.value)}>{(data?.providers||[]).map(agent=><option key={agent.id} value={agent.id}>{agent.title}{agent.installed?'':' · Not installed'}</option>)}</select></label><label>New conversation title<input value={title} maxLength={150} onChange={e => setTitle(e.target.value)} data-field-default-key="ai-session.new.title" data-field-default-page="AI sessions" data-field-default-label="Conversation title"/></label><Button disabled={busy || Boolean(prompt.trim()) || !data?.providers?.find(p => p.id === provider)?.installed} onClick={() => action('create', { provider, title })}>Create conversation</Button></div> : null}
  {conversation ? <>{conversation.automation_managed?<p>This conversation is managed by its automation. Manual messages belong in a separate Chat.</p>:null}<div className="workspace-chat-transcript" aria-label="Conversation transcript">{conversation.turns.map(turn => <article key={turn.id}><h3>You</h3><pre>{turn.prompt}</pre><h3>{providerName(conversation.provider)}</h3>{turn.response ? <DocumentContent content={turn.response}/> : <p>{turn.status}</p>}<small>{turn.status}</small>{turn.error ? <p role="alert">{turn.error}</p> : null}</article>)}</div>{conversation.approvals.map(a => <div className="workstation-review" key={a.id}><h3>Permission request</h3><p>{a.tool}</p><pre>{a.input}</pre><div className="workstation-actions"><Button disabled={busy} onClick={() => action('decision', { approval_id: a.id, decision: 'deny' })}>Deny</Button>{a.native ? <span>Computer Use is coming soon.</span> : <Button disabled={busy} onClick={() => action('decision', { approval_id: a.id, decision: 'allow' })}>Allow once</Button>}</div></div>)}
    {binding ? <><label>Message<textarea ref={input} aria-label="Message" rows={5} value={prompt} maxLength={24000} disabled={busy || running || conversation.automation_managed} onChange={e => { setPrompt(e.target.value); epoch.current++; }} onDragOver={e => { if (isWorkspaceContextDrag(e.dataTransfer) && !running) e.preventDefault(); }} onDrop={drop} data-field-defaults-exclude="true"/></label><div className="workstation-actions"><Button disabled={busy || running || conversation.automation_managed || uncertain || activityLoading} onClick={() => previewActivity()}>Add recent activity</Button><Button disabled={busy || running || conversation.automation_managed || uncertain || activityLoading} onClick={() => previewActivity(true)}>Add support log</Button><Button disabled={busy || running || conversation.automation_managed || !prompt.trim() || uncertain || data?.providers?.find(p=>p.id===conversation.provider)?.structuredConfigured===false} onClick={() => { request.current ||= crypto.randomUUID(); setReview({ id: conversation.id, revision: conversation.revision, provider: conversation.provider, bindingVersion: binding.version, path: binding.path, prompt }); }}>Review and send</Button></div></> : null}
    {running ? <div className="workstation-actions"><Button disabled={busy} onClick={() => action('stop', {})}>Stop turn</Button></div> : null}
    {uncertain ? <p role="alert">Delivery is uncertain. The request will not be automatically retried. Check this conversation before sending again. <Button onClick={checkDelivery}>Check same request</Button></p> : null}</> : <p>Select or create a conversation. Creating one does not launch a provider.</p>}
  {(!conversation || !binding) && prompt.trim() ? <label>Preserved message draft<textarea value={prompt} rows={5} maxLength={24000} onChange={e => { setPrompt(e.target.value); epoch.current++; }} data-field-defaults-exclude="true"/></label> : null}
  {deleting ? <Dialog title="Delete conversation?" onClose={() => !busy && setDeleting(null)} closeDisabled={busy}><div className="workstation-review"><p>Permanently delete <strong>{deleting.title}</strong> and its transcript from Frondose? This cannot be undone. It does not delete the provider’s own history.</p>{error ? <p role="alert">{error.message}</p> : null}</div><footer className="form-submit-row"><Button disabled={busy} onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" busy={busy} onClick={() => action('delete', { id: deleting.id, revision: deleting.revision })}>Delete conversation</Button></footer></Dialog> : null}
  {activityPreview ? <Dialog title={activityPreview.days ? "Add support log" : "Recent workspace activity"} onClose={() => setActivityPreview(null)}><div className="workstation-review"><p>Review what would be added to your message. Nothing is sent until you choose Review and send.</p>{activityPreview.days?.length ? <label>Log date<select data-field-defaults-exclude="true" value={activityPreview.day} onChange={event => { const day = event.target.value; setActivityPreview(previous => ({ ...previous, day, text: formatSupportAgentDay(day, previous.days.find(([key]) => key === day)?.[1] ?? []) })); }}>{activityPreview.days.map(([day]) => <option key={day}>{day}</option>)}</select></label> : null}{activityPreview.text ? <pre>{activityPreview.text}</pre> : <p>{activityPreview.days ? "No support log entries yet." : "No recent activity in this workspace."}</p>}</div><footer className="form-submit-row"><Button onClick={() => setActivityPreview(null)}>Cancel</Button><Button variant="primary" disabled={!activityPreview.text || running} onClick={appendActivity}>Add to message</Button></footer></Dialog> : null}{review ? <Dialog title="Send to your AI runtime?" onClose={() => !busy && setReview(false)} closeDisabled={busy}><div className="workstation-review"><p>Provider: {review.provider} · Directory: {review.path}</p><pre>{review.prompt}</pre><p>This sends the displayed text to the installed provider. Tool requests that require review appear in this conversation. No uncertain turn is automatically replayed.</p></div><footer className="form-submit-row"><Button disabled={busy} onClick={() => setReview(false)}>Cancel</Button><Button variant="primary" busy={busy} onClick={() => action('send', { id: review.id, expected_binding_version: review.bindingVersion, request_id: request.current, prompt: review.prompt, revision: review.revision })}>Send message</Button></footer></Dialog> : null}</div>;
}

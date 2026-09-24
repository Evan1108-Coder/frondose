import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { rumboActions } from '../data/useRumbo.js';
import { Button, Dialog, ErrorMessage } from '../ui.jsx';
import { ShieldCheck, RotateCw } from './icons.jsx';
import { useUnsavedUpdate } from './UnsavedUpdates.jsx';
import './native-tool-activity.css';

const REQUEST_FIELDS = {
  route_draft: ['project_id', 'title', 'description', 'priority', 'status'],
  project_update: ['project_id', 'patch'],
  memory_candidate: ['project_id', 'title', 'content'],
  permission_request: ['capability', 'reason', 'scope_type', 'scope_id', 'grants_access'],
  output_draft: ['project_id', 'route_id', 'run_id', 'title', 'content', 'kind', 'output_kind', 'state'],
  agent_handoff: ['target_agent_id', 'project_id', 'route_id', 'summary', 'launches_agent'],
};
const label = value => String(value || 'Not recorded').replaceAll('_', ' ');
const stamp = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Time not recorded';
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function nativeRequestFields(request) {
  const payload = object(request?.payload) ? request.payload : {};
  return (REQUEST_FIELDS[request?.kind] || []).filter(key => Object.hasOwn(payload, key)).map(key => {
    const value = key === 'patch' && object(payload.patch) ? Object.fromEntries(['name', 'description', 'goal', 'status'].filter(field => Object.hasOwn(payload.patch, field)).map(field => [field, payload.patch[field]])) : payload[key];
    return [key, value];
  });
}

export function nativeRequestEffect(request) {
  if (request?.kind === 'permission_request') return 'Records your review of this permission request only. It does not grant access, change policy, or resume execution.';
  if (request?.kind === 'agent_handoff') return 'Records a reviewed handoff only. It does not launch the target agent, share broader context, or grant tools.';
  if (request?.kind === 'memory_candidate') return 'Creates a memory candidate. It is not automatically approved knowledge and does not become authorization.';
  if (request?.kind === 'output_draft') return 'Creates an output for review. Applying this proposal does not accept the output or complete a Route.';
  if (request?.kind === 'route_draft') return 'Creates the proposed Route in the displayed Project backlog. It does not launch an agent.';
  if (request?.kind === 'project_update') return 'Applies the displayed Project fields after checking the recorded prior values. Review every change before confirming.';
  return 'This request kind is not supported by this review interface. No action will be applied here.';
}

export function nativeHistoryNotice(error) {
  return ['context_not_reviewed', 'native_tools_not_reviewed'].includes(error?.code)
    ? 'Native tool history unavailable for this run: no matching reviewed opt-in was recorded.'
    : null;
}

export function NativeToolsChoice({ checked, onChange, disabled, label: title = 'Enable native Rumbo tools for this launch' }) {
  return <label className="native-tools-choice"><input type="checkbox" checked={checked === true} disabled={disabled} onChange={event => onChange(event.target.checked)} /><span><strong>{title}</strong><small>Reads stay within the exact reviewed context. Every workspace write creates a pending proposal for your decision. Permission requests and handoffs never grant access or launch agents.</small></span></label>;
}

function RequestFields({ request }) {
  const fields = nativeRequestFields(request);
  const before = request.kind === 'project_update' && object(request.before) ? Object.fromEntries(['name', 'description', 'goal', 'status'].filter(key => Object.hasOwn(request.before, key)).map(key => [key, request.before[key]])) : null;
  return <>{request.target?.kind && request.target?.id ? <p>Target: {label(request.target.kind)} · <code>{request.target.id}</code></p> : null}<dl className="native-tool-fields">{fields.map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd>{value == null ? 'None' : typeof value === 'object' ? <pre tabIndex={0}>{JSON.stringify(value, null, 2)}</pre> : String(value)}</dd></div>)}</dl>{typeof request.before?.content === 'string' ? <details><summary>Previously reviewed target context</summary><p>{request.before.label || label(request.before.kind)}. This is the recorded context, not a fresh read of the target.</p><pre tabIndex={0}>{request.before.content}</pre>{request.before.truncated ? <p>This recorded context was truncated; omitted content is unavailable here.</p> : null}</details> : before && Object.keys(before).length ? <details><summary>Recorded prior values</summary><pre tabIndex={0}>{JSON.stringify(before, null, 2)}</pre></details> : null}</>;
}

export function NativeToolActivity({ runId }) {
  const [state, setState] = useState({ loading: true, calls: [], requests: [], error: null }), [revision, setRevision] = useState(0);
  const [decision, setDecision] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const inFlight = useRef(false);
  const historyNotice = nativeHistoryNotice(state.error);
  useUnsavedUpdate(false, busy);
  useEffect(() => {
    const controller = new AbortController(); setState({ loading: true, calls: [], requests: [], error: null }); setDecision(null);
    if (!runId) { setState({ loading: false, calls: [], requests: [], error: new Error('Choose a recorded run to inspect its native tools.') }); return; }
    apiRequest(`/api/runs/${encodeURIComponent(runId)}/native-tools`, { signal: controller.signal }).then(({ result }) => {
      if (!controller.signal.aborted) setState({ loading: false, calls: Array.isArray(result?.calls) ? result.calls : [], requests: Array.isArray(result?.requests) ? result.requests : [], error: null });
    }).catch(problem => { if (!controller.signal.aborted) setState({ loading: false, calls: [], requests: [], error: problem }); });
    return () => controller.abort();
  }, [runId, revision]);
  async function decide() {
    if (!decision || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      await apiRequest(`/api/native-tool-requests/${encodeURIComponent(decision.request.id)}/decision`, { method: 'POST', body: { decision: decision.value, version: decision.request.version } });
      await rumboActions.refresh().catch(() => {}); setDecision(null); setRevision(value => value + 1);
    } catch (problem) { setError(problem); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="native-tool-activity"><header><div><h3><ShieldCheck />Native tool activity</h3><p>Server-recorded calls and human-review proposals for this run. Opening this section never invokes a tool.</p></div><Button icon={RotateCw} disabled={busy || state.loading} onClick={() => { setError(null); setRevision(value => value + 1); }}>Refresh tools</Button></header>{historyNotice ? <p>{historyNotice}</p> : <ErrorMessage error={state.error} />}
    {state.loading ? <p role="status">Loading native tool records…</p> : !state.error && !state.calls.length && !state.requests.length ? <p>No native tool calls or proposals were recorded for this run. This does not imply the provider had access to every workspace resource.</p> : null}
    {state.requests.map(request => { const pending = ['pending', 'pending_review'].includes(request.status), supported = Boolean(REQUEST_FIELDS[request.kind]), reviewable = pending && supported && Number.isSafeInteger(request.version); return <article className="native-tool-request" key={request.id}><header><strong>{label(request.kind)}</strong><span>{label(request.status)}</span></header><p>{nativeRequestEffect(request)}</p><div className="native-tool-meta"><span>Tool: {request.tool_name || 'Not recorded'}</span><span>Request: {request.id}</span><span>{stamp(request.created_at)}</span></div><RequestFields request={request} />{request.error?.message || request.error?.code ? <p className="native-tool-error">{request.error.message || label(request.error.code)}</p> : null}{pending ? <div className="native-tool-actions"><Button variant="primary" disabled={busy || !reviewable} onClick={() => { setError(null); setDecision({ request, value: 'approve' }); }}>Review and approve</Button><Button disabled={busy || !Number.isSafeInteger(request.version)} onClick={() => { setError(null); setDecision({ request, value: 'reject' }); }}>Reject request</Button>{!Number.isSafeInteger(request.version) ? <small>A version is unavailable; refresh before deciding.</small> : null}</div> : <p>Decision recorded{request.reviewed_at ? ` ${stamp(request.reviewed_at)}` : ''}. Completed decisions cannot be approved again.{request.result?.type && request.result?.id ? <span> Result: {label(request.result.type)} · <code>{request.result.id}</code>.</span> : null}{request.decision_note ? <span> {request.decision_note}</span> : null}</p>}</article>; })}
    {state.calls.length ? <details className="native-tool-calls"><summary>{state.calls.length} recorded tool {state.calls.length === 1 ? 'call' : 'calls'}</summary><ol>{state.calls.map(call => <li key={call.id}><div><strong>{call.tool_name || 'Unknown tool'}</strong><span>{label(call.classification)} · {label(call.status)}</span><time>{stamp(call.created_at)}</time></div>{call.error?.message || call.error?.code ? <p className="native-tool-error">{call.error.message || label(call.error.code)}</p> : null}<small>Call ID: {call.id}</small></li>)}</ol><p>Authentication material and raw runtime requests are not displayed.</p></details> : null}
    {decision ? <Dialog title={decision.value === 'approve' ? 'Apply this reviewed request?' : 'Reject this request?'} onClose={() => !busy && setDecision(null)}><div className="native-tool-decision"><p>{decision.value === 'approve' ? nativeRequestEffect(decision.request) : 'This records a rejection and leaves the proposed workspace change unapplied.'}</p><RequestFields request={decision.request} /><ErrorMessage error={error} /><p>Decision uses request revision {decision.request.version}. Changed targets or permissions can require a fresh review. If delivery is uncertain, refresh the recorded status before deciding again.</p></div><footer className="dialog-footer"><Button disabled={busy} onClick={() => setDecision(null)}>Back</Button><Button variant={decision.value === 'approve' ? 'primary' : 'danger'} busy={busy} onClick={decide}>{decision.value === 'approve' ? 'Confirm approval' : 'Confirm rejection'}</Button></footer></Dialog> : null}
  </section>;
}

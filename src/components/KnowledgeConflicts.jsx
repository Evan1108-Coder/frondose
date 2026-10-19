import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { refreshTalvori } from '../data/useTalvori.js';
import { Button, Dialog, ErrorMessage, Field, Select, useApp } from '../ui.jsx';
import { Form } from './Form.jsx';
import { DocumentContent } from './DocumentContent.jsx';
import { RevisionComparison } from './RevisionComparison.jsx';
import { requestUpdateNavigation, useUnsavedUpdate } from './UnsavedUpdates.jsx';
import { KNOWLEDGE_CONFLICT_DECISIONS, conflictKnowledgeChoices, knowledgeConflictPairError, knowledgeConflictDecisionBlock, knowledgeConflictDecisionEffect, knowledgeConflictRequest, knowledgeConflictDeliveryUncertain } from '../lib/knowledge-conflicts.js';
import './knowledge-conflicts.css';

const stamp = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Time not recorded';
const decisionLabel = value => KNOWLEDGE_CONFLICT_DECISIONS.find(([id]) => id === value)?.[1] || 'Decision not recorded';

function useConflictRead(path, revision = 0) {
  const [state, setState] = useState({ key: null, loading: false, result: null, error: null });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState({ key: path, loading: true, result: null, error: null });
    apiRequest(path, { signal: controller.signal }).then(({ result }) => {
      if (!controller.signal.aborted) setState({ key: path, loading: false, result, error: null });
    }).catch(error => { if (!controller.signal.aborted) setState({ key: path, loading: false, result: null, error }); });
    return () => controller.abort();
  }, [path, revision]);
  return state.key === path ? state : { loading: Boolean(path), result: null, error: null };
}

function useConflictMutation() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [saved, setSaved] = useState(null), [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false), attempt = useRef(null);
  async function submit(path, payload) {
    if (inFlight.current || saved) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      if (!uncertain) {
        const next = knowledgeConflictRequest(payload, attempt.current?.request, () => crypto.randomUUID());
        attempt.current = { ...next, path };
      }
      const response = await apiRequest(attempt.current.path, { method: 'POST', body: attempt.current.body });
      setUncertain(false); setSaved(response.result);
    } catch (problem) { setError(problem); setUncertain(knowledgeConflictDeliveryUncertain(problem)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return { busy, error, saved, uncertain, submit };
}

export function KnowledgeConflicts({ workspaceId, onClose }) {
  const { data, notify } = useApp();
  const [view, setView] = useState({ type: 'list' }), [status, setStatus] = useState('open'), [revision, setRevision] = useState(0), [scanRevision, setScanRevision] = useState(0);
  const bodyRef = useRef(null), headingRef = useRef(null), previousView = useRef('list');
  const choices = useMemo(() => conflictKnowledgeChoices(data.knowledge_entries, workspaceId), [data.knowledge_entries, workspaceId]);
  const query = new URLSearchParams({ workspace_id: workspaceId, status });
  const list = useConflictRead(view.type === 'list' ? `/api/knowledge-conflicts?${query}` : null, revision);
  const scan = useConflictRead(view.type === 'list' && scanRevision ? `/api/knowledge-conflicts/candidates?${new URLSearchParams({ workspace_id: workspaceId })}` : null, scanRevision);
  const viewKey = `${view.type}:${view.id || ''}`;
  useEffect(() => {
    if (previousView.current === viewKey) return;
    previousView.current = viewKey;
    headingRef.current?.focus({ preventScroll: true });
    if (bodyRef.current) { bodyRef.current.scrollTop = 0; bodyRef.current.scrollLeft = 0; }
  }, [viewKey]);
  const changeView = next => requestUpdateNavigation(() => { setScanRevision(0); setView(next); });
  function savedReport(result) {
    setRevision(value => value + 1); setView({ type: 'detail', id: result.conflict.id });
    notify('Conflict report saved. No knowledge was changed.');
  }
  return <Dialog title="Review knowledge conflicts" subtitle="Human review of exact knowledge versions. No automatic verification or agent work." wide onClose={() => requestUpdateNavigation(onClose)}><div className="knowledge-conflicts-dialog" ref={bodyRef}>
    <h3 ref={headingRef} tabIndex={-1}>{view.type === 'report' ? 'Compare and report a pair' : view.type === 'detail' ? 'Recorded conflict review' : 'Knowledge conflict reports'}</h3>
    <p>Reports preserve the two selected versions. Opening reports and scanning candidates do not change knowledge, send content to a provider, or start work.</p>
    {view.type === 'list' ? <>
      <div className="knowledge-conflicts-actions"><Select label="Report status" value={status} onChange={setStatus}><option value="open">Open</option><option value="resolved">Resolved</option><option value="all">All</option></Select><Button disabled={list.loading} onClick={() => setRevision(value => value + 1)}>Refresh reports</Button><Button variant="primary" onClick={() => changeView({ type: 'report' })}>Compare a pair</Button></div>
      <ErrorMessage error={list.error} />{list.loading ? <p role="status">Loading accessible conflict reports…</p> : list.result ? <><div className="knowledge-conflict-list">{list.result.conflicts?.length ? list.result.conflicts.map(conflict => <button type="button" className="knowledge-conflict-row" key={conflict.id} onClick={() => changeView({ type: 'detail', id: conflict.id })}><strong>{conflict.left.title} ↔ {conflict.right.title}</strong><span>{conflict.status === 'resolved' ? decisionLabel(conflict.decision) : 'Open report'} · {conflict.freshness === 'current' ? 'Current pair' : 'Stale pair'}</span><small>Left v{conflict.left.version} · right v{conflict.right.version} · {stamp(conflict.created_at)}</small><span>{conflict.reason}</span></button>) : <p>No accessible {status === 'all' ? '' : `${status} `}conflict reports were returned.</p>}</div>{list.result.has_more ? <p className="knowledge-conflict-warning">More accessible reports exist beyond this bounded list. Narrow the status filter; older reports are not shown here.</p> : null}</> : null}
      <section className="knowledge-conflict-scan"><h3>Possible conflicts</h3><p>This bounded scan only matches the same literal title, scope and type with different content. It does not detect or verify semantic contradictions, inspect all memories, or assign confidence scores.</p><Button busy={scan.loading} onClick={() => setScanRevision(value => value + 1)}>Scan possible conflicts</Button><ErrorMessage error={scan.error} />{scan.result ? <><p>{scan.result.scanned_count} approved entries scanned · entry limit {scan.result.scan_limit} · pair limit {scan.result.pair_limit}.{scan.result.scan_truncated ? ' The entry scan was truncated.' : ''}{scan.result.pairs_truncated ? ' More matching pairs exist beyond this result.' : ''}</p>{scan.result.candidates?.length ? <div className="knowledge-conflict-list">{scan.result.candidates.map(pair => <article className="knowledge-conflict-candidate" key={`${pair.left.id}:${pair.right.id}`}><strong>{pair.left.title} · v{pair.left.version} ↔ v{pair.right.version}</strong><p>{pair.label || 'Same-title pair with different content; human review needed.'}</p><Button onClick={() => changeView({ type: 'report', pair })}>Compare this pair</Button></article>)}</div> : <p>No matching pairs were returned by this scan. That does not establish that the knowledge is consistent.</p>}</> : null}</section>
      <footer className="form-submit-row"><Button onClick={() => requestUpdateNavigation(onClose)}>Close</Button></footer>
    </> : view.type === 'report' ? <ConflictReport workspaceId={workspaceId} choices={choices} projects={data.projects || []} initialPair={view.pair} onBack={() => changeView({ type: 'list' })} onSaved={savedReport} /> : <ConflictDetail key={view.id} id={view.id} workspaceId={workspaceId} projects={data.projects || []} onBack={() => changeView({ type: 'list' })} onNewPair={pair => changeView({ type: 'report', pair })} onChanged={() => setRevision(value => value + 1)} />}
  </div></Dialog>;
}

function ConflictReport({ workspaceId, choices, projects, initialPair, onBack, onSaved }) {
  const [leftId, setLeftId] = useState(initialPair?.left.id || ''), [rightId, setRightId] = useState(initialPair?.right.id || ''), [reason, setReason] = useState(''), [confirmedPair, setConfirmedPair] = useState('');
  const [refreshing, setRefreshing] = useState(false), [refreshError, setRefreshError] = useState(null);
  const mutation = useConflictMutation(), delivered = useRef(false);
  const left = choices.find(entry => entry.id === leftId), right = choices.find(entry => entry.id === rightId);
  const pairKey = left && right ? `${left.id}:${left.version}:${right.id}:${right.version}` : '';
  const pairError = knowledgeConflictPairError(left, right, workspaceId);
  const confirmed = Boolean(pairKey && confirmedPair === pairKey);
  const disabled = mutation.busy || mutation.uncertain || refreshing;
  const dirty = !mutation.saved && Boolean(leftId || rightId || reason);
  useUnsavedUpdate(dirty, mutation.busy || refreshing);
  useEffect(() => { if (mutation.saved && !mutation.busy && !delivered.current) { delivered.current = true; onSaved(mutation.saved); } }, [mutation.saved, mutation.busy, onSaved]);
  async function refresh() {
    setRefreshing(true); setRefreshError(null); setConfirmedPair('');
    try { await refreshTalvori(); } catch (error) { setRefreshError(error); }
    finally { setRefreshing(false); }
  }
  const optionLabel = entry => `${entry.title} · v${entry.version} · ${entry.project_id ? projects.find(project => project.id === entry.project_id)?.name || 'Project' : 'Workspace'}`;
  return <Form className="knowledge-conflict-form" onSubmit={event => { event.preventDefault(); if (mutation.uncertain || (!pairError && confirmed && reason.trim())) void mutation.submit('/api/knowledge-conflicts', { workspace_id: workspaceId, left_id: left?.id, left_version: left?.version, right_id: right?.id, right_version: right?.version, reason: reason.trim() }); }}>
    <p>Choose any two accessible active approved knowledge entries. The report records your reason and the exact versions shown below; it does not change their approval state.</p>
    <div className="knowledge-conflicts-actions"><span>{choices.length} eligible entries</span><Button busy={refreshing} disabled={mutation.busy || mutation.uncertain} onClick={refresh}>Refresh knowledge</Button></div><ErrorMessage error={refreshError} />
    <div className="knowledge-conflict-pair"><Select label="Left knowledge entry" value={leftId} disabled={disabled} onChange={value => { setLeftId(value); setConfirmedPair(''); }}><option value="">Choose an entry</option>{choices.map(entry => <option value={entry.id} key={entry.id}>{optionLabel(entry)}</option>)}</Select><Select label="Right knowledge entry" value={rightId} disabled={disabled} onChange={value => { setRightId(value); setConfirmedPair(''); }}><option value="">Choose a different entry</option>{choices.map(entry => <option value={entry.id} key={entry.id} disabled={entry.id === leftId}>{optionLabel(entry)}</option>)}</Select></div>
    {pairError ? <p role="status">{pairError}</p> : <KnowledgePair left={left} right={right} projects={projects} />}
    {initialPair && left && right && (initialPair.left.version !== left.version || initialPair.right.version !== right.version) ? <p className="knowledge-conflict-warning">The selected entries changed since the earlier scan or report. These are their currently available approved versions; review them again.</p> : null}
    <Field label="Why does this pair need review?" hint="A human observation, not a verified semantic contradiction."><textarea required rows={4} maxLength={5000} disabled={disabled} value={reason} onChange={event => setReason(event.target.value)} /></Field>
    <label className="knowledge-conflict-check"><input type="checkbox" checked={confirmed} disabled={disabled || Boolean(pairError)} onChange={event => setConfirmedPair(event.target.checked ? pairKey : '')} /><span>I reviewed the displayed versions and want to record this possible conflict. Neither entry will be changed.</span></label>
    <MutationNotice mutation={mutation} /><footer className="form-submit-row"><Button disabled={mutation.busy} onClick={onBack}>Back to reports</Button><Button type="submit" variant="primary" busy={mutation.busy} disabled={Boolean(mutation.saved) || (!mutation.uncertain && (Boolean(pairError) || !confirmed || !reason.trim()))}>{mutation.uncertain ? 'Retry same report' : 'Report possible conflict'}</Button></footer>
  </Form>;
}

function ConflictDetail({ id, workspaceId, projects, onBack, onNewPair, onChanged }) {
  const { notify } = useApp();
  const [revision, setRevision] = useState(0), [decision, setDecision] = useState(''), [rationale, setRationale] = useState(''), [confirmed, setConfirmed] = useState(false);
  const state = useConflictRead(`/api/knowledge-conflicts/${encodeURIComponent(id)}`, revision), mutation = useConflictMutation(), delivered = useRef(false);
  const detail = mutation.saved || state.result;
  const mismatch = detail?.conflict && (detail.conflict.workspace_id !== workspaceId || detail.conflict.id !== id);
  const block = mismatch ? 'The returned report belongs to a different scope.' : knowledgeConflictDecisionBlock(detail);
  const dirty = !mutation.saved && Boolean(decision || rationale || confirmed);
  useUnsavedUpdate(dirty, mutation.busy);
  useEffect(() => {
    if (mutation.saved && !mutation.busy && !delivered.current) {
      delivered.current = true; void refreshTalvori().catch(() => {}); onChanged();
      notify('Human decision recorded. Earlier captured context is unchanged.');
    }
  }, [mutation.saved, mutation.busy, notify, onChanged]);
  const refresh = () => requestUpdateNavigation(() => { setDecision(''); setRationale(''); setConfirmed(false); setRevision(value => value + 1); });
  return <section><div className="knowledge-conflicts-actions"><Button disabled={mutation.busy} onClick={onBack}>Back to reports</Button><Button disabled={mutation.busy || state.loading || Boolean(mutation.saved)} onClick={refresh}>Refresh report</Button></div><ErrorMessage error={state.error} />{state.loading ? <p role="status">Loading exact conflict snapshots…</p> : detail && !mismatch ? <>
    <div className="knowledge-conflict-summary"><p><strong>{detail.conflict.status === 'resolved' ? 'Resolved' : 'Open'}</strong> · {detail.conflict.status === 'resolved' ? detail.conflict.freshness === 'current' ? 'Sources match the recorded decision' : 'Knowledge changed after this decision' : detail.conflict.freshness === 'current' ? 'Recorded versions are current' : 'Recorded pair is stale'} · report revision {detail.conflict.version}</p><p>{detail.conflict.reason}</p><Attribution actor={detail.conflict.reported_by} label="Reported" at={detail.conflict.created_at} /><small>Report ID: {detail.conflict.id}</small></div>
    <h3 className="knowledge-conflict-snapshot-title">Snapshots at report time</h3><p>These are the exact snapshots captured when the report was created. Current entry state may differ; later edits never replace this recorded text.</p><KnowledgePair left={detail.left} right={detail.right} projects={projects} />
    {detail.conflict.status === 'resolved' ? <section className="knowledge-conflict-summary"><h3>{decisionLabel(detail.conflict.decision)}</h3><p>{detail.decision?.rationale || 'Decision rationale unavailable.'}</p><p>{knowledgeConflictDecisionEffect(detail.conflict.decision)}</p><DecisionAttribution decision={detail.decision} resolvedAt={detail.conflict.resolved_at} /><small>Versions immediately after the decision: left v{detail.decision?.left_after_version ?? 'unknown'} · right v{detail.decision?.right_after_version ?? 'unknown'}.</small></section> : block ? <><p className="knowledge-conflict-warning" role="status">{block}</p><Button onClick={() => onNewPair({ left: detail.conflict.left, right: detail.conflict.right })}>Compare current entries</Button></> : <Form className="knowledge-conflict-form" onSubmit={event => { event.preventDefault(); if (mutation.uncertain || (confirmed && decision && rationale.trim() && !block)) void mutation.submit(`/api/knowledge-conflicts/${encodeURIComponent(id)}/decision`, { decision, rationale: rationale.trim(), confirmed: true }); }}>
      <h3>Record a human decision</h3><Select label="Conflict decision" value={decision} disabled={mutation.busy || mutation.uncertain} onChange={value => { setDecision(value); setConfirmed(false); }}><option value="">Choose a decision</option>{KNOWLEDGE_CONFLICT_DECISIONS.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</Select><p>{knowledgeConflictDecisionEffect(decision)}</p>
      <Field label="Decision rationale"><textarea required rows={4} maxLength={5000} disabled={mutation.busy || mutation.uncertain} value={rationale} onChange={event => { setRationale(event.target.value); setConfirmed(false); }} /></Field><label className="knowledge-conflict-check"><input type="checkbox" checked={confirmed} disabled={mutation.busy || mutation.uncertain || !decision} onChange={event => setConfirmed(event.target.checked)} /><span>I reviewed both exact versions and confirm this decision. No text will be merged or deleted.</span></label><MutationNotice mutation={mutation} /><footer className="form-submit-row"><Button type="submit" variant="primary" busy={mutation.busy} disabled={!mutation.uncertain && (!decision || !confirmed || !rationale.trim() || Boolean(block))}>{mutation.uncertain ? 'Retry same decision' : 'Confirm human decision'}</Button></footer>
    </Form>}
  </> : mismatch ? <p role="alert">{block}</p> : null}</section>;
}

function MutationNotice({ mutation }) {
  return <><ErrorMessage error={mutation.error} />{mutation.uncertain ? <p className="knowledge-conflict-warning" role="status">Delivery is uncertain. Retry uses the exact same request and idempotency key; fields are locked to prevent a different decision being sent as the same attempt. Check saved reports before abandoning this draft.</p> : null}</>;
}

function KnowledgePair({ left, right, projects }) {
  const [compare, setCompare] = useState(false);
  const readable = typeof left?.content === 'string' && typeof right?.content === 'string';
  return <section className="knowledge-conflict-reading"><div className="knowledge-conflict-pair">{[['Left', left], ['Right', right]].map(([side, entry]) => <article key={side}><h3>{side} · {entry?.title || 'Entry unavailable'}</h3>{entry ? <><p>Version {entry.version} · {entry.kind || 'Type unavailable'} · {entry.state || 'State unavailable'}</p><small>{entry.project_id ? projects.find(project => project.id === entry.project_id)?.name || `Project ${entry.project_id}` : 'Workspace scope'} · ID {entry.id}</small>{typeof entry.content === 'string' ? <div className="knowledge-conflict-content" tabIndex={0} role="region" aria-label={`${side} exact knowledge text`}><DocumentContent content={entry.content} /></div> : <p className="knowledge-conflict-warning">Exact text is unavailable, not blank. No deletion or agreement is inferred.</p>}{entry.source ? <details><summary>Recorded source or rationale</summary><p>{entry.source}</p></details> : null}{entry.content_hash ? <details><summary>Recorded content hash</summary><code>{entry.content_hash}</code></details> : null}</> : null}</article>)}</div>{readable ? <><Button aria-expanded={compare} onClick={() => setCompare(value => !value)}>{compare ? 'Hide text differences' : 'Compare exact text'}</Button>{compare ? <RevisionComparison before={left.content} after={right.content} base={`Left · ${left.title} v${left.version}`} head={`Right · ${right.title} v${right.version}`} title="Knowledge pair text differences" path="knowledge-pair.md" /> : null}</> : null}</section>;
}

function Attribution({ actor, label, at }) {
  return <p>{label} {stamp(at)} · {actor?.id ? <>Server actor <code>{actor.id}</code>{actor.name ? ` · display name: ${actor.name}` : ''}</> : 'Actor not recorded'}</p>;
}

function DecisionAttribution({ decision, resolvedAt }) {
  return <Attribution actor={decision?.reviewed_by} label="Decided" at={decision?.created_at || resolvedAt} />;
}

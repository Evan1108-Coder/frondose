import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { Button, Dialog, ErrorMessage, Field, Select, useApp } from '../ui.jsx';
import { Form } from './Form.jsx';
import { requestUpdateNavigation, useUnsavedUpdate } from './UnsavedUpdates.jsx';
import { acceptanceApprovalReason, acceptanceRequestBody, acceptanceStateKey, acceptanceStatusLabel, currentAcceptanceArtifacts } from '../lib/acceptance-evidence.js';
import './acceptance-evidence.css';

const stamp = value => value ? new Date(value).toLocaleString() : 'Not recorded';

function useAcceptanceResource(path, key) {
  const [state, setState] = useState({ key: '', loading: true, result: null, error: null });
  const [revision, setRevision] = useState(0);
  const activeKey = `${key}:${revision}`;
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState({ key: activeKey, loading: true, result: null, error: null });
    apiRequest(path, { signal: controller.signal }).then(response => {
      if (!controller.signal.aborted) setState({ key: activeKey, loading: false, result: response.result, error: null });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ key: activeKey, loading: false, result: null, error });
    });
    return () => controller.abort();
  }, [path, activeKey]);
  const current = state.key === activeKey ? state : { loading: true, result: null, error: null };
  return { ...current, reload: () => setRevision(value => value + 1) };
}

export function useAcceptanceEvidence(output, agreement) {
  return useAcceptanceResource(output.task_id && !output.archived_at ? `/api/workflow/outputs/${encodeURIComponent(output.id)}/acceptance-evidence` : null, acceptanceStateKey(output, agreement));
}

export function useRouteAcceptancePolicy(task, agreement) {
  return useAcceptanceResource(`/api/workflow/routes/${encodeURIComponent(task.id)}/acceptance-policy`, `${task.id}:${agreement?.version ?? 0}`);
}

export function AcceptancePolicyControl({ task, agreement, state }) {
  const [confirming, setConfirming] = useState(false);
  const policy = state.result?.policy;
  return <section className="acceptance-policy"><h3>Acceptance evidence</h3>{state.loading ? <p role="status">Checking the Route’s review policy…</p> : state.error ? <><ErrorMessage error={state.error} /><Button onClick={state.reload}>Retry policy check</Button></> : policy?.policy_version === 2 ? <><p>Evidence policy 2 is enabled. Each current criterion needs a human Pass assessment for the exact output version before approval. Manual checklist ticks do not count.</p><small>Enabled {stamp(policy.enabled_at)} · server actor <code>{policy.enabled_by || 'Not recorded'}</code></small></> : <><p>Legacy manual checklist. Ticks record personal progress, not evidence-backed output acceptance.</p><Button disabled={!agreement?.acceptance?.length} onClick={() => setConfirming(true)}>Require evidence for this Route</Button>{!agreement?.acceptance?.length ? <p>Add and save at least one acceptance criterion first.</p> : null}</>}
    {confirming ? <EnablePolicyDialog task={task} agreement={agreement} onClose={() => setConfirming(false)} onSaved={state.reload} /> : null}
  </section>;
}

function EnablePolicyDialog({ task, agreement, onClose, onSaved }) {
  const { notify } = useApp();
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const request = useRef(null), inFlight = useRef(false);
  const [baseVersion] = useState(agreement?.version);
  async function enable(event) {
    event.preventDefault(); if (!confirmed || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const next = acceptanceRequestBody({ route_version: baseVersion, confirmed: true }, request.current, () => crypto.randomUUID()); request.current = next.request;
      await apiRequest(`/api/workflow/routes/${encodeURIComponent(task.id)}/acceptance-policy`, { method: 'POST', body: next.body });
      notify('Evidence-backed acceptance enabled for this Route. Existing history is preserved.'); onSaved(); onClose();
    } catch (problem) { setError(problem); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <Dialog title="Require evidence for this Route?" onClose={() => !busy && onClose()}><Form className="acceptance-evidence-dialog" onSubmit={enable}><p>This enables policy 2 for <strong>{task.title}</strong>. It cannot be disabled or downgraded. Existing outputs, checklist notes and review history are preserved, but old ticks and approvals do not count as new evidence.</p><p>Future approvals require a human Pass assessment for every current criterion, linked to the exact output version. Changing the agreement or creating a new output version requires fresh assessments. This does not complete a Route or start an agent.</p><label className="workflow-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>I understand this Route will require evidence-backed review.</span></label><ErrorMessage error={error} /><footer className="form-submit-row"><Button disabled={busy} onClick={onClose}>Keep legacy policy</Button><Button type="submit" variant="primary" busy={busy} disabled={!confirmed}>Enable evidence policy</Button></footer></Form></Dialog>;
}

export function AcceptanceEvidence({ output, version, agreement, state, onOpenRoute }) {
  const [assessment, setAssessment] = useState(null);
  const result = state.result, policyV2 = result?.policy?.policy_version === 2;
  const reason = acceptanceApprovalReason(state, output, version, agreement);
  const cases = result?.coverage?.cases || [];
  const current = version?.id === result?.output?.output_version_id && result?.output?.version === output.version && result?.coverage?.agreement_version === agreement?.version;
  if (!output.task_id) return <section className="workflow-section acceptance-evidence"><h2>Acceptance evidence</h2><p>No Route is linked. This output uses legacy manual review, without a Route evidence policy.</p></section>;
  if (output.archived_at) return <section className="workflow-section acceptance-evidence"><h2>Acceptance evidence</h2><p>Restore the output to inspect current acceptance evidence. Historical review decisions remain below.</p></section>;
  return <section className="workflow-section acceptance-evidence"><header><h2>Acceptance evidence</h2><Button variant="ghost" disabled={state.loading} onClick={state.reload}>Refresh evidence</Button></header>{state.loading ? <p role="status">Loading current policy and exact-version evidence…</p> : state.error ? <ErrorMessage error={state.error} /> : result ? <>
    <p>{policyV2 ? 'Policy 2 · human assessments, not automatic verification.' : 'Legacy manual review · checklist ticks are not evidence-backed assessments.'}</p>
    {policyV2 ? <><p>{result.coverage.passed} Pass · {result.coverage.failed} Fail · {result.coverage.missing} Missing · agreement v{result.coverage.agreement_version}</p><p role="status">{reason || 'Every current criterion has a readable Pass assessment. Output approval is a separate human decision.'}</p>{!current ? <p>Coverage below is for the latest output and agreement, not the earlier version you are viewing. Select the latest version to record evidence.</p> : null}</> : <p>Enable evidence-backed acceptance from the Route’s work agreement.</p>}
    <div className="acceptance-cases">{cases.map(item => <article key={item.criterion_id}><header><strong>{item.text}</strong><span className={`acceptance-status is-${item.status}`}>{policyV2 ? acceptanceStatusLabel(item.status) : 'Legacy criterion'}</span></header>{policyV2 && current ? <Button onClick={() => setAssessment({ criterion: item, result })}>{item.assessment_id ? 'Record new assessment' : 'Assess criterion'}</Button> : null}</article>)}</div>
    {policyV2 ? <><p>New assessments supersede coverage, never rewrite history. A changed criterion, agreement or output makes earlier assessments historical; unavailable evidence cannot count.</p><AssessmentHistory assessments={result.assessments || []} coverage={result.coverage} /><AcceptedHistory snapshots={result.accepted_reviews || []} /></> : null}
  </> : null}{onOpenRoute ? <Button onClick={onOpenRoute}>Open Route work agreement</Button> : null}
    {assessment ? <CriterionAssessmentDialog output={output} result={assessment.result} criterion={assessment.criterion} onClose={() => setAssessment(null)} onSaved={state.reload} /> : null}
  </section>;
}

function EvidenceArtifact({ artifact }) {
  return <section className="acceptance-artifact"><h4>Exact recorded artifact</h4><p>{artifact?.type === 'run_event' ? 'Terminal run result' : 'Output version'} · <code>{artifact?.id || 'Unavailable'}</code></p>{typeof artifact?.content === 'string' ? <pre tabIndex={0} aria-label="Exact acceptance artifact">{artifact.content || '(Empty artifact)'}</pre> : <p>Content is unavailable; no current content has been substituted.</p>}{artifact?.hash ? <small>Content hash <code>{artifact.hash}</code></small> : null}</section>;
}

function CriterionAssessmentDialog({ output, result, criterion, onClose, onSaved }) {
  const { notify } = useApp();
  const artifacts = currentAcceptanceArtifacts(result);
  const [artifactKey, setArtifactKey] = useState(''), [decision, setDecision] = useState(''), [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState(null);
  const [pinned] = useState({ outputVersion: result.output.version, outputVersionId: result.output.output_version_id, agreementVersion: result.coverage.agreement_version, criterion });
  const artifact = artifacts.find(item => `${item.type}:${item.id}` === artifactKey);
  const request = useRef(null), inFlight = useRef(false), delivered = useRef(false);
  const dirty = !saved && Boolean(artifactKey || decision || rationale);
  useUnsavedUpdate(dirty, busy);
  useEffect(() => { if (saved && !busy && !delivered.current) { delivered.current = true; notify('Assessment recorded. Output approval is still a separate decision.'); onSaved(); onClose(); } }, [saved, busy, notify, onSaved, onClose]);
  async function save(event) {
    event.preventDefault(); if (!artifact || !decision || !rationale.trim() || inFlight.current || saved) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const payload = { output_version: pinned.outputVersion, output_version_id: pinned.outputVersionId, agreement_version: pinned.agreementVersion, criterion_id: pinned.criterion.criterion_id, decision, rationale: rationale.trim(), artifact: { type: artifact.type, id: artifact.id } };
      const next = acceptanceRequestBody(payload, request.current, () => crypto.randomUUID()); request.current = next.request;
      await apiRequest(`/api/workflow/outputs/${encodeURIComponent(output.id)}/acceptance-evidence`, { method: 'POST', body: next.body }); setSaved(true);
    } catch (problem) { setError(problem); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <Dialog title="Assess acceptance criterion" wide onClose={() => requestUpdateNavigation(onClose)}><Form className="acceptance-evidence-dialog" onSubmit={save}><p><strong>{pinned.criterion.text}</strong></p><p>Agreement v{pinned.agreementVersion} · current output <code>{pinned.outputVersionId}</code>. The server rechecks exact versions and source access when you save.</p><fieldset disabled={busy || saved} className="acceptance-evidence-fields"><Select label="Recorded evidence" value={artifactKey} onChange={setArtifactKey}><option value="">Choose an artifact to inspect</option>{artifacts.map(item => <option key={`${item.type}:${item.id}`} value={`${item.type}:${item.id}`}>{item.title || item.type}</option>)}</Select>{artifact ? <EvidenceArtifact artifact={artifact} /> : <p>No artifact selected. You cannot type or paste replacement evidence here.</p>}<Select label="Your assessment" value={decision} onChange={setDecision}><option value="">Choose a result</option><option value="passed">Pass</option><option value="failed">Fail</option></Select><Field label="Checks performed / rationale" hint="Explain what you checked against this criterion. This is a human assessment, not automated proof."><textarea required rows={5} maxLength={20000} value={rationale} onChange={event => setRationale(event.target.value)} /></Field></fieldset><p>Talvori records the signed-in server actor separately from any display name. This immutable assessment does not approve the output, change the Route status or start work.</p><ErrorMessage error={error} /><footer className="form-submit-row"><Button disabled={busy} onClick={() => requestUpdateNavigation(onClose)}>Cancel</Button><Button type="submit" variant="primary" busy={busy} disabled={saved || !artifact || !decision || !rationale.trim()}>Record assessment</Button></footer></Form></Dialog>;
}

function AssessmentHistory({ assessments, coverage }) {
  const currentIds = new Set((coverage?.cases || []).map(item => item.assessment_id).filter(Boolean));
  return <details className="acceptance-history"><summary>Recent assessment history ({assessments.length})</summary><p>Showing up to 500 recent readable assessments. Current coverage is calculated from the full ledger.</p>{assessments.length ? assessments.map(item => <article key={item.id}><h4>{item.criterion_text} · {acceptanceStatusLabel(item.decision)}</h4><p>{currentIds.has(item.id) ? 'Counts toward current coverage' : 'Historical / superseded — does not count toward current coverage'} · agreement v{item.agreement_version}</p><p>Output version <code>{item.output_version_id}</code> · {stamp(item.created_at)}</p><p>{item.rationale}</p><p>Server reviewer: <code>{item.reviewer_id || 'Not recorded'}</code>{item.reviewer_name ? ` · display name: ${item.reviewer_name}` : ''}</p><details><summary>Inspect pinned artifact</summary><EvidenceArtifact artifact={item.artifact} /></details></article>) : <p>No readable assessments recorded.</p>}</details>;
}

function AcceptedHistory({ snapshots }) {
  return <details className="acceptance-history"><summary>Recent accepted checklists ({snapshots.length})</summary><p>Up to 100 recent readable immutable snapshots preserve the exact criteria and assessment references at approval. They do not approve later changes. Records you can no longer access are not displayed.</p>{snapshots.length ? snapshots.map(snapshot => <article key={snapshot.review_id}><h4>Accepted agreement v{snapshot.agreement_version}</h4><p>{stamp(snapshot.created_at)} · output version <code>{snapshot.output_version_id}</code> · review <code>{snapshot.review_id}</code></p><ul>{(snapshot.criteria || []).map(item => <li key={item.criterion_id}><strong>{item.text}</strong><p>{acceptanceStatusLabel(item.decision)} · {item.rationale}</p><small>Server assessor <code>{item.reviewer_id || 'Not recorded'}</code> · artifact <code>{item.artifact?.id || 'Not recorded'}</code>{item.artifact?.hash ? ` · hash ${item.artifact.hash}` : ''}</small></li>)}</ul></article>) : <p>No evidence-backed approval snapshots yet. Legacy reviews are listed separately.</p>}</details>;
}

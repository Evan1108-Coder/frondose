import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { talvoriActions } from '../data/useTalvori.js';
import { Button, Dialog, ErrorMessage, Field, Select, useApp } from '../ui.jsx';
import { Form } from './Form.jsx';
import { ContextInspector } from './ContextInspector.jsx';
import { NativeToolsChoice } from './NativeToolActivity.jsx';
import { requestUpdateNavigation, useUnsavedUpdate } from './UnsavedUpdates.jsx';
import { skillCoverageRows, skillEvaluationsComparable, skillPreparationUsable, skillRequestBody } from '../lib/skills.js';
import { agentReadiness } from '../lib/agents.js';
import { Play, RotateCw, FlaskConical } from './icons.jsx';
import './skill-evaluation.css';

const stamp = value => value && Number.isFinite(typeof value === 'number' ? value : Date.parse(value)) ? new Date(value).toLocaleString() : 'Time not recorded';
const label = value => typeof value === 'string' && value ? value.replaceAll('_', ' ') : 'Not recorded';

export function SkillReliability({ skill, versions, onCoverage }) {
  const { navigate, data } = useApp();
  const [state, setState] = useState({ loading: true, result: null, error: null }), [revision, setRevision] = useState(0);
  const [testCase, setTestCase] = useState(null), [recording, setRecording] = useState(null), [comparing, setComparing] = useState(false), [cancel, setCancel] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const callbacks = useRef({ onCoverage }); callbacks.current = { onCoverage };
  const cancelRequest = useRef(null), inFlight = useRef(false);
  const version = versions.find(item => item.number === skill.version);
  useUnsavedUpdate(false, busy);
  const reload = () => setRevision(value => value + 1);
  useEffect(() => {
    const controller = new AbortController(); callbacks.current.onCoverage?.(null);
    setState(current => ({ loading: true, result: current.result, error: null }));
    apiRequest(`/api/skills/${encodeURIComponent(skill.id)}/reliability`, { signal: controller.signal }).then(({ result }) => {
      if (controller.signal.aborted) return;
      if (!result || !Array.isArray(result.evaluations) || !Array.isArray(result.preparations) || !result.coverage) throw new Error('The server did not return current Skill evidence. Refresh before evaluating or publishing.');
      setState({ loading: false, result, error: null }); callbacks.current.onCoverage?.(result.coverage);
    }).catch(problem => { if (!controller.signal.aborted) setState({ loading: false, result: null, error: problem }); });
    return () => controller.abort();
  }, [skill.id, skill.version, revision]);
  async function cancelPreparation() {
    if (!cancel || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const next = skillRequestBody({ version: cancel.version }, cancelRequest.current, () => crypto.randomUUID()); cancelRequest.current = next.request;
      await apiRequest(`/api/skills/${encodeURIComponent(skill.id)}/evaluation-preparations/${encodeURIComponent(cancel.id)}/cancel`, { method: 'POST', body: next.body }); setCancel(null); reload();
    } catch (problem) { setError(problem); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const rows = skillCoverageRows(skill, state.result?.coverage);
  return <section className="skill-reliability"><header><div><h2>Case coverage & evaluations</h2><p>Manual verdicts tied to exact case inputs, profile versions, and recorded output evidence. A pass does not independently verify a Skill or authorize future work.</p></div><Button icon={RotateCw} disabled={state.loading} onClick={reload}>Refresh evidence</Button></header><ErrorMessage error={state.error} />{state.loading ? <p role="status">Loading case evidence…</p> : null}
    <div className="skill-case-coverage">{rows.map((item, index) => <article key={item.id || index}><header><div><strong>{item.name}</strong><span className={`skill-case-status is-${item.status}`}>{item.status === 'passed' ? 'Pass' : item.status === 'failed' ? 'Fail' : 'Missing'}</span></div><Button icon={FlaskConical} disabled={state.loading || !!state.error || !item.id || !version} onClick={() => setTestCase(item)}>Evaluate case</Button></header>{item.legacy ? <p className="skill-note">Legacy case definition. Save a new Skill version to assign a stable case ID before evaluation.</p> : null}<details><summary>Inputs & expected result</summary><pre tabIndex={0}>{JSON.stringify(item.inputs, null, 2)}</pre><p>{item.expected_output}</p></details></article>)}</div>{!rows.length ? <p>Add defined test cases in a new Skill version to evaluate this capability.</p> : null}
    {state.result ? <><section className="skill-evaluation-history"><h3>Prepared and launched evaluations</h3><p>Preparing reserves an evaluation; it does not launch work. Bound runs need a manual verdict after they finish.</p>{state.result.preparations.length ? state.result.preparations.map(preparation => {
      const run = (data.runs || []).find(item => item.id === preparation.canonical_run_id);
      const recordedVersion = versions.find(item => item.id === preparation.version_id);
      return <article key={preparation.id}><header><strong>{preparation.test_case_name || recordedVersion?.definition?.test_cases?.find(item => item.id === preparation.test_case_id)?.name || preparation.test_case_id || 'Recorded case'} · v{preparation.version_number || recordedVersion?.number || 'unknown'}</strong><span>{preparation.expired ? 'Preparation expired' : label(preparation.status)}</span></header><p>{stamp(preparation.created_at)}{preparation.expires_at && !preparation.canonical_run_id ? ` · preparation expires ${stamp(preparation.expires_at)}` : ''}</p><div className="skill-evaluation-actions">{preparation.canonical_run_id ? <><Button onClick={() => navigate('work', preparation.canonical_run_id)}>Open recorded run</Button><span>{run ? `Run ${label(run.status)}` : 'Run status unavailable; open the run to inspect.'}</span>{preparation.status === 'bound' && preparation.artifacts?.length ? <Button variant="primary" onClick={() => setRecording(preparation)}>Review evidence & record result</Button> : preparation.status === 'bound' ? <small>No readable terminal evidence returned. Finish the run, then refresh evidence.</small> : null}</> : preparation.status === 'prepared' ? <><p>The launch token is not restored from history. Cancel this unused preparation, then explicitly prepare again if needed.</p><Button onClick={() => { cancelRequest.current = null; setError(null); setCancel(preparation); }}>Cancel unused preparation</Button></> : null}</div></article>;
    }) : <p>No evaluations prepared. Nothing has been launched here.</p>}</section>
      <section className="skill-evaluation-history"><header><h3>Recorded evaluations</h3><Button disabled={!state.result.evaluations.some(left => state.result.evaluations.some(right => skillEvaluationsComparable(left, right)))} onClick={() => setComparing(true)}>Compare evaluations</Button></header>{state.result.evaluations.length ? state.result.evaluations.map(evaluation => <details key={evaluation.id}><summary>{evaluation.test_case_name} · Skill v{evaluation.version_number} · {evaluation.outcome === 'passed' ? 'Pass' : 'Fail'} · {stamp(evaluation.created_at)}</summary><EvaluationEvidence evaluation={evaluation} />{evaluation.notes ? <p>Human notes: {evaluation.notes}</p> : null}<Button onClick={() => navigate('work', evaluation.run_id)}>Inspect recorded run</Button></details>) : <p>No case-bound results recorded. A provider finishing a run does not assign a pass.</p>}</section>
      <section className="skill-evaluation-history"><h3>Manual comparisons</h3><p>Comparisons never publish a Skill or choose a model automatically.</p>{state.result.comparisons?.length ? state.result.comparisons.map(comparison => <details key={comparison.id}><summary>{label(comparison.decision)} · {stamp(comparison.created_at)}</summary><p>{comparison.rationale}</p><p>Human evaluator: <code>{comparison.evaluator_id}</code></p><div className="skill-comparison-grid">{[['Left', comparison.left_evaluation_id], ['Right', comparison.right_evaluation_id]].map(([side, id]) => { const evaluation = state.result.evaluations.find(item => item.id === id); return <section key={id}><h4>{side}</h4>{evaluation ? <EvaluationEvidence evaluation={evaluation} /> : <p>Recorded evidence is no longer available in this view.</p>}</section>; })}</div></details>) : <p>No comparisons recorded.</p>}</section></> : null}
    {testCase && version ? <SkillEvaluationPrepare skill={skill} version={version} testCase={testCase} onClose={() => setTestCase(null)} onChanged={reload} /> : null}
    {recording ? <SkillEvaluationResult skill={skill} preparation={recording} version={versions.find(item => item.id === recording.version_id)} onClose={() => setRecording(null)} onSaved={reload} /> : null}
    {comparing ? <SkillEvaluationComparison skill={skill} evaluations={state.result?.evaluations || []} onClose={() => setComparing(false)} onSaved={reload} /> : null}
    {cancel ? <Dialog title="Cancel unused evaluation preparation?" onClose={() => !busy && setCancel(null)}><p>This invalidates the unused reservation only. It does not launch or stop a provider and does not delete historical evidence.</p><ErrorMessage error={error} /><footer className="dialog-footer"><Button disabled={busy} onClick={() => setCancel(null)}>Keep preparation</Button><Button variant="danger" busy={busy} onClick={cancelPreparation}>Cancel preparation</Button></footer></Dialog> : null}
  </section>;
}

function EvidenceArtifact({ artifact }) {
  return <section className="skill-evidence"><h4>Exact recorded evidence</h4>{artifact && typeof artifact.content === 'string' ? <><p>{label(artifact.type)} · <code>{artifact.id}</code></p><pre tabIndex={0} aria-label="Exact recorded evidence">{artifact.content || '(Empty recorded artifact)'}</pre>{artifact.hash ? <p className="skill-evidence-hash">Content hash <code>{artifact.hash}</code></p> : null}</> : <p>Recorded evidence is unavailable. No output will be reconstructed from current data.</p>}</section>;
}

function EvaluationEvidence({ evaluation }) {
  const profile = evaluation.profile || evaluation.provenance?.profile || {};
  return <div className="skill-evaluation-evidence"><dl className="skill-evaluation-facts"><div><dt>Skill / case</dt><dd>v{evaluation.version_number} · {evaluation.test_case_name}</dd></div><div><dt>Agent profile</dt><dd>{profile.name ? `${profile.name} · ` : ''}<code>{evaluation.agent_id}</code> · v{evaluation.profile_version}</dd></div><div><dt>Provider</dt><dd>{profile.provider || 'Not recorded'}</dd></div><div><dt>Configured model</dt><dd>{profile.model || 'Provider default / not recorded'}</dd></div><div><dt>Reasoning</dt><dd>{profile.reasoning_effort || 'Provider default / not recorded'}</dd></div><div><dt>Work mode</dt><dd>{label(evaluation.work_mode)}</dd></div><div><dt>Permission</dt><dd>{label(evaluation.permission_mode)}</dd></div><div><dt>Run outcome</dt><dd>{label(evaluation.run_status)}{evaluation.run_error_code ? ` · ${evaluation.run_error_code}` : ''}</dd></div><div><dt>Human verdict</dt><dd>{evaluation.outcome === 'passed' ? 'Pass' : evaluation.outcome === 'failed' ? 'Fail' : 'Not recorded'}</dd></div><div><dt>Context fingerprint</dt><dd><code>{evaluation.context_fingerprint || 'Not recorded'}</code></dd></div><div><dt>Profile fingerprint</dt><dd><code>{evaluation.profile_snapshot_hash || 'Not recorded'}</code></dd></div><div><dt>Input fingerprint</dt><dd><code>{evaluation.input_hash || 'Not recorded'}</code></dd></div><div><dt>Human evaluator</dt><dd><code>{evaluation.evaluator_id || 'Not recorded'}</code></dd></div></dl><p className="skill-note">Model values are pinned configuration, not proof of the provider’s resolved internal model. Shared account limits apply.</p><details><summary>Pinned inputs</summary><pre tabIndex={0}>{JSON.stringify(evaluation.inputs, null, 2)}</pre></details><EvidenceArtifact artifact={evaluation.artifact} /></div>;
}

function SkillEvaluationResult({ skill, preparation, version, onClose, onSaved }) {
  const { data } = useApp();
  const artifacts = preparation.artifacts || [];
  const testCase = version?.definition?.test_cases?.find(item => item.id === preparation.test_case_id);
  const canonicalRun = (data.runs || []).find(item => item.id === preparation.canonical_run_id);
  const [artifactKey, setArtifactKey] = useState(''), [outcome, setOutcome] = useState(''), [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState(null);
  const request = useRef(null), inFlight = useRef(false), delivered = useRef(false);
  const artifact = artifacts.find(item => `${item.type}:${item.id}` === artifactKey);
  const dirty = !saved && Boolean(artifactKey || outcome || notes);
  useUnsavedUpdate(dirty, busy);
  useEffect(() => { if (saved && !busy && !delivered.current) { delivered.current = true; onSaved(); onClose(); } }, [saved, busy, onSaved, onClose]);
  async function save(event) {
    event.preventDefault(); if (!artifact || !outcome || inFlight.current || saved) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const payload = { preparation_id: preparation.id, outcome, notes: notes.trim(), artifact: { type: artifact.type, id: artifact.id } };
      const next = skillRequestBody(payload, request.current, () => crypto.randomUUID()); request.current = next.request;
      await apiRequest(`/api/skills/${encodeURIComponent(skill.id)}/evaluations`, { method: 'POST', body: next.body }); setSaved(true);
    } catch (problem) { setError(problem); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <Dialog wide title="Review evidence & record result" subtitle={`${preparation.test_case_name} · Skill v${preparation.version_number}`} onClose={() => requestUpdateNavigation(onClose)}><Form onSubmit={save} className="skill-evaluation-dialog"><fieldset disabled={busy || saved} className="skill-evaluation-fields"><p>This is your manual assessment of one exact case. Select server-recorded evidence; you cannot replace the provider output with typed text. The server rechecks the terminal run and pins the selected artifact.</p><p>Canonical run <code>{preparation.canonical_run_id}</code> · profile v{preparation.profile_version}</p><details open><summary>Pinned inputs & expected result</summary><pre tabIndex={0}>{JSON.stringify(preparation.inputs, null, 2)}</pre><p><strong>Expected result:</strong> {testCase?.expected_output || 'The pinned expected result is unavailable in this view. Inspect the immutable version before grading.'}</p></details><Select required label="Recorded artifact to evaluate" value={artifactKey} onChange={setArtifactKey}><option value="">Select exact run evidence…</option>{artifacts.map(item => <option key={`${item.type}:${item.id}`} value={`${item.type}:${item.id}`}>{item.title || label(item.type)} · {item.id}</option>)}</Select>{artifact ? <EvidenceArtifact artifact={artifact} /> : <p>No evidence selected. A run completion alone is not a pass.</p>}<Select required label="Your observed result" value={outcome} onChange={setOutcome}><option value="">Choose after reviewing evidence…</option><option value="passed" disabled={canonicalRun?.status !== 'completed'}>Pass · manual assessment (completed run required)</option><option value="failed">Fail · manual assessment</option></Select><Field label="Checks performed / rationale" hint="Human notes only. These do not replace the pinned artifact or change permissions."><textarea rows={4} maxLength={10000} value={notes} onChange={event => setNotes(event.target.value)} /></Field><ErrorMessage error={error} /><p>The evaluation is immutable once saved. A later evaluation may change current case coverage; past evidence remains readable.</p><footer className="form-submit-row"><Button disabled={busy} onClick={() => requestUpdateNavigation(onClose)}>Cancel</Button><Button type="submit" variant="primary" busy={busy} disabled={!artifact || !outcome || !testCase || outcome === 'passed' && canonicalRun?.status !== 'completed' || saved}>Record manual result</Button></footer></fieldset></Form></Dialog>;
}

function SkillEvaluationComparison({ skill, evaluations, onClose, onSaved }) {
  const comparable = evaluations.filter(left => evaluations.some(right => skillEvaluationsComparable(left, right)));
  const [leftId, setLeftId] = useState(''), [rightId, setRightId] = useState(''), [decision, setDecision] = useState(''), [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState(null);
  const request = useRef(null), inFlight = useRef(false), delivered = useRef(false);
  const left = evaluations.find(item => item.id === leftId), right = evaluations.find(item => item.id === rightId);
  const rightOptions = left ? evaluations.filter(item => skillEvaluationsComparable(left, item)) : [];
  const valid = skillEvaluationsComparable(left, right);
  const dirty = !saved && Boolean(leftId || rightId || decision || rationale);
  useUnsavedUpdate(dirty, busy);
  useEffect(() => { if (saved && !busy && !delivered.current) { delivered.current = true; onSaved(); onClose(); } }, [saved, busy, onSaved, onClose]);
  async function save(event) {
    event.preventDefault(); if (!valid || !decision || !rationale.trim() || inFlight.current || saved) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const next = skillRequestBody({ left_evaluation_id: left.id, right_evaluation_id: right.id, decision, rationale: rationale.trim() }, request.current, () => crypto.randomUUID()); request.current = next.request;
      await apiRequest(`/api/skills/${encodeURIComponent(skill.id)}/comparisons`, { method: 'POST', body: next.body }); setSaved(true);
    } catch (problem) { setError(problem); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const optionLabel = evaluation => `${evaluation.test_case_name} · Skill v${evaluation.version_number} · ${evaluation.agent_id} profile v${evaluation.profile_version} · ${stamp(evaluation.created_at)}`;
  return <Dialog wide title="Compare recorded evaluations" subtitle="Same case and exact inputs; a human assessment, not a controlled benchmark" onClose={() => requestUpdateNavigation(onClose)}><Form onSubmit={save} className="skill-evaluation-dialog"><fieldset disabled={busy || saved} className="skill-evaluation-fields"><p>The two evaluations must use the same case ID and input fingerprint. Surrounding context, instructions, model configuration, and permissions may differ. Changed memory or sources can affect results. No confidence score is inferred.</p><div className="skill-comparison-grid"><Select required label="Left evaluation" value={leftId} onChange={value => { setLeftId(value); setRightId(''); setDecision(''); }}>{[<option key="blank" value="">Select left evaluation…</option>, ...comparable.map(item => <option key={item.id} value={item.id}>{optionLabel(item)}</option>)]}</Select><Select required label="Right evaluation · identical inputs" value={rightId} disabled={!left} onChange={value => { setRightId(value); setDecision(''); }}><option value="">Select matching evaluation…</option>{rightOptions.map(item => <option key={item.id} value={item.id}>{optionLabel(item)}</option>)}</Select></div>{valid ? <div className="skill-comparison-grid"><section><h3>Left</h3><EvaluationEvidence evaluation={left} /></section><section><h3>Right</h3><EvaluationEvidence evaluation={right} /></section></div> : <p>Choose two comparable evaluations to inspect their pinned evidence side by side.</p>}<Select required label="Your comparison verdict" value={decision} onChange={setDecision}><option value="">Choose after comparing…</option><option value="left_better">Left is better for this case</option><option value="right_better">Right is better for this case</option><option value="equivalent">Equivalent for this case</option><option value="inconclusive">Inconclusive</option></Select><Field label="Comparison rationale"><textarea required rows={4} maxLength={10000} value={rationale} onChange={event => setRationale(event.target.value)} /></Field><ErrorMessage error={error} /><p>Saving records an immutable manual comparison. It does not update the agent, change case grades, publish a Skill, or start another run.</p><footer className="form-submit-row"><Button disabled={busy} onClick={() => requestUpdateNavigation(onClose)}>Cancel</Button><Button variant="primary" type="submit" busy={busy} disabled={!valid || !decision || !rationale.trim() || saved}>Save manual comparison</Button></footer></fieldset></Form></Dialog>;
}

export function SkillEvaluationPrepare({ skill, version, testCase, onClose, onChanged }) {
  const { data, workspace } = useApp();
  const agents = (data.agents || []).filter(agent => agent.workspace_id === workspace.id && !agent.archived_at && agent.status !== 'paused' && ['codex', 'claude'].includes(agent.provider));
  const [agentId, setAgentId] = useState(agents.some(agent => agent.id === skill.preferred_agent_id) ? skill.preferred_agent_id : '');
  const [workMode, setWorkMode] = useState('conversation'), [permission, setPermission] = useState('read-only');
  const [includeMemory, setIncludeMemory] = useState(false), [nativeTools, setNativeTools] = useState(false), [timeout, setTimeoutSeconds] = useState(300);
  const [prepared, setPrepared] = useState(null), [reviewed, setReviewed] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(null), [uncertain, setUncertain] = useState(false), [launched, setLaunched] = useState(false);
  const request = useRef(null), inFlight = useRef(false), delivered = useRef(false);
  const agent = agents.find(item => item.id === agentId);
  const connection = agent && (data.connections || []).find(item => item.id === agent.provider_connection_id);
  const readiness = agent ? agentReadiness(agent, connection) : null;
  const project = (data.projects || []).find(item => item.id === skill.project_id && item.workspace_id === workspace.id && !item.archived_at);
  const canWrite = workMode === 'project' && agent?.provider === 'codex' && agent.permission_policy !== 'read-only';
  const valid = reviewed && Date.parse(reviewed.expires_at) > Date.now() && skillPreparationUsable(prepared?.preparation);
  useUnsavedUpdate(false, busy);
  useEffect(() => {
    if (launched && !busy && !delivered.current) { delivered.current = true; onChanged(); onClose(); }
  }, [launched, busy, onChanged, onClose]);
  async function prepare(event) {
    event.preventDefault(); if (inFlight.current || !agent || !readiness?.canStartLive || !version?.id || !testCase?.id) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const payload = { skill_version_id: version.id, test_case_id: testCase.id, agent_id: agent.id, profile_version: agent.version, work_mode: workMode, permission_mode: canWrite ? permission : 'read-only', include_memory: includeMemory, native_tools: nativeTools, timeout_ms: Number(timeout) * 1000 };
      const next = skillRequestBody(payload, request.current, () => crypto.randomUUID()); request.current = next.request;
      const { result } = await apiRequest(`/api/skills/${encodeURIComponent(skill.id)}/evaluations/prepare`, { method: 'POST', body: next.body });
      if (!result?.preparation?.id || !result.context_inspection_request || !result.run_request) throw new Error('The server did not return a complete evaluation preparation. Refresh evaluation history before trying again.');
      setPrepared(result); setReviewed(null); onChanged();
    } catch (problem) { setError(problem); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function launch() {
    if (!valid || inFlight.current || uncertain || launched) return;
    if (!skillPreparationUsable(prepared?.preparation) || Date.parse(reviewed.expires_at) <= Date.now()) { setReviewed(null); setError(new Error('Evaluation preparation or reviewed context expired. Close this dialog and prepare again.')); return; }
    inFlight.current = true; setBusy(true); setError(null);
    try {
      await apiRequest('/api/runs', { method: 'POST', body: { ...prepared.run_request, context_inspection_id: reviewed.id } });
      await talvoriActions.refresh().catch(() => {}); setLaunched(true);
    } catch (problem) { setError(problem); setReviewed(null); if (!problem.status || problem.status >= 500) setUncertain(true); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <Dialog wide title={`Evaluate ${testCase.name}`} subtitle={`Skill version ${version.number} · one bounded, explicitly launched live run`} onClose={() => !busy && onClose()}><div className="skill-evaluation-dialog"><p>Test inputs and expected result are pinned to this Skill version. Preparation does not start a provider. The result will remain ungraded until you review recorded evidence.</p><details><summary>Pinned test case</summary><pre tabIndex={0}>{JSON.stringify(testCase.inputs, null, 2)}</pre><p>{testCase.expected_output}</p></details>
    {!prepared ? <Form onSubmit={prepare}><fieldset disabled={busy} className="skill-evaluation-fields"><Select required label="Agent profile" value={agentId} onChange={value => { setAgentId(value); setPermission('read-only'); }}><option value="">Choose an active agent…</option>{agents.map(item => <option key={item.id} value={item.id}>{item.name} · {item.provider} · profile v{item.version}</option>)}</Select>{agent ? <><p>{readiness.label}: {readiness.description}</p><dl className="skill-evaluation-facts"><div><dt>Model</dt><dd>{agent.model || 'Provider default · resolved model may be unknown'}</dd></div><div><dt>Reasoning</dt><dd>{agent.reasoning_effort || 'Provider default / not exposed'}</dd></div></dl></> : null}<Select label="Work mode" value={workMode} onChange={value => { setWorkMode(value); setPermission('read-only'); }}><option value="conversation">General conversation · supplied context only</option>{project ? <option value="project">Project files · {project.name}</option> : null}</Select>{!project ? <p className="skill-note">This Skill has no active linked project. Evaluation uses a private conversation workspace, not an arbitrary folder.</p> : null}<Select label="File permission for this evaluation" value={canWrite ? permission : 'read-only'} onChange={setPermission}><option value="read-only">Read-only</option>{canWrite ? <option value="workspace-write">Allow project file edits</option> : null}</Select>{permission === 'workspace-write' && canWrite ? <p className="skill-evaluation-warning">The explicit launch may edit files in the linked project. A later failed evaluation does not roll back those edits.</p> : null}<Field label="Provider execution limit (seconds)" hint="Does not estimate or enforce provider token or cost usage."><input required type="number" min="1" max="1800" step="1" value={timeout} onChange={event => setTimeoutSeconds(event.target.value)} /></Field><label className="skill-check"><input type="checkbox" checked={includeMemory} onChange={event => setIncludeMemory(event.target.checked)} />Include approved memory allowed by this profile</label><NativeToolsChoice checked={nativeTools} onChange={setNativeTools} disabled={busy} /><ErrorMessage error={error} /><footer className="form-submit-row"><Button disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy} disabled={!agent || !readiness?.canStartLive || !version?.id || !testCase.id}>Prepare evaluation</Button></footer></fieldset></Form> : <><p>Preparation <code>{prepared.preparation.id}</code>{prepared.preparation.expires_at ? ` · expires ${stamp(prepared.preparation.expires_at)}` : ''}. Requested permission: {label(prepared.context_inspection_request.permission_mode)}.</p><ContextInspector request={prepared.context_inspection_request} onReviewed={setReviewed} onInvalidated={() => setReviewed(null)} /><ErrorMessage error={error} />{uncertain ? <p className="skill-evaluation-warning" role="alert">Launch delivery is uncertain. Close this dialog and refresh evaluation history. If a run was bound, inspect that existing run. Do not prepare a second evaluation to retry this delivery.</p> : null}<p>This launch uses the connected provider account and its shared limits. It is not a simulation. Provider-owned internal context is not visible to Talvori.</p><footer className="form-submit-row"><Button disabled={busy} onClick={onClose}>Back to evaluations</Button><Button variant="primary" icon={Play} busy={busy} disabled={!valid || uncertain || launched} onClick={launch}>Launch reviewed evaluation</Button></footer></>}
  </div></Dialog>;
}

import { lazy, Suspense, useState } from 'react';
import { ArrowRight, Check, Pencil, Plus, X } from './icons.jsx';
import { Button, Dialog, ErrorMessage, Field, Select, useApp, useAsync } from '../ui.jsx';
import { Form } from './Form.jsx';
import { OUTPUT_TYPES, blockedDependencies, routeAgreement, workflowLabel, workflowRequest } from '../lib/workflow.js';
import { RouteTools } from './RouteTools.jsx';
import { SubRoutes } from './SubRoutes.jsx';
import { AcceptancePolicyControl, useRouteAcceptancePolicy } from './AcceptanceEvidence.jsx';
const OutputEditor = lazy(() => import('../views/Library.jsx').then(m => ({ default: m.OutputEditor })));
import { visible } from '../lib/model.js';
import '../views/library.css';

export function RouteWorkflow({ task }) {
  const { data, perform, navigate } = useApp();
  const [editing, setEditing] = useState(false), [creatingOutput, setCreatingOutput] = useState(false), [pendingAcceptance, setPendingAcceptance] = useState(null);
  const agreement = routeAgreement(data, task.id);
  const evidencePolicy = useRouteAcceptancePolicy(task, agreement);
  const policyV2 = evidencePolicy.result?.policy?.policy_version === 2;
  const blockers = blockedDependencies(data, agreement);
  const outputs = (data.outputs ?? []).filter(row => row.task_id === task.id && !row.archived_at);
  const chats = visible(data.chats).filter(row => row.task_id === task.id);
  const toggleCriterion = async (criterionId, done) => {
    if (policyV2 || evidencePolicy.loading || evidencePolicy.error) return;
    const acceptance = agreement.acceptance.map(item => item.id === criterionId ? { ...item, done } : item);
    setPendingAcceptance(acceptance);
    try { await perform(() => workflowRequest(`routes/${task.id}`, { version: agreement.version, acceptance }, 'PATCH')); }
    finally { setPendingAcceptance(null); }
  };
  return <section className="route-workflow"><div className="section-heading"><h2>Work agreement</h2><Button icon={Pencil} onClick={() => setEditing(true)}>Edit agreement</Button></div><p className="workflow-note">Define what a successful result means. Agent completion and human acceptance are separate.</p>
    <dl className="workflow-properties"><div><dt>Human owner</dt><dd>{agreement?.owner_name || 'Not assigned'}</dd></div><div><dt>Reviewer</dt><dd>{agreement?.reviewer_name || 'Not assigned'}</dd></div><div><dt>Expected output</dt><dd>{workflowLabel(agreement?.output_type ?? 'document')}</dd></div></dl>
    {agreement?.acceptance.length ? policyV2 ? <section><h3>Current acceptance criteria</h3><ul className="workflow-criteria-summary">{agreement.acceptance.map(item => <li key={item.id}>{item.text}</li>)}</ul><p className="workflow-note">Assess each criterion from an output’s acceptance evidence panel. A checklist tick cannot satisfy evidence policy 2.</p></section> : <fieldset className="workflow-checklist" disabled={Boolean(pendingAcceptance) || evidencePolicy.loading || Boolean(evidencePolicy.error)}><legend>Legacy manual checklist</legend>{(pendingAcceptance ?? agreement.acceptance).map(item => <label key={item.id}><input type="checkbox" checked={item.done} onChange={e => toggleCriterion(item.id, e.target.checked)} /><span>{item.text}</span></label>)}</fieldset> : <button className="workflow-inline-action" onClick={() => setEditing(true)}><Plus />Add acceptance criteria</button>}
    <AcceptancePolicyControl task={task} agreement={agreement} state={evidencePolicy} />
    {agreement?.hierarchy_restricted ? <p className="workflow-note">Some relationships are unavailable; completion cannot be determined.</p> : blockers.length ? <div className="workflow-notice"><strong>Waiting on {blockers.length} route{blockers.length === 1 ? '' : 's'}</strong>{blockers.map(row => <button key={row.id} onClick={() => navigate('tasks', row.id)}>{row.title}<ArrowRight /></button>)}</div> : agreement?.dependency_ids.length ? <p className="workflow-note"><Check />All linked dependencies are complete.</p> : null}
    <SubRoutes key={task.id} task={task} />
    <section className="workflow-section"><div className="section-heading"><h3>Outputs & reviews</h3><Button icon={Plus} onClick={() => setCreatingOutput(true)}>Add output</Button></div>{outputs.length ? outputs.map(output => <button className="workflow-link" key={output.id} onClick={() => navigate('library', output.id)}><span>{output.title}</span><small>{workflowLabel(output.state)} · v{output.current_version}</small><ArrowRight /></button>) : <p className="workflow-note">Attach a versioned result, review it, and request changes without losing the original work.</p>}</section>
    {chats.length ? <section className="workflow-section"><h3>Related conversations</h3>{chats.map(chat => <button className="workflow-link" key={chat.id} onClick={() => navigate('chats', chat.id)}><span>{chat.title}</span><ArrowRight /></button>)}</section> : null}
    <RouteTools task={task}/>
    {editing ? <AgreementEditor key={task.id} task={task} agreement={agreement} evidencePolicy={evidencePolicy} onClose={() => setEditing(false)} /> : null}{creatingOutput ? <Suspense fallback={<p role="status">Opening output editor…</p>}><OutputEditor task={task} onClose={() => setCreatingOutput(false)} /></Suspense> : null}
  </section>;
}

function AgreementEditor({ task, agreement, evidencePolicy, onClose }) {
  const { data, notify } = useApp();
  const defaults = { owner_name: agreement?.owner_name ?? '', reviewer_name: agreement?.reviewer_name ?? '', output_type: agreement?.output_type ?? 'document', acceptance: agreement?.acceptance ?? [], dependency_ids: agreement?.dependency_ids ?? [] };
  const [form, setForm] = useState(defaults), [baseVersion] = useState(agreement?.version ?? 0), [initial] = useState(JSON.stringify(defaults)), [discard, setDiscard] = useState(false), [criterion, setCriterion] = useState('');
  const { busy, error, execute } = useAsync();
  const routes = visible(data.tasks).filter(row => row.id !== task.id);
  const dirty = JSON.stringify(form) !== initial || Boolean(criterion);
  const legacyChecks = !evidencePolicy.loading && !evidencePolicy.error && evidencePolicy.result?.policy?.policy_version === 1;
  const patch = (key, value) => setForm(old => ({ ...old, [key]: value }));
  const addCriterion = () => { if (!criterion.trim()) return; patch('acceptance', [...form.acceptance, { id: crypto.randomUUID(), text: criterion.trim(), done: false }]); setCriterion(''); };
  return <Dialog title={discard ? 'Discard agreement changes?' : 'Edit work agreement'} wide onClose={() => { if (!busy) dirty ? setDiscard(true) : onClose(); }}>{discard ? <div className="workflow-form"><p>The saved agreement stays unchanged.</p><Button onClick={() => setDiscard(false)}>Keep editing</Button><Button variant="danger" onClick={onClose}>Discard changes</Button></div> : <Form className="workflow-form" onSubmit={e => { e.preventDefault(); execute(async () => { const acceptance = criterion.trim() ? [...form.acceptance, { id: crypto.randomUUID(), text: criterion.trim(), done: false }] : form.acceptance; await workflowRequest(`routes/${task.id}`, { ...form, acceptance, version: baseVersion }, 'PATCH'); notify('Work agreement saved'); onClose(); }); }}>
    <div className="workflow-fields"><Field label="Human owner"><input maxLength={120} value={form.owner_name} onChange={e => patch('owner_name', e.target.value)} /></Field><Field label="Reviewer display name" hint="Responsibility label only; a review records its server actor separately."><input maxLength={120} value={form.reviewer_name} onChange={e => patch('reviewer_name', e.target.value)} /></Field></div>
    <Select label="Expected output" value={form.output_type} onChange={v => patch('output_type', v)}>{OUTPUT_TYPES.map(type => <option key={type} value={type}>{workflowLabel(type)}</option>)}</Select>
    {!legacyChecks ? <p className="workflow-note">Evidence assessments belong to exact output versions. Saving a changed agreement requires fresh assessments; manual checklist ticks are not acceptance evidence.</p> : null}
    <fieldset className="workflow-checklist"><legend>Acceptance criteria</legend>{form.acceptance.map(item => <div className="workflow-criterion-editor" key={item.id}>{legacyChecks ? <input type="checkbox" aria-label={`Legacy checklist complete: ${item.text}`} checked={item.done} onChange={e => patch('acceptance', form.acceptance.map(c => c.id === item.id ? { ...c, done: e.target.checked } : c))} /> : null}<input aria-label="Acceptance criterion" maxLength={1000} value={item.text} onChange={e => patch('acceptance', form.acceptance.map(c => c.id === item.id ? { ...c, text: e.target.value } : c))} /><button type="button" className="icon-button" aria-label={`Remove ${item.text}`} onClick={() => patch('acceptance', form.acceptance.filter(c => c.id !== item.id))}><X /></button></div>)}<div className="workflow-criterion-editor"><input aria-label="New acceptance criterion" placeholder="What must be true before this work is accepted?" value={criterion} maxLength={1000} onChange={e => setCriterion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCriterion(); } }} /><Button icon={Plus} disabled={!criterion.trim() || form.acceptance.length >= 100} onClick={addCriterion}>Add</Button></div></fieldset>
    <fieldset className="workflow-ref-list"><legend>Blocked by</legend>{routes.length ? routes.map(row => <label key={row.id}><input type="checkbox" checked={form.dependency_ids.includes(row.id)} onChange={e => patch('dependency_ids', e.target.checked ? [...form.dependency_ids, row.id] : form.dependency_ids.filter(id => id !== row.id))} /><span>{row.title}<small>{workflowLabel(row.status)}</small></span></label>) : <p>Create another route to add dependencies.</p>}</fieldset><p className="workflow-note">Dependencies are planning constraints, not automatic dispatch. Names record responsibility; they do not grant or verify account access.</p><ErrorMessage error={error} /><Button type="submit" variant="primary" busy={busy}>Save agreement</Button></Form>}</Dialog>;
}

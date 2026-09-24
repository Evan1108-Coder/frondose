import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { rumboActions } from '../data/useRumbo.js';
import { Button, Dialog, Empty, ErrorMessage, Field, PageHeader, SearchField, Select, useApp } from '../ui.jsx';
import { Form } from '../components/Form.jsx';
import { ContextInspector } from '../components/ContextInspector.jsx';
import { NativeToolsChoice } from '../components/NativeToolActivity.jsx';
import { requestUpdateNavigation, useUnsavedUpdate } from '../components/UnsavedUpdates.jsx';
import { ArrowLeft, ArrowRight, Plus, Pencil, RotateCw, Workflow, Play, Check, X, ShieldCheck } from '../components/icons.jsx';
import { visible, val, relative } from '../lib/model.js';
import { FEATURE_ROLES, WORKFLOW_INPUT_TYPES, WORKFLOW_CONDITIONS, featureWorkflowDefinition, workflowInputValues, parseWorkflowInputs, workflowRequestBody, workflowStepState, latestWorkflowAttempts, scopedWorkflowContext } from '../lib/manual-workflows.js';
import './workflows.css';

const ROOT = '/api/coordination';
const titleCase = value => String(value || 'unknown').replaceAll('_', ' ');
const stamp = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Time not recorded';

function useWorkflowResource(path) {
  const [revision, setRevision] = useState(0), [state, setState] = useState({ loading: true, result: null, error: null });
  useEffect(() => {
    if (!path) { setState({ loading: false, result: null, error: null }); return; }
    const controller = new AbortController();
    setState({ loading: true, result: null, error: null });
    apiRequest(path, { signal: controller.signal }).then(({ result }) => { if (!controller.signal.aborted) setState({ loading: false, result, error: null }); }).catch(error => { if (!controller.signal.aborted) setState({ loading: false, result: null, error }); });
    return () => controller.abort();
  }, [path, revision]);
  return { ...state, reload: () => setRevision(value => value + 1) };
}

function useWorkflowMutation() {
  const pending = useRef(new Map()), inFlight = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(null);
  async function mutate(path, body, { idempotent = true } = {}) {
    if (inFlight.current) return null;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      let payload = body;
      if (idempotent) {
        const prepared = workflowRequestBody(body, pending.current.get(path));
        pending.current.set(path, prepared.request); payload = prepared.body;
      }
      const { result } = await apiRequest(path, { method: 'POST', body: payload });
      pending.current.delete(path);
      await rumboActions.refresh().catch(() => {});
      return result;
    } catch (problem) { setError(problem); throw problem; }
    finally { inFlight.current = false; setBusy(false); }
  }
  return { busy, error, mutate, clearError: () => setError(null) };
}

export function WorkflowsView() {
  const { page, workspace } = useApp();
  if (page.id?.startsWith('run:')) return <WorkflowRun key={`${workspace.id}:${page.id}`} runId={page.id.slice(4)} />;
  return page.id ? <WorkflowDetail key={`${workspace.id}:${page.id}`} id={page.id} /> : <WorkflowList key={workspace.id} />;
}

function WorkflowList() {
  const { workspace, navigate } = useApp();
  const state = useWorkflowResource(`${ROOT}/workflows?workspace_id=${encodeURIComponent(workspace.id)}`);
  const [query, setQuery] = useState(''), [editing, setEditing] = useState(false);
  const workflows = (Array.isArray(state.result) ? state.result : []).filter(item => `${item.title} ${item.description || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <main className="page manual-workflows-page"><PageHeader title="Workflows" description="Bounded agents, explicit handoffs, and human decisions. Each provider step is reviewed and launched by you."><Button onClick={() => navigate('operations')}>Plans &amp; other work</Button><Button icon={RotateCw} onClick={state.reload}>Refresh</Button><Button variant="primary" icon={Plus} onClick={() => setEditing(true)}>New Workflow</Button></PageHeader>
    <SearchField label="Search Workflows" placeholder="Find a Workflow…" value={query} onChange={setQuery} /><ErrorMessage error={state.error} />
    {state.loading ? <p role="status">Loading Workflows…</p> : workflows.length ? <div className="manual-workflow-list">{workflows.map(item => <button key={item.id} className="manual-workflow-row" onClick={() => navigate('workflows', item.id)}><Workflow /><span><strong>{item.title}</strong><small>{item.project_id ? 'Project Workflow' : 'Workspace Workflow'} · updated {relative(item.updated_at)}</small></span><span>v{item.current_definition_version ?? 1} · {titleCase(item.state)}</span><ArrowRight /></button>)}</div> : !state.error ? <Empty kind="operations" title={query ? 'No matching Workflows' : 'Turn a request into reviewed work'} description="Start with Researcher → Planner → your approval → Builder → Reviewer → your acceptance → reviewed memory. Nothing runs in the background." action={query ? 'Clear search' : 'Create Workflow'} onAction={() => query ? setQuery('') : setEditing(true)} /> : <Button onClick={state.reload}>Retry Workflows</Button>}
    <section className="manual-workflow-note"><h2>One orchestration surface</h2><p>Existing work plans and manually generated repeating Routes remain available while executable Workflows gain capability. Neither runs automatically.</p><div><Button onClick={() => navigate('operations')}>Open existing coordination</Button><Button onClick={() => navigate('skills')}>Manage versioned Skills</Button></div></section>
    {editing ? <WorkflowEditor onClose={() => setEditing(false)} onSaved={item => { setEditing(false); navigate('workflows', item.id); }} /> : null}
  </main>;
}

function WorkflowDetail({ id }) {
  const { workspace, navigate } = useApp();
  const state = useWorkflowResource(`${ROOT}/workflows/${encodeURIComponent(id)}?workspace_id=${encodeURIComponent(workspace.id)}`);
  const history = useWorkflowResource(`${ROOT}/workflows/${encodeURIComponent(id)}/runs?workspace_id=${encodeURIComponent(workspace.id)}`);
  const versions = useWorkflowResource(`${ROOT}/workflows/${encodeURIComponent(id)}/versions?workspace_id=${encodeURIComponent(workspace.id)}`);
  const [editing, setEditing] = useState(false), [starting, setStarting] = useState(false);
  const workflow = state.result, definition = workflow?.current_definition?.definition;
  return <main className="page manual-workflows-page"><button className="back-link" onClick={() => navigate('workflows')}><ArrowLeft />All Workflows</button><ErrorMessage error={state.error} />
    {state.loading ? <p role="status">Loading Workflow…</p> : !workflow || !definition ? <Button onClick={state.reload}>Retry Workflow</Button> : <>
      <PageHeader title={workflow.title} description={definition.description || 'Manual, bounded, and reviewed.'}><Button icon={Pencil} onClick={() => setEditing(true)}>Edit new version</Button><Button variant="primary" icon={Play} onClick={() => setStarting(true)}>Preview manual run</Button></PageHeader>
      <div className="manual-workflow-meta"><span>Definition v{workflow.current_definition_version}</span><span>{definition.steps.length} steps</span><span>Manual trigger only</span></div>
      <DefinitionSteps definition={definition} />
      <section className="manual-workflow-history"><h2>Run history</h2><ErrorMessage error={history.error} />{history.loading ? <p role="status">Loading history…</p> : (history.result ?? []).length ? history.result.map(run => <button className="manual-workflow-row" key={run.id} onClick={() => navigate('workflows', `run:${run.id}`)}><Workflow /><span><strong>{titleCase(run.status)}</strong><small>{stamp(run.created_at)}</small></span><code>{run.id}</code><ArrowRight /></button>) : <p>No manual runs yet.</p>}<Button onClick={history.reload}>Refresh history</Button></section>
      <section className="manual-workflow-history"><h2>Immutable definitions</h2><ErrorMessage error={versions.error} />{versions.loading ? <p role="status">Loading versions…</p> : (versions.result ?? []).map(version => <details key={version.id}><summary>Version {version.number} · {stamp(version.created_at)}</summary><DefinitionSteps definition={version.definition} /><p className="manual-workflow-hash">Definition hash <code>{version.definition_hash}</code></p></details>)}</section>
      {editing ? <WorkflowEditor item={workflow} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); state.reload(); versions.reload(); }} /> : null}
      {starting ? <WorkflowStart workflow={workflow} onClose={() => setStarting(false)} onStarted={run => navigate('workflows', `run:${run.id}`)} /> : null}
    </>}
  </main>;
}

function DefinitionSteps({ definition }) {
  const { data, navigate } = useApp();
  return <ol className="manual-workflow-steps">{(definition?.steps ?? []).map((step, index) => <li key={step.id}><span className="manual-step-number">{index + 1}</span><div><h3>{step.name}</h3><p>{step.description}</p><div className="manual-workflow-meta"><span>{titleCase(step.type)}</span>{step.config?.agent_id ? <button className="text-button" onClick={() => navigate('agents', step.config.agent_id)}>{data.agents.find(agent => agent.id === step.config.agent_id)?.name || 'Unavailable profile'}</button> : null}<span>{Math.round((step.limits?.timeout_ms ?? 0) / 60000)} minute bound · {step.retry?.max_attempts ?? 1} attempts</span></div>{step.depends_on?.length ? <small>After: {step.depends_on.map(id => definition.steps.find(item => item.id === id)?.name || id).join(', ')}</small> : null}{step.condition ? <small>Condition: {step.condition.ref} {titleCase(step.condition.operator)} {['truthy', 'exists'].includes(step.condition.operator) ? '' : JSON.stringify(step.condition.value)}</small> : null}{step.context_refs?.length ? <small>{step.context_refs.length} explicit context references</small> : null}</div></li>)}</ol>;
}

function WorkflowStart({ workflow, onClose, onStarted }) {
  const definition = workflow.current_definition.definition;
  const [values, setValues] = useState(() => workflowInputValues(definition)), [preview, setPreview] = useState(null), [localError, setLocalError] = useState(null);
  const [started, setStarted] = useState(null), delivered = useRef(null);
  const mutation = useWorkflowMutation();
  const signature = JSON.stringify(values);
  useUnsavedUpdate(false, !started && mutation.busy);
  // This effect runs after this dialog's guard has observed the successful state.
  useEffect(() => { if (started && delivered.current !== started.id) { delivered.current = started.id; onStarted(started); } }, [started, onStarted]);
  async function previewRun() {
    setLocalError(null);
    try { const inputs = parseWorkflowInputs(definition, values); const result = await mutation.mutate(`${ROOT}/workflows/${workflow.id}/preview`, { inputs, definition_version: workflow.current_definition_version }, { idempotent: false }); setPreview({ result, signature }); } catch (error) { setLocalError(error); }
  }
  async function startRun() {
    if (started || preview?.signature !== signature) return;
    try { const run = await mutation.mutate(`${ROOT}/workflows/${workflow.id}/runs`, { inputs: parseWorkflowInputs(definition, values), definition_version: workflow.current_definition_version }); if (run) setStarted(run); } catch {}
  }
  return <Dialog title={`Run ${workflow.title}`} subtitle={`Definition version ${workflow.current_definition_version}. Preview first; creating the run does not start a provider.`} wide onClose={() => !mutation.busy && onClose()}><div className="manual-workflow-dialog"><TypedInputs inputs={definition.inputs} values={values} onChange={(name, value) => setValues(current => ({ ...current, [name]: value }))} disabled={mutation.busy} />
    <ErrorMessage error={localError || mutation.error} /><Button disabled={mutation.busy} onClick={previewRun}>Dry-run preview</Button>
    {preview?.signature === signature ? <section className="manual-workflow-preview"><h3>Preview · no provider calls</h3><p>Preview validates inputs and evaluates known conditions without starting steps. Conditions depending on future outputs remain subject to actual results.</p><ol>{(preview.result.steps ?? []).map(step => <li key={step.id}><strong>{definition.steps.find(item => item.id === step.id)?.name || step.id}</strong><span>{titleCase(step.status)}</span></li>)}</ol><p>Each agent invocation still requires context review and a separate explicit launch. Approval gates stop progress until you decide.</p></section> : <p>Changing inputs requires a new preview.</p>}
  </div><footer className="dialog-footer"><Button disabled={mutation.busy} onClick={onClose}>Cancel</Button><Button variant="primary" busy={mutation.busy} disabled={Boolean(started) || preview?.signature !== signature} onClick={startRun}>Create manual run</Button></footer></Dialog>;
}

function TypedInputs({ inputs = [], values, onChange, disabled }) {
  return <div className="manual-workflow-fields">{inputs.map(input => input.type === 'boolean' ? <label className="manual-workflow-check" key={input.name}><input type="checkbox" checked={values[input.name] === true} disabled={disabled} onChange={event => onChange(input.name, event.target.checked)} /><span>{input.name}{input.required ? ' · required' : ''}<small>{input.description}</small></span></label> : <Field key={input.name} label={`${input.name}${input.required ? ' · required' : ''}`} hint={input.description}><textarea rows={input.type === 'number' ? 1 : 4} value={typeof values[input.name] === 'object' ? JSON.stringify(values[input.name], null, 2) : values[input.name] ?? ''} onChange={event => onChange(input.name, event.target.value)} disabled={disabled} placeholder={input.type === 'json' ? 'Valid JSON value' : input.type === 'number' ? 'A finite number' : 'Provide the reusable input…'} /></Field>)}</div>;
}

function WorkflowEditor({ item = null, onClose, onSaved }) {
  const { data, workspace } = useApp();
  const initial = item?.current_definition?.definition;
  const [title, setTitle] = useState(item?.title || ''), [projectId, setProjectId] = useState(item?.project_id || ''), [purpose, setPurpose] = useState(initial?.description || 'Take a feature request through evidence, planning, approval, implementation, review, and accepted memory.');
  const [roles, setRoles] = useState(() => Object.fromEntries(FEATURE_ROLES.map(role => [role.id, initial?.steps?.find(step => step.id === role.id)?.config?.agent_id || ''])));
  const [minutes, setMinutes] = useState(30), [attempts, setAttempts] = useState(2), [allowEdits, setAllowEdits] = useState(false);
  const [definition, setDefinition] = useState(initial ? structuredClone(initial) : null), [error, setError] = useState(null);
  const [saved, setSaved] = useState(null), delivered = useRef(null);
  const mutation = useWorkflowMutation();
  const initialSignature = useRef(JSON.stringify({ title: item?.title || '', projectId: item?.project_id || '', purpose: initial?.description || 'Take a feature request through evidence, planning, approval, implementation, review, and accepted memory.', roles: Object.fromEntries(FEATURE_ROLES.map(role => [role.id, initial?.steps?.find(step => step.id === role.id)?.config?.agent_id || ''])), minutes: 30, attempts: 2, allowEdits: false, definition: initial || null }));
  const dirty = initialSignature.current !== JSON.stringify({ title, projectId, purpose, roles, minutes, attempts, allowEdits, definition });
  useUnsavedUpdate(!saved && dirty, !saved && mutation.busy);
  // Commit the clean state before navigation dispatches the global hash guard.
  useEffect(() => { if (saved && delivered.current !== saved.id) { delivered.current = saved.id; onSaved(saved); } }, [saved, onSaved]);
  const agents = visible(data.agents).filter(agent => val(agent, 'workspace_id') === workspace.id);
  const close = () => requestUpdateNavigation(onClose);
  async function save(event) {
    event.preventDefault(); if (saved) return; setError(null);
    try {
      const next = definition ? { ...definition, description: purpose.trim() } : featureWorkflowDefinition({ roles, agents, description: purpose.trim(), minutes: Number(minutes), attempts: Number(attempts), allowEdits: allowEdits && !!projectId });
      const body = item ? { version: item.version, definition: next } : { workspace_id: workspace.id, project_id: projectId || null, title: title.trim(), definition: next };
      const result = await mutation.mutate(`${ROOT}/workflows${item ? `/${item.id}/versions` : ''}`, body);
      if (result) setSaved(result);
    } catch (problem) { setError(problem); }
  }
  return <Dialog title={item ? `Revise ${item.title}` : 'New manual Workflow'} subtitle="Create a reusable definition. Saved instructions and handoffs are not permission grants." wide onClose={close}><Form onSubmit={save} className="manual-workflow-editor">
    <Field label="Workflow name"><input required maxLength={200} value={title} disabled={mutation.busy || Boolean(item)} onChange={event => setTitle(event.target.value)} placeholder="Feature request to reviewed change" /></Field>
    <Field label="Purpose"><textarea rows={3} required maxLength={5000} value={purpose} disabled={mutation.busy} onChange={event => setPurpose(event.target.value)} /></Field>
    <Select label="Project scope" value={projectId} disabled={mutation.busy || Boolean(item)} onChange={setProjectId}><option value="">Workspace · no linked project</option>{visible(data.projects).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</Select>
    {!definition ? <><fieldset className="manual-workflow-fields"><legend>Feature request starter</legend><p>The feature request is supplied as a typed input each time you start. Profiles can share provider accounts, but their responsibilities and bounded outputs remain distinct.</p>{FEATURE_ROLES.map(role => <Select key={role.id} label={`${role.label} profile`} value={roles[role.id]} required disabled={mutation.busy} onChange={id => setRoles(current => ({ ...current, [role.id]: id }))}><option value="">Choose {role.label.toLowerCase()}…</option>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name} · {agent.provider}</option>)}</Select>)}<div className="manual-workflow-columns"><Field label="Maximum minutes per step"><input type="number" min={1} max={30} value={minutes} disabled={mutation.busy} onChange={event => setMinutes(event.target.value)} /></Field><Field label="Maximum attempts per step"><input type="number" min={1} max={5} value={attempts} disabled={mutation.busy} onChange={event => setAttempts(event.target.value)} /></Field></div><label className="manual-workflow-check"><input type="checkbox" checked={allowEdits} disabled={mutation.busy || !projectId} onChange={event => setAllowEdits(event.target.checked)} /><span>Builder may request project-edit mode<small>Requires a linked project, a compatible provider/profile, approval of the plan, and explicit review of the actual launch permissions. This checkbox does not grant execution authority.</small></span></label><p>Without project-edit mode, Builder produces a read-only implementation proposal. Usage and cost bounds are not advertised as enforced when the provider cannot reliably report them.</p><Button disabled={mutation.busy} onClick={() => { try { setDefinition(featureWorkflowDefinition({ roles, agents, description: purpose, minutes: Number(minutes), attempts: Number(attempts), allowEdits: allowEdits && !!projectId })); setError(null); } catch (problem) { setError(problem); } }}>Review and customize steps</Button></fieldset></> : <DefinitionEditor definition={definition} onChange={setDefinition} projectId={projectId} disabled={mutation.busy} />}
    <p>Saving creates an immutable definition version. Earlier runs keep their pinned version. Nothing is scheduled or started.</p><ErrorMessage error={error || mutation.error} /><footer className="form-submit-row"><Button disabled={mutation.busy} onClick={close}>Cancel</Button><Button type="submit" variant="primary" disabled={Boolean(saved)} busy={mutation.busy}>{item ? 'Save new version' : 'Create Workflow'}</Button></footer>
  </Form></Dialog>;
}

function DefinitionEditor({ definition, onChange, projectId, disabled }) {
  const { data, workspace } = useApp();
  const agents = visible(data.agents).filter(agent => val(agent, 'workspace_id') === workspace.id);
  const patchStep = (id, patch) => onChange({ ...definition, steps: definition.steps.map(step => step.id === id ? { ...step, ...patch } : step) });
  const patchInput = (index, patch) => onChange({ ...definition, inputs: definition.inputs.map((input, position) => position === index ? { ...input, ...patch } : input) });
  return <><fieldset className="manual-workflow-fields"><legend>Typed inputs</legend>{definition.inputs.map((input, index) => <div className="manual-workflow-columns" key={index}><Field label={`Input ${index + 1} name`}><input required disabled={disabled || input.name === 'feature_request'} value={input.name} pattern="[A-Za-z][A-Za-z0-9_-]*" onChange={event => patchInput(index, { name: event.target.value })} /></Field><Select label={`Input ${index + 1} type`} value={input.type} disabled={disabled || input.name === 'feature_request'} onChange={type => patchInput(index, { type })}>{WORKFLOW_INPUT_TYPES.map(type => <option key={type} value={type}>{type}</option>)}</Select><Field label={`Input ${index + 1} description`}><input disabled={disabled} maxLength={1000} value={input.description || ''} onChange={event => patchInput(index, { description: event.target.value })} /></Field><label className="manual-workflow-check"><input type="checkbox" checked={input.required !== false} disabled={disabled || input.name === 'feature_request'} onChange={event => patchInput(index, { required: event.target.checked })} />Required</label></div>)}<Button disabled={disabled || definition.inputs.length >= 40} onClick={() => onChange({ ...definition, inputs: [...definition.inputs, { name: `input_${definition.inputs.length + 1}`, type: 'string', required: false, description: '' }] })}>Add typed input</Button></fieldset>
    <h3>Steps and boundaries</h3>{definition.steps.map((step, index) => <details className="manual-workflow-definition-step" key={step.id}><summary>{index + 1}. {step.name} · {titleCase(step.type)}</summary><div>
      <Field label={`${step.id} name`}><input required maxLength={200} value={step.name} disabled={disabled} onChange={event => patchStep(step.id, { name: event.target.value })} /></Field>
      <Field label={`${step.id} instructions`} hint="Include expected output, evidence, and a stopping condition. These instructions never grant tools."><textarea rows={4} maxLength={5000} value={step.description || ''} disabled={disabled} onChange={event => patchStep(step.id, { description: event.target.value })} /></Field>
      {['agent', 'skill'].includes(step.type) ? <Select label={`${step.name} execution type`} value={step.type} disabled={disabled} onChange={type => patchStep(step.id, { type })}><option value="agent">Agent instructions</option><option value="skill">Versioned Skill with this agent</option></Select> : null}
      {step.type === 'skill' ? <WorkflowSkillBinding step={step} inputs={definition.inputs} disabled={disabled} onChange={config => patchStep(step.id, { config })} /> : null}
      {['agent', 'skill'].includes(step.type) ? <NativeToolsChoice label={`${step.name}: enable native tools for its reviewed launch`} checked={step.config.native_tools === true} disabled={disabled} onChange={native_tools => patchStep(step.id, { config: { ...step.config, native_tools } })} /> : null}
      {['agent', 'skill'].includes(step.type) ? <><Select label={`${step.name} agent`} value={step.config.agent_id || ''} disabled={disabled} onChange={agent_id => patchStep(step.id, { config: { ...step.config, agent_id, profile_version: agents.find(agent => agent.id === agent_id)?.version } })}><option value="">Choose profile…</option>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name} · {agent.provider}</option>)}</Select><p>Pinned profile version {step.config.profile_version ?? 'not selected'}. {agents.find(agent => agent.id === step.config.agent_id)?.version !== step.config.profile_version ? <Button disabled={disabled || !agents.some(agent => agent.id === step.config.agent_id)} onClick={() => patchStep(step.id, { config: { ...step.config, profile_version: agents.find(agent => agent.id === step.config.agent_id)?.version } })}>Use current profile version</Button> : null}</p><Select label={`${step.name} requested file permission`} value={step.config.permission_mode || 'read-only'} disabled={disabled} onChange={permission_mode => patchStep(step.id, { config: { ...step.config, permission_mode } })}><option value="read-only">Read-only</option><option value="workspace-write">Project edits · reviewed at launch</option></Select></> : null}
      {['agent', 'skill'].includes(step.type) ? <Select label={`${step.name} work mode`} value={step.config.work_mode || (projectId ? 'project' : 'conversation')} disabled={disabled} onChange={work_mode => patchStep(step.id, { config: { ...step.config, work_mode, ...(work_mode === 'conversation' ? { permission_mode: 'read-only', task_id: null } : {}) } })}><option value="conversation">Supplied context only · read-only</option><option value="project">Project tools · linked folder required</option></Select> : null}
      {step.type === 'human_approval' ? <><Field label={`${step.name} decision prompt`}><textarea rows={3} required maxLength={2000} value={step.config.prompt || ''} disabled={disabled} onChange={event => patchStep(step.id, { config: { ...step.config, prompt: event.target.value } })} /></Field><Select label={`${step.name} source output`} value={step.config.source_step_id || ''} disabled={disabled} onChange={source_step_id => patchStep(step.id, { config: { ...step.config, source_step_id: source_step_id || null } })}><option value="">No source output</option>{definition.steps.filter(other => ['agent', 'skill'].includes(other.type) && other.id !== step.id).map(other => <option key={other.id} value={other.id}>{other.name}</option>)}</Select><label className="manual-workflow-check"><input type="checkbox" checked={step.config.requires_approved_output === true} disabled={disabled} onChange={event => patchStep(step.id, { config: { ...step.config, requires_approved_output: event.target.checked } })} />Require the exact source output to be approved in Library</label></> : null}
      {step.type === 'tool' ? <p>Tool: {step.config.tool}. Only a server-supported, permission-checked action can execute; arbitrary tool names are not launched.</p> : null}
      <div className="manual-workflow-columns"><Field label={`${step.name} timeout minutes`}><input type="number" min={1} max={30} value={(step.limits?.timeout_ms ?? 1800000) / 60000} disabled={disabled} onChange={event => patchStep(step.id, { limits: { ...step.limits, timeout_ms: Number(event.target.value) * 60000 } })} /></Field><Field label={`${step.name} maximum attempts`}><input type="number" min={1} max={5} value={step.retry?.max_attempts ?? 1} disabled={disabled} onChange={event => patchStep(step.id, { retry: { max_attempts: Number(event.target.value) } })} /></Field></div>
      <fieldset className="manual-workflow-fields"><legend>Prerequisites</legend>{definition.steps.filter(other => other.id !== step.id).map(other => <label className="manual-workflow-check" key={other.id}><input type="checkbox" checked={step.depends_on.includes(other.id)} disabled={disabled} onChange={event => patchStep(step.id, { depends_on: event.target.checked ? [...step.depends_on, other.id] : step.depends_on.filter(id => id !== other.id) })} />{other.name}</label>)}<p>Dependencies and handoffs are validated together by the server. Cycles and removed required handoffs cannot be saved.</p></fieldset>
      <Select label={`${step.name} condition`} value={step.condition?.ref || ''} disabled={disabled} onChange={ref => patchStep(step.id, { condition: ref ? { ref, operator: 'truthy', value: null } : null })}><option value="">Always, after prerequisites</option>{definition.inputs.map(input => <option key={input.name} value={`inputs.${input.name}`}>Input · {input.name}</option>)}{definition.steps.filter(other => other.id !== step.id).flatMap(other => [<option key={`${other.id}:status`} value={`steps.${other.id}.status`}>{other.name} · status</option>, <option key={`${other.id}:output`} value={`steps.${other.id}.output_id`}>{other.name} · output ID</option>])}</Select>
      {step.condition ? <><Select label={`${step.name} comparison`} value={step.condition.operator} disabled={disabled} onChange={operator => patchStep(step.id, { condition: { ...step.condition, operator } })}>{WORKFLOW_CONDITIONS.map(operator => <option key={operator} value={operator}>{titleCase(operator)}</option>)}</Select>{!['exists', 'truthy'].includes(step.condition.operator) ? <WorkflowConditionValue key={step.condition.ref} step={step} inputs={definition.inputs} disabled={disabled} onChange={value => patchStep(step.id, { condition: { ...step.condition, value } })} /> : null}</> : null}
      <Select label={`${step.name} failure policy`} value={step.on_failure || 'stop'} disabled={disabled} onChange={on_failure => patchStep(step.id, { on_failure })}><option value="stop">Stop and require attention</option><option value="continue">Continue other eligible steps</option></Select>
      <fieldset className="manual-workflow-fields"><legend>Per-step context</legend>{(step.context_refs ?? []).map((ref, refIndex) => <div className="manual-workflow-columns" key={refIndex}><Select label={`${step.name} context ${refIndex + 1} kind`} value={ref.kind} disabled={disabled} onChange={kind => patchStep(step.id, { context_refs: step.context_refs.map((item, i) => i === refIndex ? { kind, id: '' } : item) })}>{['pack', 'document', 'memory', 'knowledge', 'context_snapshot', 'output_version'].map(kind => <option key={kind} value={kind}>{titleCase(kind)}</option>)}</Select><Select label={`${step.name} context ${refIndex + 1}`} value={ref.id} required disabled={disabled} onChange={id => patchStep(step.id, { context_refs: step.context_refs.map((item, i) => i === refIndex ? { ...item, id } : item) })}><option value="">Choose source…</option>{scopedWorkflowContext(data, workspace.id, projectId, ref.kind).map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</Select><Button disabled={disabled} onClick={() => patchStep(step.id, { context_refs: step.context_refs.filter((_, i) => i !== refIndex) })}>Remove source</Button></div>)}<Button disabled={disabled || step.context_refs?.length >= 30} onClick={() => patchStep(step.id, { context_refs: [...(step.context_refs || []), { kind: 'document', id: '' }] })}>Add context reference</Button></fieldset>
    </div></details>)}
    <div className="manual-workflow-actions">{['agent', 'skill', 'human_approval'].map(type => <Button key={type} disabled={disabled || definition.steps.length >= 40} onClick={() => { const id = `step_${definition.steps.length + 1}`; onChange({ ...definition, steps: [...definition.steps, { id, name: `New ${titleCase(type)} step`, type, description: '', depends_on: [], condition: null, context_refs: [], config: type === 'human_approval' ? { prompt: 'Review this step before continuing.', source_step_id: null, requires_approved_output: false } : { agent_id: '', profile_version: null, permission_mode: 'read-only', include_memory: true, include_chat: false }, retry: { max_attempts: 1 }, limits: { timeout_ms: 1800000 }, on_failure: 'stop' }] }); }}>Add {titleCase(type)} step</Button>)}</div>
    <WorkflowHandoffEditor definition={definition} disabled={disabled} onChange={onChange} />
  </>;
}

function WorkflowHandoffEditor({ definition, disabled, onChange }) {
  const handoffs = definition.handoffs || [];
  const patch = (index, value) => onChange({ ...definition, handoffs: handoffs.map((item, i) => i === index ? { ...item, ...value } : item) });
  return <fieldset className="manual-workflow-fields"><legend>Explicit output handoffs</legend><p>A handoff pins one exact saved output. Its source must be a declared prerequisite of the receiving step. Branches use conditions and dependencies; no step starts automatically.</p>{handoffs.map((handoff, index) => <div className="manual-workflow-columns" key={index}><Select label={`Handoff ${index + 1} source`} value={handoff.from} disabled={disabled} onChange={from => patch(index, { from })}><option value="">Choose producing step…</option>{definition.steps.filter(step => ['agent', 'skill'].includes(step.type)).map(step => <option key={step.id} value={step.id}>{step.name}</option>)}</Select><Select label={`Handoff ${index + 1} recipient`} value={handoff.to} disabled={disabled} onChange={to => patch(index, { to })}><option value="">Choose receiving step…</option>{definition.steps.filter(step => step.id !== handoff.from).map(step => <option key={step.id} value={step.id}>{step.name}</option>)}</Select><Field label={`Handoff ${index + 1} output label`}><input required pattern="[A-Za-z][A-Za-z0-9_-]*" value={handoff.output || 'result'} disabled={disabled} onChange={event => patch(index, { output: event.target.value })} /></Field><label className="manual-workflow-check"><input type="checkbox" checked={handoff.required !== false} disabled={disabled} onChange={event => patch(index, { required: event.target.checked })} />Exact output required</label><Button disabled={disabled} onClick={() => onChange({ ...definition, handoffs: handoffs.filter((_, i) => i !== index) })}>Remove handoff</Button></div>)}<Button disabled={disabled || handoffs.length >= 80} onClick={() => onChange({ ...definition, handoffs: [...handoffs, { from: '', to: '', output: 'result', required: true }] })}>Add handoff</Button></fieldset>;
}

function WorkflowConditionValue({ step, inputs, disabled, onChange }) {
  const type = inputs.find(input => `inputs.${input.name}` === step.condition.ref)?.type || 'string';
  const [value, setValue] = useState(() => type === 'json' ? JSON.stringify(step.condition.value) : step.condition.value ?? '');
  if (type === 'boolean') return <Select label={`${step.name} comparison value`} value={typeof step.condition.value === 'boolean' ? String(step.condition.value) : ''} required disabled={disabled} onChange={next => onChange(next === 'true')}><option value="">Choose true or false…</option><option value="true">True</option><option value="false">False</option></Select>;
  return <Field label={`${step.name} comparison value`} hint={type === 'json' ? 'Enter a valid JSON value for exact comparison.' : `Exact ${type} comparison; step status values include completed, failed, timed_out, and skipped.`}><input value={value} type={type === 'number' ? 'number' : 'text'} step={type === 'number' ? 'any' : undefined} required={type !== 'string'} disabled={disabled} onChange={event => { const next = event.target.value; setValue(next); try { const parsed = type === 'json' ? JSON.parse(next) : type === 'number' ? Number(next) : next; if (type === 'number' && (!next.trim() || !Number.isFinite(parsed))) throw new Error('Enter a finite comparison number.'); event.target.setCustomValidity(''); onChange(parsed); } catch { event.target.setCustomValidity(type === 'json' ? 'Enter valid JSON for this comparison.' : 'Enter a finite comparison number.'); } }} /></Field>;
}

function WorkflowSkillBinding({ step, inputs, disabled, onChange }) {
  const { workspace } = useApp();
  const list = useWorkflowResource(`/api/skills?workspace_id=${encodeURIComponent(workspace.id)}`);
  const detail = useWorkflowResource(step.config.skill_id ? `/api/skills/${encodeURIComponent(step.config.skill_id)}` : null);
  const pinned = detail.result?.versions?.find(version => version.id === step.config.version_id)?.definition;
  return <div className="manual-workflow-fields"><Select label={`${step.name} Skill`} value={step.config.skill_id || ''} disabled={disabled || list.loading} onChange={skill_id => onChange({ ...step.config, skill_id, version_id: null, inputs: {} })}><option value="">Choose a Skill…</option>{(list.result || []).filter(skill => !skill.archived_at).map(skill => <option key={skill.id} value={skill.id}>{skill.name} · {skill.state}</option>)}</Select><Select label={`${step.name} immutable Skill version`} value={step.config.version_id || ''} disabled={disabled || !step.config.skill_id || detail.loading} onChange={version_id => onChange({ ...step.config, version_id, inputs: {} })}><option value="">Choose version…</option>{(detail.result?.versions || []).map(version => <option key={version.id} value={version.id}>Version {version.number} · {stamp(version.created_at)}</option>)}</Select><ErrorMessage error={list.error || detail.error} /><p>Skill instructions and required context are pinned by version. Map typed Skill inputs to Workflow inputs below. Selecting a Skill grants no tools and supplies no provider success evidence.</p>{(pinned?.inputs || []).map(field => <Select key={field.name} label={`${field.name} (${field.type})${field.required ? ' · required' : ''}`} value={step.config.inputs?.[field.name] || ''} disabled={disabled} onChange={value => { const mapping = { ...(step.config.inputs || {}) }; if (value) mapping[field.name] = value; else delete mapping[field.name]; onChange({ ...step.config, inputs: mapping }); }}><option value="">Choose Workflow input…</option>{inputs.filter(input => input.type === (field.type === 'enum' ? 'string' : field.type)).map(input => <option key={input.name} value={input.name}>{input.name}</option>)}</Select>)}</div>;
}

function WorkflowRun({ runId }) {
  const { data, navigate, workspace, notify } = useApp();
  const state = useWorkflowResource(`${ROOT}/workflow-runs/${encodeURIComponent(runId)}?workspace_id=${encodeURIComponent(workspace.id)}`);
  const mutation = useWorkflowMutation();
  const [prepared, setPrepared] = useState(null), [showPreparation, setShowPreparation] = useState(false), [cancelConfirm, setCancelConfirm] = useState(false), [memoryStep, setMemoryStep] = useState(null);
  const run = state.result, definition = run?.definition;
  const terminal = ['completed', 'failed', 'cancelled'].includes(run?.status);
  useUnsavedUpdate(false, mutation.busy);
  async function refresh() { await rumboActions.refresh().catch(() => {}); state.reload(); }
  async function act(body) {
    const result = await mutation.mutate(`${ROOT}/workflow-runs/${runId}/actions`, { ...body, version: run.version });
    if (result) state.reload();
    return result;
  }
  async function prepare(step) {
    try {
      const result = await act({ action: 'prepare_step', step_id: step.id });
      if (result?.context_inspection_request && result?.run_request) { setPrepared(result); setShowPreparation(true); }
    } catch {}
  }
  async function cancelRun() {
    try {
      const result = await act({ action: 'cancel_run' });
      if (result) { setCancelConfirm(false); setPrepared(null); if (result.canonical_run_ids?.length) notify('Workflow cancelled. Stop was requested for its active local provider sessions; inspect Runs to verify their final state.'); }
    } catch {}
  }
  return <main className="page manual-workflows-page"><button className="back-link" onClick={() => navigate('workflows', run?.plan_id || null)}><ArrowLeft />Workflow definition</button>
    <PageHeader title="Workflow run" description="A recorded sequence of bounded work and explicit decisions. Refresh reads status; it never launches the next step."><Button icon={RotateCw} disabled={mutation.busy} onClick={refresh}>Refresh status</Button>{run && !terminal ? <Button variant="danger" disabled={mutation.busy} onClick={() => setCancelConfirm(true)}>Cancel Workflow</Button> : null}</PageHeader>
    <ErrorMessage error={state.error || mutation.error} />
    {state.loading ? <p role="status">Loading recorded Workflow state…</p> : run && definition ? <div className="manual-workflow-run">
      <div className="manual-workflow-meta"><span>{titleCase(run.status)}</span><span>Created {stamp(run.created_at)}</span><span>Revision {run.version}</span><span>Account billing: unavailable</span></div>
      <details><summary>Run inputs and pinned definition</summary><pre>{JSON.stringify(run.inputs, null, 2)}</pre><p>Definition ID <code>{run.plan_version_id}</code>. New definition versions do not change this run.</p><DefinitionSteps definition={definition} /></details>
      {run.status === 'cancelled' ? <p role="status">This Workflow will not accept further steps. Cancellation does not undo files, outputs, or knowledge. Stop was requested for active local provider sessions. Inspect their recorded status to verify termination; cancellation is not an instant-termination guarantee.</p> : null}
      {definition.steps.map((step, index) => <WorkflowRunStep key={step.id} step={step} index={index} run={run} disabled={mutation.busy || terminal} onPrepare={() => prepare(step)} onAction={act} onMemory={() => setMemoryStep(step)} onResume={() => setShowPreparation(true)} hasPreparation={prepared?.step_run?.id === latestWorkflowAttempts(run.steps).get(step.id)?.id} />)}
      <section className="manual-workflow-note"><h2>Boundaries</h2><p>Each attempt is linked to a real provider session before it can complete. Handoffs pin an exact saved output version, not a mutable latest result. Human output approval is separate from a provider reporting completion. No background scheduler or automatic group conversation is active.</p><Button onClick={() => navigate('operations')}>Plans &amp; other work</Button></section>
    </div> : !state.error ? <p>No Workflow run was returned.</p> : null}
    {prepared && showPreparation ? <PreparedWorkflowStep prepared={prepared} onClose={() => setShowPreparation(false)} onStarted={() => { setShowPreparation(false); setPrepared(null); state.reload(); }} /> : null}
    {cancelConfirm ? <Dialog title="Cancel this Workflow?" onClose={() => !mutation.busy && setCancelConfirm(false)}><p>Future steps and pending decisions will stop. This does not revert completed actions. Cancellation requests a stop for active local provider sessions. They may take time to terminate; inspect Runs for the final status. No completed action is rolled back.</p><ErrorMessage error={mutation.error} /><footer className="dialog-footer"><Button disabled={mutation.busy} onClick={() => setCancelConfirm(false)}>Keep Workflow</Button><Button variant="danger" busy={mutation.busy} onClick={cancelRun}>Cancel Workflow</Button></footer></Dialog> : null}
    {memoryStep && run ? <WorkflowMemoryDialog step={memoryStep} run={run} busy={mutation.busy} error={mutation.error} onClose={() => !mutation.busy && setMemoryStep(null)} onConfirm={async values => { try { if (await act({ action: 'finalize_memory', step_id: memoryStep.id, ...values })) { setMemoryStep(null); notify('Exact approved output saved as reviewed knowledge.'); } } catch {} }} /> : null}
  </main>;
}

function WorkflowRunStep({ step, index, run, disabled, onPrepare, onAction, onMemory, onResume, hasPreparation }) {
  const { data, navigate } = useApp();
  const [outputVersion, setOutputVersion] = useState(''), [note, setNote] = useState(''), [localError, setLocalError] = useState(null), [cancelPreparation, setCancelPreparation] = useState(false);
  const latest = latestWorkflowAttempts(run.steps), attempt = latest.get(step.id), status = workflowStepState(step, run.steps);
  const canonical = (data.runs || []).find(item => item.id === attempt?.canonical_run_id);
  const gate = run.approvals?.find(item => item.step_run_id === attempt?.id && item.status === 'pending');
  const source = latest.get(step.config?.source_step_id);
  const dependenciesReady = step.depends_on.every(id => ['completed', 'skipped'].includes(latest.get(id)?.status));
  const canPrepare = !attempt || ['failed', 'timed_out', 'cancelled'].includes(attempt.status) && attempt.attempt < step.retry.max_attempts;
  const outputs = (data.outputs || []).filter(item => item.workspace_id === run.workspace_id && item.run_id === attempt?.canonical_run_id && !item.archived_at);
  const versions = (data.output_versions || []).filter(item => outputs.some(output => output.id === item.output_id));
  const selected = versions.find(item => item.id === outputVersion);
  const requiresOutput = run.definition.handoffs.some(item => item.from === step.id && item.required);
  const providerTerminal = ['completed', 'failed', 'stopped', 'interrupted'].includes(canonical?.status);
  async function action(body) { setLocalError(null); try { return await onAction(body); } catch (error) { setLocalError(error); return null; } }
  return <section className="manual-run-step"><header><div><h2>{index + 1}. {step.name}</h2><span className="manual-workflow-meta">{titleCase(step.type)}{attempt ? ` · attempt ${attempt.attempt} of ${step.retry.max_attempts}` : ''}{step.config.profile_version ? ` · profile v${step.config.profile_version}` : ''}</span></div><span className={`manual-step-state is-${status}`}>{titleCase(status)}</span></header>
    <p>{step.description}</p><ErrorMessage error={localError} />
    {attempt?.error?.message || attempt?.error?.code ? <p className="manual-step-error">{attempt.error.message || titleCase(attempt.error.code)}</p> : null}
    {source?.output_id ? <div className="manual-workflow-actions"><Button onClick={() => navigate('library', source.output_id)}>Review source output</Button><small>Exact version <code>{source.output_version_id}</code></small></div> : null}
    {step.config.requires_approved_output && !gate ? <p>Approve the exact source output version in Library before opening this acceptance gate. A later version does not inherit its approval.</p> : null}
    {attempt?.canonical_run_id ? <div className="manual-workflow-actions"><Button onClick={() => navigate('work', attempt.canonical_run_id)}>Open provider session</Button><span className="manual-workflow-meta">{canonical ? `Provider: ${titleCase(canonical.status)}` : 'Provider status unavailable; refresh to check.'}</span>{attempt.output_id ? <Button onClick={() => navigate('library', attempt.output_id)}>Open pinned output</Button> : null}</div> : null}
    {status === 'bound' ? <div className="manual-workflow-fields"><p>When the provider session finishes, save its result as an Output there, then select an exact version below. Reconciliation verifies the actual session and never accepts a typed completion claim.</p><Select label={`${step.name} exact output version`} value={outputVersion} disabled={disabled} onChange={setOutputVersion}><option value="">{requiresOutput ? 'Choose required output version…' : 'No output handoff'}</option>{versions.map(version => <option key={version.id} value={version.id}>{outputs.find(output => output.id === version.output_id)?.title} · v{version.number}</option>)}</Select><div className="manual-workflow-actions"><Button disabled={disabled || !providerTerminal || canonical?.status === 'completed' && requiresOutput && !selected} onClick={() => action({ action: 'reconcile_step', step_id: step.id, ...(selected ? { output_ref: { output_id: selected.output_id, version_id: selected.id } } : {}) })}>Reconcile recorded result</Button><Button onClick={() => navigate('library')}>Outputs &amp; reviews</Button></div></div> : null}
    {gate ? <div className="manual-workflow-fields"><h3>{gate.prompt}</h3><Field label={`${step.name} decision note`} hint="This records your decision; it does not grant tools or change an output review."><textarea rows={3} value={note} maxLength={5000} disabled={disabled} onChange={event => setNote(event.target.value)} /></Field><div className="manual-workflow-actions"><Button variant="primary" icon={Check} disabled={disabled} onClick={() => action({ action: 'decide_approval', approval_id: gate.id, decision: 'approved', note })}>Approve gate</Button><Button variant="danger" icon={X} disabled={disabled} onClick={() => action({ action: 'decide_approval', approval_id: gate.id, decision: 'rejected', note })}>Reject gate</Button></div></div> : null}
    {status === 'prepared' ? <div className="manual-workflow-actions">{hasPreparation ? <Button variant="primary" disabled={disabled} onClick={onResume}>Review prepared context</Button> : <p>The prior context preparation is not held in this view. Cancel the unused preparation before creating another; no provider has been started by preparation.</p>}<Button disabled={disabled} onClick={() => setCancelPreparation(true)}>Cancel preparation</Button></div> : null}
    {canPrepare ? <div className="manual-workflow-actions"><Button variant="primary" icon={step.type === 'human_approval' ? ShieldCheck : Play} disabled={disabled || !dependenciesReady} onClick={step.type === 'tool' ? onMemory : onPrepare}>{step.type === 'tool' ? 'Review knowledge to save' : step.type === 'human_approval' ? 'Open human decision' : attempt ? 'Prepare next attempt' : 'Prepare step'}</Button>{!dependenciesReady ? <small>Complete prerequisites first.</small> : null}</div> : null}
    <details><summary>Attempt and handoff records</summary>{(run.steps || []).filter(item => item.step_id === step.id).length ? (run.steps || []).filter(item => item.step_id === step.id).map(item => <div key={item.id}><p>Attempt {item.attempt}: {titleCase(item.status)} · {stamp(item.started_at)}{item.terminal_reason ? ` · ${titleCase(item.terminal_reason)}` : ''}</p>{item.output_version_id ? <p>Output version <code>{item.output_version_id}</code></p> : null}{item.output?.knowledge_id ? <p>Reviewed knowledge <code>{item.output.knowledge_id}</code></p> : null}</div>) : <p>No attempts recorded.</p>}{run.definition.handoffs.filter(item => item.from === step.id || item.to === step.id).map(item => <p key={`${item.from}:${item.to}:${item.output}`}>{item.from} → {item.to} · {item.output} · {item.required ? 'exact output required' : 'optional output'}</p>)}</details>
    {cancelPreparation ? <Dialog title="Cancel unused preparation?" onClose={() => !disabled && setCancelPreparation(false)}><p>This invalidates the reserved attempt. No provider is launched. A new attempt still needs a new context review and is subject to the configured attempt limit.</p><footer className="dialog-footer"><Button disabled={disabled} onClick={() => setCancelPreparation(false)}>Keep preparation</Button><Button variant="danger" disabled={disabled} onClick={async () => { if (await action({ action: 'cancel_preparation', step_run_id: attempt.id })) setCancelPreparation(false); }}>Cancel preparation</Button></footer></Dialog> : null}
  </section>;
}

function PreparedWorkflowStep({ prepared, onClose, onStarted }) {
  const { navigate } = useApp();
  const [reviewed, setReviewed] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(null), [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);
  const request = prepared.context_inspection_request;
  useUnsavedUpdate(false, busy);
  const valid = reviewed && Date.parse(reviewed.expires_at) > Date.now() && Date.parse(prepared.step_run.expires_at) > Date.now();
  async function launch() {
    if (!valid || inFlight.current || uncertain) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      await apiRequest('/api/runs', { method: 'POST', body: { ...prepared.run_request, context_inspection_id: reviewed.id } });
      await rumboActions.refresh().catch(() => {}); onStarted();
    } catch (problem) { setError(problem); setReviewed(null); if (!problem.status || problem.status >= 500) setUncertain(true); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <Dialog title="Review this Workflow step" subtitle="Preparation did not start a provider. Review context, then explicitly launch one bounded live session." wide onClose={() => !busy && onClose()}><div className="manual-workflow-dialog"><p>Prepared attempt {prepared.step_run.attempt} · expires {stamp(prepared.step_run.expires_at)}. Requested permission: {titleCase(request.permission_mode)}. Profile and source changes invalidate this preparation.</p><ContextInspector request={request} onReviewed={setReviewed} onInvalidated={() => setReviewed(null)} /><ErrorMessage error={error} />{uncertain ? <p role="alert">Launch delivery is uncertain. Close this dialog and refresh Workflow status before doing anything else. If a provider session was bound, open that existing session. Do not create another attempt to retry the same launch.</p> : null}<p>Provider tools may read additional permitted files after launch. This is live work, not a simulation; the connected provider account and its limits are shared with other profiles.</p><Button onClick={() => navigate('agents', request.agent_id)}>Inspect agent profile</Button></div><footer className="dialog-footer"><Button disabled={busy} onClick={onClose}>Back to Workflow</Button><Button variant="primary" icon={Play} busy={busy} disabled={!valid || uncertain} onClick={launch}>Launch reviewed step</Button></footer></Dialog>;
}

function WorkflowMemoryDialog({ step, run, busy, error, onClose, onConfirm }) {
  const { data, navigate } = useApp();
  const source = latestWorkflowAttempts(run.steps).get(step.config.source_step_id);
  const output = (data.outputs || []).find(item => item.id === source?.output_id && item.workspace_id === run.workspace_id);
  const version = (data.output_versions || []).find(item => item.id === source?.output_version_id && item.output_id === output?.id);
  const [title, setTitle] = useState(step.config.title || output?.title || ''), [kind, setKind] = useState(step.config.kind || 'fact');
  return <Dialog title="Keep approved knowledge" subtitle="Save the exact accepted output with its Workflow and review provenance. This does not grant permission to future agents." wide onClose={onClose}><Form className="manual-workflow-dialog" onSubmit={event => { event.preventDefault(); if (version) onConfirm({ title: title.trim(), kind }); }}><Field label="Knowledge title"><input required maxLength={200} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></Field><Select label="Knowledge kind" value={kind} disabled={busy} onChange={setKind}>{['fact', 'decision', 'preference', 'instruction'].map(value => <option key={value} value={value}>{titleCase(value)}</option>)}</Select>{version ? <><p>Exact output version <code>{version.id}</code>. The server rechecks its approval before saving.</p><pre className="manual-memory-preview" tabIndex={0}>{version.content}</pre></> : <p role="alert">The pinned output version is unavailable. Refresh the Workflow or review the source before saving; no content will be invented.</p>}<ErrorMessage error={error} /><footer className="form-submit-row"><Button disabled={busy} onClick={onClose}>Cancel</Button>{output ? <Button disabled={busy} onClick={() => navigate('library', output.id)}>Review output</Button> : null}<Button type="submit" variant="primary" busy={busy} disabled={!version || !title.trim()}>Save approved knowledge</Button></footer></Form></Dialog>;
}

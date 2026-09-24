import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { ArrowLeft, ArrowRight, Plus, Pencil, ScrollText, RotateCw, Check, X } from '../components/icons.jsx';
import { Button, Dialog, Empty, ErrorMessage, Field, PageHeader, SearchField, Select, useApp } from '../ui.jsx';
import { Form } from '../components/Form.jsx';
import { DocumentContent } from '../components/DocumentContent.jsx';
import { SkillReliability } from '../components/SkillEvaluation.jsx';
import { SkillVersionComparison } from '../components/SkillVersionComparison.jsx';
import { requestUpdateNavigation, useUnsavedUpdate } from '../components/UnsavedUpdates.jsx';
import { SKILL_INPUT_TYPES, SKILL_TOOL_NAMES, skillContextChoices, skillRequestBody, skillEditorFields, skillEditorPayload, skillHasCurrentPass, skillPublicationReason } from '../lib/skills.js';
import './skills.css';

function useSkillResource(path) {
  const [state, setState] = useState({ loading: true, result: null, error: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, result: null, error: null });
    apiRequest(path, { signal: controller.signal }).then(({ result }) => { if (!controller.signal.aborted) setState({ loading: false, result, error: null }); }).catch(error => { if (!controller.signal.aborted) setState({ loading: false, result: null, error }); });
    return () => controller.abort();
  }, [path, revision]);
  return { ...state, reload: () => setRevision(value => value + 1) };
}

export function SkillsView() {
  const { workspace, page } = useApp();
  return page.id ? <SkillDetail key={`${workspace.id}:${page.id}`} id={page.id} /> : <SkillList key={workspace.id} />;
}

function SkillList() {
  const { workspace, navigate } = useApp();
  const state = useSkillResource(`/api/skills?workspace_id=${encodeURIComponent(workspace.id)}`);
  const [query, setQuery] = useState(''), [editing, setEditing] = useState(false);
  const items = (state.result ?? []).filter(skill => `${skill.name} ${skill.purpose}`.toLowerCase().includes(query.toLowerCase()));
  return <main className="page skills-page"><PageHeader title="Skills" description="Reusable capabilities with typed inputs, versioned instructions, and evidence. A prompt is a message; a Skill is a capability; a Workflow orchestrates work."><Button icon={RotateCw} onClick={state.reload}>Refresh</Button><Button variant="primary" icon={Plus} onClick={() => setEditing(true)}>New Skill</Button></PageHeader>
    <SearchField value={query} onChange={setQuery} placeholder="Search Skills…" /><ErrorMessage error={state.error} />
    {state.loading ? <p role="status">Loading Skills…</p> : items.length ? <div className="skills-list">{items.map(skill => <button className="skill-row" key={skill.id} onClick={() => navigate('skills', skill.id)}><ScrollText /><span><strong>{skill.name}</strong><small>{skill.purpose}</small></span><span className="skill-version">v{skill.version} · {skill.state ?? 'draft'}</span><ArrowRight /></button>)}</div> : !state.error ? <Empty kind="context_pack" title={query ? 'No matching Skills' : 'Make useful work reusable'} description="Define the inputs, context, tools, expected output, and human checks for a capability. Saving a Skill never launches an agent." action={query ? 'Clear search' : 'Create Skill'} onAction={() => query ? setQuery('') : setEditing(true)} /> : null}
    {editing ? <SkillEditor onClose={() => setEditing(false)} onSaved={skill => { setEditing(false); navigate('skills', skill.id); }} /> : null}
  </main>;
}

function SkillDetail({ id }) {
  const { navigate, notify, data, workspace } = useApp();
  const state = useSkillResource(`/api/skills/${encodeURIComponent(id)}`);
  const [editing, setEditing] = useState(false), [publishing, setPublishing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const { skill, versions = [], test_runs: tests = [] } = state.result ?? {};
  const [coverage, setCoverage] = useState(null);
  async function publish() {
    setBusy(true); setError(null);
    try { await apiRequest(`/api/skills/${encodeURIComponent(id)}/publish`, { method: 'POST', body: { version: skill.version } }); setPublishing(false); state.reload(); notify('This Skill version is published. Nothing was executed.'); } catch (problem) { setError(problem); } finally { setBusy(false); }
  }
  return <main className="page skills-page"><button className="back-link" onClick={() => navigate('skills')}><ArrowLeft />All Skills</button><ErrorMessage error={state.error} />{state.loading ? <p role="status">Loading Skill…</p> : !skill ? <Button onClick={state.reload}>Retry Skill</Button> : <>
    <PageHeader title={skill.name} description={skill.purpose}><Button icon={Pencil} onClick={() => setEditing(true)}>Edit new version</Button><Button icon={RotateCw} onClick={state.reload}>Refresh Skill</Button>{skill.state !== 'published' ? <Button variant="primary" icon={Check} disabled={!skill.test_cases?.length || !skillHasCurrentPass(skill, coverage, versions)} onClick={() => setPublishing(true)}>Publish version</Button> : null}</PageHeader>
    <div className="skill-summary"><span>Version {skill.version} · {skill.state ?? 'draft'}</span><span>Approval: {skill.approval_policy ?? 'always'}</span><span>Case-bound evaluation · human verdicts</span></div>
    {skill.state !== 'published' ? <p className="skill-note">{skillPublicationReason(skill, coverage, versions)}</p> : null}
    <div className="skill-detail-grid"><section className="skill-body"><h2>Instructions</h2><DocumentContent content={skill.instructions || 'No instructions yet.'} /><h2>Inputs</h2>{skill.inputs?.length ? <dl className="skill-input-list">{skill.inputs.map(input => <div key={input.name}><dt><code>{input.name}</code> · {input.type}{input.required ? ' · required' : ''}</dt><dd>{input.description || 'No description'}</dd></div>)}</dl> : <p>No reusable inputs defined.</p>}<h2>Expected output</h2><DocumentContent content={skill.output_format || 'Not defined.'} /><h2>Examples</h2>{skill.examples?.length ? <div>{skill.examples.map((item, index) => <details key={index}><summary>Example {index + 1}</summary><pre>{JSON.stringify(item.inputs, null, 2)}</pre><DocumentContent content={item.output} /></details>)}</div> : <p>No examples yet.</p>}<h2>Test cases</h2>{skill.test_cases?.length ? skill.test_cases.map((item, index) => <details key={index}><summary>{item.name}</summary><pre>{JSON.stringify(item.inputs, null, 2)}</pre><p>{item.expected_output}</p></details>) : <p>No test cases defined.</p>}</section>
    <aside className="skill-body"><h2>Context and boundaries</h2><List title="Required context" items={skill.required_context?.map(ref => { const item = skillContextChoices(data, workspace.id, ref.kind).find(item => item.id === ref.id); return `${ref.kind} · ${item?.name ?? item?.title ?? 'Unavailable reference'}`; })} /><List title="Allowed tools" items={skill.allowed_tools} /><List title="Required capabilities" items={skill.required_capabilities} /><p className="skill-note">These requirements do not grant access. Context and permissions must be checked before each run.</p>{skill.preferred_agent_id ? <Button onClick={() => navigate('agents', skill.preferred_agent_id)}>Open preferred agent</Button> : <p>No preferred agent.</p>}</aside></div>
    {skill.provenance?.run_id ? <section className="skill-history"><h2>Origin</h2><p className="skill-note">Derived draft from a completed run. Context was not copied automatically; this origin is not a test pass.</p><Button onClick={() => navigate('work', skill.provenance.run_id)}>Inspect source run</Button></section> : null}<SkillReliability skill={skill} versions={versions} onCoverage={setCoverage} /><section className="skill-history"><h2>Legacy manual observations</h2><p className="skill-note">Preserved historical notes, not case-bound evaluation evidence. These handwritten or imported observations do not count toward publication under the current evidence policy. No agent or provider is started by reading them.</p>{tests.length ? tests.map(test => <details key={test.id}><summary>v{versions.find(version => version.id === test.version_id)?.number ?? 'unknown'} · {test.outcome} · {stamp(test.created_at)}</summary><p>{test.evidence}</p>{test.notes ? <p>{test.notes}</p> : null}<pre>{JSON.stringify(test.inputs, null, 2)}</pre></details>) : <p>No legacy observations recorded.</p>}</section>
    <SkillVersionComparison key={skill.id} skillId={skill.id} versions={versions} />
    {editing ? <SkillEditor skill={skill} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); state.reload(); }} /> : null}
    {publishing ? <Dialog title={`Publish Skill version ${skill.version}?`} onClose={() => !busy && setPublishing(false)}><p>Each defined case has a human-reviewed pass tied to recorded evidence for this exact version. The server rechecks coverage before publication. This is not independent verification and does not start a Workflow, grant tools, or call a provider.</p><ErrorMessage error={error} /><div className="form-submit-row"><Button disabled={busy} onClick={() => setPublishing(false)}>Cancel</Button><Button variant="primary" busy={busy} onClick={publish}>Publish version</Button></div></Dialog> : null}
  </>}</main>;
}

const stamp = value => value ? new Date(value).toLocaleString() : 'Time not recorded';
function List({ title, items = [] }) { return <><h3>{title}</h3>{items.length ? <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>None specified.</p>}</>; }

function SkillEditor({ skill, onClose, onSaved }) {
  const { data, workspace } = useApp();
  const request = useRef(null);
  const initial = skillEditorFields(skill);
  const [form, setForm] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState(null), [saved, setSaved] = useState(null);
  const delivered = useRef(false);
  const dirty = !saved && JSON.stringify(form) !== JSON.stringify(initial);
  useUnsavedUpdate(dirty, busy);
  useEffect(() => {
    if (saved && !busy && !delivered.current) { delivered.current = true; onSaved(saved); }
  }, [saved, busy, onSaved]);
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const listChange = (key, index, patch) => setForm(current => ({ ...current, [key]: current[key].map((item, i) => i === index ? { ...item, ...patch } : item) }));
  const remove = (key, index) => setForm(current => ({ ...current, [key]: current[key].filter((_, i) => i !== index) }));
  const close = () => requestUpdateNavigation(onClose);
  async function save(event) {
    event.preventDefault(); if (busy || saved) return; setBusy(true); setError(null);
    try { const payload = { ...skillEditorPayload(form), ...(skill ? { version: skill.version } : { workspace_id: workspace.id }) }; const prepared = skillRequestBody(payload, request.current, () => crypto.randomUUID()); request.current = prepared.request; const { result } = await apiRequest(`/api/skills${skill ? `/${encodeURIComponent(skill.id)}` : ''}`, { method: skill ? 'PATCH' : 'POST', body: prepared.body }); setSaved(result); } catch (problem) { setError(problem); } finally { setBusy(false); }
  }
  return <Dialog wide title={skill ? `Revise ${skill.name}` : 'New Skill'} subtitle="Every saved edit creates a new version. Remove one-off details and define reusable inputs." onClose={close}><Form className="skill-editor-form" onSubmit={save}><fieldset className="skill-editor" disabled={busy}>
    <Field label="Name"><input required maxLength={160} value={form.name} onChange={event => change('name', event.target.value)} /></Field><Field label="Purpose"><textarea required rows={2} maxLength={2000} value={form.purpose} onChange={event => change('purpose', event.target.value)} /></Field>
    <Field label="Versioned instructions"><textarea required rows={8} maxLength={30000} value={form.instructions} onChange={event => change('instructions', event.target.value)} placeholder="Describe the capability and stopping condition. Use named inputs instead of one-off data." /></Field>
    <fieldset><legend>Typed inputs</legend>{form.inputs.map((input, index) => <div className="skill-input-editor" key={index}><Field label={`Input ${index + 1} name`}><input required pattern="[a-zA-Z][a-zA-Z0-9_]*" value={input.name} onChange={event => listChange('inputs', index, { name: event.target.value })} /></Field><Select label={`Input ${index + 1} type`} value={input.type} onChange={type => listChange('inputs', index, { type })}>{SKILL_INPUT_TYPES.map(type => <option key={type} value={type}>{type}</option>)}</Select>{input.type === 'enum' ? <Field label={`Input ${index + 1} options`} hint="One unique option per line"><textarea rows={3} value={input.options_text ?? ''} onChange={event => listChange('inputs', index, { options_text: event.target.value })} /></Field> : null}<Field label={`Input ${index + 1} description`}><input value={input.description} onChange={event => listChange('inputs', index, { description: event.target.value })} /></Field><label className="skill-check"><input type="checkbox" checked={input.required} onChange={event => listChange('inputs', index, { required: event.target.checked })} />Required</label><Button icon={X} onClick={() => remove('inputs', index)}>Remove input {index + 1}</Button></div>)}<Button icon={Plus} disabled={form.inputs.length >= 30} onClick={() => change('inputs', [...form.inputs, { name: '', type: 'string', required: true, description: '' }])}>Add input</Button></fieldset>
    <fieldset><legend>Required context</legend><p className="skill-note">Explicit references only. These do not fetch content or grant access.</p>{form.required_context.map((ref, index) => { const choices = skillContextChoices(data, workspace.id, ref.kind); return <div className="skill-input-editor" key={index}><Select label={`Context ${index + 1} kind`} value={ref.kind} onChange={kind => listChange('required_context', index, { kind, id: '' })}>{[['document', 'Document'], ['memory', 'Memory note'], ['knowledge', 'Approved knowledge'], ['pack', 'Context Pack']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><Select required label={`Context ${index + 1} source`} value={ref.id} onChange={id => listChange('required_context', index, { id })}><option value="">Choose approved scope…</option>{ref.id && !choices.some(item => item.id === ref.id) ? <option value={ref.id}>Unavailable reference — remove or replace</option> : null}{choices.map(item => <option key={item.id} value={item.id}>{item.name ?? item.title}</option>)}</Select><Button onClick={() => remove('required_context', index)}>Remove context {index + 1}</Button></div>; })}<Button icon={Plus} disabled={form.required_context.length >= 30} onClick={() => change('required_context', [...form.required_context, { kind: 'document', id: '' }])}>Add context reference</Button></fieldset>
    <fieldset><legend>Allowed tool requirements</legend><p className="skill-note">Tool requirements are not executable grants. Permissions are checked at run time.</p>{SKILL_TOOL_NAMES.map(tool => <label key={tool} className="skill-check"><input type="checkbox" checked={form.allowed_tools.includes(tool)} onChange={() => change('allowed_tools', form.allowed_tools.includes(tool) ? form.allowed_tools.filter(item => item !== tool) : [...form.allowed_tools, tool])} /><code>{tool}</code></label>)}</fieldset>
    <Field label="Required capabilities" hint="One capability per line"><textarea rows={3} value={form.required_capabilities} onChange={event => change('required_capabilities', event.target.value)} /></Field>
    <fieldset><legend>Examples</legend>{form.examples.map((example, index) => <div className="skill-case-editor" key={index}><Field label={`Example ${index + 1} inputs (JSON object)`}><textarea required rows={3} value={example.inputs_text} onChange={event => listChange('examples', index, { inputs_text: event.target.value })} /></Field><Field label={`Example ${index + 1} output`}><textarea required rows={4} value={example.output} onChange={event => listChange('examples', index, { output: event.target.value })} /></Field><Button onClick={() => remove('examples', index)}>Remove example {index + 1}</Button></div>)}<Button icon={Plus} disabled={form.examples.length >= 20} onClick={() => change('examples', [...form.examples, { inputs_text: '{}', output: '' }])}>Add example</Button></fieldset>
    <Select label="Preferred agent" value={form.preferred_agent_id} onChange={value => change('preferred_agent_id', value)}><option value="">No preference</option>{form.preferred_agent_id && !(data.agents ?? []).some(agent => agent.id === form.preferred_agent_id && !agent.archived_at) ? <option value={form.preferred_agent_id}>Unavailable preferred agent — remove or replace</option> : null}{(data.agents ?? []).filter(agent => agent.workspace_id === workspace.id && !agent.archived_at).map(agent => <option key={agent.id} value={agent.id}>{agent.name} · {agent.provider}</option>)}</Select>
    <Field label="Expected output format"><textarea required rows={3} value={form.output_format} onChange={event => change('output_format', event.target.value)} placeholder="For example: a Markdown report containing findings, source links, limitations, and next actions." /></Field><p className="skill-note">Approval policy: Always require review. Skill instructions cannot grant themselves permissions.</p>
    <fieldset><legend>Test cases</legend>{form.test_cases.map((item, index) => <div className="skill-case-editor" key={index}><Field label={`Test ${index + 1} name`}><input required value={item.name} onChange={event => listChange('test_cases', index, { name: event.target.value })} /></Field><Field label={`Test ${index + 1} inputs (JSON object)`}><textarea required rows={4} value={item.inputs_text} onChange={event => listChange('test_cases', index, { inputs_text: event.target.value })} /></Field><Field label={`Test ${index + 1} expected result`}><textarea required rows={3} value={item.expected_output} onChange={event => listChange('test_cases', index, { expected_output: event.target.value })} /></Field><Button icon={X} onClick={() => remove('test_cases', index)}>Remove test {index + 1}</Button></div>)}<Button icon={Plus} disabled={form.test_cases.length >= 30} onClick={() => change('test_cases', [...form.test_cases, { name: '', inputs_text: '{}', expected_output: '' }])}>Add test case</Button></fieldset>
    <ErrorMessage error={error} /><footer><Button disabled={busy} onClick={close}>Cancel</Button><Button variant="primary" type="submit" busy={busy} disabled={skill && !dirty && skill.evidence_policy_version === 2}>{skill ? 'Save new version' : 'Create draft Skill'}</Button></footer>
  </fieldset></Form></Dialog>;
}

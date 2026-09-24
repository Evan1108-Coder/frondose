import { useEffect, useId, useMemo, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { Button, Dialog, ErrorMessage, Select, useApp } from '../ui.jsx';
import { val } from '../lib/model.js';
import { aggregateUsageMetrics, formatRecordedUsage, recordedMetricSummary, recordedUsagePeriod } from '../lib/run-usage.js';
import './run-usage.css';

const label = value => String(value || 'Unknown').replaceAll('_', ' ');
const stamp = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not recorded';
const metricLabel = key => ({ input_tokens: 'Input tokens', cached_input_tokens: 'Cached input tokens', output_tokens: 'Output tokens', reasoning_output_tokens: 'Reasoning output tokens', cache_read_input_tokens: 'Cache-read input tokens', cache_creation_input_tokens: 'Cache-creation input tokens', model_count: 'Reported model count' })[key] || label(key);
const familyCopy = id => id === 'codex.main' ? 'Codex main-turn counters are shown as reported. Cached input is a subset, not an additional amount to add to input tokens. Codex cost is unknown.' : id === 'claude.main_loop' ? 'Claude main-loop counters are a separate metric family. Do not add them to Claude all-model counters.' : id === 'claude.all_models' ? 'Claude all-model counters may cover more than the main loop. They are not added to main-loop counters.' : 'Provider-reported metric family. Its values are not combined with another family.';

function useRecordedUsage(path) {
  const [revision, setRevision] = useState(0), [state, setState] = useState({ key: '', loading: true, result: null, error: null });
  const key = `${path}:${revision}`;
  useEffect(() => {
    const controller = new AbortController();
    setState({ key, loading: true, result: null, error: null });
    apiRequest(path, { signal: controller.signal }).then(({ result }) => {
      if (!controller.signal.aborted) setState({ key, loading: false, result, error: null });
    }).catch(error => { if (!controller.signal.aborted) setState({ key, loading: false, result: null, error }); });
    return () => controller.abort();
  }, [path, key]);
  return { ...(state.key === key ? state : { loading: true, result: null, error: null }), reload: () => setRevision(value => value + 1) };
}

export function RunUsageButton({ run }) {
  const [open, setOpen] = useState(false);
  return <><Button onClick={() => setOpen(true)}>Recorded usage</Button>{open ? <RunUsageDialog key={run.id} run={run} onClose={() => setOpen(false)} /> : null}</>;
}

function RunUsageDialog({ run, onClose }) {
  const state = useRecordedUsage(`/api/runs/${encodeURIComponent(run.id)}/usage`);
  const result = state.result?.run_id === run.id ? state.result : null, invocation = result?.invocation;
  const mismatch = state.result && !result ? new Error('The server did not return usage for this exact run.') : null;
  return <Dialog title="Recorded run usage" subtitle={run.title || 'Run usage'} wide onClose={onClose}><div className="run-usage-dialog">
    <p>Read-only records from this canonical run. Opening this view never probes an account, restarts a provider or estimates tokens from text.</p><div className="run-usage-actions"><span>{result ? `Record state: ${label(result.state)}` : 'Recorded metrics only'}</span><Button disabled={state.loading} onClick={state.reload}>Refresh usage</Button></div>
    {state.loading ? <p role="status">Loading recorded usage…</p> : <ErrorMessage error={state.error || mismatch} />}
    {result ? <>{!result.eligible ? <p className="run-usage-warning">This run is not eligible for canonical live usage accounting. Simulations and imported or copied history are not account usage evidence.</p> : !result.tracked ? <p className="run-usage-warning">No tracked invocation was recorded. Usage is unknown, not zero.</p> : null}<p>{result.terminal_report_complete ? 'The recorded terminal usage report is complete for the fields reported by the client.' : 'A complete terminal usage report was not recorded. Available counters may be partial; missing values remain unknown.'}</p>
      {invocation ? <dl className="run-usage-facts"><div><dt>Provider</dt><dd>{invocation.provider || 'Not recorded'}</dd></div><div><dt>Profile version</dt><dd>{invocation.agent_profile_version == null ? 'Not recorded' : `v${invocation.agent_profile_version}`}</dd></div><div><dt>Configured model</dt><dd>{invocation.model || 'Provider default / not recorded'}</dd></div><div><dt>Invocation started</dt><dd>{stamp(invocation.started_at)}</dd></div><div><dt>Terminal status</dt><dd>{label(invocation.terminal_status)}{invocation.terminal_reason ? ` · ${label(invocation.terminal_reason)}` : ''}</dd></div><div><dt>Finalized</dt><dd>{stamp(invocation.finalized_at)}</dd></div><div><dt>Reports recorded</dt><dd>{formatRecordedUsage(result.report_count)}</dd></div><div><dt>Context fingerprint</dt><dd><code>{invocation.context_fingerprint || 'Not recorded'}</code></dd></div></dl> : null}
      {(result.families || []).map(family => <section className="run-usage-family" key={family.id}><h3>{family.label || family.id}</h3><p>{familyCopy(family.id)}</p><div className="run-usage-table-scroll" tabIndex={0} role="region" aria-label={`${family.label || family.id} recorded metrics`}><table className="run-usage-table"><thead><tr><th scope="col">Metric</th><th scope="col">Recorded value</th></tr></thead><tbody>{Object.entries(family.metrics || {}).map(([key, metric]) => <tr key={key}><th scope="row">{metricLabel(key)}</th><td>{metric?.known === true ? formatRecordedUsage(metric.value) : 'Unknown'}</td></tr>)}</tbody></table></div></section>)}
      {!result.families?.length ? <p>No token metric family was recorded. No totals are inferred.</p> : null}
      <UsageEstimate estimate={result.estimate} />
      {result.limitations?.length ? <section><h3>Record limitations</h3><ul>{result.limitations.map((item, index) => <li key={index}>{typeof item === 'string' ? item : item.message || item.code || 'Additional record limitation'}</li>)}</ul></section> : null}
    </> : null}<p>These records do not report account-wide remaining usage, subscription limits or invoices. Configured model names are not proof of the provider’s resolved internal model.</p><footer className="form-submit-row"><Button onClick={onClose}>Close</Button></footer>
  </div></Dialog>;
}

export function AgentUsageDisclosure({ agentId, workspaceId }) {
  const [open, setOpen] = useState(false), panelId = useId();
  return <section className="agent-usage-disclosure"><header><h3>Recorded usage</h3><Button aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>{open ? 'Hide usage' : 'Show usage'}</Button></header><p>Known metrics for this agent’s accessible canonical runs in this workspace. Shared provider-account remaining limits are not available.</p>{open ? <div id={panelId}><WorkspaceUsage key={`${workspaceId}:${agentId}`} workspaceId={workspaceId} agentId={agentId} compact /></div> : null}</section>;
}

export function WorkspaceUsage({ workspaceId, agentId = '', compact = false }) {
  const { data } = useApp();
  const [groupBy, setGroupBy] = useState('agent'), [days, setDays] = useState('30'), [agentFilter, setAgentFilter] = useState(''), [projectFilter, setProjectFilter] = useState(''), [workflowFilter, setWorkflowFilter] = useState(''), [asOf, setAsOf] = useState(() => new Date());
  const agents = (data.agents || []).filter(item => !val(item, 'workspace_id') || val(item, 'workspace_id') === workspaceId);
  const projects = (data.projects || []).filter(item => val(item, 'workspace_id') === workspaceId);
  const workflows = (data.manual_workflows || []).filter(item => val(item, 'workspace_id') === workspaceId);
  const effectiveAgent = agentId || (agents.some(item => item.id === agentFilter) ? agentFilter : '');
  const effectiveProject = projects.some(item => item.id === projectFilter) ? projectFilter : '';
  const effectiveWorkflow = workflows.some(item => item.id === workflowFilter) ? workflowFilter : '';
  const period = useMemo(() => recordedUsagePeriod(days, asOf), [days, asOf]);
  const query = new URLSearchParams({ workspace_id: workspaceId, group_by: groupBy, ...period });
  if (effectiveAgent) query.set('agent_id', effectiveAgent);
  if (effectiveProject) query.set('project_id', effectiveProject);
  if (effectiveWorkflow) query.set('workflow_id', effectiveWorkflow);
  const state = useRecordedUsage(`/api/usage?${query}`);
  const result = state.result?.scope?.workspace_id === workspaceId ? state.result : null;
  const mismatch = state.result && !result ? new Error('The server returned usage for a different workspace.') : null;
  const name = item => `${item.name || item.title || 'Unnamed'}${item.archived_at ? ' · archived' : ''}`;
  return <section className="recorded-usage" aria-label={compact ? 'Agent recorded usage' : 'Workspace recorded usage'}>
    {!compact ? <><h2>Recorded run usage</h2><p>Permission-filtered local records, not provider-account totals. Measured usage comes only from independently tracked canonical invocations. Simulations are excluded; legacy or imported run history without an invocation record remains unknown.</p></> : null}
    <div className="run-usage-filters"><Select label="Group usage by" value={groupBy} onChange={setGroupBy}><option value="agent">Agent</option><option value="project">Project</option><option value="workflow">Workflow</option></Select><Select label="Usage period" value={days} onChange={value => { setDays(value); setAsOf(new Date()); }}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All recorded time</option></Select>{!agentId ? <Select label="Agent filter" value={effectiveAgent} onChange={setAgentFilter}><option value="">All accessible agents</option>{agents.map(item => <option key={item.id} value={item.id}>{name(item)}</option>)}</Select> : null}<Select label="Project filter" value={effectiveProject} onChange={setProjectFilter}><option value="">All accessible projects</option>{projects.map(item => <option key={item.id} value={item.id}>{name(item)}</option>)}</Select><Select label="Workflow filter" value={effectiveWorkflow} onChange={setWorkflowFilter}><option value="">All accessible Workflows</option>{workflows.map(item => <option key={item.id} value={item.id}>{name(item)}</option>)}</Select></div>
    <div className="run-usage-actions"><small>{period.from ? `Invocation start: ${stamp(period.from)} inclusive to ${stamp(period.to)} exclusive.` : 'All recorded invocation start times within the accessible window.'}</small><Button disabled={state.loading} onClick={() => { setAsOf(new Date()); state.reload(); }}>Refresh usage</Button></div>
    {state.loading ? <p role="status">Reading recorded usage…</p> : <ErrorMessage error={state.error || mismatch} />}
    {result ? <><p>{formatRecordedUsage(result.totals?.eligible_run_count)} eligible runs · {formatRecordedUsage(result.totals?.reported_run_count)} complete terminal reports · {formatRecordedUsage(result.totals?.unknown_run_count)} unknown · {formatRecordedUsage(result.totals?.partial_run_count)} partial · {formatRecordedUsage(result.totals?.ambiguous_run_count)} ambiguous.</p><p className={result.scope.accessible_window_truncated ? 'run-usage-warning' : undefined}>Bounded accessible window: at most {formatRecordedUsage(result.scope.accessible_run_limit)} runs.{result.scope.accessible_window_truncated ? ' More accessible records exist outside this window; these are not lifetime totals. Narrow the period or scope.' : ' Results describe this filter and available records, not account-wide usage.'} Hidden records and their counts are not disclosed.</p>
      <UsageBucket bucket={result.totals} title="Known subtotals for this selection" />
      <section className="run-usage-groups"><h3>By {groupBy === 'agent' ? 'agent' : groupBy === 'project' ? 'project' : 'Workflow'}</h3>{result.groups?.length ? result.groups.map(group => <details key={group.key}><summary>{group.label || 'Unattributed'} · {formatRecordedUsage(group.eligible_run_count)} eligible runs</summary><UsageBucket bucket={group} title={group.label || 'Unattributed'} /></details>) : <p>No eligible recorded runs match this selection. This is not a report of zero provider-account usage.</p>}</section>
    </> : null}
    <p>Metric families are never added together. Known subtotals exclude missing values; unknown coverage is shown for each metric. Provider billing, account remaining percentages and spend-limit enforcement are unavailable.</p>
  </section>;
}

function UsageBucket({ bucket, title }) {
  if (!bucket) return <p>Recorded subtotals are unavailable.</p>;
  return <section className="run-usage-bucket"><h3>{title}</h3>{(bucket.families || []).map(family => <section className="run-usage-family" key={family.id}><h3>{family.label || family.id}</h3><p>{familyCopy(family.id)}</p><div className="run-usage-table-scroll" tabIndex={0} role="region" aria-label={`${title}: ${family.label || family.id}`}><table className="run-usage-table run-usage-subtotals"><thead><tr><th scope="col">Metric</th><th scope="col">Known subtotal</th><th scope="col">Eligible run coverage</th><th scope="col">Report completeness</th></tr></thead><tbody>{aggregateUsageMetrics(family).map(([key, metric]) => { const summary = recordedMetricSummary(metric); return <tr key={key}><th scope="row">{metricLabel(key)}</th><td><strong>{summary.value}</strong>{summary.note ? <small>{summary.note}</small> : null}</td><td>{summary.coverage}</td><td>{summary.completeness}</td></tr>; })}</tbody></table></div></section>)}{!bucket.families?.length ? <p>No recorded token family is available for this selection.</p> : null}<UsageEstimate estimate={bucket.estimate} aggregate /></section>;
}

function UsageEstimate({ estimate, aggregate = false }) {
  if (!estimate) return <section className="run-usage-family"><h3>Cost unavailable</h3><p>No provider-client estimate recorded. Codex cost remains unknown.</p></section>;
  const summary = aggregate && estimate ? recordedMetricSummary(estimate, 'usd') : null;
  const value = aggregate ? summary?.value || 'Unknown' : estimate?.total_cost_usd?.known === true ? formatRecordedUsage(estimate.total_cost_usd.value, 'usd') : 'Unknown';
  return <section className="run-usage-family"><h3>Provider-client estimated cost</h3><p>Not billing or an invoice. A provider-client estimate is not a reconciled charge, subscription cost or account balance. Codex cost remains unknown.</p><p><strong>{value}</strong>{aggregate ? ' · known Claude client-estimate subtotal' : ' · recorded Claude client estimate'}</p>{summary ? <><p>{summary.coverage} · {summary.completeness}</p>{summary.note ? <p>{summary.note}</p> : null}<p>Estimate coverage concerns eligible Claude runs only. Codex runs are not included in these reporting counts; their cost is unknown.</p></> : null}</section>;
}

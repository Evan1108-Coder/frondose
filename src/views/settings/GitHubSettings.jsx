import { useEffect, useRef, useState } from 'react';
import { Button, ErrorMessage, Select, Toggle, useApp } from '../../ui.jsx';
import { apiRequest } from '../../data/api.js';
import { refreshFrondose } from '../../data/useFrondose.js';
import { useUnsavedUpdate } from '../../components/UnsavedUpdates.jsx';
import './github-settings.css';

const defaults = { enabled: false, interval_minutes: 10, limit: 50, query: '', labels: [], assigned_to_me: false, include_body: true, copy_labels: false, project_id: null, area_id: null, state: 'open', initial_status: 'backlog', priority: 'no_priority' };
const path = (id, action = '') => `/api/github-routes${action ? `/${action}` : ''}?workspace_id=${encodeURIComponent(id)}`;
const formFor = config => ({ ...defaults, ...config, labels_text: (config?.labels || []).join(', ') });
const when = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not yet';
const reason = code => ({ connection_changed: 'The repository or workspace directory changed. Review and save the settings again.', github_not_connected: 'The workspace GitHub connection was removed. Import is suspended.', github_routes_destination: 'The destination Area or project is no longer available.', access_denied: 'Current permission no longer allows imports.', github_routes_conflict: 'The import settings or source changed; the old request created no Routes.', github_read_failed: 'GitHub could not be read. Check gh auth status and repository access, then retry.' }[code] || code);
const requestError = cause => cause.status === 404 ? new Error('The running Frondose backend does not include GitHub Route imports yet. Keep active terminal sessions running; activate the updated backend at a safe restart, then use Recheck.') : cause;

export function GitHubSettings() {
  const { workspace, data } = useApp();
  // A workspace switch remounts the entire request/draft lifecycle.
  return <GitHubWorkspaceSettings key={workspace.id} workspace={workspace} data={data}/>;
}
function GitHubWorkspaceSettings({ workspace, data }) {
  const [value, setValue] = useState(null), [draft, setDraft] = useState(formFor(null)), [baseline, setBaseline] = useState(formFor(null)), [error, setError] = useState(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const alive = useRef(true), lock = useRef(false), requests = useRef(new Set()), dirtyRef = useRef(false), epoch = useRef(0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline); dirtyRef.current = dirty;
  useUnsavedUpdate(dirty, busy);
  const request = async (action = '', body) => {
    const controller = new AbortController(); requests.current.add(controller);
    try { return (await apiRequest(path(workspace.id, action), { method: body ? 'POST' : 'GET', body: body ? { ...body, workspace_id: workspace.id } : undefined, signal: controller.signal, timeoutMs: 45000 })).result; }
    finally { requests.current.delete(controller); }
  };
  const accept = result => { setValue(result); const form = formFor(result.config); setDraft(form); setBaseline(form); };
  useEffect(() => {
    alive.current = true;
    const generation = ++epoch.current;
    const load = () => { if (lock.current || dirtyRef.current) return; request().then(result => { if (alive.current && epoch.current === generation) accept(result); }).catch(cause => { if (alive.current && epoch.current === generation && cause.name !== 'AbortError') setError(requestError(cause)); }); };
    load(); window.addEventListener('frondose:github-connection-changed', load);
    return () => { alive.current = false; for (const controller of requests.current) controller.abort(); window.removeEventListener('frondose:github-connection-changed', load); };
  }, [workspace.id]);
  const change = patch => { setDraft(current => ({ ...current, ...patch })); setNotice(''); };
  const perform = async action => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(null); setNotice('');
    const generation = epoch.current, current = () => alive.current && epoch.current === generation;
    try {
      const payload = action === 'settings' ? { ...draft, labels: draft.labels_text.split(',').map(text => text.trim()).filter(Boolean), expected_revision: value.config?.revision || null, expected_binding_version: value.bindingVersion, expected_repository: value.repository?.slug, confirmed: true } : action === 'sync' ? { expected_revision: value.config?.revision, confirmed: true } : undefined;
      const result = await request(action, payload);
      if (!current()) return;
      accept(result);
      if (action === 'sync') { setNotice(`Created ${result.sync.created} Routes · ${result.sync.existing} already imported${result.sync.limited ? ' · Result cap reached; narrow your filter for complete coverage.' : ''}`); void refreshFrondose().catch(() => {}); }
      else if (action === 'settings') setNotice(result.config.enabled ? 'Saved. Automatic checks run while the local Frondose server is running.' : 'Saved. Automatic import is off; Sync now remains available.');
    } catch (cause) { if (current()) setError(requestError(cause)); }
    finally { lock.current = false; if (current()) setBusy(false); }
  };
  const disabled = busy || !value?.connected;
  const projects = (data.projects || []).filter(project => project.workspace_id === workspace.id && !project.archived_at && (!draft.area_id || project.team_id === draft.area_id));
  const areas = (data.teams || []).filter(area => area.workspace_id === workspace.id && !area.archived_at);
  return <div className="github-route-settings">
    <header className="settings-heading"><div><h1>GitHub</h1><p>Bring GitHub issues into this local workspace as Routes.</p></div><Button disabled={busy || dirty} onClick={() => perform('')}>Recheck</Button></header>
    <ErrorMessage error={error}/>
    {!value ? <p role="status">{error ? 'Repository settings could not be loaded. Use Recheck to retry.' : 'Reading local repository connection…'}</p> : <>
      <div className="github-route-connection" role="status"><strong>{value.connected ? value.repository?.slug : 'GitHub is not connected'}</strong><span>{value.connected ? 'Uses your local GitHub CLI account. No GitHub writes.' : 'Connect the selected directory from the workspace GitHub button first. Import settings stay disabled until connected.'}</span></div>
      <section className="settings-group"><h2>Issue → Route import</h2><div className="settings-panel" aria-disabled={!value.connected}>
        <Toggle label="Automatically import issues" description="Off by default. Checks only while Frondose’s local server is running." checked={draft.enabled} disabled={disabled} onChange={enabled => change({ enabled })}/>
        <div className="github-route-fields">
          <label>Destination Area<Select aria-label="GitHub issue destination Area" disabled={disabled} value={draft.area_id || ''} onChange={area_id => change({ area_id: area_id || null, project_id: null })}><option value="">No Area</option>{areas.map(area => <option key={area.id} value={area.id}>{area.name}</option>)}</Select></label>
          <label>Destination project<Select aria-label="GitHub issue destination project" disabled={disabled} value={draft.project_id || ''} onChange={project_id => { const project = projects.find(item => item.id === project_id); change({ project_id: project_id || null, ...(project ? { area_id: project.team_id || null } : {}) }); }}><option value="">No project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</Select></label>
          <label>Issue state<Select aria-label="GitHub issue state" disabled={disabled} value={draft.state} onChange={state => change({ state })}><option value="open">Open</option><option value="closed">Closed</option><option value="all">All</option></Select></label>
          <label>Initial Route status<Select aria-label="Imported Route status" disabled={disabled} value={draft.initial_status} onChange={initial_status => change({ initial_status })}><option value="backlog">Backlog</option><option value="todo">Todo</option><option value="in_progress">In progress</option></Select></label>
          <label>Check interval<Select aria-label="GitHub import interval" disabled={disabled} value={String(draft.interval_minutes)} onChange={value => change({ interval_minutes: Number(value) })}>{[5, 10, 15, 30, 60].map(minutes => <option key={minutes} value={String(minutes)}>{minutes} minutes</option>)}</Select></label>
          <label>Issues per check<Select aria-label="GitHub issue result limit" disabled={disabled} value={String(draft.limit)} onChange={value => change({ limit: Number(value) })}>{[25, 50, 100].map(limit => <option key={limit} value={String(limit)}>{limit}</option>)}</Select></label>
          <label className="github-route-wide">Search filter<input aria-label="GitHub issue search filter" data-field-defaults-exclude="true" disabled={disabled} maxLength={300} value={draft.query} placeholder="e.g. updated:>=2026-10-01" onChange={event => change({ query: event.target.value })}/></label>
          <label className="github-route-wide">Required labels<input aria-label="GitHub required issue labels" data-field-defaults-exclude="true" disabled={disabled} maxLength={809} value={draft.labels_text} placeholder="bug, documentation (all must match)" onChange={event => change({ labels_text: event.target.value })}/></label>
        </div>
        <Toggle label="Only issues assigned to me" checked={draft.assigned_to_me} disabled={disabled} onChange={assigned_to_me => change({ assigned_to_me })}/>
        <Toggle label="Include issue description" checked={draft.include_body} disabled={disabled} onChange={include_body => change({ include_body })}/>
        <Toggle label="Copy GitHub labels to new Routes" checked={draft.copy_labels} disabled={disabled} onChange={copy_labels => change({ copy_labels })}/>
        <p className="github-route-note">Create-only: each repository and issue number imports once. Local titles, descriptions, status and destination are never overwritten. Deleted Routes are not recreated. Importing a closed issue does not mark its Route accepted or complete. Existing imported Routes are never moved by a settings change.</p>
        <div className="github-route-actions"><Button variant="primary" disabled={disabled || !dirty && Boolean(value.config) && value.status.state !== 'suspended'} onClick={() => perform('settings')}>Save settings</Button><Button disabled={disabled || dirty || !value.config || value.status.state === 'suspended'} onClick={() => perform('sync')}>{busy ? 'Working…' : 'Sync now'}</Button>{dirty ? <Button disabled={busy} onClick={() => setDraft(baseline)}>Discard changes</Button> : null}</div>
      </div></section>
      <section className="settings-group"><h2>Import status</h2><div className="settings-panel github-route-status"><p><strong>{value.status.state === 'suspended' ? 'Suspended — review source' : value.status.state === 'scheduled' ? 'Automatic checks enabled' : value.status.state === 'syncing' ? 'Import in progress' : 'Manual import'}</strong></p>{value.status.reason ? <p role="status">{reason(value.status.reason)}</p> : null}<dl><dt>Imported sources</dt><dd>{value.importedCount}</dd><dt>Last successful check</dt><dd>{when(value.status.lastSuccessAt)}</dd><dt>Next automatic check</dt><dd>{value.status.nextCheckAt ? when(value.status.nextCheckAt) : 'Off'}</dd></dl>{value.status.result?.limited ? <p>Last check reached its result cap. This is not a complete repository backfill. Narrow the filter or import a different date range to cover older issues.</p> : null}<p>GitHub issue reads require current repository access. Changing the directory, remote, consent or destination permissions stops imports until reviewed. No fetch, push, issue edits or automatic agent execution is performed by this source.</p></div></section>
      {notice ? <p role="status" className="github-route-notice">{notice}</p> : null}
    </>}
  </div>;
}

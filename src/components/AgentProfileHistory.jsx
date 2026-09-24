import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { refreshRumbo } from '../data/useRumbo.js';
import { Button, Dialog, ErrorMessage, Select, useApp } from '../ui.jsx';
import { ChangeReview } from './ChangeReview.jsx';
import { requestUpdateNavigation, useUnsavedUpdate } from './UnsavedUpdates.jsx';
import { textPatch } from '../lib/change-review.js';
import { AGENT_CONTENT_FIELDS, agentContentChanges, agentContentField, agentContentRequestBody, agentContentVersionLabel, selectedAgentContentFields } from '../lib/agent-profile-history.js';
import './agent-profile-history.css';

const stamp = value => value ? new Date(value).toLocaleString() : 'Date not recorded';

function useProfileHistory(agentId) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ loading: true, loadingMore: false, result: null, error: null });
  const pageRequest = useRef(null), generation = useRef(0), pageInFlight = useRef(false);
  useEffect(() => {
    const controller = new AbortController(), current = ++generation.current;
    pageRequest.current?.abort(); pageInFlight.current = false;
    setState({ loading: true, loadingMore: false, result: null, error: null });
    apiRequest(`/api/agents/${encodeURIComponent(agentId)}/content-history?limit=20`, { signal: controller.signal }).then(({ result }) => {
      if (!controller.signal.aborted && generation.current === current) setState({ loading: false, loadingMore: false, result, error: null });
    }).catch(error => { if (!controller.signal.aborted) setState({ loading: false, loadingMore: false, result: null, error }); });
    return () => { controller.abort(); pageRequest.current?.abort(); generation.current++; };
  }, [agentId, revision]);
  async function loadOlder() {
    if (!state.result?.next_before_version || pageInFlight.current) return;
    const controller = new AbortController(), current = generation.current;
    pageRequest.current = controller; pageInFlight.current = true;
    setState(old => ({ ...old, loadingMore: true, error: null }));
    try {
      const query = new URLSearchParams({ limit: '20', before_version: String(state.result.next_before_version) });
      const { result } = await apiRequest(`/api/agents/${encodeURIComponent(agentId)}/content-history?${query}`, { signal: controller.signal });
      if (!controller.signal.aborted && generation.current === current) setState(old => {
        const versions = new Map((old.result?.versions || []).map(item => [item.version, item]));
        for (const version of result.versions || []) versions.set(version.version, version);
        return { ...old, loadingMore: false, result: { ...old.result, versions: [...versions.values()].sort((a, b) => b.version - a.version), next_before_version: result.next_before_version, latest_observed_version: result.current_version } };
      });
    } catch (error) { if (!controller.signal.aborted && generation.current === current) setState(old => ({ ...old, loadingMore: false, error })); }
    finally { if (generation.current === current) pageInFlight.current = false; }
  }
  return { ...state, loadOlder, reload: () => setRevision(value => value + 1) };
}

export function AgentProfileHistory({ agent, onClose }) {
  const { notify } = useApp();
  const history = useProfileHistory(agent.id);
  const [leftVersion, setLeftVersion] = useState(''), [rightVersion, setRightVersion] = useState(''), [field, setField] = useState('instructions');
  const [selectedFields, setSelectedFields] = useState([]), [preview, setPreview] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(null), [error, setError] = useState(null);
  const request = useRef(null), inFlight = useRef(false), delivered = useRef(false);
  const bodyRef = useRef(null), previewHeading = useRef(null), restoreHeading = useRef(null), previousPreview = useRef(false);
  const versions = history.result?.versions || [];
  const currentVersion = history.result?.current_version;
  const source = versions.find(item => item.version === Number(leftVersion)) || (!leftVersion ? versions.find(item => item.version !== currentVersion) || versions[0] : null);
  const comparisonTarget = versions.find(item => item.version === Number(rightVersion)) || (!rightVersion ? versions.find(item => item.version === currentVersion) || versions[0] : null);
  const current = versions.find(item => item.version === currentVersion);
  const sourceContent = source?.restricted ? null : source?.content;
  const comparisonContent = comparisonTarget?.restricted ? null : comparisonTarget?.content;
  const currentContent = current?.restricted ? null : current?.content;
  const changes = agentContentChanges(sourceContent, comparisonContent);
  const restoreChanges = agentContentChanges(currentContent, sourceContent);
  const fields = selectedAgentContentFields(selectedFields);
  const stale = (Number.isInteger(agent.version) && Number.isInteger(currentVersion) && agent.version > currentVersion) || Boolean(history.result?.latest_observed_version && history.result.latest_observed_version !== currentVersion);
  const canPrepare = Boolean(source?.source_sha256 && !source.restricted && currentContent && !stale && fields.length && fields.every(id => restoreChanges.find(item => item.id === id)?.state === 'changed'));
  const dirty = !saved && Boolean(fields.length || preview || confirmed);
  useUnsavedUpdate(dirty, busy);
  useEffect(() => {
    if (previousPreview.current === preview) return;
    previousPreview.current = preview;
    const body = bodyRef.current, heading = preview ? previewHeading.current : restoreHeading.current;
    heading?.focus({ preventScroll: true });
    if (!body) return;
    body.scrollLeft = 0;
    body.scrollTop = preview ? 0 : heading ? body.scrollTop + heading.getBoundingClientRect().top - body.getBoundingClientRect().top - 16 : 0;
  }, [preview]);
  useEffect(() => {
    if (saved && !busy && !delivered.current) {
      delivered.current = true;
      void refreshRumbo().catch(() => {});
      notify(`Selected content saved as profile version ${saved.restored_version?.version ?? saved.current_version}. No work was started.`); onClose();
    }
  }, [saved, busy, notify, onClose]);
  function changeVersions(action) {
    requestUpdateNavigation(() => { setSelectedFields([]); setPreview(false); setConfirmed(false); setError(null); request.current = null; action(); });
  }
  function reload() { changeVersions(() => { setLeftVersion(''); setRightVersion(''); history.reload(); }); }
  async function restore() {
    if (!confirmed || !preview || !canPrepare || inFlight.current || saved) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const payload = { current_version: currentVersion, source_version: source.version, source_hash: source.source_sha256, fields, confirmed: true };
      const next = agentContentRequestBody(payload, request.current, () => crypto.randomUUID()); request.current = next.request;
      const response = await apiRequest(`/api/agents/${encodeURIComponent(agent.id)}/restore-content`, { method: 'POST', body: next.body }); setSaved(response.result);
    } catch (problem) { setError(problem); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <Dialog title={preview ? 'Review selected content restore' : `${agent.name} · content history`} subtitle="Compare recorded text. Restoring creates a new profile version." wide onClose={() => requestUpdateNavigation(onClose)}><div ref={bodyRef} className="agent-profile-history-dialog">
    <p>Only role, description, instructions and expected output behavior can be restored. Name, status, account, provider, model, reasoning, folders, context, memory and permissions stay unchanged. Historical instructions are content, never authorization.</p>
    {history.loading ? <p role="status">Loading recorded profile versions…</p> : <>
      <div className="agent-profile-history-actions"><span>{versions.length} versions loaded · current v{currentVersion ?? 'unknown'} · pages of up to 20</span><Button disabled={busy || history.loadingMore} onClick={reload}>Refresh history</Button>{history.result?.next_before_version ? <Button disabled={busy || preview} busy={history.loadingMore} onClick={history.loadOlder}>Load older versions</Button> : null}</div>
      <ErrorMessage error={history.error} />
      {stale ? <p className="agent-profile-history-warning" role="status">This profile changed while history was open. Refresh history and review your selections again before restoring.</p> : null}
      {!versions.length && !history.error ? <p>No recorded versions are available. Missing history cannot be reconstructed from today’s profile.</p> : null}
      {versions.length ? <>
        {!preview ? <><div className="agent-profile-history-selectors"><Select label="Source version" value={String(source?.version ?? '')} disabled={busy} onChange={value => changeVersions(() => setLeftVersion(value))}>{versions.map(item => <option value={item.version} key={item.version}>{agentContentVersionLabel(item)}{item.version === currentVersion ? ' · current' : ''}</option>)}</Select><Select label="Compare with version" value={String(comparisonTarget?.version ?? '')} disabled={busy} onChange={value => changeVersions(() => setRightVersion(value))}>{versions.map(item => <option value={item.version} key={item.version}>{agentContentVersionLabel(item)}{item.version === currentVersion ? ' · current' : ''}</option>)}</Select></div>
          <div className="agent-profile-version-facts"><VersionFacts title="Source" version={source} /><VersionFacts title="Compare with" version={comparisonTarget} /></div>
          <ul className="agent-profile-field-summary" aria-label="Field change summary">{changes.map(item => <li key={item.id}><span>{item.label}</span><strong>{item.state === 'changed' ? 'Changed' : item.state === 'unchanged' ? 'Unchanged' : 'Unavailable — not an empty value'}</strong></li>)}</ul>
          <Select label="Field to compare" value={field} onChange={setField}>{AGENT_CONTENT_FIELDS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select>
          <ContentComparison before={sourceContent} after={comparisonContent} field={field} base={`Profile v${source?.version ?? '?'}`} head={`Profile v${comparisonTarget?.version ?? '?'}`} />
          <fieldset className="agent-profile-restore-fields" disabled={busy || stale || !source?.source_sha256 || Boolean(source?.restricted)}><legend ref={restoreHeading} tabIndex={-1}>Select fields to restore from version {source?.version ?? '?'}</legend><p>Selections are compared with current version {currentVersion ?? '?'}, even when the comparison above shows another historical version. All choices start unchecked.</p>{restoreChanges.map(item => <label key={item.id}><input type="checkbox" checked={fields.includes(item.id)} disabled={item.state !== 'changed'} onChange={event => { setSelectedFields(previous => event.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id)); setConfirmed(false); setError(null); }} /><span>{item.label}<small>{item.state === 'unavailable' ? 'Source or current content unavailable; cannot restore' : item.state === 'unchanged' ? 'Already matches the current version' : item.after.value === '' ? 'Will explicitly clear this field to its recorded empty value' : 'Will replace the current text with this recorded source text'}</small></span></label>)}</fieldset>
        </> : <section className="agent-profile-restore-preview"><h3 ref={previewHeading} tabIndex={-1}>Save {fields.length} selected field{fields.length === 1 ? '' : 's'} as a new version</h3><p>Source v{source?.version} → new version after current v{currentVersion}. Existing history and pinned runs stay unchanged. The server rechecks versions, the source hash and access before saving.</p><VersionFacts title="Restore source" version={source} />{fields.map(id => { const definition = AGENT_CONTENT_FIELDS.find(item => item.id === id); return <details key={id} open><summary>{definition.label} · exact proposed text</summary><pre tabIndex={0} aria-label={`Proposed ${definition.label}`}>{agentContentField(sourceContent, id).value || '(Recorded empty value — this field will be cleared)'}</pre></details>; })}<label className="workflow-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>I reviewed the selected text and want to save it as a new profile version.</span></label><p>This does not launch, restart or modify an existing run, and it does not roll back files or workspace changes.</p></section>}
      </> : null}
    </>}
    <ErrorMessage error={error} /><footer className="form-submit-row"><Button disabled={busy} onClick={() => { if (preview) { setPreview(false); setConfirmed(false); } else requestUpdateNavigation(onClose); }}>{preview ? 'Back to comparison' : 'Close'}</Button>{preview ? <Button variant="primary" disabled={!confirmed || !canPrepare || Boolean(saved)} busy={busy} onClick={restore}>Save as new version</Button> : <Button variant="primary" disabled={!canPrepare || busy || history.loading} onClick={() => { setPreview(true); setConfirmed(false); }}>Preview selected restore</Button>}</footer>
  </div></Dialog>;
}

function VersionFacts({ title, version }) {
  return <section><h3>{title} · {agentContentVersionLabel(version)}</h3>{!version ? <p>Version unavailable.</p> : <><p>{stamp(version.created_at)}</p>{version.restricted ? <p className="agent-profile-history-warning">Historical content unavailable: {version.reason === 'invalid_snapshot' ? 'the recorded snapshot is invalid' : 'its source access is unavailable'}. This does not mean the fields were empty or deleted.</p> : <><p>{version.author?.id ? <>Recorded server actor <code>{version.author.id}</code>{version.author.name ? ` · display name: ${version.author.name}` : ''}</> : 'Author not recorded (legacy / unknown)'}</p><small>Source hash <code>{version.source_sha256 || 'Not recorded'}</code></small>{version.restored_from ? <p>Restored from v{version.restored_from.version} · {(version.restored_from.fields || []).map(id => AGENT_CONTENT_FIELDS.find(item => item.id === id)?.label || 'Unknown field').join(', ')}</p> : null}</>}</>}</section>;
}

function ContentComparison({ before, after, field, base, head }) {
  const left = agentContentField(before, field), right = agentContentField(after, field);
  const label = AGENT_CONTENT_FIELDS.find(item => item.id === field)?.label || 'Content';
  const comparison = useMemo(() => ({ source: 'document', title: `${label} comparison`, base, head, notice: 'Exact saved profile text. Code font, theme and diff layout follow Code & reviews settings. Restoring never grants access.', files: left.available && right.available && left.value !== right.value ? [{ path: `${field}.md`, status: 'modified', patch: textPatch(left.value, right.value) }] : [] }), [label, base, head, field, left.available, left.value, right.available, right.value]);
  if (!left.available || !right.available) return <p className="agent-profile-history-warning" role="status">Comparison unavailable for {label.toLowerCase()}. One or both exact values are unavailable, not blank. No additions or deletions are inferred.</p>;
  return <><ChangeReview comparison={comparison} /><details className="agent-profile-exact-text"><summary>Read exact values</summary><div className="agent-profile-version-facts"><section><h3>{base}</h3><pre tabIndex={0}>{left.value || '(Recorded empty value)'}</pre></section><section><h3>{head}</h3><pre tabIndex={0}>{right.value || '(Recorded empty value)'}</pre></section></div></details></>;
}

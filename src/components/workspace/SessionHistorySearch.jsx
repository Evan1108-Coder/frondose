import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../../data/api.js';
import { Button, Dialog, ErrorMessage, Select } from '../../ui.jsx';
import './session-history-search.css';

const names = { codex: 'Codex', claude: 'Claude Code' };
const path = (workspaceId, action = '', parameters = {}) => `/api/local-session-history${action ? `/${action}` : ''}?${new URLSearchParams({ workspace_id: workspaceId, ...parameters })}`;
async function request(workspaceId, action, method = 'GET', body, parameters, signal) { return (await apiRequest(path(workspaceId, action, parameters), { method, body, signal, timeoutMs: 30_000 })).result; }
const when = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Time unavailable';

// One lifecycle per workspace. Late responses must match both the live channel
// ticket and the currently rendered workspace, including before effect cleanup.
export function createHistoryRequestScope() {
  const channels = new Map();
  const api = {
    begin(channel) { api.cancel(channel); const ticket = { channel, controller: new AbortController() }; channels.set(channel, ticket); return ticket; },
    current(ticket, activeScope = api) { return activeScope === api && channels.get(ticket.channel) === ticket && !ticket.controller.signal.aborted; },
    finish(ticket) { if (channels.get(ticket.channel) === ticket) channels.delete(ticket.channel); },
    cancel(...names) { for (const name of names) { const ticket = channels.get(name); ticket?.controller.abort(); channels.delete(name); } },
    cancelTicket(ticket) { if (channels.get(ticket.channel) === ticket) api.cancel(ticket.channel); },
    cancelAll() { api.cancel(...channels.keys()); },
  };
  return api;
}

function useHistorySettings(workspaceId) {
  const scope = useMemo(() => createHistoryRequestScope(), [workspaceId]), activeScope = useRef(scope); activeScope.current = scope;
  const empty = { workspaceId, settings: null, error: null, settingsBusy: false, scanBusy: false };
  const [value, setValue] = useState(empty), state = value.workspaceId === workspaceId ? value : empty;
  const isCurrent = useCallback(ticket => scope.current(ticket, activeScope.current), [scope]);
  const commit = useCallback((ticket, patch) => { if (isCurrent(ticket)) setValue(current => ({ ...(current.workspaceId === workspaceId ? current : { workspaceId, settings: null, error: null, settingsBusy: false, scanBusy: false }), ...patch })); }, [workspaceId, isCurrent]);
  useEffect(() => {
    setValue({ workspaceId, settings: null, error: null, settingsBusy: false, scanBusy: false });
    const ticket = scope.begin('settings-load');
    request(workspaceId, '', 'GET', undefined, undefined, ticket.controller.signal).then(settings => commit(ticket, { settings, error: null })).catch(error => commit(ticket, { error })).finally(() => scope.finish(ticket));
    return () => scope.cancelAll();
  }, [workspaceId, scope, commit]);
  const change = useCallback(async (enabled, allowAll, clearOnly = false) => {
    // Privacy changes remain available during indexing. Abort its UI request;
    // the server's changed consent epoch separately stops/rejects the old scan.
    scope.cancel('refresh', 'search', 'settings-load');
    const ticket = scope.begin('settings-change'); commit(ticket, { settingsBusy: true, scanBusy: false, error: null });
    try { const settings = await request(workspaceId, clearOnly ? 'clear' : 'settings', 'POST', { ...(clearOnly ? {} : { enabled, allow_all: allowAll }), confirmed: true }, undefined, ticket.controller.signal); if (!isCurrent(ticket)) return null; commit(ticket, { settings, error: null }); return settings; }
    catch (error) { commit(ticket, { error }); return null; } finally { commit(ticket, { settingsBusy: false }); scope.finish(ticket); }
  }, [workspaceId, scope, commit, isCurrent]);
  const refresh = useCallback(async input => {
    const ticket = scope.begin('refresh'); commit(ticket, { scanBusy: true, error: null });
    try { const settings = await request(workspaceId, 'refresh', 'POST', input, undefined, ticket.controller.signal); if (!isCurrent(ticket)) return null; commit(ticket, { settings, error: null }); return settings; }
    catch (error) { commit(ticket, { error }); return null; } finally { commit(ticket, { scanBusy: false }); scope.finish(ticket); }
  }, [workspaceId, scope, commit, isCurrent]);
  return { ...state, busy: state.settingsBusy || state.scanBusy, change, refresh, requests: scope, isCurrent, isActive: () => activeScope.current === scope };
}

function HistoryConsent({ state }) {
  const { settings, settingsBusy: busy, change } = state, [allowAll, setAllowAll] = useState(false);
  useEffect(() => setAllowAll(settings?.allowAll === true), [settings?.allowAll]);
  return <div className="session-history-consent">
    <p>Search supported CLI histories on this computer. Session headers are read locally to find the selected directory; only matching user and assistant text is indexed. Nothing is uploaded or imported into Frondose conversations.</p>
    <label><input type="checkbox" checked={allowAll} disabled={busy} onChange={event => setAllowAll(event.target.checked)} data-field-defaults-exclude="true" />Allow the separate “All local sessions” scope to index histories from other directories</label>
    <p className="session-history-note">Histories can contain sensitive text. Search content stays in bounded process memory, not workspace exports. Clear or disable removes Frondose’s index, never the provider’s original files.</p>
    <div className="session-history-actions"><Button variant="primary" disabled={!settings || busy} onClick={() => change(true, allowAll)}>{settings?.enabled ? 'Save history access' : 'Enable local history search'}</Button>{settings?.enabled ? <><Button disabled={busy} onClick={() => change(false, false)}>Disable</Button><Button disabled={busy} onClick={() => change(true, settings.allowAll, true)}>Clear local search index</Button></> : null}</div>
  </div>;
}

export function LocalSessionHistorySettings({ workspaceId }) {
  const state = useHistorySettings(workspaceId);
  return <section className="session-history-settings"><h3>Native CLI session history</h3><p>Opt-in title and message search for Codex and Claude Code. Other CLIs use their own native history commands. This does not read ChatGPT or Claude website chats.</p><ErrorMessage error={state.error} />{state.settings ? <><HistoryConsent state={state} /><p className="session-history-note">{state.settings.enabled ? `${state.settings.indexed} sessions currently indexed. Open Session history search and choose Refresh index to scan.` : 'Disabled. No session files are scanned until you enable search and explicitly refresh the index.'}</p></> : <p role="status">Loading local history access…</p>}</section>;
}

/** onResume receives only a displayed result with an opaque id. The caller
 * carries historyResultId as transient launch intent, never tab persistence. */
export function SessionHistorySearch({ workspaceId, onClose, onResume, onChooseDirectory, onBrowseCodex }) {
  const state = useHistorySettings(workspaceId), { settings } = state;
  const [scope, setScope] = useState('workspace'), [projectId, setProjectId] = useState(''), [provider, setProvider] = useState(''), [query, setQuery] = useState(''), [revision, setRevision] = useState(0), [result, setResult] = useState(null), [searching, setSearching] = useState(false), [searchError, setSearchError] = useState(null), [showAccess, setShowAccess] = useState(false);
  useEffect(() => { setScope('workspace'); setProjectId(''); setProvider(''); setQuery(''); setRevision(0); setResult(null); setSearching(false); setSearchError(null); setShowAccess(false); }, [workspaceId]);
  useEffect(() => { if (settings?.projectId && !projectId) setProjectId(settings.projectId); }, [settings?.projectId, projectId]);
  useEffect(() => { if (settings && scope === 'all' && !settings.allowAll) setScope('workspace'); }, [settings?.allowAll, scope]);
  useEffect(() => {
    setResult(null); setSearching(false); setSearchError(null);
    if (!settings?.enabled || state.settingsBusy || scope === 'workspace' && !settings.root || scope === 'all' && !settings.allowAll || scope === 'project' && !projectId) return;
    const ticket = state.requests.begin('search'); setSearching(true);
    const timer = setTimeout(() => request(workspaceId, 'search', 'GET', undefined, { scope, ...(scope === 'project' ? { project_id: projectId } : {}), ...(provider ? { provider } : {}), q: query }, ticket.controller.signal).then(next => { if (state.isCurrent(ticket)) { setResult(next); setSearchError(null); } }).catch(error => { if (state.isCurrent(ticket)) setSearchError(error); }).finally(() => { if (state.isCurrent(ticket)) setSearching(false); state.requests.finish(ticket); }), 200);
    return () => { clearTimeout(timer); state.requests.cancelTicket(ticket); };
  }, [workspaceId, state.requests, state.isCurrent, state.settingsBusy, settings?.enabled, settings?.allowAll, settings?.generation, settings?.root, scope, projectId, provider, query, revision]);
  const refresh = async () => {
    const next = await state.refresh({ scope, ...(scope === 'project' ? { project_id: projectId } : {}) });
    if (next && state.isActive()) setRevision(value => value + 1);
  };
  return <Dialog title="Session history search" onClose={onClose} className="session-history-dialog"><div className="session-history-content">
    {onBrowseCodex?<div className="session-history-actions"><Button onClick={onBrowseCodex}>Browse all Codex chats</Button><small>Open Codex’s own local picker across directories without indexing chat text in Frondose.</small></div>:null}
    <ErrorMessage error={state.error || searchError} />
    {!settings ? <p role="status">Loading local history access…</p> : <>
      {!settings.enabled || showAccess ? <HistoryConsent state={state} /> : null}
      {settings.enabled ? <>
        <div className="session-history-toolbar"><input type="search" autoFocus value={query} maxLength={180} onChange={event => setQuery(event.target.value)} placeholder="Search titles and messages…" aria-label="Search session titles and content" data-field-defaults-exclude="true" /><Select label="Scope" value={scope} onChange={setScope}><option value="workspace">This workspace</option><option value="project">Project directory</option><option value="all" disabled={!settings.allowAll}>All local sessions{settings.allowAll ? '' : ' — separate opt-in'}</option></Select><Select label="Provider" value={provider} onChange={setProvider}><option value="">All supported CLIs</option><option value="codex">Codex</option><option value="claude">Claude Code</option></Select></div>
        {scope === 'project' ? <Select label="Project" value={projectId} onChange={setProjectId}><option value="">Choose a local project</option>{settings.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</Select> : null}
        <div className="session-history-actions"><Button busy={state.scanBusy} disabled={state.settingsBusy || scope === 'workspace' && !settings.root || scope === 'project' && !projectId || scope === 'all' && !settings.allowAll} onClick={refresh}>Refresh index</Button><Button onClick={() => setShowAccess(value => !value)}>{showAccess ? 'Hide history access' : 'History access'}</Button>{onChooseDirectory && !settings.root ? <Button onClick={onChooseDirectory}>Choose workspace directory</Button> : null}</div>
        <p className="session-history-note">Codex and Claude Code JSONL only. All local sessions includes archived Codex chats for search; restore them in Codex to resume. Tools, reasoning and website chats are not indexed. Direct resume uses the original linked directory.</p>
        {result?.needsRefresh ? <p role="status">Refresh the index for this scope. Changed or removed source files are hidden until refreshed.</p> : null}
        {result?.limited ? <p role="status">The bounded scan reached its limit. Results and message counts cover only supported files that fit the scan limits.</p> : null}
        {searching || state.busy ? <p role="status">{state.busy ? 'Reading the selected local history scope…' : 'Searching…'}</p> : null}
        <div className="session-history-results" aria-label="Native session search results">{result?.items.map(item => <article className="session-history-result" key={item.id}><div><h3>{item.title}</h3><p className="session-history-meta"><span>{names[item.providerId]}</span><span>{item.messageCount} messages</span><time dateTime={item.updatedAt}>{when(item.updatedAt)}</time></p><p className="session-history-directory" title={item.directory}>{item.directory}</p>{item.snippet ? <p className="session-history-snippet">{item.snippet}</p> : null}{!item.canResume ? <p className="session-history-note">{item.resumeReason}</p> : null}</div><Button disabled={!item.canResume || state.busy || !onResume} onClick={() => onResume(item)}>Resume</Button></article>)}{result && !result.items.length && !searching && !result.needsRefresh ? <p>No supported sessions matched this search.</p> : null}</div>
        {result?.total > 40 ? <p className="session-history-note">Showing the 40 newest matches. Refine the search to find an older session.</p> : null}
      </> : null}
    </>}
  </div></Dialog>;
}

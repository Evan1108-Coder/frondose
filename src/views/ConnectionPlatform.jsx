import { useEffect, useRef, useState } from 'react';
import { apiRequest, rumboApi } from '../data/api.js';
import { refreshRumbo } from '../data/useRumbo.js';
import { Button, Dialog, ErrorMessage, Field, PageHeader, SearchField, Select, useApp } from '../ui.jsx';
import { Form } from '../components/Form.jsx';
import { ServiceLogo } from '../components/ServiceLogo.jsx';
import { ArrowLeft, ArrowRight, Check, ExternalLink, Plug, Settings, ShieldCheck } from '../components/icons.jsx';
import { ConnectionDialog } from './Connections.jsx';
import { GitHubCodeBrowser } from '../components/GitHubCodeBrowser.jsx';
import { ConnectionOverview } from '../components/ConnectionOverview.jsx';
import { connectionPresentation } from '../lib/connection-presentation.js';
import { safeUrl } from '../lib/model.js';
import { connectionReadOptions, connectionQueryKey, matchingConnectionCursor, selectedConnectionResources, connectionScopes, PACKAGE_TYPES, canEditRejectedConnectionAction } from '../lib/connection-ui-policy.js';
import './connection-platform.css';

const BASE = '/api/connection-platform';
const stamp = value => value ? new Date(value).toLocaleString() : 'Never';
const readable = value => String(value === 'team' ? 'Area' : value ?? '').replaceAll('_', ' ').replaceAll('-', ' ');
const unwrap = response => response.result;
const get = (path, signal) => apiRequest(`${BASE}${path}`, { signal }).then(unwrap);
const mutate = (path, body, method = 'POST') => apiRequest(`${BASE}${path}`, { method, body }).then(unwrap);
const established = new Set(['codex', 'claude', 'github', 'google-drive']);

export function ConnectionPlatformView() {
  const { workspace, data } = useApp();
  const [catalog, setCatalog] = useState([]), [connections, setConnections] = useState([]);
  const [query, setQuery] = useState(''), [category, setCategory] = useState('all'), [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(null), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setSelected(null);
    Promise.all([get(`/catalog?workspace_id=${encodeURIComponent(workspace.id)}`, controller.signal), get(`/connections?workspace_id=${encodeURIComponent(workspace.id)}`, controller.signal)])
      .then(([items, records]) => { if (!controller.signal.aborted) { setCatalog(items); setConnections(records); } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspace.id, revision]);
  const refresh = async () => setConnections(await get(`/connections?workspace_id=${encodeURIComponent(workspace.id)}`));
  const legacy = data.connections ?? [];
  const connected = provider => connections.some(item => item.provider === provider && ['connected', 'ready'].includes(item.state)) || legacy.some(item => item.provider === provider && item.state === 'connected');
  const filtered = catalog.filter(item => (category === 'all' || item.category === category || (category === 'enabled' && connected(item.id))) && `${item.name} ${item.category} ${item.description ?? ''} ${item.features?.map(feature => feature.label).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const provider = catalog.find(item => item.id === selected);
  return <main className={`page connection-platform${provider ? ' cp-detail-page' : ''}`}>
    {provider ? <ProviderDetail key={`${workspace.id}:${provider.id}`} provider={provider} connections={connections.filter(item => item.provider === provider.id)} onBack={() => setSelected(null)} onChange={refresh} /> : <>
      <PageHeader title="Connections" description="Connect your tools to the projects, conversations, and people doing the work." />
      <div className="cp-search"><SearchField value={query} onChange={setQuery} placeholder="Search connections and capabilities…" /><Select label="Category" value={category} onChange={setCategory}><option value="all">All connections</option><option value="enabled">Connected</option>{[...new Set(catalog.map(item => item.category))].map(item => <option key={item} value={item}>{readable(item)}</option>)}</Select></div>
      <ErrorMessage error={error} />
      {error ? <Button onClick={() => setRevision(value => value + 1)}>Try again</Button> : null}
      {loading ? <p className="cp-empty" role="status">Loading connections…</p> : !filtered.length ? <p className="cp-empty">No connections match your search.</p> : <div className="cp-grid">{filtered.map(item => <button className="cp-card" key={item.id} onClick={() => setSelected(item.id)}>
        <div className="cp-card-heading"><ServiceLogo name={item.id} /><span><strong>{item.name}</strong><small>{connected(item.id) ? 'Connected' : readable(item.category)}</small></span>{connected(item.id) ? <Check className="cp-connected" /> : null}</div>
        <p>{connectionPresentation(item).description}</p>
        <div className="cp-card-footer"><span>{item.execution === 'existing_runner' ? 'Agent account & execution' : `${item.features?.length ?? 0} ${item.features?.length === 1 ? 'capability' : 'capabilities'}`}</span><ArrowRight /></div>
      </button>)}</div>}
      <div className="cp-footnote"><ShieldCheck /><span>Choose which resources and features each connection shares with Rumbo. Account permissions are managed in workspace settings.</span></div>
    </>}
  </main>;
}

function ProviderDetail({ provider, connections, onBack, onChange }) {
  const { workspace, data } = useApp();
  const [tab, setTab] = useState('features'), [accountId, setAccountId] = useState(connections[0]?.id ?? '');
  const accountRef = useRef(null);
  const presentation = connectionPresentation(provider);
  const runner = provider.execution === 'existing_runner';
  const tabs = ['features', 'resources', 'agents', ...(provider.id === 'github' ? ['code'] : []), 'sync', 'actions', 'activity'];
  const tabLabels = { features: 'Capabilities', resources: 'Resources', agents: 'Agent access', code: 'Code', sync: 'Sync', actions: 'Actions', activity: 'Activity' };
  const focusAccount = () => { accountRef.current?.scrollIntoView({ block: 'start' }); accountRef.current?.focus({ preventScroll: true }); };
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [notice, setNotice] = useState('');
  const [legacyDialog, setLegacyDialog] = useState(false), [setup, setSetup] = useState(null);
  const [scope, setScope] = useState('workspace'), [teamId, setTeamId] = useState(''), [disconnect, setDisconnect] = useState(false), [addingAccount, setAddingAccount] = useState(false);
  const connection = connections.find(item => item.id === accountId) ?? connections[0];
  const existing = data.connections?.find(item => item.provider === provider.id);
  const run = async (work, message, propagate = false) => { setBusy(true); setError(null); setNotice(''); try { const result = await work(); await onChange(); if (message) setNotice(message); return result; } catch (cause) { setError(cause); if (propagate) throw cause; return null; } finally { setBusy(false); } };
  const openLegacy = async () => { setError(null); try { const result = await rumboApi.connectionSetups(); setSetup(result.result.setups?.find(item => item.provider === provider.id)); setLegacyDialog(true); } catch (cause) { setError(cause); } };
  async function connect() {
    await run(async () => {
      const record = connection ?? await mutate('/connections', { workspace_id: workspace.id, provider: provider.id, scope_type: scope, ...(scope === 'team' ? { scope_id: teamId } : {}) });
      setAccountId(record.id);
      const result = await mutate(`/connections/${record.id}/authorize`, {});
      const url = safeUrl(result.authorization_url);
      if (!url) throw new Error('The provider did not return a valid authorization address.');
      window.location.assign(url);
    });
  }
  const requirements = Array.isArray(provider.setup_required) ? provider.setup_required : provider.setup_required ? [provider.setup_required] : [];
  return <>
    <Button icon={ArrowLeft} variant="ghost" onClick={onBack}>All connections</Button>
    <header className="cp-detail-heading"><ServiceLogo name={provider.id} /><div className="cp-detail-identity"><h1>{provider.name}</h1><p>{presentation.description}</p><span className="cp-pill">{!runner && !connection && existing?.state === 'connected' ? 'Existing account connected · workspace OAuth not connected' : readable(connection?.state ?? existing?.state ?? 'not_connected')}</span></div><div className="cp-header-action">
      {runner ? <Button icon={ExternalLink} variant="primary" onClick={openLegacy}>{existing?.state === 'connected' ? 'Manage account' : `Connect ${provider.name}`}</Button> : <Button icon={ExternalLink} variant="primary" busy={busy} disabled={!provider.configured || (!connection && scope === 'team' && !teamId)} onClick={connect}>{connection?.state === 'connected' ? 'Reauthorize' : `Connect ${provider.name}`}</Button>}
      {!runner && (!provider.configured || (!connection && scope === 'team' && !teamId)) ? <button className="cp-setup-link" onClick={focusAccount}>{!provider.configured ? 'Authorization setup required' : 'Choose an Area below'}</button> : null}
    </div></header>
    <ErrorMessage error={error} />{notice ? <p className="cp-notice" role="status">{notice}</p> : null}
    <ConnectionOverview provider={provider} presentation={presentation} />
    <section className="cp-account-section cp-detail-body" aria-labelledby="connection-account-title" ref={accountRef} tabIndex={-1}>
      <div className="cp-section-heading"><h2 id="connection-account-title">Account & access</h2><p>{runner ? 'Manage the provider account used by your local runner.' : 'Choose the account and scope, then authorize access at the provider.'}</p></div>
      <div className="cp-account-panel">
        {connections.length > 1 ? <Select label="Connected account" value={connection?.id ?? ''} onChange={setAccountId}>{connections.map(item => <option key={item.id} value={item.id}>{item.account_label ?? item.id}</option>)}</Select> : null}
        {connection ? <dl className="cp-facts"><div><dt>Account</dt><dd>{connection.account_label ?? 'Awaiting authorization'}</dd></div><div><dt>Scope</dt><dd>{readable(connection.scope_type)}{connection.scope_id ? ` · ${(connection.scope_type === 'workspace' ? workspace.name : data.teams?.find(item => item.id === connection.scope_id)?.name) ?? connection.scope_id}` : ''}</dd></div><div><dt>Last synchronized</dt><dd>{stamp(connection.last_sync_at)}</dd></div></dl> : !runner ? <div className="cp-form-grid"><Select label="Connection scope" value={scope} onChange={setScope}><option value="workspace">Workspace</option><option value="team">Area</option></Select>{scope === 'team' ? <Select label="Area" value={teamId} onChange={setTeamId}><option value="">Choose an Area</option>{data.teams?.filter(item => item.workspace_id === workspace.id && !item.archived_at).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select> : null}</div> : <p>Sign in and inspect readiness without starting an agent session.</p>}
        {requirements.length ? <div className="cp-note"><h3>Authorization setup</h3><ul>{requirements.map((item, index) => <li key={index}>{typeof item === 'string' ? item : item.message ?? item.label ?? JSON.stringify(item)}</li>)}</ul></div> : null}
        {!runner ? <SetupDiagnostics provider={provider} /> : null}
        {connection || established.has(provider.id) ? <div className="cp-actions">{!runner && connection ? <><Button busy={busy} disabled={connection.state !== 'connected'} onClick={() => run(() => mutate(`/connections/${connection.id}/check`, {}), 'Account checked. A successful synchronization separately records access to the selected resource.')}>Check account</Button><Button disabled={busy} onClick={() => setAddingAccount(true)}>Add another account</Button><Button disabled={busy} onClick={() => setDisconnect(true)}>Disconnect</Button></> : null}{established.has(provider.id) ? <Button icon={Settings} onClick={openLegacy}>Manage existing account</Button> : null}</div> : null}
        {connection?.verification ? <p className="cp-verification">Identity checked: {stamp(connection.verification.identity_checked_at)} · Resource access checked: {stamp(connection.verification.resource_checked_at)}. These checks do not prove every enabled write will succeed.</p> : null}
        {!provider.configured && !requirements.length ? <p className="muted">Provider authorization must be configured by the Rumbo operator before this connection can sign in.</p> : null}
        {!connection && provider.execution !== 'existing_runner' ? <Button busy={busy} disabled={scope === 'team' && !teamId} onClick={() => run(async () => { const record = await mutate('/connections', { workspace_id: workspace.id, provider: provider.id, scope_type: scope, ...(scope === 'team' ? { scope_id: teamId } : {}) }); setAccountId(record.id); setTab('features'); }, 'Connection configuration created. Authorize an account before using provider resources.')}>Configure capabilities first</Button> : null}
        {connection?.last_error ? <p className="cp-note" role="status">{typeof connection.last_error === 'string' ? connection.last_error : connection.last_error.message}</p> : null}
      </div>
    </section>
    <section className="cp-settings-section cp-detail-body" aria-labelledby="connection-settings-title">
      <div className="cp-section-heading"><h2 id="connection-settings-title">{runner ? 'Agent settings' : 'Connection settings'}</h2><p>{runner ? 'Keep account setup separate from how each agent works.' : `Control how ${provider.name} participates in your workspace.`}</p></div>
      {runner ? <div className="cp-runner-settings"><div><strong>Account & execution preferences</strong><p>Inspect sign-in, supported settings, and provider readiness.</p><Button icon={Settings} onClick={openLegacy}>Manage existing account</Button></div><div><strong>Agent profiles & instructions</strong><p>Choose context, instructions, and execution permissions for each agent.</p><a className="cp-guide-link" href="#/agents">Open agents <ArrowRight /></a></div></div> : <div className="cp-settings-panel">
        <div className="cp-tabs" role="tablist" aria-label={`${provider.name} configuration`}>{tabs.map(item => <button key={item} id={`connection-tab-${item}`} role="tab" aria-controls="connection-settings-panel" aria-selected={tab === item} tabIndex={tab === item ? 0 : -1} onClick={() => setTab(item)} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const index = tabs.indexOf(item);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          setTab(tabs[next]); event.currentTarget.parentElement.children[next]?.focus();
        }}>{tabLabels[item]}</button>)}</div>
        <div role="tabpanel" id="connection-settings-panel" aria-labelledby={`connection-tab-${tab}`} tabIndex={0} className="cp-settings-content">
          {connection ? tab === 'code' ? <GitHubCodeBrowser key={connection.id} connection={connection} /> : <ConnectionContent key={`${connection.id}:${tab}`} tab={tab} connection={connection} provider={provider} run={run} busy={busy} /> : tab === 'features' ? <><h3>Available capabilities</h3><p>Create a configuration to choose capabilities. Authorization is still required before they can be used.</p><ul className="cp-capability-preview">{provider.features?.map(feature => <li key={feature.id}><Check /><span>{feature.label}</span></li>)}</ul><Button onClick={focusAccount}>Account setup</Button></> : <div className="cp-empty"><Plug /><h3>Set up an account first</h3><p>Configure this connection above, then authorize it to use provider resources and actions.</p><Button onClick={focusAccount}>Account setup</Button></div>}
        </div>
      </div>}
    </section>
    {legacyDialog ? <ConnectionDialog provider={provider.id} setup={setup} onClose={() => { setLegacyDialog(false); onChange().catch(setError); }} /> : null}
    {disconnect ? <DisconnectDialog connection={connection} provider={provider} busy={busy} onClose={() => setDisconnect(false)} onDisconnect={input => run(() => mutate(`/connections/${connection.id}/disconnect`, input))} /> : null}
    {addingAccount ? <AddConnectionAccount provider={provider} workspace={workspace} teams={data.teams ?? []} busy={busy} onClose={() => setAddingAccount(false)} onCreate={input => run(async () => { const record = await mutate('/connections', input); setAccountId(record.id); setAddingAccount(false); setTab('features'); }, 'New account configuration created. Use Connect above to authorize this account.')} /> : null}
  </>;
}

function SetupDiagnostics({ provider }) {
  const scopes = connectionScopes(provider.scopes);
  return <details className="cp-setup-diagnostics"><summary>Authorization details</summary><p>{provider.configured ? 'The server has application credentials configured. This is not a live account or resource verification.' : 'The operator must register Rumbo with this provider before account authorization can begin.'}</p>{provider.callback_url ? <div><strong>Exact redirect URL</strong><code>{provider.callback_url}</code><small>Register this exact URL in the provider application. Public accounts may require provider review; hosting alone does not grant approval.</small></div> : null}{scopes.length ? <div><strong>Requested permissions</strong><ul>{scopes.map(scope => <li key={scope}><code>{scope}</code></li>)}</ul></div> : null}{safeUrl(provider.registration_url) ? <a href={safeUrl(provider.registration_url)} target="_blank" rel="noreferrer">Provider application setup <ExternalLink /></a> : null}</details>;
}

function AddConnectionAccount({ provider, workspace, teams, busy, onClose, onCreate }) {
  const [scope, setScope] = useState('workspace'), [team, setTeam] = useState(''), [error, setError] = useState(null);
  return <Dialog title={`Add ${provider.name} account`} subtitle="Create a separate configuration and authorize it deliberately." onClose={onClose}><Form className="cp-dialog-body" onSubmit={async event => { event.preventDefault(); setError(null); const result = await onCreate({ workspace_id: workspace.id, provider: provider.id, scope_type: scope, ...(scope === 'team' ? { scope_id: team } : {}) }); if (result === null) setError(new Error('The account configuration could not be created. Check your connection-management permissions and try again.')); }}><ErrorMessage error={error} /><p>Existing accounts, selections, and permissions will not change. After creating this configuration, choose Connect to select the provider account.</p><Select label="Connection scope" value={scope} onChange={setScope}><option value="workspace">Workspace</option><option value="team">Area</option></Select>{scope === 'team' ? <Select label="Area" value={team} onChange={setTeam} required><option value="">Choose an Area</option>{teams.filter(item => item.workspace_id === workspace.id && !item.archived_at).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select> : null}<Button type="submit" variant="primary" busy={busy} disabled={scope === 'team' && !team}>Create account configuration</Button></Form></Dialog>;
}

function ConnectionContent({ tab, connection, provider, run, busy }) {
  const { data, workspace } = useApp();
  const [features, setFeatures] = useState(connection.settings?.enabled_features ?? []);
  const [resources, setResources] = useState([]), [selected, setSelected] = useState(connection.settings?.selected_resources ?? []);
  const [resourcePage, setResourcePage] = useState(null), [syncPage, setSyncPage] = useState(null), [records, setRecords] = useState([]), [loading, setLoading] = useState(false), [error, setError] = useState(null);
  const [resourceId, setResourceId] = useState(''), [syncMode, setSyncMode] = useState(connection.settings?.sync_mode ?? 'link');
  const [discoveryId, setDiscoveryId] = useState(''), [kind, setKind] = useState(provider.sync_kinds?.[0] ?? '');
  const [readOptions, setReadOptions] = useState(() => connectionReadOptions(provider.id, connection.settings?.read_options, provider.read_fields));
  const [agentAccess, setAgentAccess] = useState(Boolean(connection.settings?.agent_access)), [agentIds, setAgentIds] = useState(connection.settings?.allowed_agent_ids ?? []);
  const [action, setAction] = useState(null), [importObject, setImportObject] = useState(null), [importRevision, setImportRevision] = useState(0);
  const base = `/connections/${encodeURIComponent(connection.id)}`;
  const syncQuery = { resource_id: resourceId, kind, ...readOptions };
  const syncKey = connectionQueryKey(connection.id, syncQuery);
  const discoveryKey = connectionQueryKey(connection.id, { resource_id: discoveryId });
  const activeQueries = useRef({ syncKey, discoveryKey });
  activeQueries.current = { syncKey, discoveryKey };
  const cursor = matchingConnectionCursor(tab === 'resources' ? resourcePage : syncPage, tab === 'resources' ? discoveryKey : syncKey);
  useEffect(() => {
    if (!['resources', 'sync', 'activity'].includes(tab)) return;
    const controller = new AbortController(); setLoading(true);
    const path = tab === 'resources' ? '/resources' : tab === 'sync' ? '/objects' : '/activity';
    const initialKey = connectionQueryKey(connection.id, { resource_id: '' });
    get(`${base}${path}`, controller.signal).then(result => { if (!controller.signal.aborted) { if (tab === 'resources' && activeQueries.current.discoveryKey === initialKey) { setResources(result.items ?? []); setResourcePage({ queryKey: initialKey, cursor: result.cursor }); } else if (tab !== 'resources') setRecords(result); } }).catch(cause => { if (!controller.signal.aborted) setError(cause); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [base, tab]);
  const save = settings => run(() => mutate(`${base}/settings`, settings, 'PATCH'), 'Connection settings saved.');
  const synchronize = nextPage => {
    const capturedKey = syncKey;
    const input = { ...syncQuery, ...(nextPage ? { cursor } : {}) };
    return run(async () => {
      const result = await mutate(`${base}/sync`, input);
      const objects = await get(`${base}/objects`);
      if (activeQueries.current.syncKey === capturedKey) { setRecords(objects); setSyncPage({ queryKey: capturedKey, cursor: result.cursor }); }
    }, 'Resource synchronized.');
  };
  return <><ErrorMessage error={error} />
    {tab === 'features' ? <><h2>Enabled capabilities</h2><p>Choose the features available to people and agents with permission to use this connection.</p><div className="cp-feature-list">{provider.features?.map(feature => <label className="cp-feature" key={feature.id}><input type="checkbox" checked={features.includes(feature.id)} onChange={event => setFeatures(current => event.target.checked ? [...current, feature.id] : current.filter(item => item !== feature.id))} /><span><strong>{feature.label}</strong><small>{feature.description ?? (feature.id === 'read' ? provider.resource_hint : ({ write: 'Makes an explicit change at the provider.', communication: 'Sends a message after required approval.', consequential: 'Requires review before provider-side execution.', destructive: 'Requires approval before changing external work.' }[feature.risk] ?? readable(feature.risk)))}</small></span></label>)}</div><Button variant="primary" busy={busy} onClick={() => save({ enabled_features: features })}>Save capabilities</Button></> : null}
    {tab === 'agents' ? <><h2>Agent access</h2><p>Choose which agents may use this connection. Their delegated permissions, selected resources, enabled features, and approval rules still apply.</p><label className="cp-feature"><input type="checkbox" checked={agentAccess} onChange={event => setAgentAccess(event.target.checked)} /><span><strong>Allow selected agents to use this connection</strong><small>Agents receive permitted context and actions. Authorization tokens and secrets remain private.</small></span></label><div className="cp-feature-list">{data.agents.filter(agent => !agent.archived_at && (!agent.workspace_id || agent.workspace_id === workspace.id)).map(agent => <label key={agent.id} className="cp-feature"><input type="checkbox" disabled={!agentAccess} checked={agentIds.includes(agent.id)} onChange={event => setAgentIds(current => event.target.checked ? [...current, agent.id] : current.filter(id => id !== agent.id))} /><span><strong>{agent.name}</strong><small>{agent.provider}</small></span></label>)}</div><Button busy={busy} variant="primary" onClick={() => save({ agent_access: agentAccess, allowed_agent_ids: agentIds })}>Save agent access</Button><p><a href="#/settings/security">Review workspace roles and permissions</a></p></> : null}
    {tab === 'resources' ? <>
      <div className="cp-section-head"><div><h2>Selected resources</h2><p>{provider.resource_hint}</p></div><Button busy={busy} onClick={() => save({ selected_resources: selected })}>Save selection</Button></div>
      <div className="cp-saved-resources"><h3>Selection · {selected.length}</h3><p>Saved selections remain listed even when they are not on the current discovery page. Remove an item, then save to apply the change.</p>{selected.length ? selectedConnectionResources(selected, resources).map(item => <div className="cp-action-row" key={item.id}><div><strong>{item.name ?? item.title ?? item.id}</strong><small>{item.id}</small></div><Button disabled={busy} onClick={() => setSelected(current => current.filter(id => id !== item.id))} aria-label={`Remove ${item.name ?? item.id} from selection`}>Remove</Button></div>) : <p>No resources selected.</p>}</div>
      <h3>Discover resources</h3>
      {['figma', 'figjam', 'jira'].includes(provider.id) ? <Form className="cp-discovery" onSubmit={event => { event.preventDefault(); const capturedKey = discoveryKey; run(async () => { const result = await get(`${base}/resources?resource_id=${encodeURIComponent(discoveryId)}`); if (activeQueries.current.discoveryKey === capturedKey) { setResources(result.items ?? []); setResourcePage({ queryKey: capturedKey, cursor: result.cursor }); } }); }}><Field label={provider.id === 'jira' ? 'Explore an authorized site' : 'File or board URL, or file:key'}><input required value={discoveryId} onChange={event => { setDiscoveryId(event.target.value); setResourcePage(null); }} /></Field><Button type="submit" busy={busy}>Explore</Button></Form> : null}
      {loading ? <p role="status">Discovering resources…</p> : resources.length ? <div className="cp-feature-list">{resources.map(resource => <label className="cp-feature" key={resource.id}><input type="checkbox" checked={selected.includes(resource.id)} onChange={event => setSelected(current => event.target.checked ? [...current, resource.id] : current.filter(item => item !== resource.id))} /><span><strong>{resource.name ?? resource.title ?? resource.id}</strong><small>{readable(resource.type)} · {resource.id}</small></span></label>)}</div> : <p className="cp-empty">No resources returned. Check account authorization and provider access.</p>}
      {cursor ? <Button busy={busy} onClick={() => { const capturedKey = discoveryKey; return run(async () => { const result = await get(`${base}/resources?cursor=${encodeURIComponent(cursor)}&resource_id=${encodeURIComponent(discoveryId)}`); if (activeQueries.current.discoveryKey === capturedKey) { setResources(items => [...items, ...result.items.filter(item => !items.some(existing => existing.id === item.id))]); setResourcePage({ queryKey: capturedKey, cursor: result.cursor }); } }); }}>Load more</Button> : null}
    </> : null}
    {tab === 'sync' ? <>
      <h2>Synchronization</h2><p>Linked references keep their source identity. Cached content is available to permitted workspace tools.</p>
      <div className="cp-form-grid"><Select label="Storage mode" value={syncMode} onChange={setSyncMode}><option value="link">Linked references</option><option value="cache">Cache selected content</option></Select><Select label="Resource to synchronize" value={resourceId} onChange={setResourceId}><option value="">Choose a selected resource</option>{(connection.settings?.selected_resources ?? []).map(id => <option key={id} value={id}>{id}</option>)}</Select><Select label="Content type" value={kind} onChange={setKind}>{provider.sync_kinds?.map(item => <option key={item} value={item}>{readable(item)}</option>)}</Select></div>
      {provider.id === 'google-sheets' ? <Field label="Cell range" hint="An A1 rectangle of at most 20,000 cells, optionally including a sheet name. Manual reads use the range shown; save it to apply to future automatic refresh jobs."><input value={readOptions.range} maxLength={180} placeholder="Sheet1!A1:Z200" onChange={event => { setReadOptions(current => ({ ...current, range: event.target.value })); setSyncPage(null); }} /></Field> : null}
      {provider.id === 'github-packages' ? <Select label="Package ecosystem" value={readOptions.package_type} onChange={value => { setReadOptions(current => ({ ...current, package_type: value })); setSyncPage(null); }}>{PACKAGE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}</Select> : null}
      {(provider.read_fields ?? []).filter(field => !['range', 'package_type'].includes(field.name) && (!field.kind || field.kind === kind)).map(field => <Field key={field.name} label={field.label} hint={field.description ?? 'Used for this read. Save sync settings to use it in future automatic refresh jobs.'}><input required={field.required} type={field.type === 'number' ? 'number' : 'text'} maxLength={500} value={readOptions[field.name] ?? ''} onChange={event => { setReadOptions(current => ({ ...current, [field.name]: event.target.value })); setSyncPage(null); }} /></Field>)}
      <div className="cp-actions"><Button busy={busy} onClick={() => save({ sync_mode: syncMode, read_options: readOptions })}>Save sync settings</Button><Button busy={busy} disabled={!resourceId || provider.id === 'google-sheets' && !readOptions.range?.trim() || (provider.read_fields ?? []).some(field => field.required && (!field.kind || field.kind === kind) && !readOptions[field.name]?.trim())} onClick={() => synchronize(false)}>Sync selected resource</Button>{cursor ? <Button busy={busy} onClick={() => synchronize(true)}>Sync next page</Button> : null}</div>
      <SyncAutomation base={base} busy={busy} run={run} />
      <h3>Source objects</h3><RecordList records={records} loading={loading} empty="No synchronized objects yet." onImport={setImportObject} />
      <ImportConflicts base={base} busy={busy} run={run} revision={`${records.length}:${importRevision}`} />
      {importObject ? <ImportDialog object={importObject} data={data} workspace={workspace} onClose={() => setImportObject(null)} busy={busy} onImport={input => run(async () => { const result = await mutate(`${base}/import`, { object_id: importObject.id, ...input }); setImportRevision(current => current + 1); await refreshRumbo(); return result; })} /> : null}
    </> : null}
    {tab === 'actions' ? <><h2>Actions</h2><p>Run provider actions with the same resource and access rules used by agents.</p><div className="cp-action-list">{provider.actions?.map(item => <div className="cp-action-row" key={item.id}><div><strong>{item.label}</strong><small>{item.description ?? readable(item.risk)}{!features.includes(item.id) ? ' · Enable in Capabilities' : ''}</small></div><Button disabled={busy || !features.includes(item.id)} onClick={() => setAction(item)}>Open</Button></div>)}</div>{action ? <ActionDialog action={action} connectionId={connection.id} busy={busy} onClose={() => setAction(null)} onRun={(input, key) => run(() => mutate(`${base}/actions`, { action: action.id, input, idempotency_key: key }), undefined, true)} /> : null}</> : null}
    {tab === 'activity' ? <><h2>Connection activity</h2><p>Authorization, configuration, synchronization, and provider actions.</p><RecordList records={records} loading={loading} empty="No activity recorded for this connection." /></> : null}
  </>;
}

function DisconnectDialog({ connection, provider, busy, onClose, onDisconnect }) {
  const storageKey = `rumbo:connection-purge:${connection.workspace_id}:${connection.id}`;
  const [saved] = useState(() => { try { return sessionStorage.getItem(storageKey); } catch { return null; } });
  const [deleteCache, setDeleteCache] = useState(Boolean(saved)), [requestKey] = useState(saved || crypto.randomUUID()), [submitted, setSubmitted] = useState(Boolean(saved));
  const [pending, setPending] = useState(false), [error, setError] = useState(null);
  return <Dialog title={`Disconnect ${provider.name}?`} subtitle="Synchronization and connection actions will stop. Content at the provider will remain unchanged." onClose={onClose}><div className="cp-dialog-body">
    <p>Existing Rumbo imports remain available. Cached provider references are retained unless you explicitly remove them.</p>
    <label className="cp-feature"><input type="checkbox" disabled={busy || submitted} checked={deleteCache} onChange={event => setDeleteCache(event.target.checked)} /><span><strong>Also remove cached provider content</strong><small>This requires an Owner decision. Original provider content and previously imported Rumbo objects are not deleted.</small></span></label>
    <ErrorMessage error={error} />
    {pending || saved ? <p className="cp-note" role="status">Cache removal is a protected action. <a href="#/settings/access-approvals">Review the approval request</a>, then return to Disconnect and retry this request.</p> : null}
    <Button busy={busy} onClick={async () => { setError(null); if (deleteCache) { sessionStorage.setItem(storageKey, requestKey); setSubmitted(true); } const result = await onDisconnect({ delete_cache: deleteCache, ...(deleteCache ? { idempotency_key: requestKey } : {}) }); if (!result) setError(new Error('Disconnection could not complete. Check connection permissions and retry this request.')); else if (result.approval_required) setPending(true); else { sessionStorage.removeItem(storageKey); onClose(); } }}>{submitted ? 'Retry approved disconnection' : deleteCache ? 'Request disconnection & cache removal' : 'Disconnect account'}</Button>
  </div></Dialog>;
}

function RecordList({ records, loading, empty, onImport }) {
  if (loading) return <p role="status">Loading…</p>;
  if (!records?.length) return <p className="cp-empty">{empty}</p>;
  return <div className="cp-records">{records.map((item, index) => <article key={item.id ?? index}><strong>{item.title ?? item.name ?? readable(item.action ?? item.kind ?? item.type ?? item.event_type)}</strong><small>{stamp(item.synced_at ?? item.updated_at ?? item.created_at)}{item.status ? ` · ${readable(item.status)}` : ''}</small>{item.summary ? <p>{item.summary}</p> : null}{safeUrl(item.url) ? <a href={safeUrl(item.url)} target="_blank" rel="noreferrer">Open source <ExternalLink /></a> : null}{onImport ? <Button onClick={() => onImport(item)}>Import into Rumbo</Button> : null}</article>)}</div>;
}

function ActionDialog({ action, connectionId, onClose, onRun, busy }) {
  const storageKey = `rumbo:pending-connection-action:${connectionId}:${action.id}`;
  const [draft] = useState(() => { try { return JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { return null; } });
  const [values, setValues] = useState(draft?.values ?? {}), [requestKey, setRequestKey] = useState(draft?.requestKey ?? crypto.randomUUID()), [result, setResult] = useState(null), [error, setError] = useState(null), [submitted, setSubmitted] = useState(Boolean(draft));
  const fields = action.fields ?? action.input_fields ?? [];
  return <Dialog title={action.label} subtitle={action.description ?? `Perform this action in the connected account. ${readable(action.risk)}.`} onClose={onClose}><Form className="cp-dialog-body" onSubmit={async event => { event.preventDefault(); setError(null); try { const input = { ...values }; for (const field of fields) if (field.type === 'json') input[field.key ?? field.name] = JSON.parse(input[field.key ?? field.name]); sessionStorage.setItem(storageKey, JSON.stringify({ values, requestKey })); setSubmitted(true); const outcome = await onRun(input, requestKey); if (outcome !== null) { setResult(outcome); if (!outcome.approval_required) sessionStorage.removeItem(storageKey); } else setError(new Error('The action could not complete. Check the connection activity and account permissions. Retrying preserves the original request.')); } catch (cause) { setError(cause); } }}>
    <ErrorMessage error={error} />
    {submitted ? <p className="cp-note">This request is saved for safe retry. Its inputs cannot change after submission.</p> : null}
    {submitted && canEditRejectedConnectionAction(error) ? <div className="cp-note"><p>The server confirmed that this request was not applied. You can correct its fields and submit a new request.</p><Button disabled={busy} onClick={() => { sessionStorage.removeItem(storageKey); setRequestKey(crypto.randomUUID()); setSubmitted(false); setResult(null); setError(null); }}>Edit rejected request</Button></div> : null}
    <fieldset disabled={submitted || busy} className="cp-action-fields">
    {fields.map(field => field.options ? <Select key={field.key ?? field.name} label={field.label} required={field.required} value={values[field.key ?? field.name] ?? ''} onChange={value => setValues(current => ({ ...current, [field.key ?? field.name]: value }))}><option value="">Choose…</option>{field.options.map(option => <option key={option.value ?? option} value={option.value ?? option}>{option.label ?? option}</option>)}</Select> : <Field key={field.key ?? field.name} label={field.label ?? readable(field.key ?? field.name)} hint={field.description}>{field.type === 'textarea' ? <textarea required={field.required} value={values[field.key ?? field.name] ?? ''} onChange={event => setValues(current => ({ ...current, [field.key ?? field.name]: event.target.value }))} /> : <input required={field.required} type={field.type === 'number' ? 'number' : 'text'} value={values[field.key ?? field.name] ?? ''} onChange={event => setValues(current => ({ ...current, [field.key ?? field.name]: field.type === 'number' ? Number(event.target.value) : event.target.value }))} />}</Field>)}
    </fieldset>
    {['destroy', 'destructive', 'publish', 'security', 'consequential', 'communication'].includes(action.risk) ? <p className="cp-note">This action changes the external account. Rumbo may request approval before executing it.</p> : null}
    {result?.approval_required ? <p className="cp-note" role="status">Owner approval is required. <a href="#/settings/access-approvals">Review approval requests</a>, then return to this action and retry the same request.</p> : result ? <div className="cp-action-result" role="status"><h3>Action completed</h3><pre>{JSON.stringify(result, null, 2)}</pre></div> : null}<Button type="submit" variant="primary" busy={busy} disabled={Boolean(result && !result.approval_required)}>{submitted ? 'Retry this request' : action.label}</Button>
  </Form></Dialog>;
}

function ImportDialog({ object, data, workspace, busy, onClose, onImport }) {
  const [type, setType] = useState('route'), [project, setProject] = useState(''), [result, setResult] = useState(null), [error, setError] = useState(null);
  return <Dialog title="Import into Rumbo" subtitle={object.title ?? object.name} onClose={onClose}><Form className="cp-dialog-body" onSubmit={async event => { event.preventDefault(); setError(null); const result = await onImport({ target_type: type, ...(project ? { project_id: project } : {}) }); if (result) setResult(result); else setError(new Error('Import could not complete. Check account permissions and source availability.')); }}><ErrorMessage error={error} /><Select label="Create or update" value={type} onChange={setType}><option value="route">Route</option><option value="project">Project</option><option value="document">Document</option></Select>{type !== 'project' ? <Select label="Project" value={project} required={type === 'document'} onChange={setProject}><option value="">{type === 'document' ? 'Choose a project' : 'Workspace'}</option>{data.projects.filter(item => item.workspace_id === workspace.id && !item.archived_at).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select> : null}<p>Rumbo preserves the source link. Importing the same source again updates its linked object unless your changes conflict.</p>{result ? <p className="cp-notice" role="status">{result.status === 'conflict' ? 'Changes conflict with your Rumbo version. Close this dialog and review Sync conflicts below.' : `Rumbo ${type} ${result.status}.`}</p> : null}<Button type="submit" variant="primary" busy={busy}>Import source</Button></Form></Dialog>;
}

function ImportConflicts({ base, busy, run, revision }) {
  const [items, setItems] = useState([]), [error, setError] = useState(null), [selected, setSelected] = useState(null);
  async function refresh() { setItems(await get(`${base}/conflicts`)); }
  useEffect(() => { const controller = new AbortController(); get(`${base}/conflicts`, controller.signal).then(setItems).catch(cause => { if (!controller.signal.aborted) setError(cause); }); return () => controller.abort(); }, [base, revision]);
  return <><div className="cp-section-head"><h3>Sync conflicts</h3><Button onClick={() => refresh().catch(setError)}>Refresh conflicts</Button></div><ErrorMessage error={error} />{!items.length ? <p>No unresolved conflicts.</p> : items.map(item => <article className="cp-action-row" key={item.id}><div><strong>Source changed alongside your Rumbo version</strong><small>{stamp(item.created_at)}</small></div><Button onClick={() => setSelected(item)}>Review</Button></article>)}{selected ? <Dialog wide title="Resolve sync conflict" subtitle="Review both versions before choosing which one to keep." onClose={() => setSelected(null)}><div className="cp-dialog-body"><div className="cp-form-grid"><section><h3>Rumbo version</h3><pre className="cp-conflict-value">{JSON.stringify(selected.local_value, null, 2)}</pre></section><section><h3>Provider version</h3><pre className="cp-conflict-value">{JSON.stringify(selected.external_value, null, 2)}</pre></section></div><div className="cp-actions">{[['keep_local', 'Keep Rumbo version'], ['use_external', 'Replace with provider version']].map(([resolution, label]) => <Button key={resolution} busy={busy} onClick={async () => { const result = await run(() => mutate(`${base}/resolve-conflict`, { conflict_id: selected.id, expected_local_hash: selected.local_hash, resolution }), 'Conflict resolved.'); if (result) { setSelected(null); await refresh(); } }}>{label}</Button>)}</div></div></Dialog> : null}</>;
}

function SyncAutomation({ base, run, busy }) {
  const [policy, setPolicy] = useState(null), [jobs, setJobs] = useState([]), [error, setError] = useState(null);
  useEffect(() => { const controller = new AbortController(); Promise.all([get(`${base}/sync-policy`, controller.signal), get(`${base}/jobs`, controller.signal)]).then(([policy, jobs]) => { if (!controller.signal.aborted) { setPolicy(policy); setJobs(jobs); } }).catch(cause => { if (!controller.signal.aborted) setError(cause); }); return () => controller.abort(); }, [base]);
  if (!policy) return <ErrorMessage error={error} />;
  return <section className="cp-sync-policy"><h3>Automatic refresh</h3><ErrorMessage error={error} /><Select label="Check for changes" value={String(policy.reconcile_minutes)} onChange={value => setPolicy(current => ({ ...current, reconcile_minutes: Number(value) }))}>{[[0, 'Manual only'], [5, 'Every 5 minutes'], [15, 'Every 15 minutes'], [30, 'Every 30 minutes'], [60, 'Every hour'], [360, 'Every 6 hours'], [1440, 'Every day']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><label className="cp-feature"><input type="checkbox" checked={Boolean(policy.auto_update_imports)} onChange={event => setPolicy(current => ({ ...current, auto_update_imports: event.target.checked }))} /><span><strong>Update previously imported Rumbo objects</strong><small>Conflicts pause updates when both versions have changed.</small></span></label><label className="cp-feature"><input type="checkbox" disabled={!policy.webhooks_supported || !policy.webhooks_configured} checked={Boolean(policy.webhooks_enabled)} onChange={event => setPolicy(current => ({ ...current, webhooks_enabled: event.target.checked }))} /><span><strong>Receive provider events</strong><small>{!policy.webhooks_supported ? 'This provider uses scheduled refresh.' : !policy.webhooks_configured ? 'The Rumbo operator must configure the webhook signing secret and public endpoint.' : 'Verified provider events queue synchronization.'}</small></span></label><Button busy={busy} onClick={() => run(async () => setPolicy(await mutate(`${base}/sync-policy`, { reconcile_minutes: policy.reconcile_minutes, auto_update_imports: policy.auto_update_imports, webhooks_enabled: policy.webhooks_enabled }, 'PATCH')), 'Automatic refresh saved.')}>Save automatic refresh</Button><div className="cp-section-head"><h3>Sync jobs</h3><Button busy={busy} onClick={() => run(async () => setJobs(await get(`${base}/jobs`)))}>Refresh jobs</Button></div>{jobs.length ? jobs.map(job => <article className="cp-action-row" key={job.id}><div><strong>{readable(job.state)} · {job.kind ?? 'resource sync'}</strong><small>{stamp(job.created_at)} · {job.attempts ?? 0} attempts{job.last_error ? ` · ${typeof job.last_error === 'string' ? job.last_error : job.last_error.message}` : ''}</small></div>{job.state === 'failed' ? <Button busy={busy} onClick={() => run(async () => { await mutate(`${base}/retry-job`, { job_id: job.id }); setJobs(await get(`${base}/jobs`)); }, 'Sync job queued again.')}>Retry</Button> : null}</article>) : <p>No background jobs yet.</p>}</section>;
}

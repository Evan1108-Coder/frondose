import { useEffect, useMemo, useState } from 'react';
import { apiRequest, frondoseApi } from '../data/api.js';
import { Button, Dialog, ErrorMessage, Field, PageHeader, SearchField, Select, useApp } from '../ui.jsx';
import { API_PROVIDERS, apiProviderDefinition } from '../lib/ai-provider-catalog.js';
import { aiProviderName } from '../lib/ai-providers.js';
import { refreshFrondose } from '../data/useFrondose.js';
import { ArrowRight, Check, ExternalLink, Plug, Terminal } from '../components/icons.jsx';
import { ServiceLogo } from '../components/ServiceLogo.jsx';
import { ConnectionDialog } from './Connections.jsx';
import { ComputerConnections } from '../components/ComputerConnections.jsx';
import './ai-connections.css';

const PROVIDERS = [
  { id: 'openrouter', name: 'OpenRouter', category: 'sign-in', route: 'Sign in or API key', usage: 'Your OpenRouter credits or limits', description: 'Choose browser authorization or connect your own OpenRouter API key.', models: 'Models available to your OpenRouter account', docs: 'https://openrouter.ai/docs/guides/overview/auth/oauth', abilities: ['Load account-visible models and test a selected model', 'Send reviewed conversations or scheduled agent messages', 'Review supported workspace-action proposals in the final reply'], limitation: 'Uses your current user/workspace credential and an explicit model. No native or project-file tools, live streaming, or provider billing ledger.' },
  { id: 'huggingface', name: 'Hugging Face Inference', category: 'sign-in', route: 'Sign in or API token', usage: 'Your Hugging Face account', description: 'Connect a personal token with Inference Providers permission, or use browser authorization when configured.', models: 'Models served through Hugging Face Inference Providers', docs: 'https://huggingface.co/docs/hub/oauth', abilities: ['Load available inference models and test a selected model', 'Send reviewed conversations or scheduled agent messages', 'Review supported workspace-action proposals in the final reply'], limitation: 'API tokens work without a Frondose OAuth app. Browser sign-in requires operator setup. Text conversations and reviewed actions are supported; native/project-file tools and streaming are unavailable.' },
  { id: 'copilot', name: 'GitHub Copilot', category: 'sign-in', route: 'GitHub authorization', usage: 'Your Copilot access and limits', description: 'Authorize your own GitHub account for reviewed conversations through the official Copilot SDK.', models: 'Models advertised for your Copilot account', docs: 'https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth', abilities: ['Stream reviewed conversations through an isolated SDK session', 'Use scheduled messages and proposed Frondose actions', 'Cancel active requests without automatic prompt retries'], limitation: 'Browser authorization requires Frondose’s GitHub app registration and eligible Copilot access for each user. GitHub sign-in alone does not grant model access. General chat only; file, shell, MCP and native tools are disabled. A separate local ACP method remains available on local installations.' },
  { id: 'codex', name: 'Codex', category: 'local', route: 'Local CLI', usage: 'Your Codex account', description: 'Use a Codex runner already installed and signed in on this machine for explicit reviewed work.', models: 'Models allowed by your signed-in Codex account', abilities: ['Run reviewed requests in conversations and linked project work', 'Review context and permissions before a run', 'Inspect results and proposed Frondose actions'], limitation: 'A local CLI sign-in is not a public website OAuth connection.' },
  { id: 'claude', name: 'Claude Code', category: 'local', route: 'Local CLI', usage: 'Your Claude Code account', description: 'Use a Claude Code runner already installed and signed in on this machine for explicit reviewed work.', models: 'Models allowed by your signed-in Claude Code account', abilities: ['Run reviewed analysis requests', 'Inspect results and proposed Frondose actions'], limitation: 'The current Claude runner is restricted; account sign-in alone does not enable project editing.' },
  ...API_PROVIDERS.filter(item => !item.auth).map(item => ({ ...item, category: 'api', route: 'API key', usage: 'Your provider API credits', description: `Connect your ${item.name} API key for conversations and reviewed Frondose actions.`, models: item.discovery ? 'Provider catalog and your configured model IDs' : 'Model IDs you configure from the provider catalog', abilities: ['Conversations with an explicitly selected model', 'Scheduled agent messages with reviewed context', 'Review proposed Frondose actions before applying them'], limitation: 'Text conversations and reviewed final-reply actions are supported. Project-file tools and native tool execution are not available through this connection. API usage is billed by the provider.' })),
];
const isLocal = provider => provider.category === 'local';
const logoName = provider => provider.id === 'codex' ? 'Codex' : provider.id === 'claude' ? 'Claude' : provider.id === 'copilot' ? 'GitHub Copilot' : apiProviderDefinition(provider.id)?.brand || provider.name;

function ProviderMark({ provider, large = false }) {
  return <span className={`ai-provider-mark ${large ? 'large' : ''}`} aria-hidden="true">
    <ServiceLogo name={logoName(provider)} url={apiProviderDefinition(provider.id)?.keyUrl} />
  </span>;
}

function providerStatus(provider, state, runner) {
  if (provider.id === 'copilot') return state?.copilot?.state === 'connected' ? 'Model request verified' : state?.copilot?.auth?.status === 'running' ? 'Sign-in pending' : state?.copilot?.state === 'configured' ? 'Authorized · test required' : 'Not connected';
  if (isLocal(provider) && state?.deployment?.mode === 'public') return 'Personal runner required';
  if (isLocal(provider)) return runner?.state === 'connected' ? 'Ready on this machine' : 'Not ready on this machine';
  if (state?.[provider.id]?.state === 'connected') return 'Connected';
  if (state?.[provider.id]?.state === 'configured') return 'Key saved · test required';
  return 'Not connected';
}

function CopilotAccount({ saved, setup, hosted, busy, onAuthorize, onAction, onDisconnect, onTest, workspaceId, onStatus }) {
  const [local, setLocal] = useState(false);
  useEffect(() => {
    if (saved?.auth?.status !== 'running') return;
    let active = true;
    const timer = setInterval(() => { apiRequest(`/api/ai-connections/copilot/status?workspace_id=${encodeURIComponent(workspaceId)}`).then(response => { if (active) onStatus(response.result); }).catch(() => {}); }, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [workspaceId, saved?.auth?.status]);
  const browser = saved?.method === 'github_oauth';
  return <section aria-label="Copilot connection setup">
    <div className="ai-methods"><div><h2>GitHub authorization</h2><p>Each person connects their own GitHub account. Copilot access is required; an ordinary GitHub account alone is not enough.</p>
      <Button disabled={busy || !setup?.configured || Boolean(saved && !browser && saved.state !== 'not_connected')} onClick={onAuthorize}>{browser ? 'Reauthorize GitHub' : 'Connect with GitHub'} <ExternalLink /></Button>
      {setup && !setup.configured ? <p>Operator setup required: register a GitHub app and configure <code>{setup.missing.join(', ')}</code>. Callback: <code>{setup.callback_path}</code>. <a href={setup.docs} target="_blank" rel="noreferrer">Registration guide <ExternalLink /></a></p> : null}
      {saved && !browser && saved.state !== 'not_connected' ? <p>Disconnect the local account before switching to browser authorization.</p> : null}
</div><div><h2>Verify model access</h2><p>{browser ? `Authorized as ${saved.account_label}. ` : ''}Authorization does not prove model access. Choose a model and explicitly test it; the test may use your Copilot allowance.</p><div className="ai-account-actions"><Button disabled={busy || !saved || saved.state === 'not_connected' || saved.auth?.status === 'running'} onClick={() => onAction('check')}>Check authorization</Button><Button disabled={busy || !saved || saved.state === 'not_connected' || saved.auth?.status === 'running'} onClick={onTest}>Choose a model to test</Button>{saved && saved.state !== 'not_connected' ? <Button disabled={busy} onClick={onDisconnect}>Disconnect</Button> : null}</div></div></div>
    {!hosted && !browser ? <details open={local} onToggle={event => setLocal(event.currentTarget.open)} className="ai-direct-note"><summary>Local ACP alternative</summary><p>Install the official CLI on this computer: <code>npm install -g @github/copilot</code>. This method is for local installations, not shared public accounts.</p><Button disabled={busy || saved?.auth?.status === 'running'} onClick={() => onAction('start')}>Start local device sign-in</Button>{saved?.auth ? <><p role="status">Sign-in: {saved.auth.status}</p><pre className="ai-auth-output">{saved.auth.output || 'Waiting for sign-in instructions…'}</pre><a href="https://github.com/login/device" target="_blank" rel="noreferrer">GitHub device sign-in <ExternalLink /></a></> : null}</details> : null}
  </section>;
}

function ApiKeyDialog({ provider, saved, busy, onSave, onClose }) {
  const [key, setKey] = useState('');
  const [modelIds, setModelIds] = useState((saved?.model_ids || []).join('\n'));
  const [region, setRegion] = useState(saved?.region || provider.regions?.[0]?.id || '');
  const [providerWorkspace, setProviderWorkspace] = useState(saved?.provider_workspace || '');
  const [error, setError] = useState(null);
  return <Dialog title={`${saved ? 'Replace' : 'Add'} ${provider.name} API key`} onClose={onClose}><form className="ai-dialog-content ai-key-form" onSubmit={async event => {
    event.preventDefault(); setError(null);
    try { await onSave({ api_key: key.trim(), model_ids: modelIds.split(/[\n,]/).map(value => value.trim()).filter(Boolean), region: region || undefined, provider_workspace: providerWorkspace || undefined }); setKey(''); } catch (cause) { setError(cause); }
  }}>
    <p><a href={provider.keyUrl} target="_blank" rel="noreferrer">Get an API key <ExternalLink /></a> from {provider.name}. Your provider bills API usage separately.</p>
    {saved ? <p>This replaces this provider’s current connection method in this workspace. Existing conversation history is kept.</p> : null}
    <Field label="API key"><input aria-label="API key" type="password" autoComplete="new-password" required minLength={8} maxLength={8192} value={key} onChange={event => setKey(event.target.value)} spellCheck={false} disabled={busy} /></Field>
    {provider.regions ? <Field label="Provider region"><Select aria-label="Provider region" value={region} onChange={setRegion} disabled={busy}>{provider.regions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field> : null}
    {provider.workspaceRequired ? <Field label="Model Studio workspace ID" hint="Use the ID in your Alibaba Cloud API endpoint, not your Frondose workspace ID."><input aria-label="Model Studio workspace ID" value={providerWorkspace} onChange={event => setProviderWorkspace(event.target.value)} required maxLength={63} disabled={busy} /></Field> : null}
    <Field label={`Model IDs${provider.discovery ? ' (optional)' : ''}`} hint={provider.discovery ? 'Leave empty to load the provider catalog, or enter only the model IDs you want to use, one per line. Explicit IDs also work with keys that cannot list models.' : 'Copy IDs from your provider’s model catalog. These remain unverified until a test succeeds.'}><textarea aria-label="Model IDs" rows={3} required={!provider.discovery} value={modelIds} onChange={event => setModelIds(event.target.value)} placeholder={provider.modelHint || 'One model ID per line'} disabled={busy} maxLength={6100} /></Field>
    <p>Keys are encrypted on the Frondose server. Saving does not send a prompt; choose Test a model afterward to verify the connection.</p>
    <ErrorMessage error={error} /><div><Button disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Save API key</Button></div>
  </form></Dialog>;
}

export function AIConnectionsView() {
  const { workspace, data, navigate, page } = useApp();
  const [state, setState] = useState(null);
  const [models, setModels] = useState([]);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [runnerDialog, setRunnerDialog] = useState(null);
  const [keyDialog, setKeyDialog] = useState(null);
  const detail = PROVIDERS.find(item => item.id === page.id);
  const runners = new Map((data.connections ?? []).filter(item => ['codex', 'claude'].includes(item.provider)).map(item => [item.provider, { ...item, state: item.workspace_states ? item.workspace_states[workspace.id] || 'not_connected' : item.state }]));
  const matching = useMemo(() => PROVIDERS.filter(item =>
    (filter === 'all' || item.category === filter || filter === 'api' && apiProviderDefinition(item.id) || filter === 'sign-in' && item.id === 'copilot') &&
    `${item.name} ${item.route} ${item.models} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase())
  ), [filter, query]);

  const load = async () => {
    const response = await apiRequest(`/api/ai-connections?workspace_id=${encodeURIComponent(workspace.id)}`);
    setState(response.result);
    await refreshFrondose();
  };
  useEffect(() => {
    let active = true;
    setState(null);
    setError(null);
    setKeyDialog(null); setConfirm(null); setModels([]); setResult(null);
    apiRequest(`/api/ai-connections?workspace_id=${encodeURIComponent(workspace.id)}`)
      .then(response => { if (active) setState(response.result); })
      .catch(cause => { if (active) setError(cause); });
    return () => { active = false; };
  }, [workspace.id]);
  const run = async action => {
    setBusy(true); setError(null); setResult(null);
    try { await action(); } catch (cause) { setError(cause); } finally { setBusy(false); }
  };
  const post = (provider, path, extra = {}) => apiRequest(`/api/ai-connections/${provider}/${path}`, {
    method: 'POST', body: { workspace_id: workspace.id, ...extra }, timeoutMs: path === 'test' ? 85_000 : 25_000,
  }).then(response => response.result);
  const start = provider => run(async () => {
    const response = await post(provider, provider === 'copilot' ? 'oauth/start' : 'start');
    const url = new URL(response.authorization_url);
    if (url.origin !== ({ openrouter: 'https://openrouter.ai', huggingface: 'https://huggingface.co', copilot: 'https://github.com' })[provider]) throw new Error('Provider authorization address was invalid.');
    window.location.assign(url.href);
  });
  const check = provider => run(async () => { const checked = await post(provider, 'check'); await load(); setResult({ type: 'check', provider, data: checked }); });
  const openModels = provider => run(async () => {
    const response = await apiRequest(`/api/ai-connections/${provider}/models?workspace_id=${encodeURIComponent(workspace.id)}`, { timeoutMs: 25_000 });
    setModels(response.result); setSelected(''); setConfirm({ type: 'test', provider });
  });
  const test = provider => run(async () => { const checked = await post(provider, 'test', { model: selected }); await load(); setResult({ type: 'test', provider, data: checked }); setConfirm(null); });
  const disconnect = provider => run(async () => { await post(provider, 'disconnect'); await load(); setModels([]); setConfirm(null); setResult({ type: 'disconnect', provider }); });
  const openRunner = provider => run(async () => {
    const response = await frondoseApi.connectionSetups();
    setRunnerDialog({ provider, setup: response.result.setups?.find(item => item.provider === provider) });
  });

  const connected = detail && state?.[detail.id]?.state === 'connected';
  const saved = detail && state?.[detail.id];
  const apiDefinition = detail && apiProviderDefinition(detail.id);
  const hosted = state?.deployment?.mode === 'public';
  const canAuthorize = detail?.id === 'openrouter' || detail?.id === 'huggingface' && state?.huggingface_configured;
  const status = detail ? providerStatus(detail, state, runners.get(detail.id)) : null;

  return <main className="page ai-connections">
    {detail ? <section className="ai-provider-detail">
      <button type="button" className="ai-provider-back" onClick={() => navigate('connections')}>← AI connections</button>
      <div className="ai-provider-hero">
        <ProviderMark provider={detail} large />
        <div className="ai-provider-identity"><h1>{detail.name}</h1><p>{detail.description}</p><span className="ai-provider-status">{status}</span></div>
        <div className="ai-provider-main-action">
          {detail.id === 'copilot' ? <Button variant="primary" disabled={busy} onClick={() => document.querySelector('[aria-label="Copilot connection setup"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>Manage connection <ArrowRight /></Button>
            : isLocal(detail) ? hosted ? <span className="ai-unavailable-action">Use the API connection below</span> : <Button variant="primary" busy={busy} onClick={() => openRunner(detail.id)}>Manage runner <ArrowRight /></Button>
            : saved ? <Button variant="primary" onClick={() => openModels(detail.id)} disabled={busy}>Test a model</Button>
            : apiDefinition ? <Button variant="primary" disabled={!state || busy} onClick={() => setKeyDialog(apiDefinition)}>Connect {detail.name} <ArrowRight /></Button>
            : canAuthorize ? <Button variant="primary" disabled={!state || busy} busy={busy} onClick={() => start(detail.id)}>Connect {detail.name} <ExternalLink /></Button>
            : <span className="ai-unavailable-action">{detail.id === 'copilot' ? 'Coming soon' : 'Operator setup required'}</span>}
        </div>
      </div>
      <p className="ai-connection-guide-links"><a href={`#/docs/${detail.id === 'copilot' ? 'account-copilot' : apiDefinition ? `api-${detail.id}` : `computer-${detail.id}`}`}>Read the {detail.name} setup guide</a>{apiDefinition?.auth ? <> · <a href={`#/docs/account-${detail.id}`}>Account authorization</a></> : null}{isLocal(detail) || detail.id === 'copilot' ? <> · <a href={`#/docs/computer-${detail.id}`}>Paired-computer route</a> · <button type="button" className="text-button" onClick={() => { navigate('connections'); requestAnimationFrame(() => document.getElementById('computer-connections-heading')?.scrollIntoView({ block: 'start' })); }}>Connect your computer</button></> : null}</p>
      <ErrorMessage error={error} />
      {detail.id === 'copilot' ? <CopilotAccount workspaceId={workspace.id} saved={saved} setup={state?.copilot_oauth_setup} hosted={hosted} busy={busy} onAuthorize={() => start('copilot')} onDisconnect={() => setConfirm({ type: 'disconnect', provider: 'copilot' })} onStatus={connection => setState(current => ({ ...current, copilot: connection }))} onAction={operation => run(async () => { await post('copilot', operation); await load(); })} onTest={() => openModels('copilot')} /> : null}
      {apiDefinition ? <div className="ai-methods" aria-label="Connection methods">
        <div><h2>API key</h2><p>{saved?.method === 'api_key' ? connected ? 'Connected with your API key.' : 'Key saved. Test a model to finish connecting.' : 'Connect with your own provider API key.'}</p><Button disabled={!state || busy} onClick={() => setKeyDialog(apiDefinition)}>{saved ? 'Use a new API key' : 'Add API key'}</Button></div>
        {apiDefinition.auth ? <div><h2>Browser authorization</h2><p>{detail.id === 'huggingface' && !state?.huggingface_configured ? 'Requires a Frondose OAuth app. An API token can be used now.' : 'Authorize on the provider website.'}{saved?.method === 'api_key' ? ' Signing in replaces the active API-key method.' : ''}</p><Button disabled={!state || busy || !canAuthorize} onClick={() => start(detail.id)}>{saved?.method === 'oauth' ? 'Reauthorize' : 'Sign in'} <ExternalLink /></Button></div> : null}
      </div> : null}
{isLocal(detail) && detail.id !== 'copilot' ? <div className="ai-methods" aria-label="Connection methods">{!hosted ? <div><h2>Local account</h2><p>Use the signed-in {detail.name} runner on this machine.</p><Button disabled={busy} onClick={() => openRunner(detail.id)}>Manage runner</Button>{detail.id === 'codex' ? <><p>Optional Paseo-style session transport. Enable it after signing in. Each reviewed request starts a fresh ephemeral Codex thread.</p><Button disabled={busy} onClick={() => run(async () => { await frondoseApi.connectConnection('codex', { method: 'app_server', workspace_id: workspace.id }); await load(); setResult({ type: 'bridge', provider: 'codex' }); })}>Enable Codex session bridge</Button>{result?.type === 'bridge' ? <p role="status">Session bridge selected. Your next reviewed run will use app-server; no prompt has been sent.</p> : null}</> : null}</div> : <div><h2>Public account access</h2><p>{detail.id === 'codex' ? 'Hosted ChatGPT-plan sign-in needs OpenAI approval. Shared server CLI accounts are disabled.' : 'Claude subscription login is not a general third-party OAuth option. Shared server CLI accounts are disabled.'} Connect a personal API key instead.</p></div>}<div><h2>API key</h2><p>{detail.id === 'codex' ? 'OpenAI API' : 'Anthropic API'} provides text conversations and reviewed Frondose actions through a separate API account. Project-file work still needs the local runner.</p><Button onClick={() => navigate('connections', detail.id === 'codex' ? 'openai' : 'anthropic')}>Connect {detail.id === 'codex' ? 'OpenAI API' : 'Anthropic API'} <ArrowRight /></Button></div></div> : null}
      <div className="ai-provider-overview">
        <div className="ai-provider-meta"><div><small>Built by</small><strong>Frondose</strong></div><div><small>Connection route</small><strong>{detail.route}</strong></div>{detail.docs ? <div><small>Docs</small><a href={detail.docs} target="_blank" rel="noreferrer">Provider guide <ExternalLink /></a></div> : null}</div>
        <div className="ai-provider-examples">
          <article><span className="ai-example-label">What this enables</span><h2>{detail.abilities.length ? 'Work you can do' : 'Not available yet'}</h2>{detail.abilities.length ? <ul>{detail.abilities.map(ability => <li key={ability}><Check />{ability}</li>)}</ul> : <p>Frondose cannot authorize or execute this provider today.</p>}</article>
          <article><span className="ai-example-label">Before you continue</span><h2>Account and review</h2><ul><li><Check />{detail.usage}</li><li><Check />Agent permissions remain separate from account access</li><li><Check />Opening this page never starts a run or spends credits</li></ul></article>
        </div>
        <div className="ai-provider-description"><h2>Overview</h2><p>{detail.limitation}</p><p>Available models: {detail.models}. A provider account check does not certify every model or tool.</p>
          {saved && detail.id !== 'copilot' ? <div className="ai-account-actions"><Button busy={busy} onClick={() => check(detail.id)}>Check authorization</Button><Button busy={busy} onClick={() => openModels(detail.id)}>Choose a model to test</Button><Button onClick={() => setConfirm({ type: 'disconnect', provider: detail.id })}>Disconnect from Frondose</Button></div> : null}
          {result?.provider === detail.id && result.type === 'check' ? <p role="status">{result.data.requires_model_test ? 'A successful model test is required to finish verifying this API key.' : 'Authorization checked. A model request is a separate test.'}</p> : null}
          {result?.provider === detail.id && result.type === 'test' ? <p role="status">{result.data.model} replied: “{result.data.reply}”. This test may use provider credits.</p> : null}
          {result?.provider === detail.id && result.type === 'disconnect' ? <p role="status">Saved Frondose credentials removed. Revoke provider access separately if needed.</p> : null}
        </div>
      </div>
    </section> : <>
      <PageHeader title="AI connections" description="Choose API credentials, supported account authorization, or a personal computer. Account access and agent permissions are separate."><Button onClick={() => navigate('docs', 'provider-connections')}>Connection guides</Button></PageHeader>
      <div className="ai-catalog-controls">
        <div className="ai-filter-tabs" role="group" aria-label="Filter AI connections">
          {[[ 'all', 'All' ], [ 'api', 'API key' ], [ 'sign-in', 'Sign in' ], [ 'local', 'Local' ]].map(([id, label]) => <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
        </div>
        <SearchField value={query} onChange={setQuery} placeholder="Search providers…" />
      </div>
      <ErrorMessage error={error} />
      {!state && !error ? <p role="status" className="ai-muted">Checking connection status…</p> : null}
      <div className="ai-provider-table" role="list" aria-label="AI providers">
        <div className="ai-provider-table-head" aria-hidden="true"><span>Provider</span><span>Route</span><span>This connection will use</span><span>Status</span></div>
        {matching.map(provider => {
          const statusText = providerStatus(provider, state, runners.get(provider.id));
          const connectedProvider = state?.[provider.id]?.state === 'connected';
          const action = isLocal(provider) ? 'Manage' : state?.[provider.id] ? 'Manage' : 'Connect';
          return <button type="button" role="listitem" key={provider.id} className="ai-provider-row" onClick={() => navigate('connections', provider.id)} aria-label={`View ${provider.name} connection details · ${statusText}`}>
            <span className="ai-provider-name"><ProviderMark provider={provider} /><strong>{provider.name}</strong></span>
            <span className="ai-provider-route">{isLocal(provider) ? <Terminal /> : <ExternalLink />}{apiProviderDefinition(provider.id)?.auth ? 'Sign in or API key' : provider.route}</span>
            <span className="ai-provider-usage">{provider.usage}</span>
            <span className={`ai-provider-row-action ${action === 'Connect' ? 'primary' : ''}`}>{!connectedProvider && state?.[provider.id]?.state === 'configured' ? provider.id === 'copilot' ? 'Test model' : 'Test key' : action}</span>
          </button>;
        })}
        {!matching.length ? <p className="ai-empty-match">No AI connections match your search.</p> : null}
      </div>
      <details className="ai-direct-note"><summary>About connection methods and credits</summary><p>API keys use your provider API billing. OpenRouter, configured Hugging Face, and configured GitHub Copilot offer browser authorization. A paired computer uses the owner’s locally authorized runtimes and account. Public mode never borrows the server owner’s CLI login. Each computer and agent policy must explicitly allow execution; connecting never starts a request.</p></details>
      <ComputerConnections key={workspace.id} workspaceId={workspace.id} />
      <div className="ai-plugin-note"><Plug /><span>Service integrations are now called <strong>Plugins</strong>. They remain Coming soon and are separate from AI connections.</span><button type="button" onClick={() => navigate('settings', 'integrations')}>View Plugins <ArrowRight /></button></div>
    </>}
    {runnerDialog ? <ConnectionDialog provider={runnerDialog.provider} setup={runnerDialog.setup} onClose={() => setRunnerDialog(null)} /> : null}
    {keyDialog ? <ApiKeyDialog key={`${workspace.id}:${keyDialog.id}`} provider={keyDialog} saved={state?.[keyDialog.id]} busy={busy} onClose={() => { if (!busy) setKeyDialog(null); }} onSave={async input => { setBusy(true); try { await post(keyDialog.id, 'api-key', input); await load(); setKeyDialog(null); } finally { setBusy(false); } }} /> : null}
    {confirm?.type === 'test' ? <Dialog title={`Test a ${aiProviderName(confirm.provider)} model`} subtitle="This sends a short test prompt and may spend your provider credits. It is a separate test, not an agent run." onClose={() => { if (!busy) setConfirm(null); }}><div className="ai-dialog-content"><Select aria-label="Model to test" value={selected} onChange={setSelected}><option value="">{confirm.provider === 'copilot' ? 'Provider default' : 'Choose a model'}</option>{models.filter(item => !item.output_modalities?.length || item.output_modalities.includes('text')).map(item => <option key={item.id} value={item.id}>{item.name}{item.source === 'configured' ? ' · configured ID' : ''}</option>)}</Select><p>Passing this test verifies one model request only. It does not certify other models or tool access.</p><ErrorMessage error={error} /><div><Button disabled={busy} onClick={() => setConfirm(null)}>Cancel</Button><Button variant="primary" disabled={(!selected && confirm.provider !== 'copilot') || busy} busy={busy} onClick={() => test(confirm.provider)}>Send test request</Button></div></div></Dialog> : null}
    {confirm?.type === 'disconnect' ? <Dialog title={`Disconnect ${aiProviderName(confirm.provider)}?`} subtitle="Frondose will delete its encrypted credential. This does not revoke access at the provider." onClose={() => setConfirm(null)}><div className="ai-dialog-content"><p>You can revoke the grant separately in the provider's account settings.</p><div><Button onClick={() => setConfirm(null)}>Keep connection</Button><Button variant="primary" busy={busy} onClick={() => disconnect(confirm.provider)}>Remove from Frondose</Button></div></div></Dialog> : null}
  </main>;
}

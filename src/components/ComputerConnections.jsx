import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { Button, Dialog, ErrorMessage, Field, SearchField, useApp } from '../ui.jsx';
import { Form } from './Form.jsx';
import { AgentIdentity } from './AgentIdentity.jsx';
import './computer-connections.css';

const PLATFORM_NAMES = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
const STATE_NAMES = { approval_required: 'Awaiting your approval', online: 'Online', offline: 'Offline', revoked: 'Disconnected' };
const INVENTORY_NAMES = { installed: 'Command found', launcher_only: 'Installer launcher found', not_found: 'Not found', unsupported: 'Unsupported on this computer', error: 'Discovery failed' };

function ComputerConnectionsContent({ workspaceId }) {
  const [runners, setRunners] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [name, setName] = useState('');
  const [pairing, setPairing] = useState(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [disconnect, setDisconnect] = useState(null);
  const [approve, setApprove] = useState(null);
  const active = useRef(true);
  const request = useRef(null);
  const actionLock = useRef(false);
  const command = `node scripts/frondose-runner.mjs pair --server ${window.location.origin}`;
  const authorizeCommand = 'node scripts/frondose-runner.mjs authorize --providers codex,claude --max-concurrent 2';
  const runCommand = 'node scripts/frondose-runner.mjs run';

  const load = useCallback(async ({ quiet = false } = {}) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (!quiet) setLoading(true);
    try {
      const response = await apiRequest(`/api/runner-connections?workspace_id=${encodeURIComponent(workspaceId)}`, { signal: controller.signal });
      if (!active.current || controller.signal.aborted) return;
      const result = response.result || response;
      setRunners(Array.isArray(result.runners) ? result.runners : []);
      setCatalog(Array.isArray(result.catalog) ? result.catalog : []);
      setError(null);
    } catch (cause) {
      if (active.current && !controller.signal.aborted) setError(cause);
    } finally {
      if (active.current && !controller.signal.aborted) setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    active.current = true;
    load();
    return () => { active.current = false; request.current?.abort(); };
  }, [load]);

  const awaitingClaim = Boolean(pairing) || runners.some(runner => runner.state === 'approval_required' || runner.state === 'online');
  useEffect(() => {
    if (!awaitingClaim) return;
    const refresh = () => {
      if (document.visibilityState !== 'visible' || actionLock.current) return;
      if (pairing && Date.parse(pairing.expires_at) <= Date.now()) {
        setPairing(null);
        setNotice('The pairing code expired. Create another code if this computer has not connected.');
      }
      load({ quiet: true });
    };
    const timer = window.setInterval(refresh, 5_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [awaitingClaim, pairing, load]);

  const perform = async (key, action) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(key); setError(null); setNotice('');
    try { await action(); }
    catch (cause) { if (active.current) setError(cause); }
    finally { actionLock.current = false; if (active.current) setBusy(''); }
  };
  const createPairing = event => {
    event.preventDefault();
    perform('pair', async () => {
      const response = await apiRequest('/api/runner-connections/pairing', { method: 'POST', body: { workspace_id: workspaceId, name: name.trim() } });
      if (!active.current) return;
      setPairing((response.result || response).pairing);
      setNotice('Pairing code created. Enter it only in the helper on your own computer.');
    });
  };
  const copy = text => perform('copy', async () => {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable. Select and copy the text manually.');
    await navigator.clipboard.writeText(text);
    if (active.current) setNotice('Copied to clipboard.');
  });
  const confirmComputer = () => perform('approve', async () => {
    await apiRequest(`/api/runner-connections/${encodeURIComponent(approve.id)}/confirm`, { method: 'POST', body: { workspace_id: workspaceId } });
    if (!active.current) return;
    setApprove(null); setPairing(null); setNotice('Computer approved. Authorize the runtime allowlist and execution limits locally on that computer before enabling an agent binding. Nothing was started.');
    await load({ quiet: true });
  });
  const disconnectComputer = () => perform('disconnect', async () => {
    await apiRequest(`/api/runner-connections/${encodeURIComponent(disconnect.id)}`, { method: 'DELETE', body: { workspace_id: workspaceId, version: disconnect.version } });
    if (!active.current) return;
    setDisconnect(null); setNotice('Computer disconnected. Its Frondose credential is revoked; provider accounts and files are unchanged.');
    await load({ quiet: true });
  });
  const search = query.trim().toLocaleLowerCase();
  const matching = catalog.filter(provider => `${provider.title} ${provider.protocol}`.toLocaleLowerCase().includes(search));

  return <section className="computer-connections" aria-labelledby="computer-connections-heading">
    <header className="computer-connections-header">
      <div><h2 id="computer-connections-heading">Connect a computer</h2><p>Use your own Mac, Windows or Linux computer as an explicitly authorized AI host. <a href="#/docs/computer-connections">Setup guide</a></p></div>
      <Button disabled={Boolean(busy) || loading} busy={loading} onClick={() => load()}>Refresh computers</Button>
    </header>
    <p className="computer-connections-boundary"><strong>Pairing is not execution permission.</strong> The owner must authorize runtimes on the computer, then enable a named agent binding. Native tools run with that OS account’s privileges—not inside a Frondose sandbox. Opening this page never starts AI or spends credits.</p>
    <ErrorMessage error={error} />
    {notice ? <p className="computer-connections-notice" role="status">{notice}</p> : null}

    <div className="computer-setup">
      <Form onSubmit={createPairing} className="computer-pair-form">
        <Field label="Computer name" hint="A name you will recognize, such as Home Mac or Windows laptop."><input value={name} onChange={event => setName(event.target.value)} maxLength={100} required autoComplete="off" placeholder="Name this computer" disabled={Boolean(busy)} /></Field>
        <Button type="submit" variant="primary" busy={busy === 'pair'} disabled={Boolean(busy) || !name.trim()}>Create pairing code</Button>
      </Form>
      <div className="computer-helper-instructions">
        <h3>Run the developer helper</h3>
        <p>Use a local Frondose checkout on the computer you are pairing. Install Node.js 22.17+ or 24+, then run this from the Frondose folder:</p>
        <div className="computer-copy-line"><code>{command}</code><Button disabled={Boolean(busy)} onClick={() => copy(command)}>Copy command</Button></div>
        <p>Paste the pairing code into the terminal when asked, then return here to approve the computer. Follow the helper’s local authorization command to choose runtime IDs, tool/package permissions, member access and session limits. A browser cannot grant itself these rights. There is no packaged installer yet.</p>
        <details><summary>Authorize and keep the helper running</summary><p>Example only: replace the runtime IDs with the agents you installed and intend to allow. This command changes local execution consent; run it only on the computer you control.</p><div className="computer-copy-line"><code>{authorizeCommand}</code><Button disabled={Boolean(busy)} onClick={() => copy(authorizeCommand)}>Copy example</Button></div><p>Then keep the helper running:</p><div className="computer-copy-line"><code>{runCommand}</code><Button disabled={Boolean(busy)} onClick={() => copy(runCommand)}>Copy run command</Button></div><p>Native tools, package downloads and member sharing are not enabled by this example. Use <code>authorize --help</code> or the <a href="#/docs/computer-connections">setup guide</a> for their explicit flags. Run <code>node scripts/frondose-runner.mjs disable</code> to remove execution consent.</p></details>
        <p>The helper must stay running and the computer must stay awake and online. Agent sign-in happens through each provider’s official CLI; Claude and ChatGPT website histories are not automatically synced.</p>
      </div>
    </div>
    {pairing ? <div className="computer-pair-code" role="group" aria-label="Temporary pairing code">
      <div><h3>Enter this code in your helper</h3><p>Expires at {new Date(pairing.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Treat it as a temporary secret—do not share it or paste it into a chat.</p></div>
      <div className="computer-copy-line"><code>{pairing.code}</code><Button disabled={Boolean(busy)} onClick={() => copy(pairing.code)}>Copy pairing code</Button></div>
      <Button variant="ghost" disabled={Boolean(busy)} onClick={() => { setPairing(null); setNotice('Code hidden. It remains usable until it expires or is claimed.'); }}>Hide code</Button>
    </div> : null}

    <div className="computer-list-heading"><h3>Your paired computers</h3><span>{runners.length} of 10</span></div>
    {loading && !runners.length ? <p className="computer-empty" role="status">Loading your computers…</p> : !runners.length ? <p className="computer-empty">No computers paired in this workspace. API-key and account-authorization connections remain separate.</p> : <ul className="computer-list">{runners.map(runner => <li key={runner.id}>
      <div className="computer-identity"><strong>{runner.name}</strong><span>{PLATFORM_NAMES[runner.platform] || runner.platform} · {runner.architecture} · {STATE_NAMES[runner.state] || 'Status unavailable'}</span>
        {runner.state !== 'approval_required' ? <span>{runner.execution_available ? 'Execution enabled by local policy' : 'Execution disabled or helper offline'} · account access unverified</span> : null}
        {runner.last_seen_at ? <span>Last seen {new Date(runner.last_seen_at).toLocaleString()}</span> : null}
      </div>
      <div className="computer-row-actions">{runner.state === 'approval_required' ? <Button variant="primary" disabled={Boolean(busy)} onClick={() => setApprove(runner)}>Review computer</Button> : null}<Button disabled={Boolean(busy)} onClick={() => setDisconnect(runner)}>Disconnect</Button></div>
      {runner.execution_policy?.enabled ? <div className="computer-policy-summary"><strong>Local execution policy</strong><p>Up to {runner.execution_policy.max_concurrent_sessions} simultaneous requests · {runner.execution_policy.allow_workspace_members ? 'workspace members may be explicitly granted access' : 'owner only'} · native tools {runner.execution_policy.native_tools_approved ? 'locally approved' : 'not approved'} · package execution {runner.execution_policy.package_execution_approved ? 'locally approved' : 'not approved'}</p><p>Allowed runtimes: {runner.execution_policy.provider_ids.map(id => catalog.find(provider => provider.id === id)?.title || id).join(', ') || 'None'}. Project access also requires the local project allowlist and current workspace grants.</p><a href="#/docs/computer-agent-permissions">Review agent permissions and sharing</a></div> : null}
      {runner.runtimes?.length ? <details className="computer-inventory"><summary>Detected commands ({runner.runtimes.length})</summary><ul>{runner.runtimes.map(runtime => <li key={runtime.id}><a href={`#/docs/computer-${runtime.id}`}>{catalog.find(provider => provider.id === runtime.id)?.title || runtime.id}</a><span>{INVENTORY_NAMES[runtime.state] || 'Unknown'} · {runner.execution_policy?.provider_ids?.includes(runtime.id) ? 'locally authorized' : 'not locally authorized'} · account unverified</span></li>)}</ul></details> : null}
    </li>)}</ul>}

    <details className="computer-catalog"><summary>Agent runtime catalog{catalog.length ? ` (${catalog.length})` : ''}</summary>
      <p>Adapted from Paseo’s licensed catalog. Each guide explains its installation, account route, transport and limits. A listing or command detection is not provider authentication or live verification. Operating-system support depends on the provider; discovery installs nothing.</p>
      <SearchField label="Search agent runtime catalog" placeholder="Search runtimes or protocols…" value={query} onChange={setQuery} />
      {matching.length ? <ul>{matching.map(provider => <li key={provider.id}><div className="computer-runtime-title"><AgentIdentity provider={provider.id} compact /><div><strong>{provider.title}</strong><span>{provider.protocol}</span></div></div><div><span>{provider.requiresInstallApproval ? 'Explicit package execution or manual installation' : 'Provider-owned installation and login'}{provider.requiresFullAccess ? ' · full-access runtime' : ''} · live verification unknown</span><a href={`#/docs/computer-${provider.id}`}>Read {provider.title} guide</a></div></li>)}</ul> : <p>{loading ? 'Loading runtime catalog…' : 'No runtimes match your search.'}</p>}
    </details>

    {approve ? <Dialog title={`Approve ${approve.name}?`} subtitle="Approve only a computer you just paired and control." closeDisabled={Boolean(busy)} onClose={() => { if (!busy) setApprove(null); }}><div className="computer-dialog-content"><p>The helper reports <strong>{PLATFORM_NAMES[approve.platform] || approve.platform} · {approve.architecture}</strong>. Approval allows the helper connection and inventory. Execution still requires the computer owner’s local authorization policy and an enabled agent binding.</p><p>If this is not your computer, disconnect it instead. Approval never shares a provider subscription automatically.</p><div><Button disabled={Boolean(busy)} onClick={() => setApprove(null)}>Cancel</Button><Button variant="primary" busy={busy === 'approve'} disabled={Boolean(busy)} onClick={confirmComputer}>Approve computer</Button></div></div></Dialog> : null}
    {disconnect ? <Dialog title={`Disconnect ${disconnect.name}?`} subtitle="This revokes this computer’s Frondose connection in this workspace." closeDisabled={Boolean(busy)} onClose={() => { if (!busy) setDisconnect(null); }}><div className="computer-dialog-content"><p>This does not uninstall agents, delete files or sign you out of your AI providers. Pair the helper again to reconnect.</p><div><Button disabled={Boolean(busy)} onClick={() => setDisconnect(null)}>Keep connection</Button><Button variant="danger" busy={busy === 'disconnect'} disabled={Boolean(busy)} onClick={disconnectComputer}>Disconnect computer</Button></div></div></Dialog> : null}
  </section>;
}

export function ComputerConnections({ workspaceId }) {
  const { workspace } = useApp();
  const currentId = workspaceId || workspace?.id;
  return currentId ? <ComputerConnectionsContent key={currentId} workspaceId={currentId} /> : null;
}

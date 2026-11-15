import { useEffect, useRef, useState } from 'react';
import { apiRequest, frondoseApi } from '../data/api.js';
import { frondoseActions } from '../data/useFrondose.js';
import { Button, ErrorMessage, useApp } from '../ui.jsx';
import './local-installation.css';

const names = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
export function LocalRuntimePanel({ providerId, onConnected, compact = false, disabled = false, discoveryOnly = false }) {
  const { data, workspace, navigate } = useApp();
  const [inventory, setInventory] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState('');
  const [refresh, setRefresh] = useState(0);
  const active = useRef(true), lock = useRef(false);
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    setError(null); setInventory(null);
    apiRequest('/api/local-runtime', { signal: controller.signal }).then(response => { if (!controller.signal.aborted) setInventory(response.result); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause); });
    return () => { active.current = false; controller.abort(); };
  }, [refresh]);
  async function useLogin(id) {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(id); setError(null);
    try {
      const response = await frondoseApi.connectConnection(id, { method: 'existing', workspace_id: workspace.id });
      if (response.connection?.state !== 'connected') throw new Error('Sign in through the provider CLI on this computer, then check again.');
      const latest = await frondoseActions.refresh();
      const connection = latest.connections.find(item => item.provider === id);
      if (active.current) onConnected?.(connection);
    } catch (cause) { if (active.current) setError(cause); }
    finally { lock.current = false; if (active.current) setBusy(''); }
  }
  const runtimes = (inventory?.runtimes || []).filter(item => providerId ? item.id === providerId : item.installed || ['codex', 'claude', 'copilot'].includes(item.id));
  return <section className={`local-runtime-panel ${compact ? 'compact' : ''}`} aria-label={discoveryOnly ? 'CLI tools on this computer' : 'Agents on this computer'}>
    <header><div><h2>{compact ? 'This computer' : discoveryOnly ? 'CLI tools on this computer' : 'Agents on this computer'}</h2>{!compact ? <p>Detected locally. Discovery never installs software, signs in or sends a prompt.</p> : null}{inventory && discoveryOnly ? <p>{names[inventory.platform] || inventory.platform}{inventory.host?.architecture ? ` · ${inventory.host.architecture}` : ''} · Node.js {inventory.node}{inventory.host?.defaultShell?.title ? ` · Default terminal: ${inventory.host.defaultShell.title}` : ''}</p> : null}</div><Button disabled={disabled || Boolean(busy)} onClick={() => setRefresh(value => value + 1)}>Refresh detection</Button></header>
    <ErrorMessage error={error} />{!inventory && !error ? <p role="status">Detecting installed CLI commands…</p> : null}
    {runtimes.map(runtime => {
      const connection = data.connections?.find(item => item.provider === runtime.id);
      const ready = !discoveryOnly && (connection?.workspace_states?.[workspace.id] || connection?.state) === 'connected';
      return <div className="local-runtime-row" key={runtime.id}><div><strong>{runtime.title || runtime.id}</strong><small>{runtime.installed ? ready ? 'Connected locally · model access depends on your provider' : 'Installed · sign-in not checked' : 'Not found in inherited PATH or known install folders'}</small></div>
        {!discoveryOnly && runtime.installed && ['codex', 'claude'].includes(runtime.id) ? <Button busy={busy === runtime.id} disabled={disabled || Boolean(busy)} onClick={() => useLogin(runtime.id)}>{ready ? 'Check local sign-in' : 'Use local sign-in'}</Button> : <Button disabled={disabled || Boolean(busy)} onClick={() => navigate('docs', `computer-${runtime.id}`)}>Setup guide</Button>}
      </div>;
    })}
    {inventory && !runtimes.length ? <p>No matching installed runtime was found. Install your provider’s CLI, then refresh detection.</p> : null}
  </section>;
}

export function LocalInstallation() {
  const { navigate } = useApp();
  return <><header className="settings-heading"><div><h1>Local installation</h1><p>One owner. Your workspace, history and credentials stay on this computer.</p></div></header>
    <section className="local-installation-facts"><h2>Your private workspace</h2><ul><li>No Frondose cloud account, membership or subscription is required.</li><li>Existing local passwords remain enabled. An optional local lock is separate from CLI sign-in.</li><li>Each CLI manages its own provider login. Cloud AI providers still receive prompts you explicitly send.</li><li>Local terminal processes need this computer awake and Frondose running.</li><li>Native tools run as your OS user, not inside a project sandbox.</li></ul><div><Button onClick={() => navigate('settings', 'personal-security')}>Local lock & sessions</Button><Button onClick={() => navigate('settings', 'storage')}>Export workspace</Button><Button onClick={() => navigate('settings', 'terminal')}>Terminal preferences</Button></div></section>
    <LocalRuntimePanel discoveryOnly />
  </>;
}

import { useEffect, useState } from 'react';
import { apiRequest } from '../../data/api.js';
import { Button, Dialog, ErrorMessage, Field } from '../../ui.jsx';

export function IdentitySettings() {
  const [identity, setIdentity] = useState(null), [sessions, setSessions] = useState([]), [error, setError] = useState(null), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const load = async () => { const response = await apiRequest('/api/identity'); setIdentity(response.result); if (response.result.configured) setSessions((await apiRequest('/api/identity/sessions')).result); };
  useEffect(() => { load().catch(setError); }, []);
  const run = async fn => { setBusy(true); setError(null); try { await fn(); await load(); } catch (failure) { setError(failure); } finally { setBusy(false); } };
  return <><header className="settings-heading"><div><h1>Account & sessions</h1><p>Manage sign-in for this Frondose installation and end sessions you no longer use.</p></div></header><ErrorMessage error={error} />
    {identity && !identity.configured ? <section className="settings-panel identity-setup account-settings-panel"><h2>Set up your account</h2><p>This installation currently uses its development owner. Setting a password turns on sign-in for all browsers. Keep your password available; email recovery is not configured.</p><form onSubmit={e => { e.preventDefault(); setConfirm(true); }}>
      <Field label="Your name"><input required maxLength={160} value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></Field>
      <Field label="Email"><input required type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></Field>
      <Field label="Password"><input required type="password" minLength={12} maxLength={256} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" /></Field>
      <Button type="submit" variant="primary" busy={busy}>Enable sign-in</Button>
    </form></section> : identity ? <><section className="settings-panel identity-setup account-settings-panel"><h2>{identity.user?.name}</h2><p>{identity.user?.email}</p><Button onClick={() => run(async () => { await apiRequest('/api/identity/logout', { method: 'POST', body: {} }); location.reload(); })}>Sign out</Button></section><section className="settings-group"><h2>Sessions</h2>{sessions.map(session => <div className="setting-row" key={session.id}><span><strong>{session.current ? 'This browser' : 'Another browser session'}</strong><small>Last used {new Date(session.last_seen_at).toLocaleString()} · Expires {new Date(session.expires_at).toLocaleString()}</small></span><Button disabled={busy} onClick={() => run(async () => { await apiRequest('/api/identity/revoke', { method: 'POST', body: { session_id: session.id } }); if (session.current) location.reload(); })}>End session</Button></div>)}</section></> : null}
    {confirm ? <Dialog title="Enable account sign-in?" onClose={() => !busy && setConfirm(false)}><div className="identity-setup"><p>Other browsers will need to sign in. Your current Owner access and workspace content stay attached to this account.</p><ErrorMessage error={error} /><Button variant="primary" busy={busy} onClick={() => run(async () => { await apiRequest('/api/identity/setup', { method: 'POST', body: { name, email, password } }); setPassword(''); setConfirm(false); })}>Enable sign-in</Button></div></Dialog> : null}
  </>;
}

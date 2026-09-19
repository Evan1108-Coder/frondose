import { useEffect, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { Button, ErrorMessage, Field } from '../ui.jsx';
import { RumboSymbol } from './Brand.jsx';

export function IdentityGate({ children }) {
  const [identity, setIdentity] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const invitation = new URLSearchParams(location.hash.split('?')[1] || '').get('invitation');
  useEffect(() => { let active = true; apiRequest('/api/identity').then(r => { if (active) setIdentity(r.result); }).catch(e => { if (active) setError(e); }); return () => { active = false; }; }, []);
  if (identity?.user && !invitation) return children;
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      await apiRequest(`/api/identity/${invitation ? 'accept' : 'login'}`, { method: 'POST', body: invitation ? { token: invitation, password } : { email, password } });
      location.replace(`${location.pathname}#/overview`); location.reload();
    } catch (failure) { setError(failure); } finally { setBusy(false); }
  }
  return <main className="identity-screen"><div className="identity-card"><RumboSymbol size={40} decorative />
    <h1>{invitation ? 'Join your Rumbo workspace' : identity ? 'Sign in to Rumbo' : 'Opening Rumbo'}</h1>
    <ErrorMessage error={error} />
    {identity || invitation ? <form onSubmit={submit}>
      {!invitation ? <Field label="Email"><input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></Field> : <p>Create a password to activate the account assigned to this invitation.</p>}
      <Field label="Password"><input type="password" autoComplete={invitation ? 'new-password' : 'current-password'} minLength={invitation ? 12 : undefined} required value={password} onChange={e => setPassword(e.target.value)} /></Field>
      <Button type="submit" variant="primary" busy={busy}>{invitation ? 'Accept invitation' : 'Sign in'}</Button>
    </form> : error ? <Button onClick={() => location.reload()}>Try again</Button> : <p role="status">Loading your workspace…</p>}
  </div></main>;
}

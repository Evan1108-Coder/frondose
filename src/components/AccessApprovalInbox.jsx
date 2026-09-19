import { useEffect, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { Button, ErrorMessage, useApp } from '../ui.jsx';
import { ShieldCheck } from './icons.jsx';

export function AccessApprovalInbox() {
  const { workspace, navigate } = useApp();
  const [items, setItems] = useState([]), [error, setError] = useState(null);
  useEffect(() => {
    let active = true;
    const load = () => apiRequest(`/api/governance?workspace_id=${encodeURIComponent(workspace.id)}`).then(response => { if (active) { setItems(response.result.approvals.filter(item => item.status === 'pending')); setError(null); } }).catch(failure => { if (active && failure.status !== 403) setError(failure); });
    load(); const timer = setInterval(load, 15000); return () => { active = false; clearInterval(timer); };
  }, [workspace.id]);
  return <><ErrorMessage error={error} />{items.length ? <section className="settings-panel" style={{ padding: 20, marginBottom: 24 }}><div className="section-heading"><h2><ShieldCheck /> Owner decisions · {items.length}</h2><Button onClick={() => navigate('settings', 'access-approvals')}>Review requests</Button></div>{items.map(item => <p key={item.id}>{item.kind === 'owner_promotion' ? 'New Owner requested' : item.kind === 'owner_leave' ? 'Owner departure requested' : 'Protected action requested'} · {new Date(item.created_at).toLocaleString()}</p>)}</section> : null}</>;
}

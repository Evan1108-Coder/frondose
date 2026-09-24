import { lazy, Suspense } from 'react';
import { Button, PageHeader, useApp } from '../ui.jsx';
import { Settings } from '../components/icons.jsx';
import { Plans } from './Plans.jsx';
import { RepeatingRoutes } from '../components/RouteTools.jsx';
import './settings/settings-center.css';
import './experience.css';
const ResourcePage = lazy(() => import('./settings/ResourcePage.jsx').then(m => ({ default: m.ResourcePage })));
export const OPERATION_TABS = [['plans', 'Work plans', null], ['repeating', 'Repeating routes', null], ['queue', 'Queue', 'queue'], ['handoffs', 'Handoffs', 'handoff'], ['requests', 'Requests', 'request'], ['views', 'Saved views', 'saved_view'], ['goals', 'Goals', 'goal'], ['templates', 'Templates', 'route_template']];
export function OperationsView() {
  const { page, navigate } = useApp();
  const tab = OPERATION_TABS.find(t => t[0] === page.id) ?? OPERATION_TABS[0];
  return <main className="page operations-page"><PageHeader title="Coordination" description="Existing plans, repeating Routes, and workspace queues. Plans do not execute agent steps."><Button onClick={() => navigate('workflows')}>Manual Workflows</Button><Button icon={Settings} onClick={() => navigate('settings', 'coordination')}>Settings</Button></PageHeader>
    <div className="tabs" role="tablist" aria-label="Coordination areas">{OPERATION_TABS.map(([id,label]) => <button key={id} role="tab" className={tab[0] === id ? 'active' : ''} aria-selected={tab[0] === id} onClick={() => navigate('operations', id)}>{label}</button>)}</div>
    {tab[0] === 'plans' ? <Plans /> : tab[0] === 'repeating' ? <RepeatingRoutes /> : <Suspense fallback={<p role="status">Opening {tab[1].toLowerCase()}…</p>}><ResourcePage key={tab[2]} kind={tab[2]} /></Suspense>}
  </main>;
}

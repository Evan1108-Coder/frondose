import { useState } from 'react';
import { Button, Empty, PageHeader, Select, useApp } from '../ui.jsx';
import { ArrowRight, Check, Clock, Plus, Bell, Pin, Terminal } from '../components/icons.jsx';
import { attentionItems, describePage } from '../lib/workspace-experience.js';
import { parsePage } from '../lib/navigation.js';
import { visible, relative } from '../lib/model.js';
import { ActivityList, ProjectRow } from './Overview.jsx';
import './experience.css';

export function Home() {
  const { data, workspace, edit, navigate, experience, updateExperience, organization, status } = useApp();
  const [tab, setTab] = useState('attention'), [projectFilter, setProjectFilter] = useState('all');
  const projects = visible(data.projects), now = Date.now();
  const all = attentionItems(data, organization.seenFailures, now);
  const snoozed = all.filter(i => experience.snoozed[i.key] > now);
  const items = all.filter(i => !(experience.snoozed[i.key] > now) && (projectFilter === 'all' || i.projectId === projectFilter));
  const groups = experience.options.groupAttention === 'project'
    ? [...new Set(items.map(i => i.projectId || 'unassigned'))].map(id => [id, projects.find(p => p.id === id)?.name || 'Workspace', items.filter(i => (i.projectId || 'unassigned') === id)])
    : [['attention', 'Needs your decision'], ['running', 'In motion'], ['ready', 'Up next']].map(([id, label]) => [id, label, items.filter(i => i.group === id)]);
  const open = hash => { const p = parsePage(hash); navigate(p.view, p.id, p); };
  const recent = experience.recent.map(i => ({ ...i, title: describePage(data, parsePage(i.hash)) })).filter(i => i.title && i.hash !== '#/overview').slice(0, experience.options.recentLimit);
  const followed = projects.filter(p => experience.followed.includes(p.id));
  return <main className="page home-page"><PageHeader title="Home" description={`Your next decisions in ${workspace.name}.`}><Button variant="primary" icon={Plus} onClick={() => edit('task')}>New route</Button></PageHeader>
    <div className="home-status"><span>{status.syncError ? 'Updates interrupted' : `Updated ${relative(status.lastUpdatedAt || data.meta?.generatedAt)}`}</span><span>Routes track goals · runs track execution · outputs track results</span></div>
    <div className="tabs" role="tablist" aria-label="Home sections">{[['attention', 'Attention'], ['projects', 'Following'], ['recent', 'Recent'], ['activity', 'Activity']].map(([id,label]) => <button role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)}>{label}{id === 'attention' && items.filter(i => i.group === 'attention').length ? ` · ${items.filter(i => i.group === 'attention').length}` : ''}</button>)}</div>
    {tab === 'attention' ? <><div className="home-tools"><Select aria-label="Home project filter" value={projectFilter} onChange={setProjectFilter}><option value="all">All projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select><Button variant="ghost" onClick={() => navigate('operations')}>Coordination<ArrowRight /></Button></div>
      <div className="home-columns">{groups.map(([id,label,entries]) => <section key={id} className="home-section"><header><h2>{label}</h2><span>{entries.length}</span></header>{entries.length ? entries.map(item => <article className="attention-row" key={item.key}><button onClick={() => navigate(item.view,item.id)}><span><strong>{item.title}</strong><small>{item.detail}</small></span><ArrowRight /></button><button className="attention-snooze" aria-label={`Snooze ${item.title}`} title={`Snooze for ${experience.options.snoozeHours} hours`} onClick={() => updateExperience({ ...experience, snoozed: { ...experience.snoozed, [item.key]: Date.now() + experience.options.snoozeHours * 3600000 } })}><Clock /></button></article>) : <p className="quiet-note">{id === 'running' ? 'No active work. Nothing starts without you.' : id === 'ready' ? 'Move a route to Ready when its brief is clear.' : 'No decisions waiting here.'}</p>}</section>)}</div>
      {snoozed.length ? <details className="snoozed-items"><summary>{snoozed.length} snoozed items</summary>{snoozed.map(item => <div key={item.key}><span>{item.title}</span><Button onClick={() => updateExperience({ ...experience, snoozed: { ...experience.snoozed, [item.key]: 0 } })}>Bring back</Button></div>)}</details> : null}
      <div className="home-digest"><Bell /><div><strong>Since your last check-in</strong><p>{experience.lastSeenAt ? `${(data.audit_log ?? []).filter(e => Date.parse(e.created_at) > experience.lastSeenAt).length} recorded workspace changes` : 'Mark a check-in to track changes from this point.'}{experience.options.includeCompleted ? ` · ${data.runs.filter(r => r.status === 'completed' && (!experience.lastSeenAt || Date.parse(r.finished_at || r.updated_at) > experience.lastSeenAt)).length} completed sessions` : ''}</p></div><Button onClick={() => updateExperience({ ...experience, lastSeenAt: Date.now() })}>Mark checked</Button></div></> : null}
    {tab === 'projects' ? <><div className="home-project-picks">{projects.map(p => <Button key={p.id} icon={Pin} aria-pressed={experience.followed.includes(p.id)} onClick={() => updateExperience({ ...experience, followed: experience.followed.includes(p.id) ? experience.followed.filter(id => id !== p.id) : [...experience.followed, p.id] })}>{p.name}</Button>)}</div>{followed.map(p => <div className="followed-project" key={p.id}><ProjectRow project={p} /><Button icon={Terminal} onClick={() => navigate('workbench', p.id)}>Workbench</Button></div>)}{!followed.length ? <Empty compact kind="projects" title="Follow what matters" description="Choose a project above to keep its progress and workbench close." action={!projects.length ? 'Create project' : undefined} onAction={() => edit('project')} /> : null}</> : null}
    {tab === 'recent' ? <section className="recent-list">{recent.map(item => <button key={item.hash} onClick={() => open(item.hash)}><Clock /><span><strong>{item.title}</strong><small>{relative(new Date(item.at).toISOString())}</small></span><ArrowRight /></button>)}{!recent.length ? <Empty compact kind="audit" title="Pick up where you left off" description="Projects, chats, routes, and workbenches you visit will appear here." /> : null}</section> : null}
    {tab === 'activity' ? <ActivityList limit={60} compact={false} /> : null}
  </main>;
}

import { useEffect, useState } from 'react';
import { Button, Empty, PageHeader, Select, useApp } from '../ui.jsx';
import { ArrowRight, Bell, BookOpen, Bot, CircleAlert, Clock, ListChecks, Pin, RotateCw, ShieldCheck, Terminal, Workflow } from '../components/icons.jsx';
import { apiRequest } from '../data/api.js';
import { describePage } from '../lib/workspace-experience.js';
import { pageHash, parsePage } from '../lib/navigation.js';
import { visible, relative, val } from '../lib/model.js';
import { ActivityList, ProjectRow } from './Overview.jsx';
import './experience.css';
import './today.css';

const TODAY_SECTIONS = [
  { key: 'needs_you', title: 'Needs you', icon: ShieldCheck, empty: 'No decisions waiting here.', description: 'Requests and approval gates that need your review.' },
  { key: 'working_now', title: 'Working now', icon: Bot, empty: 'No active runs in this scope. Nothing starts without you.', description: 'Recorded execution state, separate from output acceptance.' },
  { key: 'ready_to_review', title: 'Ready to review', icon: ListChecks, empty: 'No results waiting for review here.', description: 'Inspect the result and evidence before accepting it.' },
  { key: 'suggested_next', title: 'Suggested next', icon: Workflow, empty: 'No next-step proposals in this scope.', description: 'Proposals only. Opening one never starts work.' },
  { key: 'recent_context', title: 'Recent context', icon: BookOpen, empty: 'No recent context recorded in this scope.', description: 'Recent knowledge and source changes you can inspect.' },
];
const TODAY_DESTINATIONS = new Set(['overview', 'inbox', 'projects', 'tasks', 'chats', 'work', 'memory', 'agents', 'connections', 'settings', 'teams', 'focus', 'workbench', 'library', 'operations', 'documents', 'views', 'docs', 'updates', 'skills', 'workflows']);

export function todayFilters(selection, workspaceId, areas, projects) {
  const sameWorkspace = selection.workspaceId === workspaceId;
  const areaId = sameWorkspace && areas.some(area => area.id === selection.areaId) ? selection.areaId : 'all';
  const scopedProjects = projects.filter(project => areaId === 'all' || val(project, 'team_id') === areaId);
  const projectId = sameWorkspace && scopedProjects.some(project => project.id === selection.projectId) ? selection.projectId : 'all';
  return { workspaceId, areaId, projectId };
}

export function todayDestination(item) {
  if (!TODAY_DESTINATIONS.has(item?.view)) return null;
  try {
    return parsePage(pageHash(item.view, item.id ?? null, { projectId: item.project_id || null, ...(item.review_id ? { reviewId: item.review_id } : {}) }));
  } catch {
    return null;
  }
}

export function todayGroups(items, projects, groupByProject) {
  if (!groupByProject) return [{ key: 'all', title: null, items }];
  const groups = new Map();
  for (const item of items) {
    const id = item.project_id || 'workspace';
    if (!groups.has(id)) groups.set(id, { key: id, title: projects.find(project => project.id === id)?.name || 'Workspace', items: [] });
    groups.get(id).items.push(item);
  }
  return [...groups.values()];
}

export function todayEntries(result) {
  return [...Object.values(result?.sections || {}).flatMap(items => Array.isArray(items) ? items : []), ...(result?.failure_clusters || []), ...(result?.warnings || [])]
    .filter(item => item && typeof item.key === 'string' && typeof item.title === 'string')
    .filter((item, index, items) => items.findIndex(candidate => candidate.key === item.key) === index);
}

export function todayFailureItem(cluster) {
  return { ...cluster, view: cluster.run_ids?.length ? 'work' : null, id: cluster.run_ids?.[0] || null, time: cluster.latest_time };
}

export function todaySnoozeKeys(item) {
  const legacy = ['agent_run', 'run_needs_input', 'run_failed', 'paused_run'].includes(item.kind) ? `run:${item.id}`
    : item.kind === 'output_review' ? `output:${item.id}` : item.kind === 'ready_route' ? `task:${item.id}` : null;
  return legacy ? [item.key, legacy] : [item.key];
}

export function restoreTodayItem(snoozed, item) {
  return { ...snoozed, ...Object.fromEntries(todaySnoozeKeys(item).map(key => [key, 0])) };
}

function TodayItem({ item, projects, areas, onOpen, onSnooze, snoozeHours }) {
  const destination = todayDestination(item);
  const project = projects.find(record => record.id === item.project_id);
  const area = areas.find(record => record.id === item.area_id);
  const time = item.time && Number.isFinite(Date.parse(item.time)) ? item.time : null;
  const content = <><span className="today-item-copy"><strong>{item.title}</strong>{item.detail ? <span className="today-item-detail">{item.detail}</span> : null}<span className="today-item-meta">{item.simulation ? <span className="today-simulation">Simulation</span> : null}{project ? <span>{project.name}</span> : area ? <span>{area.name}</span> : null}{time ? <time dateTime={time}>{relative(time)}</time> : null}{!destination ? <span>No detail view available</span> : null}</span></span>{destination ? <ArrowRight aria-hidden="true" /> : null}</>;
  return <article className="today-item">{destination ? <button className="today-item-open" onClick={() => onOpen(destination)}>{content}</button> : <div className="today-item-open">{content}</div>}{onSnooze && item.key ? <button className="today-snooze" aria-label={`Snooze ${item.title} for ${snoozeHours} hours`} title={`Snooze for ${snoozeHours} hours`} onClick={() => onSnooze(item.key)}><Clock aria-hidden="true" /></button> : null}</article>;
}

function TodaySection({ section, entries, projects, areas, onOpen, onSnooze, options }) {
  const Icon = section.icon;
  return <section className={`today-section today-section-${section.key}`} aria-labelledby={`today-${section.key}`}><header><div><Icon aria-hidden="true" /><h2 id={`today-${section.key}`}>{section.title}</h2></div><span className="today-count" aria-label={`${entries.length} shown`}>{entries.length}</span></header><p className="today-section-description">{section.description}</p>{entries.length ? todayGroups(entries, projects, options.groupAttention === 'project').map(group => <div className="today-item-group" key={group.key}>{group.title ? <h3>{group.title}</h3> : null}{group.items.map(item => <TodayItem key={item.key} item={item} projects={projects} areas={areas} onOpen={onOpen} onSnooze={onSnooze} snoozeHours={options.snoozeHours} />)}</div>) : <p className="today-empty">{section.empty}</p>}</section>;
}

export function Home() {
  const { data, workspace, navigate, edit, experience, updateExperience, status } = useApp();
  const [tab, setTab] = useState('today');
  const [selection, setSelection] = useState({ workspaceId: workspace.id, areaId: 'all', projectId: 'all' });
  const [refresh, setRefresh] = useState(0);
  const [feed, setFeed] = useState({ query: null, result: null, loading: true, error: null, checkedAt: null });
  const projects = visible(data.projects).filter(project => val(project, 'workspace_id') === workspace.id);
  const areas = visible(data.teams).filter(area => val(area, 'workspace_id') === workspace.id);
  const firstWork = projects.length === 0 && !visible(data.tasks).some(task => val(task, 'workspace_id') === workspace.id);
  const filters = todayFilters(selection, workspace.id, areas, projects);
  const filteredProjects = projects.filter(project => filters.areaId === 'all' || val(project, 'team_id') === filters.areaId);
  const query = new URLSearchParams({ workspace_id: workspace.id, ...(filters.areaId !== 'all' ? { area_id: filters.areaId } : {}), ...(filters.projectId !== 'all' ? { project_id: filters.projectId } : {}) }).toString();
  useEffect(() => {
    setSelection(current => current.workspaceId === filters.workspaceId && current.areaId === filters.areaId && current.projectId === filters.projectId ? current : { workspaceId: filters.workspaceId, areaId: filters.areaId, projectId: filters.projectId });
  }, [filters.workspaceId, filters.areaId, filters.projectId]);
  useEffect(() => {
    if (tab !== 'today') return;
    const controller = new AbortController();
    setFeed(current => ({ query, result: current.query === query ? current.result : null, loading: true, error: null, checkedAt: current.query === query ? current.checkedAt : null }));
    apiRequest(`/api/today?${query}`, { signal: controller.signal }).then(({ result }) => {
      if (!result?.sections || TODAY_SECTIONS.some(section => !Array.isArray(result.sections[section.key]))) throw new Error('Today returned an incomplete status summary. Try refreshing.');
      if (!controller.signal.aborted) setFeed({ query, result, loading: false, error: null, checkedAt: new Date().toISOString() });
    }).catch(error => {
      if (!controller.signal.aborted) setFeed(current => ({ ...current, query, result: current.query === query ? current.result : null, loading: false, error: error.message || 'Today is unavailable. Your workspace has not been changed.' }));
    });
    return () => controller.abort();
  }, [query, refresh, status.lastUpdatedAt, tab]);

  const result = feed.query === query ? feed.result : null;
  const loading = feed.query !== query || feed.loading;
  const now = Date.now();
  const isSnoozed = item => todaySnoozeKeys(item).some(key => experience.snoozed[key] > now);
  const all = todayEntries(result);
  const snoozed = all.filter(isSnoozed);
  const sectionItems = key => (result?.sections[key] || []).filter(item => !isSnoozed(item));
  const failures = (result?.failure_clusters || []).filter(item => !isSnoozed(item));
  const warnings = (result?.warnings || []).filter(item => !isSnoozed(item));
  const onOpen = page => navigate(page.view, page.id, page);
  const snooze = key => updateExperience({ ...experience, snoozed: { ...experience.snoozed, [key]: Date.now() + experience.options.snoozeHours * 3600000 } });
  const recent = experience.recent.map(item => ({ ...item, title: describePage(data, parsePage(item.hash)) })).filter(item => item.title && !['#/overview', '#/today'].includes(item.hash)).slice(0, experience.options.recentLimit);
  const followed = projects.filter(project => experience.followed.includes(project.id));

  return <main className="page home-page today-page"><PageHeader title="Today" description={`Your agents, decisions, and next steps in ${workspace.name}.`}>{!firstWork ? <><Button icon={Bot} onClick={() => navigate('agents')}>Agent Studio</Button><Button variant="primary" icon={Workflow} onClick={() => navigate('workflows')}>Workflows</Button></> : null}</PageHeader>
    <div className="home-status"><span>Opening Today never starts work.</span><span>Intent → Route → Run → Output → Review → Memory</span></div>
    {firstWork ? <section className="today-first-action" aria-labelledby="today-first-title"><span className="today-first-eyebrow">A good place to begin</span><h2 id="today-first-title">What do you want to get done?</h2><p>Create a Route for one concrete outcome. You can add context and decide whether an agent should work on it later.</p><Button variant="primary" icon={ArrowRight} onClick={() => edit('task', null, { guided: true })}>Create your first Route</Button><button type="button" className="today-first-secondary" onClick={() => navigate('rumbo-agent')}>Or explore Frondose</button></section> : null}
    <div className="tabs today-tabs" role="tablist" aria-label="Today sections">{[['today', 'Today'], ['projects', 'Following'], ['recent', 'Recent'], ['activity', 'Activity']].map(([id, label]) => <button type="button" id={`today-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`today-panel-${id}`} className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)}>{label}{id === 'today' && result && sectionItems('needs_you').length ? ` · ${sectionItems('needs_you').length}` : ''}</button>)}</div>
    <div role="tabpanel" id={`today-panel-${tab}`} aria-labelledby={`today-tab-${tab}`}>
      {tab === 'today' ? <><div className="today-toolbar"><div className="today-filters"><Select aria-label="Today Area filter" value={filters.areaId} onChange={areaId => setSelection({ workspaceId: workspace.id, areaId, projectId: 'all' })}><option value="all">All Areas</option>{areas.map(area => <option key={area.id} value={area.id}>{area.name}</option>)}</Select><Select aria-label="Today project filter" value={filters.projectId} onChange={projectId => setSelection({ workspaceId: workspace.id, areaId: filters.areaId, projectId })}><option value="all">All projects</option>{filteredProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</Select></div><Button variant="ghost" icon={RotateCw} disabled={loading} onClick={() => setRefresh(value => value + 1)}>{loading ? 'Refreshing…' : 'Refresh'}</Button></div>
        <div className="today-feed-status" role="status">{loading ? result ? 'Refreshing recorded status…' : 'Loading recorded status…' : feed.checkedAt && result ? `Last checked ${relative(feed.checkedAt)}` : 'Recorded workspace status'}{result ? ' · Filters apply to Today only; other tabs and check-in remain workspace-wide.' : ''}</div>
        {feed.query === query && feed.error ? <div className="today-error" role="alert"><CircleAlert aria-hidden="true" /><div><strong>Could not refresh Today</strong><p>{feed.error}</p>{result ? <p>The last loaded summary is shown. Open the item to verify its current state.</p> : null}</div><Button onClick={() => setRefresh(value => value + 1)}>Try again</Button></div> : null}
        {result ? <><div className="today-grid">{TODAY_SECTIONS.map(section => <TodaySection key={section.key} section={section} entries={sectionItems(section.key)} projects={projects} areas={areas} onOpen={onOpen} onSnooze={snooze} options={experience.options} />)}<section className="today-section today-section-problems" aria-labelledby="today-problems"><header><div><CircleAlert aria-hidden="true" /><h2 id="today-problems">Failures & context warnings</h2></div><span className="today-count" aria-label={`${failures.length + warnings.length} shown`}>{failures.length + warnings.length}</span></header><p className="today-section-description">Recorded failures and context changes—not inferred causes or confidence scores.</p>{failures.length ? <div className="today-item-group"><h3>Failure groups</h3>{failures.map(cluster => <div key={cluster.key}><TodayItem item={todayFailureItem(cluster)} projects={projects} areas={areas} onOpen={onOpen} onSnooze={snooze} snoozeHours={experience.options.snoozeHours} />{cluster.run_ids?.length > 1 ? <details className="today-failure-runs"><summary>{cluster.count} recorded failures · inspect runs</summary>{cluster.run_ids.map(id => <Button variant="ghost" key={id} onClick={() => { const page = todayDestination({ view: 'work', id }); if (page) onOpen(page); }}>{id}<ArrowRight aria-hidden="true" /></Button>)}</details> : null}</div>)}</div> : null}{warnings.length ? <div className="today-item-group"><h3>Context warnings</h3>{warnings.map(item => <TodayItem key={item.key} item={item} projects={projects} areas={areas} onOpen={onOpen} onSnooze={snooze} snoozeHours={experience.options.snoozeHours} />)}</div> : null}{!failures.length && !warnings.length ? <p className="today-empty">No recorded failure groups or context warnings here. This is not a guarantee that every source is current.</p> : null}</section></div>
          {snoozed.length ? <details className="snoozed-items today-snoozed"><summary>{snoozed.length} snoozed {snoozed.length === 1 ? 'item' : 'items'} in this scope</summary>{snoozed.map(item => <div key={item.key}><span>{item.title}</span><Button onClick={() => updateExperience({ ...experience, snoozed: restoreTodayItem(experience.snoozed, item) })}>Bring back</Button></div>)}</details> : null}</> : !loading && !feed.error ? <Empty compact kind="audit" title="Status unavailable" description="Refresh to read the current workspace state. Nothing has been started." /> : null}
        <div className="home-digest"><Bell aria-hidden="true" /><div><strong>Workspace check-in</strong><p>{experience.lastSeenAt ? `${(data.audit_log ?? []).filter(event => Date.parse(event.created_at) > experience.lastSeenAt).length} recorded workspace changes since your last check-in` : 'Mark a check-in to track changes from this point.'}{experience.options.includeCompleted ? ` · ${(data.runs || []).filter(run => run.status === 'completed' && (!experience.lastSeenAt || Date.parse(run.finished_at || run.updated_at) > experience.lastSeenAt)).length} completed sessions` : ''}</p><small>Counts reflect currently loaded history. Run completion does not mean output acceptance.</small></div><Button onClick={() => updateExperience({ ...experience, lastSeenAt: Date.now() })}>Mark checked</Button></div>
      </> : null}
      {tab === 'projects' ? <><div className="home-project-picks">{projects.map(project => <Button key={project.id} icon={Pin} aria-pressed={experience.followed.includes(project.id)} onClick={() => updateExperience({ ...experience, followed: experience.followed.includes(project.id) ? experience.followed.filter(id => id !== project.id) : [...experience.followed, project.id] })}>{project.name}</Button>)}</div>{followed.map(project => <div className="followed-project" key={project.id}><ProjectRow project={project} /><Button icon={Terminal} onClick={() => navigate('workbench', project.id)}>Workbench</Button></div>)}{!followed.length ? <Empty compact kind="projects" title="Follow what matters" description="Choose a project above to keep its progress and workbench close." action={!projects.length ? 'Open projects' : undefined} onAction={() => navigate('projects')} /> : null}</> : null}
      {tab === 'recent' ? <section className="recent-list">{recent.map(item => <button key={item.hash} onClick={() => onOpen(parsePage(item.hash))}><Clock aria-hidden="true" /><span><strong>{item.title}</strong><small>{relative(new Date(item.at).toISOString())}</small></span><ArrowRight aria-hidden="true" /></button>)}{!recent.length ? <Empty compact kind="audit" title="Pick up where you left off" description="Projects, conversations, Routes, and workbenches you visit will appear here." /> : null}</section> : null}
      {tab === 'activity' ? <ActivityList limit={60} compact={false} /> : null}
    </div>
  </main>;
}

import { requestUpdateNavigation } from '../components/UnsavedUpdates.jsx';
import { useEffect, useRef, useState } from 'react';
import { ActivityComposer, ActivityEntry, ActivityFeed } from '../components/ActivityFeed.jsx';
import { ArrowLeft, Plus, RotateCw, MessageSquareText } from '../components/icons.jsx';
import { Button, Dialog, Empty, ErrorMessage, PageHeader, SearchField, Select, useApp } from '../ui.jsx';
import { rumboApi } from '../data/api.js';
import { filteredActivityThreads, UPDATE_TYPES } from '../lib/activity.js';
import { insertSavedUpdates, mergeUpdatePages, UPDATE_HEALTH, UPDATE_TARGETS, updateTargetLink, updateTargets } from '../lib/updates.js';
import './updates.css';

export function UpdatesView() {
  const { workspace, page } = useApp();
  return page.id ? <UpdateDetail key={`${workspace.id}:${page.id}`} workspaceId={workspace.id} id={page.id} /> : <WorkspaceUpdates key={`${workspace.id}:${page.projectId ?? ''}`} workspaceId={workspace.id} projectId={page.projectId} />;
}

export function WorkspaceUpdates({ workspaceId, projectId, teamId }) {
  const { data, notify } = useApp();
  const [state, setState] = useState('published'), [type, setType] = useState(''), [health, setHealth] = useState(''), [target, setTarget] = useState('');
  const [project, setProject] = useState(projectId ?? ''), [search, setSearch] = useState(''), [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false), [creating, setCreating] = useState(false), [reload, setReload] = useState(0);
  const [savedEntries, setSavedEntries] = useState([]);
  const filterKey = JSON.stringify({ state, type, health, target, project, query, archived, teamId });
  const changeView = action => requestUpdateNavigation(() => { setSavedEntries([]); action(); });
  const Container = teamId ? 'section' : 'main';
  return <Container className={`${teamId ? '' : 'page '}updates-page`}><PageHeader title={teamId ? 'Area updates' : 'Updates'} description={teamId ? 'Updates from this Area’s Routes and projects.' : 'Progress, decisions, and context from across your workspace.'}><Button icon={RotateCw} onClick={() => changeView(() => setReload(value => value + 1))}>Refresh</Button><Button variant="primary" icon={Plus} onClick={() => requestUpdateNavigation(() => setCreating(true))}>New update</Button></PageHeader>
    <div className="updates-privacy-note">Updates stay attached to their work. Drafts are private to their author; publishing does not send external notifications or start agents.</div>
    <div className="updates-filter-bar">
      <Select label="Visibility" value={state} onChange={value => changeView(() => setState(value))}><option value="published">Published updates</option><option value="draft">My drafts</option></Select>
      <Select label="Work type" value={target} onChange={value => changeView(() => setTarget(value))}><option value="">Every work type</option>{UPDATE_TARGETS.filter(([id]) => !teamId || ['project', 'route'].includes(id)).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</Select>
      <Select label="Project" value={project} onChange={value => changeView(() => setProject(value))}><option value="">Every project</option>{(data.projects ?? []).filter(item => !item.archived_at && (!teamId || item.team_id === teamId)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
      <Select label="Update type" value={type} onChange={value => changeView(() => setType(value))}><option value="">Every update type</option>{UPDATE_TYPES.filter(([id]) => id !== 'comment').map(([id,label]) => <option key={id} value={id}>{label}</option>)}</Select>
      <Select label="Health" value={health} onChange={value => changeView(() => setHealth(value))}><option value="">Every health state</option>{UPDATE_HEALTH.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</Select>
      <label className="updates-archive-filter"><input type="checkbox" checked={archived} onChange={event => { const checked = event.target.checked; changeView(() => setArchived(checked)); }} />Include archived</label>
      <form className="updates-search" onSubmit={event => { event.preventDefault(); changeView(() => setQuery(search.trim())); }}><SearchField value={search} onChange={setSearch} label="Search updates" placeholder="Search titles and content…" /><Button type="submit">Search</Button>{query ? <Button onClick={() => changeView(() => { setSearch(''); setQuery(''); })}>Clear</Button> : null}</form>
    </div>
    <UpdateResults key={`${workspaceId}:${filterKey}:${reload}`} workspaceId={workspaceId} savedEntries={savedEntries} filters={{ publicationState: state, targetType: target, updateType: type, health, projectId: project, teamId, search: query, includeArchived: archived }} />
    {creating ? <NewUpdateDialog workspaceId={workspaceId} teamId={teamId} initialProject={project} onClose={() => setCreating(false)} onSaved={entry => { setCreating(false); setSavedEntries(current => mergeUpdatePages(current, [entry])); notify(entry.publication_state === 'draft' ? 'Draft saved privately. Find it under My drafts; current filters and unsent replies were kept.' : 'Update published. Current filters and unsent replies were kept.'); }} /> : null}
  </Container>;
}

function UpdateResults({ workspaceId, filters, savedEntries }) {
  const [entries, setEntries] = useState([]), [cursor, setCursor] = useState(null), [next, setNext] = useState(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(null), [retry, setRetry] = useState(0);
  // The parent keys this component by every filter. Old pages and requests cannot
  // survive a filter/workspace change or be appended to a different query.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    rumboApi.listActivityFeed({ workspaceId, ...filters, cursor, limit: 30 }, { signal: controller.signal }).then(response => {
      if (controller.signal.aborted) return;
      setEntries(current => mergeUpdatePages(current, response.result.items));
      setNext(response.result.next_cursor ?? null);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspaceId, cursor, retry]);
  const displayed = insertSavedUpdates(entries, savedEntries, workspaceId, filters);
  return <section className="updates-results" aria-label="Workspace updates" aria-busy={loading}>
    <ErrorMessage error={error} />
    {displayed.map(entry => <FeedConversation key={entry.id} entry={entry} workspaceId={workspaceId} />)}
    {loading ? <p role="status" className="updates-load-state">Loading updates…</p> : error ? <Button onClick={() => setRetry(value => value + 1)}>Try again</Button> : !displayed.length ? <Empty icon={MessageSquareText} title={filters.publicationState === 'draft' ? 'No drafts match' : 'No updates match'} description="Try different filters, or write an update on a project, Route, or another workspace item." /> : next ? <Button onClick={() => setCursor(next)}>Load more updates</Button> : <p className="updates-load-state">You have reached the end of this feed.</p>}
  </section>;
}

function FeedConversation({ entry, workspaceId }) {
  const [records, setRecords] = useState([entry]), [loaded, setLoaded] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(null);
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function load() {
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setLoading(true); setError(null);
    try {
      const response = await rumboApi.listActivity({ workspaceId, targetType: entry.target_type, targetId: entry.target_id, includeArchived: true }, { signal: request.signal });
      if (!request.signal.aborted) { setRecords(response.result); setLoaded(true); }
    } catch (cause) { if (!request.signal.aborted) setError(cause); }
    finally { if (!request.signal.aborted) setLoading(false); }
  }
  const currentRoot = records.find(item => item.id === entry.id) || entry;
  const root = filteredActivityThreads(records, { state: currentRoot.archived_at ? 'archived' : currentRoot.publication_state }).find(item => item.id === entry.id) || currentRoot;
  function changed(result) {
    setRecords(current => current.some(item => item.id === result.id) ? current.map(item => item.id === result.id ? result : item) : [...current, result]);
    load();
  }
  return <div className="feed-conversation"><ActivityEntry entry={root} workspaceId={workspaceId} showTarget onChanged={changed} /><ErrorMessage error={error} />{!loaded || error ? <Button disabled={loading} onClick={load}>{loading ? 'Loading conversation…' : 'Load conversation'}</Button> : null}</div>;
}

function UpdateDetail({ workspaceId, id }) {
  const { data, navigate } = useApp();
  const [entry, setEntry] = useState(null), [error, setError] = useState(null), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null);
    rumboApi.getActivity(id, { workspaceId }, { signal: controller.signal }).then(response => { if (!controller.signal.aborted) setEntry(response.result); }).catch(cause => { if (!controller.signal.aborted) setError(cause); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspaceId, id, retry]);
  const link = entry ? updateTargetLink(entry, data) : null;
  return <main className="page updates-page"><PageHeader title="Update thread" description="The original update and the conversation around its work."><Button icon={ArrowLeft} onClick={() => navigate('updates')}>All updates</Button>{link ? <a className="button secondary" href={link}>Open work item</a> : null}</PageHeader><ErrorMessage error={error} />
    {loading ? <p role="status">Opening update…</p> : error ? <><p>This update is unavailable or you do not have access. No content has been changed.</p><Button onClick={() => setRetry(value => value + 1)}>Try again</Button></> : entry ? <ActivityFeed workspaceId={workspaceId} targetType={entry.target_type} targetId={entry.target_id} focusEntryId={entry.id} title={entry.target?.title ? `Updates · ${entry.target.title}` : 'Updates & replies'} /> : null}
  </main>;
}

function NewUpdateDialog({ workspaceId, initialProject, teamId, onClose, onSaved }) {
  const { data } = useApp();
  const [type, setType] = useState('project'), [targetId, setTargetId] = useState(initialProject || '');
  const [dirty, setDirty] = useState(false), [pending, setPending] = useState(false), [discard, setDiscard] = useState(false);
  const targets = updateTargets(data, type, workspaceId).filter(item => !teamId || (data.projects.find(project => project.id === item.project_id)?.team_id || item.team_id) === teamId), selected = targets.find(item => item.id === targetId);
  const close = () => { if (pending) return; if (dirty) setDiscard(true); else onClose(); };
  return <Dialog title="New update" subtitle="Choose the work this update belongs to." onClose={close}><div className="updates-new-dialog">
    {discard ? <div role="alert"><h3>Discard unsaved changes?</h3><p>This text has not been saved as a draft.</p><Button onClick={() => setDiscard(false)}>Keep editing</Button><Button variant="danger" onClick={onClose}>Discard changes</Button></div> : null}
    <div hidden={discard}><div className="updates-target-picker"><Select label="Work type" disabled={dirty || pending} value={type} onChange={value => { setType(value); setTargetId(''); }}>{UPDATE_TARGETS.filter(([id]) => !teamId || ['project', 'route'].includes(id)).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</Select><Select label="Work item" disabled={dirty || pending} value={selected?.id ?? ''} onChange={setTargetId}><option value="">Choose an item</option>{targets.map(item => <option key={item.id} value={item.id}>{item.name || item.title}</option>)}</Select></div>{selected ? <ActivityComposer key={`${type}:${targetId}`} workspaceId={workspaceId} targetType={type} targetId={targetId} onSaved={onSaved} onCancel={close} onDirtyChange={setDirty} onPendingChange={setPending} /> : <p>Select an available work item. The server checks its current permissions before saving.</p>}</div>
  </div></Dialog>;
}

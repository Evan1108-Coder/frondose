import { useEffect, useState } from 'react';
import { ActivityComposer, ActivityEntry, ActivityFeed } from '../components/ActivityFeed.jsx';
import { ArrowLeft, Plus, RotateCw, MessageSquareText } from '../components/icons.jsx';
import { Button, Dialog, Empty, ErrorMessage, PageHeader, SearchField, Select, useApp } from '../ui.jsx';
import { rumboApi } from '../data/api.js';
import { UPDATE_TYPES } from '../lib/activity.js';
import { mergeUpdatePages, UPDATE_HEALTH, UPDATE_TARGETS, updateTargetLink, updateTargets } from '../lib/updates.js';
import './updates.css';

export function UpdatesView() {
  const { workspace, page } = useApp();
  return page.id ? <UpdateDetail key={`${workspace.id}:${page.id}`} workspaceId={workspace.id} id={page.id} /> : <WorkspaceUpdates key={`${workspace.id}:${page.projectId ?? ''}`} workspaceId={workspace.id} projectId={page.projectId} />;
}

function WorkspaceUpdates({ workspaceId, projectId }) {
  const { data } = useApp();
  const [state, setState] = useState('published'), [type, setType] = useState(''), [health, setHealth] = useState(''), [target, setTarget] = useState('');
  const [project, setProject] = useState(projectId ?? ''), [search, setSearch] = useState(''), [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false), [creating, setCreating] = useState(false), [reload, setReload] = useState(0);
  const filterKey = JSON.stringify({ state, type, health, target, project, query, archived });
  return <main className="page updates-page"><PageHeader title="Updates" description="Progress, decisions, and context from across your workspace."><Button icon={RotateCw} onClick={() => setReload(value => value + 1)}>Refresh</Button><Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>New update</Button></PageHeader>
    <div className="updates-privacy-note">Updates stay attached to their work. Drafts are private to their author; publishing does not send external notifications or start agents.</div>
    <div className="updates-filter-bar">
      <Select label="Visibility" value={state} onChange={setState}><option value="published">Published updates</option><option value="draft">My drafts</option></Select>
      <Select label="Work type" value={target} onChange={setTarget}><option value="">Every work type</option>{UPDATE_TARGETS.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</Select>
      <Select label="Project" value={project} onChange={setProject}><option value="">Every project</option>{(data.projects ?? []).filter(item => !item.archived_at).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
      <Select label="Update type" value={type} onChange={setType}><option value="">Every update type</option>{UPDATE_TYPES.filter(([id]) => id !== 'comment').map(([id,label]) => <option key={id} value={id}>{label}</option>)}</Select>
      <Select label="Health" value={health} onChange={setHealth}><option value="">Every health state</option>{UPDATE_HEALTH.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</Select>
      <label className="updates-archive-filter"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />Include archived</label>
      <form className="updates-search" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); }}><SearchField value={search} onChange={setSearch} label="Search updates" placeholder="Search titles and content…" /><Button type="submit">Search</Button>{query ? <Button onClick={() => { setSearch(''); setQuery(''); }}>Clear</Button> : null}</form>
    </div>
    <UpdateResults key={`${workspaceId}:${filterKey}:${reload}`} workspaceId={workspaceId} filters={{ publicationState: state, targetType: target, updateType: type, health, projectId: project, search: query, includeArchived: archived }} onChanged={entry => { if (entry?.publication_state) setState(entry.publication_state); setReload(value => value + 1); }} />
    {creating ? <NewUpdateDialog workspaceId={workspaceId} initialProject={project} onClose={() => setCreating(false)} onSaved={entry => { setCreating(false); setState(entry.publication_state || 'published'); setType(''); setHealth(''); setTarget(entry.target_type); setProject(''); setSearch(''); setQuery(''); setArchived(false); setReload(value => value + 1); }} /> : null}
  </main>;
}

function UpdateResults({ workspaceId, filters, onChanged }) {
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
  return <section className="updates-results" aria-label="Workspace updates" aria-busy={loading}>
    <ErrorMessage error={error} />
    {entries.map(entry => <ActivityEntry key={entry.id} entry={entry} workspaceId={workspaceId} showTarget onChanged={onChanged} />)}
    {loading ? <p role="status" className="updates-load-state">Loading updates…</p> : error ? <Button onClick={() => setRetry(value => value + 1)}>Try again</Button> : !entries.length ? <Empty icon={MessageSquareText} title={filters.publicationState === 'draft' ? 'No drafts match' : 'No updates match'} description="Try different filters, or write an update on a project, Route, or another workspace item." /> : next ? <Button onClick={() => setCursor(next)}>Load more updates</Button> : <p className="updates-load-state">You have reached the end of this feed.</p>}
  </section>;
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

function NewUpdateDialog({ workspaceId, initialProject, onClose, onSaved }) {
  const { data } = useApp();
  const [type, setType] = useState('project'), [targetId, setTargetId] = useState(initialProject || '');
  const [dirty, setDirty] = useState(false), [pending, setPending] = useState(false), [discard, setDiscard] = useState(false);
  const targets = updateTargets(data, type, workspaceId), selected = targets.find(item => item.id === targetId);
  const close = () => { if (pending) return; if (dirty) setDiscard(true); else onClose(); };
  return <Dialog title="New update" subtitle="Choose the work this update belongs to." onClose={close}><div className="updates-new-dialog">
    {discard ? <div role="alert"><h3>Discard unsaved changes?</h3><p>This text has not been saved as a draft.</p><Button onClick={() => setDiscard(false)}>Keep editing</Button><Button variant="danger" onClick={onClose}>Discard changes</Button></div> : null}
    <div hidden={discard}><div className="updates-target-picker"><Select label="Work type" disabled={dirty || pending} value={type} onChange={value => { setType(value); setTargetId(''); }}>{UPDATE_TARGETS.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</Select><Select label="Work item" disabled={dirty || pending} value={selected?.id ?? ''} onChange={setTargetId}><option value="">Choose an item</option>{targets.map(item => <option key={item.id} value={item.id}>{item.name || item.title}</option>)}</Select></div>{selected ? <ActivityComposer key={`${type}:${targetId}`} workspaceId={workspaceId} targetType={type} targetId={targetId} onSaved={onSaved} onCancel={close} onDirtyChange={setDirty} onPendingChange={setPending} /> : <p>Select an available work item. The server checks its current permissions before saving.</p>}</div>
  </div></Dialog>;
}

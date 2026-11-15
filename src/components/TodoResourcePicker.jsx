import {useEffect, useId, useRef, useState} from 'react';
import {Button, ErrorMessage, SearchField} from '../ui.jsx';
import {Folder, FileText, MessageSquare, Check, ChevronRight} from './icons.jsx';
import {FileIcon} from './FileIcon.jsx';
import {apiRequest} from '../data/api.js';
import {todoApi} from '../lib/local-todos.js';
import {directoryApiPath} from '../lib/directory-drafts.js';
import {fileCommentsApiPath} from '../lib/file-comments.js';
import {resourceKey, workspaceResourceOptions, todoResourceScopeQuery} from '../lib/todo-resource-options.js';

export function TodoResourcePicker({workspaceId, data, resources, membership, onAdd, onClose}) {
  const headingId = useId(), picker = useRef(null), revealed = useRef(false);
  const [category, setCategory] = useState('resources');
  const [query, setQuery] = useState('');
  const [path, setPath] = useState('');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const selected = new Set(resources.map(resourceKey));
  const areaScope = JSON.stringify(todoResourceScopeQuery(membership));
  const scope = JSON.stringify([workspaceId, category, query.trim(), path, offset, revision, areaScope]);
  const liveScope = useRef(scope); liveScope.current = scope;
  const current = listing?.scope === scope ? listing : null;

  useEffect(() => {
    const refresh = event => {
      if (event.detail?.workspaceId && event.detail.workspaceId !== workspaceId) return;
      setPath(''); setOffset(0); setRevision(value => value + 1);
    };
    window.addEventListener('frondose:directory-changed', refresh);
    return () => window.removeEventListener('frondose:directory-changed', refresh);
  }, [workspaceId]);

  useEffect(() => {
    if (category === 'items') { setLoading(false); setError(null); return; }
    const controller = new AbortController();
    setLoading(true); setError(null);
    const timer = setTimeout(async () => {
      try {
        const options = {signal: controller.signal};
        if (category === 'resources') {
          if (membership.area_scope === 'selected' && !membership.team_ids.length) {
            if (!controller.signal.aborted) setListing({scope, items:[]});
            return;
          }
          const {result} = await apiRequest(todoApi(workspaceId, 'resources', {...JSON.parse(areaScope), q:query.trim(), offset}), options);
          if (!controller.signal.aborted) setListing({scope, ...result});
          return;
        }
        const {result: directory} = await apiRequest(directoryApiPath(workspaceId), options);
        if (!directory.ready) {
          if (!controller.signal.aborted) setListing({scope, unbound: true, entries: []});
          return;
        }
        const rootVersion = directory.binding.version;
        const endpoint = category === 'comments'
          ? fileCommentsApiPath(workspaceId, '', {expected_binding_version: rootVersion, offset})
          : query.trim()
            ? directoryApiPath(workspaceId, 'search', {q: query.trim(), mode: 'names'})
            : directoryApiPath(workspaceId, 'tree', {path});
        const {result} = await apiRequest(endpoint, options);
        // Tree/search do not carry a binding revision; reject a root changed during the read.
        const {result: after} = await apiRequest(directoryApiPath(workspaceId), options);
        if (!after.ready || after.binding.version !== rootVersion) throw Error('The workspace directory changed. Refresh the resources.');
        if (!controller.signal.aborted) setListing({scope, ...result, rootVersion});
      } catch (cause) { if (!controller.signal.aborted) setError(cause); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, query.trim() ? 180 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [workspaceId, category, query, path, offset, revision, scope, areaScope]);

  useEffect(() => {
    if (revealed.current || (!current && category !== 'items')) return;
    revealed.current = true;
    picker.current?.scrollIntoView({block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduced' ? 'auto' : 'smooth'});
  }, [current, category]);

  async function choose(resource) {
    if (adding || selected.has(resourceKey(resource)) || resources.length >= 20) return;
    const capturedScope = scope;
    setAdding(true); setError(null);
    try {
      // Validate a selected file/comment against its captured root before adding it to the draft.
      if (resource.kind === 'file') await apiRequest(directoryApiPath(workspaceId, 'file', {path: resource.path, expected_binding_version: resource.rootVersion}));
      if (resource.kind === 'comment') await apiRequest(fileCommentsApiPath(workspaceId, `threads/${resource.id}`, {expected_binding_version: resource.rootVersion}));
      let chosen = resource;
      if (resource.kind === 'area-resource') {
        const {result} = await apiRequest(todoApi(workspaceId, 'resources', {...JSON.parse(areaScope), id:resource.id, team_id:resource.teamId}));
        chosen = result.item;
      }
      if (capturedScope !== liveScope.current) throw Error('The resource selection changed. Choose the resource again.');
      onAdd(chosen);
    } catch (cause) { setError(cause); }
    finally { setAdding(false); }
  }

  function choice(resource, Icon = FileText, detail = '') {
    const added = selected.has(resourceKey(resource));
    return <button key={resourceKey(resource)} type="button" className="todo-resource-choice" disabled={added || adding || resources.length >= 20} onClick={() => choose(resource)} aria-label={(added ? 'Added: ' : 'Add resource: ') + resource.label}>
      {resource.kind === 'file' ? <FileIcon path={resource.path}/> : <Icon/>}
      <span><strong>{resource.label}</strong>{detail ? <small>{detail}</small> : null}</span>
      {added ? <Check/> : null}
    </button>;
  }

  const itemOptions = category === 'items' ? workspaceResourceOptions(data, workspaceId, query, membership) : [];
  const threads = (current?.threads || []).filter(thread => `${thread.path} ${thread.body || ''} ${thread.quote || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section ref={picker} className="todo-resource-picker" aria-labelledby={headingId}>
    <header><h4 id={headingId}>Add resource</h4><Button onClick={onClose} disabled={adding}>Done</Button></header>
    <div className="todo-resource-categories" role="group" aria-label="Resource type">
      {[['resources', 'Resources'], ['files', 'Files'], ['items', 'Workspace items'], ['comments', 'Comments']].map(([key, label]) => <button type="button" key={key} aria-pressed={category === key} onClick={() => {setCategory(key); setQuery(''); setOffset(0);}}>{label}</button>)}
    </div>
    <SearchField placeholder={category === 'resources' ? 'Search saved Area resources…' : category === 'files' ? 'Find files…' : category === 'comments' ? 'Filter comments on this page…' : 'Find projects, Routes, Areas or documents…'} value={query} onChange={setQuery} maxLength={200} data-field-defaults-exclude="true"/>
    {category === 'resources' ? <p>{membership.area_scope === 'selected' ? 'Only resources from the selected Areas are shown.' : 'Saved resources from Areas in this workspace.'}</p> : null}
    <ErrorMessage error={error}/>{error ? <Button onClick={() => setRevision(value => value + 1)}>Retry</Button> : null}
    {resources.length >= 20 ? <p role="status">20 resources added. Remove one before adding another.</p> : null}
    {category === 'files' && path && !query.trim() ? <Button onClick={() => setPath(path.split('/').slice(0, -1).join('/'))}>Back to parent folder</Button> : null}
    <div className="todo-resource-results" aria-busy={loading || adding}>
      {category === 'items' ? <>{itemOptions.map(resource => choice(resource, FileText, resource.type))}{!itemOptions.length ? <p>No matching workspace items.</p> : null}</> : loading ? <p role="status">Loading resources…</p> : error ? null : category === 'resources' ? <>
        {(current?.items || []).map(resource => choice(resource, FileText, resource.areaName + (resource.description ? ' · ' + resource.description : '')))}
        {!current?.items?.length ? <p>{membership.area_scope === 'selected' && !membership.team_ids.length ? 'Select an Area to choose its resources.' : 'No matching resources in these Areas.'}</p> : null}
        {offset || current?.next_offset != null ? <div className="todo-resource-pagination"><Button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button><Button disabled={current?.next_offset == null} onClick={() => setOffset(current.next_offset)}>Next</Button></div> : null}
      </> : current?.unbound ? <p>Choose a workspace directory to browse saved files and comments. Workspace items are available without a directory.</p> : category === 'files' ? <>
        {(current?.entries || []).filter(entry => entry.type !== 'link').map(entry => entry.type === 'directory'
          ? <button key={entry.path} type="button" className="todo-resource-choice" onClick={() => {setPath(entry.path); setQuery('');}}><Folder/><span>{entry.name}</span><ChevronRight/></button>
          : choice({kind: 'file', path: entry.path, rootVersion: current.rootVersion, label: entry.path.slice(0, 200)}, FileText))}
        {!current?.entries?.some(entry => entry.type !== 'link') ? <p>No matching files or folders.</p> : null}
        {current?.limited ? <p>Results are limited. Use a more specific file name.</p> : null}
      </> : <>
        {threads.map(thread => choice({kind: 'comment', id: thread.id, rootVersion: current.rootVersion, label: `${thread.path} · Lines ${thread.start_line}–${thread.end_line}`.slice(0, 200)}, MessageSquare, (thread.body || thread.quote || 'Comment').slice(0, 160)))}
        {!threads.length ? <p>No matching comments on this page.</p> : null}
        {offset || current?.next_offset != null ? <div className="todo-resource-pagination"><Button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button><Button disabled={current?.next_offset == null} onClick={() => setOffset(current.next_offset)}>Next</Button></div> : null}
      </>}
    </div>
  </section>;
}

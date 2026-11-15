import {beginContextDrag,endWorkspaceContextDrag} from '../lib/workspace-context-drop.js';
import { useEffect, useRef, useState } from 'react';
import { Archive, ArrowRight, NotebookPen, Download, ExternalLink, FileText, FolderKanban, GitBranch, Route, Link, MessageSquareText, Paperclip, Pencil, Plus, RotateCcw, X } from '../components/icons.jsx';
import { Button, Dialog, Empty, ErrorMessage, Field, IconButton, SearchField, Select, useApp, useAsync } from '../ui.jsx';
import { apiRequest } from '../data/api.js';
import { relative, visible } from '../lib/model.js';
import './team-resources.css';
import { ServiceLogo } from '../components/ServiceLogo.jsx';
import { pageHash } from '../lib/navigation.js';
import { readableResource } from '../lib/reader-content.js';
import { TodoResourcePicker } from '../components/TodoResourcePicker.jsx';
import { isLocalProduct } from '../lib/local-product.js';
import { isTodoResourceDrop, todoDropSource } from '../lib/todo-resource-drop.js';
import { openTodoResource } from '../lib/open-todo-resource.js';
import { requestUpdateNavigation, useUnsavedUpdate } from '../components/UnsavedUpdates.jsx';

const KINDS = { file: 'File', url: 'Web link', route: 'Route', project: 'Project', chat: 'Chat', document: 'Document', branch: 'GitHub branch', reference: 'Workspace reference' };
const ICONS = { file: Paperclip, url: Link, route: Route, project: FolderKanban, chat: MessageSquareText, document: NotebookPen, branch: GitBranch };
const REFERENCES = { route: ['tasks', 'tasks'], project: ['projects', 'projects'], chat: ['chats', 'chats'], document: ['documents', 'documents'] };
const FILE_LIMIT = 25 * 1024 * 1024;
const bytesLabel = size => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
const resourcePath = (team, id = '') => `/api/team-resources${id ? `/${encodeURIComponent(id)}` : ''}?workspace_id=${encodeURIComponent(team.workspace_id)}&team_id=${encodeURIComponent(team.id)}`;
const contentPath = (team, item, preview = false) => `/api/team-resources/${encodeURIComponent(item.id)}/content?workspace_id=${encodeURIComponent(team.workspace_id)}&team_id=${encodeURIComponent(team.id)}${preview ? '&preview=1' : ''}`;
const referenceFor = item => {
  try { return item?.kind === 'reference' ? JSON.parse(item.ref_id) : null; }
  catch { return null; }
};

function ResourceIcon({ item }) {
  const Icon = ICONS[item.kind] || FileText;
  return <span className="team-resource-symbol">{item.url ? <ServiceLogo url={item.url} /> : <Icon />}</span>;
}

function ResourceStorage({ remaining, capacity }) {
  return <div className="team-resources-storage">
    <meter aria-label="Workspace resource storage remaining" aria-valuetext={`${bytesLabel(remaining)} left of ${bytesLabel(capacity)}`} min={0} max={capacity} value={remaining} />
    <span>{bytesLabel(remaining)} left</span>
  </div>;
}

export function TeamResources({ team, compact = false, onViewAll }) {
  const { data, page, navigate, notify } = useApp();
  const [state, setState] = useState({ items: [], loading: true, error: null, storage_bytes: 0 });
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [archived, setArchived] = useState(false);
  const [editor, setEditor] = useState(null);
  const [selection, setSelection] = useState(null);
  const [archive, setArchive] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const mutate = useAsync();
  const openedResource = useRef(null);
  useEffect(() => {
    if (compact || state.scope !== team.workspace_id + ':' + team.id || state.loading || state.error || !page.resourceId || openedResource.current === page.resourceId) return;
    openedResource.current = page.resourceId;
    const item = state.items.find(item => item.id === page.resourceId && !item.archived_at);
    if (item) open(item);
    else notify('This resource is no longer available in this Area.');
  }, [compact, state.loading, state.error, state.items, page.resourceId]);
  useEffect(() => {
    const controller = new AbortController();
    setState(current => ({ ...current, loading: true, error: null }));
    apiRequest(resourcePath(team), { signal: controller.signal }).then(({ result }) => setState({ ...result, scope:team.workspace_id + ':' + team.id, loading: false, error: null })).catch(error => { if (!controller.signal.aborted) setState(current => ({ ...current, loading: false, error })); });
    return () => controller.abort();
  }, [team.id, team.workspace_id, reload]);
  const items = state.items.filter(item => Boolean(item.archived_at) === archived && (filter === 'all' || item.kind === filter || filter === 'media' && /^(image|video|audio)\//.test(item.mime_type || '')) && `${item.name} ${item.description} ${item.file_name || ''} ${item.url || ''}`.toLowerCase().includes(query.toLowerCase()));
  function saved(item) {
    setState(current => ({ ...current, items: [item, ...current.items.filter(resource => resource.id !== item.id)] }));
    setReload(value => value + 1); setEditor(null);
  }
  function open(item) {
    if (item.kind === 'reference') {
      const reference = referenceFor(item);
      if (!reference) { notify('This workspace reference is unavailable.', 'error'); return; }
      requestUpdateNavigation(() => openTodoResource(reference, {workspaceId:team.workspace_id,navigate,notify,setError:error=>notify(error.message,'error')}));
      return;
    }
    if (REFERENCES[item.kind]) {
      const [collection, view] = REFERENCES[item.kind];
      if (!visible(data[collection]).some(record => record.id === item.ref_id)) { notify('This linked item has been archived or removed. You can edit this resource to select another item.'); return; }
      if (item.kind === 'document') navigate('reader', `document:${item.ref_id}`, { returnTo: pageHash(page.view, page.id, page) });
      else navigate(view, item.ref_id);
      return;
    }
    if (readableResource(item)) { navigate('reader', `resource:${team.id}:${item.id}`, { returnTo: pageHash(page.view, page.id, page) }); return; }
    setSelection(item);
  }
  async function archiveResource(item, enabled) {
    await mutate.execute(async () => {
      const { result } = await apiRequest(`/api/team-resources/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: { workspace_id: team.workspace_id, team_id: team.id, version: item.version, archived_at: enabled ? true : null } });
      saved(result); setArchive(null);
      notify(enabled ? `Archived: ${item.name}` : 'Resource restored', 'success', enabled ? async () => {
        await apiRequest(`/api/team-resources/${encodeURIComponent(result.id)}`, { method: 'PATCH', body: { workspace_id: team.workspace_id, team_id: team.id, version: result.version, archived_at: null } });
        setReload(value => value + 1);
      } : undefined);
    });
  }
  async function deleteResource(item) {
    await mutate.execute(async () => {
      await apiRequest(`/api/team-resources/${encodeURIComponent(item.id)}`, { method: 'DELETE', body: { workspace_id: team.workspace_id, team_id: team.id, version: item.version, confirmed: true } });
      setState(current => ({ ...current, items: current.items.filter(resource => resource.id !== item.id) }));
      setReload(value => value + 1); setDeleting(null); notify('Resource permanently deleted. Its uploaded file cannot be restored.');
    });
  }
  const shown = compact ? items.slice(0, 5) : items;
  return <section className={`team-resources ${compact ? 'is-compact' : ''}`} aria-label="Area resources">
    {compact ? <div className="section-heading"><h2>Area resources</h2><button className="text-button" onClick={() => setEditor({})}><Plus />Add resource</button></div> : <>
      <div className="team-resources-intro"><div><h2>The context your Area works with</h2><p>Files, useful links, branches, and connected Frondose work, together in one place.</p></div><Button variant="primary" icon={Plus} onClick={() => setEditor({})}>Add resource</Button></div>
      <div className="space-section-toolbar"><SearchField value={query} onChange={setQuery} placeholder="Search resources…" /><Select aria-label="Resource type" value={filter} onChange={setFilter}><option value="all">All types</option><option value="media">Images, video & audio</option>{Object.entries(KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><Select aria-label="Resource visibility" value={archived ? 'archived' : 'active'} onChange={value => setArchived(value === 'archived')}><option value="active">Active resources</option><option value="archived">Archived resources</option></Select><span className="toolbar-count">{items.length} resources</span></div>
    </>}
    {state.loading && !state.items.length ? <p className="team-resources-loading" role="status">Loading resources…</p> : null}
    <ErrorMessage error={state.error || mutate.error} />
    {state.error ? <Button icon={RotateCcw} onClick={() => setReload(value => value + 1)}>Try again</Button> : null}
    {shown.length ? <div className="team-resource-list">{shown.map(item => <article className="team-resource-row" key={item.id} draggable={!item.archived_at} onDragStart={event=>{if(event.target.closest('input,textarea,select')){event.preventDefault();return;}beginContextDrag(event.dataTransfer,team.workspace_id,{kind:'area-resource',id:item.id,teamId:team.id});}} onDragEnd={endWorkspaceContextDrag}>
      <button className="team-resource-main" onClick={() => open(item)} disabled={Boolean(item.archived_at)}><ResourceIcon key={item.url || item.kind} item={item} /><span><strong>{item.name}</strong><small>{item.description || item.file_name || item.url || `Connected ${KINDS[item.kind].toLowerCase()}`}</small></span></button>
      <div className="team-resource-meta"><span>{KINDS[item.kind]}{item.byte_size ? ` · ${bytesLabel(item.byte_size)}` : ''}</span>{!compact ? <time dateTime={item.updated_at}>{relative(item.updated_at)}</time> : null}</div>
      <div className="team-resource-actions">{item.archived_at ? <><IconButton label={`Restore ${item.name}`} disabled={mutate.busy} onClick={() => archiveResource(item, false)}><RotateCcw /></IconButton><IconButton label={`Delete ${item.name} permanently`} disabled={mutate.busy} onClick={() => { mutate.setError(null); setDeleting(item); }}><X /></IconButton></> : <><IconButton label={`Edit ${item.name}`} onClick={() => setEditor(item)}><Pencil /></IconButton><IconButton label={`Archive ${item.name}`} onClick={() => { mutate.setError(null); setArchive(item); }}><Archive /></IconButton></>}</div>
    </article>)}</div> : !state.loading && !state.error ? compact ? <p className="space-inline-empty">Keep your Area’s files, links, GitHub branches, and Frondose work close at hand. Add a resource to get started.</p> : <Empty compact kind={query || filter !== 'all' ? 'search' : 'resources'} icon={Paperclip} title={query || filter !== 'all' ? 'No matching resources' : archived ? 'No archived resources' : 'Keep useful context within reach'} description={query || filter !== 'all' ? 'Try another search or resource type.' : archived ? 'Resources you archive stay here with their files so they can be restored.' : 'Upload a file, add a useful link, or connect a Route, document, project, chat, or GitHub branch.'} action={query || filter !== 'all' ? 'Clear filters' : archived ? 'Show active resources' : 'Add resource'} onAction={() => query || filter !== 'all' ? (setQuery(''), setFilter('all')) : archived ? setArchived(false) : setEditor({})} /> : null}
    {compact ? <button className="text-button space-view-all" onClick={onViewAll}>All resources <ArrowRight /></button> : state.limits && !state.error ? <ResourceStorage remaining={Math.max(0, state.limits.workspaceBytes - state.storage_bytes)} capacity={state.limits.workspaceBytes} /> : null}
    {editor ? <ResourceEditor team={team} item={editor.id ? editor : null} onClose={() => setEditor(null)} onSaved={saved} /> : null}
    {selection ? <ResourcePreview team={team} item={selection} onClose={() => setSelection(null)} onEdit={() => { setEditor(selection); setSelection(null); }} /> : null}
    {archive ? <Dialog title="Archive resource?" subtitle="Its file and details will be kept, and you can restore it at any time from Archived resources." onClose={() => !mutate.busy && setArchive(null)}><div className="team-resource-confirm"><strong>{archive.name}</strong><ErrorMessage error={mutate.error} /></div><footer className="dialog-footer"><Button onClick={() => setArchive(null)} disabled={mutate.busy}>Cancel</Button><Button variant="primary" icon={Archive} busy={mutate.busy} onClick={() => archiveResource(archive, true)}>Archive resource</Button></footer></Dialog> : null}
    {deleting ? <Dialog title="Delete resource permanently?" subtitle="The resource and its uploaded file will be permanently removed. This cannot be undone. Linked websites and Frondose items will not be deleted." onClose={() => !mutate.busy && setDeleting(null)}><div className="team-resource-confirm"><strong>{deleting.name}</strong><ErrorMessage error={mutate.error} /></div><footer className="dialog-footer"><Button disabled={mutate.busy} onClick={() => setDeleting(null)}>Keep resource</Button><Button variant="danger" busy={mutate.busy} onClick={() => deleteResource(deleting)}>Delete permanently</Button></footer></Dialog> : null}
  </section>;
}

function ResourceEditor({ team, item, onClose, onSaved }) {
  const { data, notify } = useApp();
  const [kind, setKind] = useState(item?.kind ?? 'file');
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [url, setUrl] = useState(item?.url ?? '');
  const [refId, setRefId] = useState(item?.ref_id ?? '');
  const [file, setFile] = useState(null);
  const [reference, setReference] = useState(() => referenceFor(item));
  const [picking, setPicking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const input = useRef(null);
  const request = useAsync();
  const dirty = Boolean(file || (!item && reference)) || kind !== (item?.kind ?? 'file') || name !== (item?.name ?? '') || description !== (item?.description ?? '') || url !== (item?.url ?? '') || refId !== (item?.ref_id ?? '');
  useUnsavedUpdate(dirty,request.busy);
  function close() { if (request.busy) return; if (dirty) setDiscarding(true); else onClose(); }
  function chooseFiles(files) {
    request.setError(null);
    if (files.length !== 1) { request.setError(new Error('Choose one file per resource.')); return; }
    const selected = files[0];
    if (!selected.size || selected.size > FILE_LIMIT) { request.setError(new Error('Choose a non-empty file of at most 25 MB.')); return; }
    setFile(selected); if (!name) setName(selected.name.slice(0, 160));
  }
  function chooseReference(resource) {
    setReference(resource); setPicking(false); request.setError(null);
    if (!name) setName(resource.label.slice(0,160));
  }
  function dropReference(event) {
    if (!isTodoResourceDrop(event.dataTransfer)) return;
    event.preventDefault(); event.stopPropagation();
    if (request.busy) return;
    try {
      const [value, extra] = todoDropSource(event.dataTransfer,team.workspace_id);
      if (!value || extra) throw Error('Drop one resource at a time.');
      if (value.kind === 'pending-upload') {
        if (!value.file.size || value.file.size > FILE_LIMIT) throw Error('Choose a non-empty file of at most 25 MB.');
        setKind('file'); setReference(null); chooseFiles([value.file]);
      } else chooseReference(value);
    } catch (error) { request.setError(error); }
  }
  const options = REFERENCES[kind] ? visible(data[REFERENCES[kind][0]]).filter(record => record.workspace_id === team.workspace_id).toSorted((a, b) => (a.name || a.title).localeCompare(b.name || b.title)) : [];
  async function submit(event) {
    event.preventDefault();
    await request.execute(async () => {
      if (!name.trim()) throw new Error('Give this resource a name.');
      if (kind === 'file' && !item && !file) throw new Error('Choose a file to upload.');
      const body = { workspace_id: team.workspace_id, team_id: team.id, kind, name, description, url, ref_id: refId, ...(item ? { version: item.version } : {}) };
      if (kind === 'reference' && !item) {
        if (!reference) throw Error('Choose a workspace reference or enter a text note.');
        body.reference = reference;
      }
      if (file && kind === 'file') body.file = { name: file.name, data_base64: await fileBase64(file) };
      const { result } = await apiRequest(`/api/team-resources${item ? `/${encodeURIComponent(item.id)}` : ''}`, { method: item ? 'PATCH' : 'POST', body, timeoutMs: 60_000 });
      notify(item ? 'Resource updated' : 'Resource added'); onSaved(result);
    });
  }
  return <Dialog title={item ? 'Edit resource' : 'Add Area resource'} subtitle={`Keep useful context connected to ${team.name}.`} onClose={close} className="team-resource-editor">
    <form onSubmit={submit} className="team-resource-form" noValidate>
      <Field label="Resource type"><Select value={kind} disabled={Boolean(item) || request.busy} onChange={value => { setKind(value); setRefId(''); setFile(null); setReference(null); setPicking(false); request.setError(null); }}>{Object.entries(KINDS).filter(([value])=>value!=='reference'||isLocalProduct(data)||item?.kind==='reference').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
      {kind === 'reference' ? item ? <p>{reference?.label || 'Reference unavailable'}</p> : <>
        <div className="team-resource-dropzone" onDragOver={event=>{if(isTodoResourceDrop(event.dataTransfer))event.preventDefault();}} onDrop={dropReference}>
          <Link/><strong>{reference?.label || 'Drop a workspace resource'}</strong>
          <span>Files, links, text, comments, to-dos or open tabs</span>
          <Button disabled={request.busy} aria-expanded={picking} onClick={()=>setPicking(value=>!value)}>Browse workspace</Button>
        </div>
        {picking ? <TodoResourcePicker workspaceId={team.workspace_id} data={data} resources={reference ? [reference] : []} membership={{area_scope:'selected',team_ids:[team.id]}} onAdd={chooseReference} onClose={()=>setPicking(false)}/> : null}
        <Field label="Text note"><textarea value={reference?.kind==='note' ? reference.text : ''} disabled={request.busy} maxLength={4000} rows={2} data-field-defaults-exclude="true" onChange={event=>{const value=event.target.value;setReference(value ? {kind:'note',text:value,label:value.trim().slice(0,100)||'Text reference'} : null);}}/></Field>
      </> : null}
      {kind === 'file' ? item ? <p className="team-resource-file-note"><Paperclip />{item.file_name} · {bytesLabel(item.byte_size)}<small>Add another resource to upload a new version.</small></p> : <div className={`team-resource-dropzone ${dragging ? 'is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!request.busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!request.busy) chooseFiles(event.dataTransfer.files); }}>
        <Paperclip /><strong>{file ? file.name : 'Drop a file here'}</strong><span>{file ? bytesLabel(file.size) : 'Images, video, audio, documents, and other files · up to 25 MB'}</span><Button disabled={request.busy} onClick={() => input.current?.click()}>{file ? 'Choose another file' : 'Browse files'}</Button><input ref={input} type="file" hidden onChange={event => { if (event.target.files.length) chooseFiles(event.target.files); event.target.value = ''; }} />
      </div> : null}
      {kind === 'url' || kind === 'branch' ? <Field label={kind === 'branch' ? 'GitHub branch URL' : 'Website URL'} hint={kind === 'branch' ? 'A link to an existing branch. Frondose does not create or connect the repository.' : 'Use a full http:// or https:// address. Its website icon is loaded from that origin.'}><input type="url" value={url} maxLength={2048} placeholder={kind === 'branch' ? 'https://github.com/owner/repo/tree/main' : 'https://example.com/resource'} onChange={event => setUrl(event.target.value)} disabled={request.busy} /></Field> : null}
      {REFERENCES[kind] ? <Field label={`Choose ${KINDS[kind].toLowerCase()}`} hint={!options.length ? `Create a ${KINDS[kind].toLowerCase()} in this workspace first.` : 'A resource links to the original item; it does not duplicate its content.'}><Select value={refId} onChange={value => { setRefId(value); if (!name) { const chosen = options.find(record => record.id === value); setName(chosen?.name || chosen?.title || ''); } }} disabled={request.busy}><option value="">Select {KINDS[kind].toLowerCase()}…</option>{options.map(record => <option key={record.id} value={record.id}>{record.name || record.title}</option>)}</Select></Field> : null}
      <Field label="Name"><input data-field-default-key="area-resource.new.name" data-field-default-page="Add Area resource" data-field-default-label="Name" data-field-default-mode={item ? 'edit' : 'create'} value={name} maxLength={160} onChange={event => setName(event.target.value)} placeholder="A clear name for this resource" disabled={request.busy} /></Field>
      <Field label="Description" hint="Optional. Explain when the Area should use this resource."><textarea data-field-default-key="area-resource.new.description" data-field-default-page="Add Area resource" data-field-default-label="Description" data-field-default-mode={item ? 'edit' : 'create'} value={description} maxLength={2000} rows={3} onChange={event => setDescription(event.target.value)} disabled={request.busy} /></Field>
      <ErrorMessage error={request.error} /><footer className="dialog-footer"><Button disabled={request.busy} onClick={close}>Cancel</Button><Button type="submit" variant="primary" busy={request.busy} disabled={!name.trim() || Boolean(REFERENCES[kind] && !refId)}>{request.busy && file ? 'Uploading…' : item ? 'Save changes' : 'Add resource'}</Button></footer>
    </form>
    {discarding ? <Dialog title="Discard resource changes?" subtitle="Your unsaved changes will be lost. Uploaded resources already saved to the Area are not affected." onClose={() => setDiscarding(false)}><footer className="dialog-footer"><Button onClick={() => setDiscarding(false)}>Keep editing</Button><Button variant="primary" onClick={onClose}>Discard changes</Button></footer></Dialog> : null}
  </Dialog>;
}

function ResourcePreview({ team, item, onClose, onEdit }) {
  const [failed, setFailed] = useState(false);
  const image = item.mime_type?.startsWith('image/');
  const video = item.mime_type?.startsWith('video/');
  const audio = item.mime_type?.startsWith('audio/');
  const preview = contentPath(team, item, true);
  return <Dialog title={item.name} subtitle={item.description || `${KINDS[item.kind]}${item.byte_size ? ` · ${bytesLabel(item.byte_size)}` : ''}`} wide={image || video} onClose={onClose} className="team-resource-preview">
    <div className="team-resource-preview-body">{item.kind === 'file' ? failed ? <ErrorMessage error="This media cannot be previewed by your browser. You can still download the original file." /> : image ? <img src={preview} alt={item.name} onError={() => setFailed(true)} /> : video ? <video src={preview} controls preload="metadata" onError={() => setFailed(true)} /> : audio ? <audio src={preview} controls preload="metadata" onError={() => setFailed(true)} /> : <div className="team-resource-download-state"><FileText /><strong>{item.file_name}</strong><p>This file is available to download. Documents and executable formats are not opened inside Frondose.</p></div> : <div className="team-resource-link-preview"><ResourceIcon key={item.url || item.kind} item={item} /><span>{item.url}</span><p>Opens the original website in a new tab. This resource is a link, not a connected integration.</p></div>}</div>
    <footer className="dialog-footer"><Button icon={Pencil} onClick={onEdit}>Edit details</Button>{item.kind === 'file' ? <a className="button primary" href={contentPath(team, item)} download={item.file_name}><Download />Download file</a> : <a className="button primary" href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink />Open {item.kind === 'branch' ? 'branch' : 'website'}</a>}</footer>
  </Dialog>;
}

function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = () => reject(new Error('This file could not be read. Choose it again.'));
    reader.readAsDataURL(file);
  });
}

import {requestUpdateNavigation} from '../UnsavedUpdates.jsx';
import { forwardRef, lazy, Suspense, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { richPreviewType } from '../../lib/rich-previews.js';
const RichFilePreview = lazy(() => import('./RichFilePreview.jsx').then(m => ({ default: m.RichFilePreview })));
import {FileIcon} from '../FileIcon.jsx';
import { BookOpen, Check, ChevronDown, ChevronRight, Code, FileText, Folder, FolderOpen, RotateCw, Search, CircleAlert } from '../icons.jsx';
import { Button, Dialog, Field, IconButton, Select, useApp } from '../../ui.jsx';
import { Form } from '../Form.jsx';
import { apiRequest } from '../../data/api.js';
import { frondoseActions } from '../../data/useFrondose.js';
import { workbenchRequest } from '../../lib/workbench.js';
import { useInterfaceLanguage } from '../InterfaceLanguage.jsx';
import { interfaceText } from '../../lib/interface-language.js';
import { acceptDirectorySave, createDirectoryDraft, directoryApiPath, directoryDraftDirty, discardDirectoryDraft } from '../../lib/directory-drafts.js';
import { beginContextDrag, endWorkspaceContextDrag, selectedFileContext } from '../../lib/workspace-context-drop.js';
import { continueMarkdownList, formatMarkdown } from '../../lib/markdown-editing.js';
import { EditorSelectionTools } from './EditorSelectionTools.jsx';
import { ExplorerFileSections } from './ExplorerFileSections.jsx';
import { ReviewedSourceEditor } from './ReviewedSourceEditor.jsx';
import { EditorViewSelector, FileBlame, RecentFileChanges, useEditorRepository } from './EditorChanges.jsx';
import { editorObservationKey, observeEditorContent } from '../../lib/editor-changes.js';
import { MarkdownReviewNotes } from './MarkdownReviewNotes.jsx';
import { useExternalFileSync } from './useExternalFileSync.js';
import { ExternalFileState } from './ExternalFileState.jsx';
import './directory-files.css';
import {Collapse} from '../Collapse.jsx';

const emptyMap = () => new Map();
const folderName = path => path?.split(/[\\/]/).filter(Boolean).at(-1) || 'Workspace';

export function DirectoryBindingDialog({ workspaceId, current, onClose, onBound }) {
  const app = useApp();
  const language=useInterfaceLanguage();
  const initial = current?.binding || null;
  const initialProjects = current?.projects || (app?.data.projects || []).filter(project => project.workspace_id === workspaceId && !project.archived_at).map(project => ({ id: project.id, name: project.name, path: project.local_path || null }));
  const [inventory, setInventory] = useState(() => current || { projects: initialProjects, binding: null });
  const [projectId, setProjectId] = useState(initial?.projectId || (initialProjects.length === 1 ? initialProjects[0].id : ''));
  const [path, setPath] = useState(initial?.path || '');
  const [createProject, setCreateProject] = useState(initialProjects.length === 0);
  const [name, setName] = useState(app?.workspace?.name || 'Project');
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(null);
  const [stopTarget,setStopTarget]=useState(null);
  const active = useRef(true), createdProject = useRef(null), requestLock = useRef(false);
  async function refreshBlockers() {
    const {result}=await apiRequest(directoryApiPath(workspaceId));
    if(active.current)setInventory(previous=>({...previous,blockers:result.blockers}));
    return result.blockers;
  }
  async function stopBlockingTerminal() {
    if(!stopTarget||requestLock.current)return;
    requestLock.current=true;setBusy(true);setError(null);
    try{
      const scope=stopTarget.scope==='workspace'?{workspaceId,host:'workspace'}:{workspaceId,projectId:stopTarget.projectId};
      await workbenchRequest(scope,`terminals/${stopTarget.id}/stop`,{method:'POST'});
      const id=stopTarget.id;
      if(active.current)setStopTarget(null);
      for(let retry=0;retry<5&&active.current;retry++){
        const blockers=await refreshBlockers();
        if(!blockers?.terminals?.some(row=>row.id===id))break;
        await new Promise(resolve=>setTimeout(resolve,300));
      }
    }catch(cause){if(active.current)setError(cause);}
    finally{requestLock.current=false;if(active.current)setBusy(false);}
  }
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    apiRequest(directoryApiPath(workspaceId), { signal: controller.signal }).then(({ result }) => {
      if (!active.current) return;
      setInventory(result); setLoading(false);
      if (result.binding) { setProjectId(result.binding.projectId); setPath(result.binding.path); setCreateProject(false); }
      else if (result.projects.length > 0) { if (result.projects.length === 1) setProjectId(result.projects[0].id); setCreateProject(false); }
      else if (!result.projects.length) setCreateProject(true);
    }).catch(cause => { if (!controller.signal.aborted && active.current) { setError(cause); setLoading(false); } });
    return () => { active.current = false; controller.abort(); };
  }, [workspaceId]);
  const chooseDirectory = async () => {
    if (requestLock.current) return;
    requestLock.current = true; setBusy(true); setError(null);
    try {
      const selected = await globalThis.frondoseDesktop.chooseDirectory();
      if (active.current && !selected?.cancelled && selected?.path) { setPath(selected.path); setConfirmed(false); }
    } catch (cause) { if (active.current) setError(cause); }
    finally { requestLock.current = false; if (active.current) setBusy(false); }
  };
  const submit = async event => {
    event.preventDefault();
    if (requestLock.current) return;
    requestLock.current = true; setBusy(true); setError(null);
    try {
      if (!confirmed || !path.trim()) throw Error('Choose and confirm the project directory.');
      let selectedId = projectId;
      if (createProject) {
        if (!name.trim()) throw Error('Enter a project name.');
        // Reuse a successfully created record if the following binding failed.
        const project = createdProject.current || await frondoseActions.createProject({ workspace_id: workspaceId, name: name.trim(), status: 'planned' });
        createdProject.current = project;
        selectedId = project.id;
        if (active.current) { setProjectId(project.id); setCreateProject(false); setInventory(value => ({ ...value, projects: [...value.projects.filter(row => row.id !== project.id), { id: project.id, name: project.name, path: null }] })); }
      }
      if (!selectedId) throw Error('Choose an existing project or create one.');
      const { result } = await apiRequest(directoryApiPath(workspaceId), { method: 'PUT', body: { workspace_id: workspaceId, project_id: selectedId, path, confirmed: true, expected_version: inventory?.binding?.version || null } });
      await frondoseActions.refresh().catch(() => {});
      if (active.current) onBound?.(result);
    } catch (cause) {
      if(active.current)setError(cause);
      if(cause.code==='directory_conflict')await refreshBlockers().catch(()=>{});
    }
    finally { requestLock.current = false; if (active.current) setBusy(false); }
  };
  const blockers=inventory.blockers;
  return <><Dialog title="Workspace directory" onClose={onClose} closeDisabled={busy} className="directory-binding-dialog">
    <Form onSubmit={submit}>
      <div className="directory-binding-body">
        <p>Link one project directory. Existing records and folders stay where they are.</p>
        {loading ? <p role="status">Checking the current directory…</p> : null}
        {!createProject ? <Field label="Project"><Select value={projectId} onChange={id => { setProjectId(id); setPath(inventory.projects.find(project => project.id === id)?.path || ''); setConfirmed(false); }} disabled={busy || loading}><option value="">Choose a project</option>{inventory.projects?.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</Select></Field> : <Field label="Project name"><input value={name} maxLength={200} onChange={event => setName(event.target.value)} disabled={busy || loading} /></Field>}
        {inventory.projects?.length > 0 && !createdProject.current ? <button className="text-button" type="button" disabled={busy || loading} onClick={() => { setCreateProject(value => !value); setConfirmed(false); }}>{createProject ? 'Use an existing project' : 'Create a project for this directory'}</button> : null}
        <Field label="Directory"><input value={path} onChange={event => { setPath(event.target.value); setConfirmed(false); }} disabled={busy || loading} placeholder="Absolute path to your project folder" spellCheck={false} autoComplete="off" data-field-defaults-exclude="true" /></Field>
        {globalThis.frondoseDesktop?.chooseDirectory ? <Button icon={FolderOpen} disabled={busy || loading} onClick={chooseDirectory}>Choose directory</Button> : <p className="directory-platform-note">Enter the folder’s full path. The desktop app also provides a system folder picker.</p>}
        <label className="directory-confirm"><input type="checkbox" checked={confirmed} disabled={busy || loading} onChange={event => setConfirmed(event.target.checked)} />Use this directory for this workspace</label>
        {error ? <p className="directory-error" role="alert">{error.code==='directory_conflict'?interfaceText(error.message,language):error.message}</p> : null}
        {blockers?.terminals?.length||blockers?.other?<section className="directory-blockers" aria-label="Work still using this directory">
          <strong>Work still using this directory</strong>
          <p>Closing a terminal tab can leave the terminal running. Stop only the terminal you no longer need before linking a different directory.</p>
          {blockers.terminals.map(terminal=><div key={terminal.id}><span>{terminal.name}</span><Button disabled={busy||terminal.status==='stopping'} onClick={()=>{setStopTarget(terminal);setError(null);}}>{terminal.status==='stopping'?'Stopping…':'Stop terminal'}</Button></div>)}
          {blockers.other?<p>Another session or pending start is using this workspace. Check your active work, then refresh.</p>:null}
          <Button disabled={busy} onClick={()=>void refreshBlockers().then(()=>setError(null)).catch(setError)}>Refresh active work</Button>
        </section>:null}
      </div>
      <footer className="dialog-actions"><Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" busy={busy} disabled={loading || !confirmed || !path.trim() || (!createProject && !projectId)}>Link directory</Button></footer>
    </Form>
  </Dialog>{stopTarget?<Dialog title="Stop this terminal?" onClose={()=>setStopTarget(null)} closeDisabled={busy}><div className="directory-binding-body"><strong>{stopTarget.name}</strong><p>Stopping this terminal ends its current process. Unfinished work in that process may be lost.</p>{error?<p role="alert">{error.message}</p>:null}</div><footer className="dialog-actions"><Button disabled={busy} onClick={()=>setStopTarget(null)}>Cancel</Button><Button variant="danger" busy={busy} onClick={stopBlockingTerminal}>Stop terminal</Button></footer></Dialog>:null}</>;
}

export function DirectoryExplorer({ workspaceId, binding, onOpenFile, onBind, editors, currentFile, onOpenEditor, onJumpToLine }) {
  const [trees, setTrees] = useState({}), [expanded, setExpanded] = useState(() => new Set());
  const [query, setQuery] = useState(''), [mode, setMode] = useState('names'), [matches, setMatches] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [revision, setRevision] = useState(0);
  const requests = useRef(new Map()), generation = useRef(0), alive = useRef(true), switcher = useRef(null);
  const currentScope = `${workspaceId}:${binding?.version || ''}`;
  const scope = useRef(currentScope); scope.current = currentScope;
  const loadDirectory = useCallback(async path => {
    const controller = new AbortController(), expectedScope = scope.current, epoch = generation.current;
    requests.current.get(path)?.abort(); requests.current.set(path, controller);
    try {
      const { result } = await apiRequest(directoryApiPath(workspaceId, 'tree', { path }), { signal: controller.signal });
      if (alive.current && !controller.signal.aborted && expectedScope === scope.current && epoch === generation.current) { setTrees(previous => ({ ...previous, [path]: result })); setError(null); }
    } catch (cause) { if (alive.current && !controller.signal.aborted && expectedScope === scope.current && epoch === generation.current) setError(cause); }
    finally { if (requests.current.get(path) === controller) requests.current.delete(path); }
  }, [workspaceId]);
  useEffect(() => {
    alive.current = true; generation.current++;
    for (const controller of requests.current.values()) controller.abort(); requests.current.clear();
    setTrees({}); setExpanded(new Set()); setError(null);
    if (binding) void loadDirectory('');
    return () => { alive.current = false; for (const controller of requests.current.values()) controller.abort(); requests.current.clear(); };
  }, [workspaceId, binding?.version, revision, loadDirectory]);
  useEffect(() => {
    if (!binding || !query.trim()) { setMatches(null); setBusy(false); return; }
    const controller = new AbortController(); const expectedScope = currentScope;
    setBusy(true); setMatches(null); setError(null);
    const timer = setTimeout(() => {
      apiRequest(directoryApiPath(workspaceId, 'search', { q: query.trim(), mode }), { signal: controller.signal }).then(({ result }) => { if (alive.current && !controller.signal.aborted && scope.current === expectedScope) setMatches(result); }).catch(cause => { if (alive.current && !controller.signal.aborted) setError(cause); }).finally(() => { if (alive.current && !controller.signal.aborted) setBusy(false); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [workspaceId, currentScope, Boolean(binding), query, mode, revision]);
  const toggleDirectory = path => {
    setExpanded(previous => { const next = new Set(previous); if (next.has(path)) next.delete(path); else next.add(path); return next; });
    if (!trees[path]) void loadDirectory(path);
  };
  const revealDirectory = path => {
    const parts = path.split('/'), ancestors = parts.map((_, index) => parts.slice(0, index + 1).join('/'));
    setQuery(''); setExpanded(previous => new Set([...previous, ...ancestors]));
    for (const ancestor of ancestors) if (!trees[ancestor]) void loadDirectory(ancestor);
  };
  const fileDrag = entry => ({ draggable: entry.type === 'file', onDragStart: event => { if (entry.type !== 'file' || !beginContextDrag(event.dataTransfer, workspaceId, { kind: 'file', path: entry.path, rootVersion: binding?.version })) event.preventDefault(); }, onDragEnd: endWorkspaceContextDrag });
  const rows = (path = '', depth = 0) => (trees[path]?.entries || []).map(entry => <li key={entry.path}>
    <button type="button" {...fileDrag(entry)} className="directory-tree-row" style={{ '--file-depth': depth }} disabled={entry.type === 'link'} title={entry.type === 'link' ? 'Symbolic links are not opened through this file browser' : entry.path} aria-expanded={entry.type === 'directory' ? expanded.has(entry.path) : undefined} onClick={() => entry.type === 'directory' ? toggleDirectory(entry.path) : onOpenFile?.(entry.path)}>
      {entry.type === 'directory' ? <ChevronRight morphTo={expanded.has(entry.path)?ChevronDown:ChevronRight} interactive={false}/> : <span className="directory-disclosure-spacer" />}{entry.type === 'directory' ? <Folder /> : <FileIcon path={entry.path} />}<span>{entry.name}</span>
    </button>
    {entry.type === 'directory' ? <Collapse open={expanded.has(entry.path)}><ul className="directory-tree-group">{trees[entry.path] ? rows(entry.path, depth + 1) : <li className="directory-loading" role={error ? undefined : 'status'}>{error ? 'Folder unavailable' : 'Opening folder…'}</li>}{trees[entry.path]?.entries.length === 0 ? <li className="directory-loading">Empty folder</li> : null}</ul></Collapse> : null}
  </li>);
  if (!binding) return <section className="directory-unbound"><FolderOpen /><p>Choose this workspace’s project directory to browse files.</p><Button onClick={onBind}>Choose directory</Button></section>;
  return <section className="directory-explorer" aria-label={`Files in ${folderName(binding.path)}`}>
    <div className="directory-explorer-tools"><div className="directory-view-switch" role="tablist" aria-label="File search mode" ref={switcher} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const next = mode === 'names' ? 'contents' : 'names'; setMode(next); switcher.current?.querySelector(`[data-mode="${next}"]`)?.focus(); } }}>{[['names', 'Names'], ['contents', 'Contents']].map(([id, label]) => <button type="button" key={id} role="tab" data-mode={id} aria-selected={mode === id} tabIndex={mode === id ? 0 : -1} onClick={() => setMode(id)}>{label}</button>)}</div><IconButton label="Refresh files" onClick={() => setRevision(value => value + 1)}><RotateCw /></IconButton></div>
    <div className="directory-file-search"><Search /><input aria-label={mode === 'names' ? 'Find files by name' : 'Search file contents'} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={mode === 'names' ? 'Find files' : 'Find in files'} maxLength={200} data-field-defaults-exclude="true" /></div>
    {error ? <p className="directory-error" role="alert">{error.message}</p> : null}
    <div className="directory-file-results">
      {query.trim() ? busy ? <p className="directory-loading" role="status">Searching…</p> : matches ? <><ul className="directory-tree">{matches.entries.map(entry => <li key={entry.path}><button type="button" {...fileDrag(entry)} className="directory-search-result" onClick={() => entry.type === 'directory' ? revealDirectory(entry.path) : onOpenFile?.(entry.path)}>{entry.type === 'directory' ? <Folder /> : <FileIcon path={entry.path} />}<span><strong>{entry.path}</strong>{entry.snippet ? <small>Line {entry.line} · {entry.snippet}</small> : null}</span></button></li>)}</ul>{!matches.entries.length ? <p className="directory-loading">No matching files</p> : null}{matches.limited ? <p className="directory-loading">Results limited. Narrow your search.</p> : null}</> : null : trees[''] ? <><ul className="directory-tree">{rows()}</ul>{!trees[''].entries.length ? <p className="directory-loading">No visible files</p> : null}{trees[''].limited ? <p className="directory-loading">Folder listing limited to 500 entries.</p> : null}</> : <p className="directory-loading" role={error ? undefined : 'status'}>{error ? 'Files unavailable' : 'Opening files…'}</p>}
    </div>
    <ExplorerFileSections editors={editors} currentFile={currentFile} onOpenEditor={onOpenEditor} onJumpToLine={onJumpToLine}/>
  </section>;
}

export const DirectoryFileEditor = forwardRef(function DirectoryFileEditor(props, ref) {
  const [source, setSource] = useState(false);
  const draft = props.drafts?.get(props.tab.entityId);
  if (!source && !props.tab.draft && !draft?.loaded && richPreviewType(props.tab.path)) return <Suspense fallback={<p role="status">Opening preview…</p>}><RichFilePreview workspaceId={props.workspaceId} tab={props.tab} onSource={() => setSource(true)}/></Suspense>;
  return <DirectoryTextEditor {...props} ref={ref}/>;
});
const DirectoryTextEditor = forwardRef(function DirectoryTextEditor({ workspaceId, tab, onDirtyChange, onSaved, onDraftChange, drafts }, ref) {
  const editor = useRef(null), owner = useRef(null), [selectionEpoch, setSelectionEpoch] = useState(0);
  const fallbackDrafts = useRef(null); fallbackDrafts.current ||= emptyMap();
  const storage = drafts || fallbackDrafts.current, draftKey = tab.entityId || tab.id;
  const [draft, setDraft] = useState(() => createDirectoryDraft(workspaceId, tab, storage.get(draftKey)));
  const [loadRevision, setLoadRevision] = useState(0);
  const [viewMode, setViewMode] = useState('code'), [observationEpoch, setObservationEpoch] = useState(0);
  const [commentRange, setCommentRange] = useState(null);
  const repository = useEditorRepository(workspaceId, tab.rootVersion);
  const observationKey = editorObservationKey(workspaceId, tab.rootVersion, draftKey);
  useEffect(() => { if (draft.loaded && observeEditorContent(observationKey, draft.content)) setObservationEpoch(value => value + 1); }, [observationKey, draft.loaded, draft.content]);
  const [rawPreview, setRawPreview] = useState(null), [rawBusy, setRawBusy] = useState(false), rawRequest = useRef(null);
  useEffect(() => () => rawRequest.current?.abort(), []);
  // Scroll/selection are live editor state, intentionally not a React render
  // subscription. Never overwrite them with an older rendered draft snapshot.
  const state = useRef(draft);
  const attachEditor = useCallback(element => {
    editor.current = element;
    const current = state.current;
    if (!element || !current.loaded) return;
    if (current.selectionStart != null) element.setSelectionRange(current.selectionStart, current.selectionEnd ?? current.selectionStart);
    // Restore only when a code editor is mounted (or Source is reopened), never
    // during ordinary toolbar/parent/scroll-triggered renders.
    element.scrollTop = current.scrollTop || 0;
    element.scrollLeft = current.scrollLeft || 0;
  }, []);
  const alive = useRef(true), savePromise = useRef(null), dirtyReported = useRef(undefined), callback = useRef(onDirtyChange), savedCallback = useRef(onSaved);
  callback.current = onDirtyChange; savedCallback.current = onSaved;
  const draftCallback = useRef(onDraftChange); draftCallback.current = onDraftChange;
  useEffect(() => { const timer = setTimeout(() => draftCallback.current?.(), 150); return () => clearTimeout(timer); }, [draft.content, draft.loaded, draft.version]);
  const update = useCallback(change => {
    const next = typeof change === 'function' ? change(state.current) : change;
    state.current = next; storage.set(draftKey, next);
    if (alive.current) setDraft(next);
    const dirty = directoryDraftDirty(next);
    if (dirtyReported.current !== dirty) { dirtyReported.current = dirty; callback.current?.(dirty); }
    return next;
  }, [storage, draftKey]);
  useEffect(() => {
    alive.current = true; storage.set(draftKey, state.current);
    const dirty = directoryDraftDirty(state.current);
    if (dirtyReported.current !== dirty) { dirtyReported.current = dirty; callback.current?.(dirty); }
    return () => { alive.current = false; };
  }, [storage, draftKey]);
  const external = useExternalFileSync({ workspaceId, rootVersion: tab.rootVersion, draft, state, update, owner });
  useEffect(() => {
    if (state.current.loaded || state.current.isNew) return;
    const controller = new AbortController();
    apiRequest(directoryApiPath(workspaceId, 'file', { path: state.current.path, expected_binding_version: tab.rootVersion }), { signal: controller.signal }).then(({ result }) => {
      if (alive.current && !controller.signal.aborted) update(value => result.unsupported ? { ...value, unsupported: result, loaded: false, error: null } : { ...value, ...result, baseline: result.content, loaded: true, error: null, timeline: [{ version: result.version, modified_at: result.modified_at }] });
    }).catch(error => { if (alive.current && !controller.signal.aborted) update(value => ({ ...value, error })); });
    return () => controller.abort();
  }, [workspaceId, draftKey, tab.rootVersion, update, loadRevision]);
  const save = () => {
    if (savePromise.current) return savePromise.current;
    const sent = { ...state.current };
    if (!sent.loaded) return Promise.resolve(false);
    if (!directoryDraftDirty(sent)) return Promise.resolve(true);
    update(value => ({ ...value, pending: true, error: null }));
    const promise = (async () => {
      try {
        const checked = await external.beforeSave(sent);
        const result = checked.saved || (await apiRequest(directoryApiPath(workspaceId, 'file'), { method: 'PUT', body: { workspace_id: workspaceId, path: sent.path, content: sent.content, expected_version: checked.version, expected_binding_version: tab.rootVersion, confirmed: true } })).result;
        update(value => ({ ...acceptDirectorySave(value, result, sent), diskState: { status: 'current', checkedAt: Date.now() } }));
        savedCallback.current?.({ path: result.path });
        return true;
      } catch (error) { update(value => ({ ...value, error })); return false; }
      finally { update(value => ({ ...value, pending: false })); savePromise.current = null; }
    })();
    savePromise.current = promise;
    return promise;
  };
  useImperativeHandle(ref, () => ({ isDirty: () => directoryDraftDirty(state.current), isPending: () => state.current.pending || external.isApplying(), save, discard: () => update(discardDirectoryDraft), jumpToLine: line => { if (!state.current.loaded || !Number.isSafeInteger(line) || line < 1) return; setViewMode('code'); update(value => ({ ...value, mode: 'source' })); requestAnimationFrame(() => { editor.current?.jumpToLine(line); setSelectionEpoch(value => value + 1); }); } }));
  const markdown = /\.(?:md(?:own|arkdown)?|txt)$/i.test(draft.path);
  const openRaw = async () => {
    if (rawBusy) return;
    const controller = new AbortController(); rawRequest.current = controller; setRawBusy(true);
    try {
      const { result } = await apiRequest(directoryApiPath(workspaceId, 'raw-file', { path: state.current.path, expected_binding_version: tab.rootVersion }), { signal: controller.signal });
      if (!controller.signal.aborted && alive.current) { setRawPreview(result); update(value => ({ ...value, error: null })); }
    } catch (error) { if (!controller.signal.aborted && alive.current) update(value => ({ ...value, error })); }
    finally { if (!controller.signal.aborted && alive.current) setRawBusy(false); }
  };
  const applyEdit = result => {
    if (!result || state.current.pending) return;
    update(value => ({ ...value, content: result.content, selectionStart: result.start, selectionEnd: result.end, discarded: false, revision: value.revision + 1, error: null }));
    requestAnimationFrame(() => { editor.current?.focus(); editor.current?.setSelectionRange(result.start, result.end); setSelectionEpoch(value => value + 1); });
  };
  const rememberSelection = element => { const next = { ...state.current, selectionStart: element.selectionStart, selectionEnd: element.selectionEnd }; state.current = next; storage.set(draftKey, next); setSelectionEpoch(value => value + 1); };
  return <section ref={owner} className="directory-file-editor" aria-label={`File editor ${draft.path}`}>
    <header className="directory-editor-toolbar"><div className="directory-editor-identity"><FileIcon path={draft.path} />{draft.isNew ? <input aria-label="New Markdown file path" value={draft.path} disabled={draft.pending} spellCheck={false} autoComplete="off" maxLength={2048} data-field-defaults-exclude="true" onChange={event => update(value => ({ ...value, path: event.target.value, discarded: false, revision: value.revision + 1, error: null }))} /> : <strong title={draft.path}>{draft.path}</strong>}{directoryDraftDirty(draft) ? <span className="directory-dirty-mark" aria-label="Unsaved changes" /> : null}</div>
      <ExternalFileState draft={draft} state={state} sync={external} />
      <EditorViewSelector mode={viewMode} onChange={mode=>requestUpdateNavigation(()=>setViewMode(mode))} blameEnabled={Boolean(repository?.connected && !draft.isNew)} />
      {markdown && viewMode === 'code' ? <div className="directory-view-switch directory-editor-modes" role="group" aria-label="Markdown view"><button type="button" aria-pressed={draft.mode === 'source'} onClick={() => requestUpdateNavigation(()=>update(value => ({ ...value, mode: 'source' })))}><Code />Source</button><button type="button" aria-pressed={draft.mode === 'preview'} onClick={() => requestUpdateNavigation(()=>update(value => ({ ...value, mode: 'preview' })))}><BookOpen />Preview</button></div> : null}
      <Button icon={Check} busy={draft.pending} disabled={!draft.loaded || !directoryDraftDirty(draft) || external.busy || ['changed', 'readonly', 'unavailable', 'unsupported'].includes(draft.diskState?.status)} onClick={save}>Save</Button>
    </header>
    {draft.error ? <p className="directory-error directory-editor-error" role="alert">{draft.error.message} {directoryDraftDirty(draft) ? 'Your draft is still here.' : ''}</p> : null}
    {draft.unsupported ? rawPreview ? <div className="directory-raw-preview"><p role="status">Read-only raw preview · {rawPreview.preview_bytes.toLocaleString()} of {rawPreview.size.toLocaleString()} bytes{rawPreview.truncated ? ' · Truncated' : ''}. Control bytes are shown as ⟦hex⟧; unsupported encoding may display replacement characters. Saving is unavailable.</p><pre aria-label={`Read-only raw preview of ${draft.path}`}>{rawPreview.raw_preview}</pre></div> : <div className="directory-unsupported"><CircleAlert aria-hidden="true"/><p>{draft.unsupported.unsupported === 'large' ? 'This file is too large for the text editor.' : 'This file is binary or uses an unsupported text encoding.'}</p><p>Open a read-only raw preview of up to 64 KiB. The original file will not be modified.</p><Button busy={rawBusy} onClick={openRaw}>Open Anyway</Button></div> : null}
    {draft.unsupported ? null : !draft.loaded ? <div className="directory-loading" role={draft.error ? undefined : 'status'}>{draft.error ? <><p>The file could not be opened.</p><Button onClick={() => { update(value => ({ ...value, error: null })); setLoadRevision(value => value + 1); }}>Try opening again</Button></> : 'Opening file…'}</div> : viewMode === 'recent' ? <RecentFileChanges observationKey={observationKey} content={draft.content} observationEpoch={observationEpoch}/> : viewMode === 'blame' ? <FileBlame workspaceId={workspaceId} bindingVersion={tab.rootVersion} path={draft.path} repository={repository}/> : markdown && draft.mode === 'preview' ? <MarkdownReviewNotes workspaceId={workspaceId} bindingVersion={tab.rootVersion} path={draft.path} fileVersion={draft.version} content={draft.content} dirty={directoryDraftDirty(draft)}/> : <ReviewedSourceEditor workspaceId={workspaceId} bindingVersion={tab.rootVersion} fileVersion={draft.version} dirty={directoryDraftDirty(draft)} noteDraft={commentRange} onNote={range=>setCommentRange({...range,content:state.current.content,fileVersion:state.current.version})} onCloseNote={()=>setCommentRange(null)} ref={attachEditor} value={draft.content} path={draft.path} readOnly={draft.pending} onFocus={rememberSelection} onBlur={() => setSelectionEpoch(value => value + 1)} onSelection={rememberSelection} onKeyDown={(event, input) => { if (!markdown || event.isComposing || event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false; const result = continueMarkdownList(state.current.content, input.selectionStart, input.selectionEnd); if (result) { event.preventDefault(); applyEdit(result); return true; } return false; }} onDragStart={(event, input) => { const source = selectedFileContext(state.current, tab.rootVersion, input.selectionStart, input.selectionEnd); if (!source || !beginContextDrag(event.dataTransfer, workspaceId, source)) event.preventDefault(); }} onDragEnd={endWorkspaceContextDrag} onViewport={input => { const next = { ...state.current, scrollTop: input.scrollTop, scrollLeft: input.scrollLeft }; state.current = next; storage.set(draftKey, next); setSelectionEpoch(value => value + 1); }} onChange={(content, input) => update(value => ({ ...value, content, selectionStart: input.selectionStart, selectionEnd: input.selectionEnd, discarded: false, revision: value.revision + 1, error: null }))} />}
    {draft.loaded && draft.mode === 'source' && viewMode === 'code' ? <EditorSelectionTools editor={editor} owner={owner} draft={{ ...draft, selectionStart: state.current.selectionStart, selectionEnd: state.current.selectionEnd }} rootVersion={tab.rootVersion} workspaceId={workspaceId} selectionEpoch={selectionEpoch} markdown={markdown} onComment={range => requestUpdateNavigation(()=>setCommentRange({...range,content:state.current.content,fileVersion:state.current.version}))} onFormat={action => { const input = editor.current; if (input) applyEdit(formatMarkdown(state.current.content, input.selectionStart, input.selectionEnd, action)); }}/> : null}
    <footer className="directory-editor-status"><span>{draft.unsupported ? rawPreview ? 'Read-only raw preview' : 'Unsupported file' : draft.isNew ? 'New Markdown draft' : 'UTF-8'}{draft.pending ? ' · Saving…' : directoryDraftDirty(draft) ? ' · Unsaved' : draft.diskState?.status === 'changed' ? ' · Disk changed' : draft.diskState?.status === 'unavailable' ? ' · Disk unavailable' : draft.loaded ? ' · Saved' : ''}{external.recoveryError ? ' · Recovery needs attention' : ''}</span><span>{draft.unsupported ? `${(rawPreview?.size ?? draft.unsupported.size).toLocaleString()} bytes` : `${draft.content.length.toLocaleString()} characters`}</span></footer>
  </section>;
});

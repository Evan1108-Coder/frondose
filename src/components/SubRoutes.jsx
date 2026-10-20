import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, GitBranch, Link, Plus, RotateCcw, Minus as Unlink } from './icons.jsx';
import { Button, Dialog, ErrorMessage, Field, Select, useApp } from '../ui.jsx';
import { frondoseApi } from '../data/api.js';
import { refreshFrondose } from '../data/useFrondose.js';
import { PRIORITIES, STATUSES } from '../lib/model.js';
import { hierarchyCandidates, hierarchyRetryRequest, hierarchySnapshotSignature, leafProgressLabel, moveSibling } from '../lib/sub-route-ui.js';
import './sub-routes.css';

export function SubRoutes({ task }) {
  const { data, navigate, notify } = useApp();
  const [tree, setTree] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(null), [reload, setReload] = useState(0);
  const [dialog, setDialog] = useState(null), [showArchived, setShowArchived] = useState(false), [busy, setBusy] = useState(false), [pending, setPending] = useState(null);
  const sending = useRef(false), mounted = useRef(true), retry = useRef(null);
  const graphSignal = useMemo(() => hierarchySnapshotSignature(data.tasks, data.route_workflows), [data.tasks, data.route_workflows]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null);
    frondoseApi.subRoutes(task.id, task.workspace_id, { signal: controller.signal }).then(response => { if (!controller.signal.aborted) setTree(response.result); }).catch(cause => { if (!controller.signal.aborted) setError(cause); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [task.id, task.workspace_id, graphSignal, reload]);
  const caps = tree?.capabilities || {}, locked = busy || Boolean(pending) || loading;
  useEffect(() => { if (!busy && !pending) return; const warn = event => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [busy, pending]);
  const candidates = useMemo(() => hierarchyCandidates(data.tasks || [], data.route_workflows || [], tree, dialog?.mode, data.projects || []), [data.tasks, data.route_workflows, data.projects, tree, dialog?.mode]);
  async function mutate(id, action, fields = {}) {
    if (sending.current || !tree) return false;
    const request = pending || { id, action, input: { workspace_id: task.workspace_id, revision: tree.revision, ...fields } };
    sending.current = true; setBusy(true); setError(null);
    try {
      if (!pending) { retry.current = await hierarchyRetryRequest(request.input, `subroutes:${id}:${action}`); request.input.request_id = retry.current.request_id; request.input.revision = retry.current.revision; }
      setPending(request);
      const response = await frondoseApi.mutateSubRoutes(request.id, request.action, request.input);
      retry.current?.clear();
      if (!mounted.current) return false;
      setPending(null);
      if (!response.result?.tree || response.result?.approval_required) { setError(new Error('This change requires approval. The hierarchy has not been reported as changed.')); return false; }
      setDialog(null); if (response.result.tree.route?.id === task.id) setTree(response.result.tree); notify(request.action === 'create' ? 'Sub-route created. No agent was started.' : 'Route hierarchy updated');
      await refreshFrondose().catch(() => {}); setReload(value => value + 1); return true;
    } catch (cause) {
      if (!mounted.current) return false;
      setError(cause); if (cause.status >= 400 && cause.status < 500 && cause.status !== 408) { setPending(null); retry.current?.clear(); } return false;
    } finally { sending.current = false; if (mounted.current) setBusy(false); }
  }
  const children = tree?.children || [], shown = children.filter(child => showArchived || !child.archived_at);
  const archivedAncestor = tree?.ancestors?.find(ancestor => ancestor.archived_at);
  function open(mode, route = tree.route) { if (!locked) setDialog({ mode, route }); }
  return <section className="sub-routes" aria-labelledby={`sub-routes-${task.id}`}>
    <div className="section-heading"><div><h3 id={`sub-routes-${task.id}`}>Sub-routes</h3><p>Smaller goals, with their own status and work agreement.</p></div><Button icon={RotateCcw} disabled={locked || loading} onClick={() => setReload(value => value + 1)}>Refresh</Button></div>
    <ErrorMessage error={error} />
    {pending && !busy ? <div className="sub-route-notice" role="status"><strong>Delivery is uncertain</strong><p>The same request is retained. Retry it before making another hierarchy change.</p><Button onClick={() => mutate(pending.id, pending.action)}>Retry same request</Button></div> : null}
    {loading && !tree ? <p role="status">Loading sub-routes…</p> : tree ? <>
      {tree.ancestors?.length ? <nav className="sub-route-ancestors" aria-label="Route ancestors">{tree.ancestors.map(ancestor => <span key={ancestor.id}><button type="button" onClick={() => navigate('tasks', ancestor.id)}>{ancestor.title}{ancestor.archived_at ? ' (archived)' : ''}</button><ArrowRight /></span>)}<strong>{task.title}</strong></nav> : null}
      {archivedAncestor ? <div className="sub-route-notice"><strong>{tree.parent?.archived_at ? 'Parent route is archived' : 'An ancestor route is archived'}</strong><p>This route keeps its place in the hierarchy. Restore archived ancestors from Settings → Archive before adding work beneath them.</p><Button onClick={() => navigate('settings', 'archive')}>Open archive</Button></div> : null}
      {tree.integrity?.warnings?.length || tree.integrity?.restricted ? <div className="sub-route-notice" role="note"><strong>{tree.integrity.restricted ? 'Some related work is restricted' : 'Hierarchy needs attention'}</strong><ul>{(tree.integrity.warnings || []).map((warning, index) => <li key={index}>{warning}</li>)}</ul>{caps.can_repair ? <Button onClick={() => open('repair')} disabled={locked}>Repair by detaching this route</Button> : null}</div> : null}
      <div className="sub-route-summary"><GitBranch /><div><strong>{leafProgressLabel(tree.progress, tree.integrity)}</strong><p>{tree.progress?.complete === true ? `${tree.progress.cancelled} cancelled · ${tree.progress.archived} archived leaves.` : 'Complete leaf counts are unavailable.'} Parent status is changed separately.</p></div>{tree.progress?.ratio != null && tree.integrity?.valid !== false && !tree.integrity?.restricted ? <progress aria-label="Completed active leaf routes" value={tree.progress.ratio} max={1} /> : null}</div>
      <div className="sub-route-toolbar">{caps.can_create ? <Button icon={Plus} disabled={locked} onClick={() => open('create')}>New sub-route</Button> : null}{caps.can_attach ? <Button icon={Link} disabled={locked} onClick={() => open('attach')}>Attach existing route</Button> : null}{caps.can_reparent ? <Button disabled={locked} onClick={() => open('parent')}>{tree.parent ? 'Change parent' : 'Choose parent'}</Button> : null}{caps.can_detach ? <Button icon={Unlink} disabled={locked} onClick={() => open('detach')}>Detach from parent</Button> : null}</div>
      {children.some(child => child.archived_at) ? <label className="sub-route-archived-toggle"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />Show archived sub-routes</label> : null}
      {shown.length ? <ol className="sub-route-children">{shown.map(child => <li key={child.id} className={child.archived_at ? 'is-archived' : ''}><div className="sub-route-child-main"><button type="button" className="sub-route-child-title" onClick={() => navigate('tasks', child.id)}>{child.title}<ArrowRight /></button><span>{child.archived_at ? 'Archived' : STATUSES[child.status] || child.status}</span></div><div className="sub-route-child-actions">{caps.can_reorder ? <><button type="button" aria-label={`Move ${child.title} up`} disabled={locked || !moveSibling(children, child.id, -1, showArchived)} onClick={() => mutate(task.id, 'reorder', { child_ids: moveSibling(children, child.id, -1, showArchived) })}><ArrowUp /></button><button type="button" aria-label={`Move ${child.title} down`} disabled={locked || !moveSibling(children, child.id, 1, showArchived)} onClick={() => mutate(task.id, 'reorder', { child_ids: moveSibling(children, child.id, 1, showArchived) })}><ArrowDown /></button></> : null}{child.can_detach || child.capabilities?.can_detach ? <button type="button" disabled={locked} onClick={() => open('detach', child)}>Detach</button> : null}<button type="button" onClick={() => navigate('tasks', child.id)}>Open route</button></div></li>)}</ol> : <p className="sub-route-empty">{children.length ? 'All immediate sub-routes are archived.' : 'No sub-routes yet. Break this goal into smaller, independently trackable pieces.'}</p>}
      <p className="sub-route-footnote">Hierarchy is separate from dependencies. Creating or moving routes never starts an agent or marks the parent done.</p>
    </> : error ? <p className="sub-route-footnote">The hierarchy could not be loaded. Existing routes have not been changed.</p> : null}
    {dialog ? <HierarchyDialog key={`${dialog.mode}:${dialog.route.id}`} mode={dialog.mode} route={dialog.route} candidates={candidates} busy={busy || loading} pending={Boolean(pending)} error={error} onClose={() => !locked && setDialog(null)} onReload={() => setReload(value => value + 1)} onSubmit={fields => {
      if (dialog.mode === 'create') return mutate(task.id, 'create', fields);
      if (dialog.mode === 'attach') return mutate(fields.route_id, 'attach', { parent_id: task.id });
      if (dialog.mode === 'parent') return mutate(task.id, tree.parent ? 'reparent' : 'attach', { parent_id: fields.route_id });
      return mutate(dialog.route.id, 'detach', dialog.mode === 'repair' ? { repair: true } : {});
    }} /> : null}
  </section>;
}

function HierarchyDialog({ mode, route, candidates, busy, pending, error, onClose, onReload, onSubmit }) {
  const [title, setTitle] = useState(''), [description, setDescription] = useState(''), [priority, setPriority] = useState('medium'), [selected, setSelected] = useState(''), [discard, setDiscard] = useState(false);
  const labels = { create: 'New sub-route', attach: 'Attach existing route', parent: 'Choose parent route', detach: 'Detach route', repair: 'Repair route hierarchy' };
  const dirty = Boolean(title || description || selected || priority !== 'medium'), locked = busy || pending;
  function close() { if (!locked) dirty ? setDiscard(true) : onClose(); }
  useEffect(() => { if (!dirty && !locked) return; const warn = event => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty, locked]);
  return <Dialog title={discard ? 'Discard route changes?' : labels[mode]} onClose={close}>{discard ? <div className="sub-route-form"><p>No new hierarchy change will be submitted.</p><Button onClick={() => setDiscard(false)}>Keep editing</Button><Button variant="danger" onClick={onClose}>Discard changes</Button></div> : <form className="sub-route-form" onSubmit={event => { event.preventDefault(); onSubmit(mode === 'create' ? { title: title.trim(), description: description.trim(), priority } : { route_id: selected }); }}>
    <p>{mode === 'create' ? `Create a smaller goal under “${route.title}”. It inherits the project and team, starts in Backlog, and does not launch an agent.` : mode === 'attach' ? 'Choose an unparented route in the same project and team. Its status, agreement, and existing descendants stay unchanged.' : mode === 'parent' ? 'Choose a parent in the same project and team. The server checks cycles, depth, permissions, and completed ancestors before moving this subtree.' : mode === 'repair' ? 'Remove this route’s broken parent link. Its descendants and work records stay intact. Review the resulting hierarchy afterward.' : `Detach “${route.title}” from its parent. It becomes a top-level route in the same project and team; its descendants remain attached.`}</p>
    {mode === 'create' ? <><Field label="Sub-route title"><input autoFocus required maxLength={200} value={title} disabled={locked} onChange={event => setTitle(event.target.value)} /></Field><Field label="Description"><textarea rows={4} maxLength={50000} value={description} disabled={locked} onChange={event => setDescription(event.target.value)} /></Field><Select label="Priority" value={priority} disabled={locked} onChange={setPriority}>{Object.entries(PRIORITIES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></> : ['attach', 'parent'].includes(mode) ? <><Select label={mode === 'attach' ? 'Existing route' : 'New parent'} value={selected} disabled={locked} onChange={setSelected}><option value="">Choose a route</option>{candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</Select>{!candidates.length ? <p>No eligible visible routes are available in this project and team.</p> : null}</> : null}
    <ErrorMessage error={error} />{error?.status === 409 && !pending ? <Button onClick={onReload} disabled={busy}>Refresh hierarchy before retrying</Button> : null}{pending && !busy ? <p role="status">Delivery is uncertain. Retry uses the identical request and revision.</p> : null}<div className="sub-route-dialog-actions"><Button onClick={close} disabled={locked}>Cancel</Button><Button type="submit" variant="primary" busy={busy} disabled={!pending && (mode === 'create' ? !title.trim() : ['attach', 'parent'].includes(mode) ? !selected : false)}>{pending && !busy ? 'Retry same request' : mode === 'create' ? 'Create sub-route' : mode === 'attach' ? 'Attach route' : mode === 'parent' ? 'Move route' : 'Detach route'}</Button></div>
  </form>}</Dialog>;
}

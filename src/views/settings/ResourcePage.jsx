import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, ErrorMessage, Field, Select, Empty, useApp, useAsync } from '../../ui.jsx';
import { Form } from '../../components/Form.jsx';
import { Plus, Pencil, Archive, RotateCcw, ArrowUp, ArrowDown, Clock, FileText, ArrowRight } from '../../components/icons.jsx';
import { rumboActions } from '../../data/useRumbo.js';
import { rumboApi } from '../../data/api.js';
import { RESOURCE_TYPES, featureItems, matchingRoutes, pretty, ROUTE_STAGES, PROJECT_STAGES } from '../../lib/settings-catalog.js';
import { visible, relative } from '../../lib/model.js';
import { ImageField } from '../../components/ImageField.jsx';
import { isEmojiImage, emojiShortcode } from '../../lib/custom-emojis.js';
import { ActivityFeed } from '../../components/ActivityFeed.jsx';

export function ResourcePage({ kind, allowCreate = true }) {
  const { data, workspace, perform, notify, navigate, startSession } = useApp();
  const spec = RESOURCE_TYPES[kind];
  const [query, setQuery] = useState(''), [archived, setArchived] = useState(false), [editor, setEditor] = useState(null), [action, setAction] = useState(null), [history, setHistory] = useState(null);
  const items = (archived ? (data.workspace_items ?? []).filter(i => i.kind === kind && i.archived_at) : featureItems(data, kind)).filter(i => `${i.name} ${i.payload.description ?? ''} ${i.payload.group ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  const update = (item, patch) => rumboActions.updateWorkspaceItem(item.id, { version: item.version, ...patch });
  const openHistory = item => perform(async () => { const response = await rumboApi.history(item.id, workspace.id); setHistory({ item, changes: response.result }); });
  const launchAction = async item => {
    if (kind === 'saved_view') { navigate('views', item.id); return; }
    if (kind === 'queue') { startSession({ title: item.name, prompt: item.payload.content, project_id: item.payload.project_ids[0], agent_id: item.payload.agent_ids[0] }); return; }
    if (kind === 'automation') { const result = await perform(() => rumboActions.workspaceItemAction(item.id, { version: item.version, action: 'preview-rule' })); if (result) setAction({ item, matches: result.matches }); return; }
    setAction({ item });
  };
  const actions = { route_label: 'Merge', project_label: 'Merge', route_template: 'Use template', project_template: 'Use template', chat_template: 'Use template', preset: 'Apply to agent', request: 'Create route', saved_view: 'Open view', context_pack: 'Preview context', collection: 'View agents', goal: 'View progress', handoff: 'Read handoff', review: 'Read deliverable', update: 'Read update', emoji: 'Copy emoji', automation: 'Preview rule', queue: 'Prepare session' };
  function renderRow(item, index) {
    const payload = item.payload;
    const labelCollection = kind === 'route_label' ? data.tasks : data.projects;
    const usage = kind.endsWith('_label') ? labelCollection.filter(row => !row.archived_at && row.labels?.some(l => l === item.id || l === item.name)).length : null;
    const routes = kind === 'goal' ? matchingRoutes(data, { project_ids: payload.project_ids }).filter(t => payload.project_ids.length && payload.project_ids.includes(t.project_id)) : [];
    const done = routes.filter(t => t.status === 'done').length;
    return <article className={`resource-row resource-${spec.layout}`} key={item.id}>
      <div className="resource-name">{payload.color ? <i className="resource-dot" style={{ background: payload.color }} /> : kind === 'emoji' ? <span className="resource-emoji">{isEmojiImage(payload.symbol) ? <img src={payload.symbol} alt={item.name} width="28" height="28" /> : payload.symbol}</span> : <FileText />}<div><strong>{item.name}</strong><small>{payload.group || (payload.state ? pretty(payload.state) : `Updated ${relative(item.updated_at)}`)}</small></div></div>
      <div className="resource-summary">{kind === 'goal' ? <><span>{done} of {routes.length} routes complete</span><progress value={done} max={routes.length || 1} /></> : <p>{payload.description || payload.content || (payload.agent_ids ? `${payload.agent_ids.length} agents` : payload.category ? pretty(payload.category) : '—')}</p>}</div>
      {usage !== null ? <span className="resource-usage">{usage} {kind === 'route_label' ? 'route' : 'project'}{usage === 1 ? '' : 's'}</span> : null}
      <div className="resource-actions">{archived ? <Button icon={RotateCcw} onClick={() => perform(() => update(item, { archived_at: null }), 'Restored')}>Restore</Button> : <>
        {actions[kind] ? <Button onClick={() => launchAction(item)}>{kind === 'request' && payload.route_id ? 'Open route' : actions[kind]}</Button> : null}
        {spec.layout === 'queue' || spec.layout === 'stages' ? <><button className="icon-button" aria-label={`Move ${item.name} up`} disabled={index === 0} onClick={() => perform(() => update(item, { position: items[index - 1].position - .5 }))}><ArrowUp /></button><button className="icon-button" aria-label={`Move ${item.name} down`} disabled={index === items.length - 1} onClick={() => perform(() => update(item, { position: items[index + 1].position + .5 }))}><ArrowDown /></button></> : null}
        <button className="icon-button" aria-label={`Edit ${item.name}`} onClick={() => setEditor(item)}><Pencil /></button>
        <button className="icon-button" aria-label={`History of ${item.name}`} onClick={() => openHistory(item)}><Clock /></button>
        <button className="icon-button" aria-label={`Archive ${item.name}`} onClick={() => setAction({ item, archive: true })}><Archive /></button>
      </>}</div>
    </article>;
  }
  return <>
    <header className="settings-heading"><div><h1>{spec.title}</h1><p>{spec.description}</p></div>{allowCreate ? <Button variant="primary" icon={Plus} onClick={() => setEditor({})}>New {spec.singular}</Button> : null}</header>
    <div className="settings-toolbar"><input aria-label={`Search ${spec.title.toLowerCase()}`} placeholder="Filter by name…" value={query} onChange={e => setQuery(e.target.value)} /><Select aria-label="Show items" value={archived ? 'archived' : 'active'} onChange={v => setArchived(v === 'archived')}><option value="active">Active</option><option value="archived">Archived</option></Select><span>{items.length} {items.length === 1 ? 'item' : 'items'}</span></div>
    {items.length ? spec.layout === 'stages' && !archived ? <div className="workflow-groups">{(kind === 'route_status' ? ROUTE_STAGES : PROJECT_STAGES).map(category => <section key={category}><h2>{pretty(category)}<span>{items.filter(i => i.payload.category === category).length}</span></h2>{items.filter(i => i.payload.category === category).map(item => renderRow(item, items.indexOf(item)))}{!items.some(i => i.payload.category === category) ? <p className="workflow-empty">Uses the default {pretty(category).toLowerCase()} stage.</p> : null}</section>)}</div> : <div className={`resource-list layout-${spec.layout}`}>{items.map(renderRow)}</div> : <Empty compact kind={query ? 'search' : archived ? 'archive' : kind} title={query ? 'No matching items' : archived ? 'Nothing archived' : allowCreate ? `Create your first ${spec.singular}` : 'No historical updates'} description={query ? 'Try a different search.' : spec.description} action={archived || !allowCreate ? undefined : `New ${spec.singular}`} onAction={() => setEditor({})} />}
    {editor ? <ResourceEditor kind={kind} item={editor.id ? editor : null} onClose={() => setEditor(null)} /> : null}
    {action ? <ResourceAction kind={kind} {...action} onClose={() => setAction(null)} /> : null}
    {history ? <Dialog title={`${history.item.name} · history`} onClose={() => setHistory(null)}><div className="settings-history">{history.changes.map(change => <details key={change.id}><summary>{pretty(change.action)} · {new Date(change.created_at).toLocaleString()}</summary><pre>{JSON.stringify(change.after?.payload ?? change.after, null, 2)}</pre></details>)}<p>History records workspace edits. It is not a tamper-proof security audit.</p></div></Dialog> : null}
  </>;
}

export function ResourceEditor({ kind, item, onClose }) {
  const { data, workspace, notify } = useApp();
  const spec = RESOURCE_TYPES[kind];
  const defaults = Object.fromEntries(Object.entries(spec.fields).map(([key, field]) => [key, item?.payload[key] ?? (field.type === 'refs' ? [] : field.type === 'choice' ? field.options[0] : field.type === 'color' ? '#93949c' : '')]));
  const [name, setName] = useState(item?.name ?? ''), [payload, setPayload] = useState(defaults), [discard, setDiscard] = useState(false);
  const initial = useRef(JSON.stringify({ name: item?.name ?? '', payload: defaults }));
  const { busy, error, execute } = useAsync();
  const dirty = JSON.stringify({ name, payload }) !== initial.current;
  const close = () => { if (busy) return; if (dirty && !discard) setDiscard(true); else onClose(); };
  const change = (key, value) => setPayload(p => ({ ...p, [key]: value }));
  return <Dialog title={discard ? 'Discard these changes?' : `${item ? 'Edit' : 'New'} ${spec.singular}`} subtitle={workspace.name} onClose={close}>
    {discard ? <div className="settings-confirm"><p>Your unsaved changes will be lost.</p><Button onClick={() => setDiscard(false)}>Keep editing</Button><Button variant="danger" onClick={onClose}>Discard changes</Button></div> : <Form className="settings-resource-form" onSubmit={e => { e.preventDefault(); execute(async () => { const input = { name, payload, workspace_id: workspace.id, kind }; if (item) await rumboActions.updateWorkspaceItem(item.id, { ...input, version: item.version }); else await rumboActions.createWorkspaceItem(input); notify(`${pretty(spec.singular)} saved`); onClose(); }); }}>
      <Field label="Name"><input autoFocus required maxLength={160} value={name} onChange={e => setName(e.target.value)} /></Field>
      {Object.entries(spec.fields).map(([key, field]) => field.type === 'image' ? <ImageField key={key} label={field.label} value={isEmojiImage(payload[key]) ? payload[key] : null} disabled={busy} onChange={value => change(key, value ?? '')} /> : field.type === 'choice' ? <Select key={key} label={field.label} value={payload[key]} onChange={v => change(key, v)}>{field.options.map(v => <option key={v} value={v}>{pretty(v)}</option>)}</Select> : field.type === 'refs' ? <fieldset className="resource-ref-field" key={key}><legend>{field.label}</legend>{visible(data[field.collection]).length ? visible(data[field.collection]).map(row => <label key={row.id}><input type="checkbox" checked={payload[key].includes(row.id)} onChange={e => change(key, e.target.checked ? [...payload[key], row.id] : payload[key].filter(id => id !== row.id))} /><span>{row.name ?? row.title}</span></label>) : <p>No {field.collection.replaceAll('_', ' ')} yet. You can add them later.</p>}</fieldset> : field.type === 'color' ? <Field key={key} label={field.label}><div className="resource-colors">{['#93949c', '#e06b75', '#dfae67', '#76ad91', '#6da8d6', '#9890cf'].map(color => <button type="button" aria-label={`Color ${color}`} aria-pressed={payload[key] === color} key={color} style={{ background: color }} onClick={() => change(key, color)} />)}<input aria-label="Hex color" pattern="#[a-fA-F0-9]{6}" value={payload[key]} maxLength={7} onChange={e => change(key, e.target.value)} /></div></Field> : <Field key={key} label={field.label}>{field.type === 'textarea' ? <textarea rows={5} maxLength={50000} value={payload[key]} onChange={e => change(key, e.target.value)} /> : <input maxLength={field.max ?? 500} value={payload[key]} onChange={e => change(key, e.target.value)} />}</Field>)}
      <ErrorMessage error={error} /><footer className="form-submit-row"><Button onClick={close}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Save {spec.singular}</Button></footer>
    </Form>}
  </Dialog>;
}

function ResourceAction({ kind, item, archive, matches, onClose }) {
  const { data, navigate, notify } = useApp();
  const { busy, error, execute } = useAsync();
  const [name, setName] = useState(item.name), [agent, setAgent] = useState(''), [target, setTarget] = useState('');
  const p = item.payload;
  const action = actionName(kind);
  const refs = ['document_ids', 'memory_ids'].flatMap(key => (p[key] ?? []).map(id => (key === 'document_ids' ? data.documents : data.memory_notes).find(row => row.id === id)).filter(Boolean));
  const context = [p.content, ...refs.map(row => `${row.title}\n${row.content}${row.archived_at ? '\n[Archived source]' : ''}`)].filter(Boolean).join('\n\n');
  const routes = kind === 'saved_view' ? matchingRoutes(data, item) : kind === 'goal' ? matchingRoutes(data, item).filter(t => p.project_ids.length && p.project_ids.includes(t.project_id)) : [];
  const act = () => execute(async () => {
    if (archive) { await rumboActions.updateWorkspaceItem(item.id, { version: item.version, archived_at: new Date().toISOString() }); notify('Archived. Restore it from the Archived filter.'); }
    else if (kind === 'request' && p.route_id) navigate('tasks', p.route_id);
    else if (kind === 'emoji' || kind === 'context_pack') { await navigator.clipboard.writeText(kind === 'emoji' ? isEmojiImage(p.symbol) ? emojiShortcode(item) : p.symbol : context); notify('Copied'); }
    else { const result = await rumboActions.workspaceItemAction(item.id, { version: item.version, action, name, agent_id: agent, target_id: target, ids: matches?.map(row => row.id) }); if (result?.view) navigate(result.view, result.id); else notify(`${result.count} items updated`); }
    onClose();
  });
  const hasAction = archive || action || ['emoji', 'context_pack'].includes(kind);
  return <Dialog title={archive ? `Archive ${item.name}?` : item.name} onClose={() => !busy && onClose()}><div className="settings-action-body">
    {archive ? <p>This item will leave active lists. You can restore it later. Statuses still in use cannot be archived.</p> : <>
      {kind.endsWith('_template') ? <Field label="Name for the new item" hint="Creates workspace content only. No agent starts."><input required value={name} maxLength={160} onChange={e => setName(e.target.value)} /></Field> : null}
      {kind.endsWith('_label') ? <><p>Replace this label on all linked work with another label, then archive it. Work is preserved.</p><Select label="Merge into" value={target} onChange={setTarget}><option value="">Choose label</option>{featureItems(data, kind).filter(i => i.id !== item.id).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</Select></> : null}
      {kind === 'preset' ? <><p>This replaces the selected profile’s instructions. Its previous version remains in the audit history.</p><Select label="Agent" value={agent} onChange={setAgent}><option value="">Choose agent</option>{visible(data.agents).filter(a => a.workspace_id).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</Select><pre>{p.content}</pre></> : null}
      {kind === 'context_pack' ? <><p>{context.length.toLocaleString()} characters · Copy this explicitly into the conversation. Archived sources are marked. Nothing has been sent.</p><pre className="context-preview">{context || 'This pack has no context yet.'}</pre></> : null}
      {['saved_view', 'goal'].includes(kind) ? <><p>{routes.length} matching routes{kind === 'goal' ? ` · ${routes.filter(t => t.status === 'done').length} complete` : ''}</p><div className="settings-link-list">{routes.map(t => <button key={t.id} onClick={() => navigate('tasks', t.id)}><span>{t.title}</span><small>{pretty(t.status)}</small><ArrowRight /></button>)}</div></> : null}
      {kind === 'collection' ? <div className="settings-link-list">{visible(data.agents).filter(a => p.agent_ids.includes(a.id)).map(a => <button key={a.id} onClick={() => navigate('agents', a.id)}><span>{a.name}</span><small>{a.provider}</small><ArrowRight /></button>)}</div> : null}
      {kind === 'automation' ? <><p>Move {matches.length} matching routes from {pretty(p.from)} to {pretty(p.to)}. You must explicitly apply this preview; this rule never runs in the background.</p><ul>{matches.map(t => <li key={t.id}>{t.title}</li>)}</ul></> : null}
      {['request', 'handoff', 'review', 'update'].includes(kind) ? <><pre>{p.content || 'No brief yet.'}</pre>{p.feedback ? <><h3>Review feedback</h3><pre>{p.feedback}</pre></> : null}</> : null}
      {kind === 'request' && !item.archived_at ? <ActivityFeed key={item.id} workspaceId={item.workspace_id} targetType="request" targetId={item.id} /> : null}
      {kind === 'emoji' ? <span className="emoji-preview">{isEmojiImage(p.symbol) ? <img src={p.symbol} alt={item.name} width="64" height="64" /> : p.symbol}</span> : null}
    </>}
    <ErrorMessage error={error} /><footer className="form-submit-row"><Button onClick={onClose} disabled={busy}>Close</Button>{hasAction ? <Button variant={archive ? 'danger' : 'primary'} disabled={!archive && (kind === 'preset' && !agent || kind.endsWith('_template') && !name.trim() || kind.endsWith('_label') && !target)} busy={busy} onClick={act}>{archive ? 'Archive' : kind.endsWith('_label') ? 'Merge labels' : kind === 'automation' ? 'Apply to these routes' : kind === 'request' ? p.route_id ? 'Open route' : 'Create route' : kind.endsWith('_template') ? 'Create from template' : kind === 'preset' ? 'Replace instructions' : 'Copy'}</Button> : null}</footer>
  </div></Dialog>;
}
function actionName(kind) { return kind.endsWith('_template') ? 'instantiate' : kind.endsWith('_label') ? 'merge-label' : ({ preset: 'apply-preset', request: 'convert', automation: 'apply-rule' })[kind]; }

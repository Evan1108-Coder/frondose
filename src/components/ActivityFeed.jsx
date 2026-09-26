import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, MessageCircle, Pencil, History, Smile as SmilePlus, Link, RotateCcw } from './icons.jsx';
import { rumboApi } from '../data/api.js';
import { activityAnchor, activityCapabilities, activityLink, activityRetryKey, evidenceMarkdown, filteredActivityThreads, mentionedAgents, UPDATE_HEALTH, UPDATE_TYPES } from '../lib/activity.js';
import { parseSlashCommand, searchCommands } from '../lib/commands.js';
import { SlashCommandMenu } from './SlashCommandMenu.jsx';
import { Button, Dialog, ErrorMessage, SearchField, Select, useApp } from '../ui.jsx';
import { relative, visible } from '../lib/model.js';
import { customEmojis } from '../lib/custom-emojis.js';
import { getReaction, reactionKey } from '../lib/reaction-catalog.js';
import { DocumentContent } from './DocumentContent.jsx';
import ReactionPicker from './ReactionPicker.jsx';
import { ReactionGlyph } from './ReactionGlyph.jsx';
import './activity-feed.css';
import { AttachmentLinks, AskUpdateAgent, UpdateAttachments, UpdateWorkChanges, WorkChangeSummary } from './UpdateExtras.jsx';

import { useUnsavedUpdate, useUpdateEditorsState, requestUpdateNavigation } from './UnsavedUpdates.jsx';
import { ActivityTimeline } from './ActivityTimeline.jsx';
import { RumboAgentEntryDialog, RumboAgentEntryButton } from './RumboAgentEntry.jsx';
import { rumboAgentActivitySource } from '../lib/rumbo-agent-entry.js';

const TYPE_LABELS = Object.fromEntries(UPDATE_TYPES), HEALTH_LABELS = Object.fromEntries(UPDATE_HEALTH);
const noop = () => {};
const ACTIVITY_COMMANDS = ['update', 'reply', 'mention', 'agent', 'rumbo', 'route.new', 'project.new', 'remember', 'connections', 'settings'];

export function ActivityComposer({ workspaceId, targetType, targetId, entry, replyTo, onSaved = noop, onCancel, onDirtyChange = noop, onPendingChange = noop }) {
  const { data, edit, navigate } = useApp();
  const agents = useMemo(() => visible(data.agents), [data.agents]);
  const emojis = useMemo(() => customEmojis(data.workspace_items, workspaceId, true), [data.workspace_items, workspaceId]);
  const [workChanges, setWorkChanges] = useState(() => JSON.parse(entry?.work_changes_json || '{}'));
  const [attachments, setAttachments] = useState(() => JSON.parse(entry?.attachments_json || '[]'));
  const [readingFiles, setReadingFiles] = useState(false);
  const [content, setContent] = useState(entry?.content || ''), [title, setTitle] = useState(entry?.title || '');
  const [type, setType] = useState(entry?.update_type || 'progress'), [health, setHealth] = useState(entry?.health || 'none');
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [preview, setPreview] = useState(false);
  const [pending, setPending] = useState(null), [slashIndex, setSlashIndex] = useState(0), [evidence, setEvidence] = useState(false);
  const [evidenceUrl, setEvidenceUrl] = useState(''), [evidenceLabel, setEvidenceLabel] = useState('');
  const [rumboRequest, setRumboRequest] = useState(null);
  const sending = useRef(false), retry = useRef(null), mounted = useRef(true), mentions = mentionedAgents(content, agents);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const isReply = Boolean(replyTo || entry?.parent_id), isPublished = entry && entry.publication_state !== 'draft', locked = busy || Boolean(pending) || readingFiles;
  const commandContext = ['project', 'route', 'request', 'document', 'output'].includes(targetType) ? targetType : 'reply';
  const slashVisible = content.trimStart().startsWith('/') && !content.trimStart().startsWith('//') && !content.includes('\n');
  const slashResults = slashVisible ? searchCommands(content.trimStart().slice(1), { context: commandContext }).slice(0, 10) : [];
  const dirty = JSON.stringify(workChanges) !== (entry?.work_changes_json || '{}') || JSON.stringify(attachments) !== (entry?.attachments_json || '[]') || content !== (entry?.content || '') || title !== (entry?.title || '') || type !== (entry?.update_type || 'progress') || health !== (entry?.health || 'none');
  const rumboSource = rumboAgentActivitySource({ entry, replyTo, targetType, targetId });
  const rumboInstruction = isReply ? 'Help me draft a reply to this update. Suggest text for me to review; do not post it.' : 'Help me draft an update for this work. Suggest text for me to review; do not publish it.';
  useUnsavedUpdate(dirty, locked);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onPendingChange(locked); }, [locked, onPendingChange]);
  useEffect(() => { if (!dirty && !locked) return; const warn = event => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty, locked]);
  function executeCommand(command, argv = []) {
    const args = argv.join(' ').trim(); setError(null);
    if (command.id === 'rumbo') { setRumboRequest(args || rumboInstruction); return; }
    if (command.id === 'update') { const requested = argv[0]?.toLowerCase(); if (UPDATE_TYPES.some(([value]) => value === requested)) { setType(requested); setContent(argv.slice(1).join(' ')); } else setContent(args); return; }
    if (command.id === 'reply') { if (!isReply) setError(new Error('Choose Reply on an update first.')); else setContent(args); return; }
    if (['mention', 'agent'].includes(command.id)) { const agent = agents.find(item => [item.name, item.provider, item.id].some(value => String(value || '').toLowerCase() === args.toLowerCase())); if (!agent) { setError(new Error('Add an available agent name after the command.')); return; } setContent(`@${agent.name} `); return; }
    if (command.id === 'route.new') { edit('task', null, { title: args || undefined, ...(targetType === 'project' ? { project_id: targetId } : {}) }); return; }
    if (command.id === 'project.new') { edit('project', null, { name: args || undefined }); return; }
    if (command.id === 'remember') { edit('memory', null, { content: args }); return; }
    if (command.id === 'connections') { navigate('connections'); return; }
    if (command.id === 'settings') { navigate('settings', args || null); return; }
    setError(new Error(`${command.command} is not executable in an update. Use its normal reviewed workflow.`));
  }
  function chooseCommand(command) { if (locked) return; const parsed = parseSlashCommand(content), exact = parsed?.type === 'command' && parsed.command.id === command.id; if (!exact && command.usage.includes('[')) { setContent(`${command.command} `); return; } executeCommand(command, exact ? parsed.argv : []); }
  async function save(publicationState) {
    if (sending.current || readingFiles || !content.trim()) return;
    if (!pending) { const parsed = parseSlashCommand(content); if (parsed) { if (parsed.type === 'unknown' || parsed.error) setError(new Error(parsed.error || `Unknown command /${parsed.name}.`)); else executeCommand(parsed.command, parsed.argv); return; } }
    sending.current = true; setBusy(true); setError(null);
    try {
      const payload = pending || { workspace_id: workspaceId, ...(entry ? { version: entry.version } : { target_type: targetType, target_id: targetId, parent_id: replyTo?.id ?? null }), content: content.trim(), title: isReply ? '' : title.trim(), update_type: isReply ? 'comment' : type, health: isReply ? 'none' : health, publication_state: publicationState, work_changes: workChanges, attachments };
      if (!pending) { retry.current = await activityRetryKey(payload, entry ? `edit:${entry.id}` : 'create'); payload.idempotency_key = retry.current.key; }
      setPending(payload);
      const response = entry ? await rumboApi.updateActivity(entry.id, payload) : await rumboApi.createActivity(payload); retry.current?.clear(); if (!mounted.current) return; setPending(null); if (!response.result?.id || response.result?.approval_required) { setError(new Error('This action needs approval. Your text is retained; it has not been published.')); return; } setContent(''); setTitle(''); setHealth('none'); setType('progress'); setWorkChanges({}); setAttachments([]); onSaved(response.result);
    }
    catch (cause) { setError(cause); if (cause.status >= 400 && cause.status < 500 && cause.status !== 408) { setPending(null); retry.current?.clear(); } }
    finally { sending.current = false; setBusy(false); }
  }
  function insertEvidence() { const markdown = evidenceMarkdown(evidenceLabel, evidenceUrl.trim()); if (!markdown) { setError(new Error('Use an HTTP or HTTPS evidence link without credentials, spaces, or parentheses.')); return; } setContent(value => `${value}${value ? '\n\n' : ''}${markdown}`); setEvidence(false); setEvidenceUrl(''); setEvidenceLabel(''); setError(null); }
  return <form className="activity-composer" onSubmit={event => { event.preventDefault(); save('published'); }}>
    <ErrorMessage error={error} />
    {isReply ? <div className="activity-reply-target"><MessageCircle /><span>Replying to <strong>{replyTo?.actor_name || 'this thread'}</strong></span></div> : <><input aria-label="Update title" placeholder="Give this update a title (optional)" maxLength={200} value={title} disabled={locked} onChange={event => setTitle(event.target.value)} /><div className="activity-composer-top"><Select aria-label="Update type" value={type} onChange={setType} disabled={locked}>{UPDATE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><Select aria-label="Update health" value={health} onChange={setHealth} disabled={locked}>{UPDATE_HEALTH.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></div></>}
    {!isReply && !isPublished && ['route', 'project'].includes(targetType) ? <UpdateWorkChanges targetType={targetType} targetId={targetId} value={workChanges} onChange={setWorkChanges} disabled={locked} /> : null}
    <div className="activity-editor-toolbar"><button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>Write</button><button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>Preview</button><button type="button" disabled={locked} onClick={() => setEvidence(!evidence)}><Link />Add evidence link</button><RumboAgentEntryButton source={rumboSource} disabled={locked} initialInstruction={rumboInstruction} /></div>
    {rumboRequest !== null ? <RumboAgentEntryDialog source={rumboSource} initialInstruction={rumboRequest} onClose={() => setRumboRequest(null)} /> : null}
    {evidence ? <div className="activity-evidence-fields"><input aria-label="Evidence label" placeholder="Link label" value={evidenceLabel} onChange={event => setEvidenceLabel(event.target.value)} disabled={locked} /><input aria-label="Evidence URL" placeholder="https://…" value={evidenceUrl} onChange={event => setEvidenceUrl(event.target.value)} disabled={locked} /><Button disabled={locked} onClick={insertEvidence}>Insert link</Button></div> : null}
    {preview ? <div className="activity-preview"><DocumentContent content={content || 'Nothing to preview yet.'} emojis={emojis} /></div> : <>{!locked ? <SlashCommandMenu text={content} context={commandContext} activeIndex={slashIndex} onActiveIndexChange={setSlashIndex} onSelect={chooseCommand} executableCommandIds={ACTIVITY_COMMANDS} /> : null}<textarea aria-label={isReply ? 'Reply' : 'Update'} rows={5} maxLength={50000} value={content} disabled={locked} onChange={event => { setSlashIndex(0); setContent(event.target.value); }} onKeyDown={event => {
      if (slashResults.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setSlashIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + slashResults.length) % slashResults.length); }
      else if (slashVisible && event.key === 'Escape') { event.preventDefault(); setContent(`/${content.trimStart()}`); }
      else if (slashResults.length && ['Enter', 'Tab'].includes(event.key) && !event.shiftKey) { event.preventDefault(); chooseCommand(slashResults[Math.min(slashIndex, slashResults.length - 1)]); }
    }} placeholder="What changed, what matters, and what comes next? Markdown and / commands supported." /></>}
    <UpdateAttachments value={attachments} onChange={setAttachments} disabled={locked} onError={setError} onReadingChange={setReadingFiles} />
    {mentions.length ? <div className="activity-mention-review" role="note"><strong>Mentions do not start agents</strong><span>{mentions.map(agent => `@${agent.name}`).join(', ')} will be recorded for review only.</span></div> : null}
    {pending && !busy ? <p className="activity-retry-note" role="status">Delivery is uncertain. Retry checks the same request; editing is locked to prevent a duplicate.</p> : null}
    <div className="activity-composer-actions"><span>{isPublished ? 'Changes create a new published revision.' : isReply ? 'Replies are published to this item.' : 'Save privately, then publish when ready.'}</span><div>{onCancel ? <Button disabled={locked} onClick={onCancel}>Cancel</Button> : null}{!isPublished && !isReply && !pending ? <Button disabled={!content.trim() || locked} onClick={() => save('draft')}>Save draft</Button> : null}<Button type="submit" variant="primary" busy={busy} disabled={!content.trim() || readingFiles}>{pending && !busy ? 'Retry same request' : isPublished ? 'Save changes' : isReply ? 'Post reply' : 'Publish update'}</Button></div></div>
  </form>;
}

export function ActivityHistoryDialog({ entry, workspaceId = entry.workspace_id, onClose }) {
  const [history, setHistory] = useState(null), [error, setError] = useState(null);
  useEffect(() => { const controller = new AbortController(); rumboApi.activityHistory(entry.id, { workspaceId }, { signal: controller.signal }).then(response => { if (!controller.signal.aborted) setHistory(response.result); }).catch(cause => { if (!controller.signal.aborted) setError(cause); }); return () => controller.abort(); }, [entry.id, workspaceId]);
  return <Dialog title="Published revision history" subtitle="Draft content is never included in published history." onClose={onClose} wide><ErrorMessage error={error} />{history === null && !error ? <p role="status">Loading history…</p> : null}<div className="activity-history">{(history || []).map((revision, index) => { const snapshot = revision.after || revision.before || {}; return <section key={revision.id || index}><header><strong>Version {snapshot.version || index + 1} · {revision.action}</strong><time>{relative(revision.created_at)}</time></header>{snapshot.title ? <h3>{snapshot.title}</h3> : null}<DocumentContent content={snapshot.content || ''} /><WorkChangeSummary value={JSON.parse(snapshot.work_changes_json || '{}')} /><AttachmentLinks value={JSON.parse(snapshot.attachments_json || '[]')} /></section>; })}{history?.length === 0 ? <p>No published revisions are available.</p> : null}</div></Dialog>;
}

export function ActivityEntry({ entry, workspaceId = entry.workspace_id, showTarget = false, onChanged = noop, onReply, focused = false }) {
  const { data } = useApp();
  const [replyOpen, setReplyOpen] = useState(false), [collapsed, setCollapsed] = useState(false), [askAgent, setAskAgent] = useState(false), [archiveConfirm, setArchiveConfirm] = useState(false);
  const descendants = entries => entries.reduce((total, item) => total + 1 + descendants(item.replies || []), 0);
  const replyCount = descendants(entry.replies || []);
  const [editing, setEditing] = useState(false), [history, setHistory] = useState(false), [picker, setPicker] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(null), [copied, setCopied] = useState(false);
  const [editDirty, setEditDirty] = useState(false), [editPending, setEditPending] = useState(false), [discard, setDiscard] = useState(false);
  function closeEdit() { if (editPending) return; if (editDirty) setDiscard(true); else setEditing(false); }
  const capabilities = activityCapabilities(entry), draft = entry.publication_state === 'draft';
  const emojis = useMemo(() => customEmojis(data.workspace_items, workspaceId, true), [data.workspace_items, workspaceId]);
  const mentions = mentionedAgents(entry.content, visible(data.agents));
  async function mutate(action) { if (busy) return; setBusy(true); setError(null); try { const response = await action(); if (response.result?.approval_required || !response.result?.id) { setError(new Error('This action needs approval. The update has not been changed.')); return; } onChanged(response.result); setPicker(false); } catch (cause) { setError(cause); } finally { setBusy(false); } }
  function react(reaction, mine) { return mutate(() => rumboApi.reactActivity(entry.id, { workspace_id: workspaceId, reaction: { id: reaction.id, color: reaction.color || null }, action: mine ? 'remove' : 'add' })); }
  return <article id={activityAnchor(entry.id)} className={`activity-entry activity-${entry.update_type}${focused ? ' activity-focused' : ''}${entry.archived_at ? ' activity-archived' : ''}`}><div className="activity-entry-marker" aria-hidden="true" /><div className="activity-entry-body">
    <header><span className="activity-type">{TYPE_LABELS[entry.update_type] || 'Update'}</span>{draft ? <span className="activity-type">Private draft</span> : null}{entry.archived_at ? <span className="activity-type">Archived</span> : null}{entry.health && entry.health !== 'none' ? <span className={`activity-health health-${entry.health}`}>{HEALTH_LABELS[entry.health]}</span> : null}<strong>{entry.actor_name}</strong><time dateTime={entry.published_at || entry.created_at}>{relative(entry.published_at || entry.created_at)}</time></header>
    {entry.imported ? <span className="activity-target">Imported history · author not verified</span> : null}{showTarget && entry.target ? <span className="activity-target">{entry.target.type} · {entry.target.title}</span> : null}{entry.title ? <h3 className="activity-entry-title"><a href={activityLink(entry)}>{entry.title}</a></h3> : null}<DocumentContent content={entry.content} emojis={emojis} /><WorkChangeSummary value={JSON.parse(entry.work_changes_json || '{}')} /><AttachmentLinks value={JSON.parse(entry.attachments_json || '[]')} />
    {mentions.length ? <div className="activity-agent-request"><strong>Agent mention recorded</strong><span>{mentions.map(agent => `@${agent.name}`).join(', ')} was mentioned. No agent was started.</span></div> : null}<ErrorMessage error={error} />
    <div className="activity-reactions">{(entry.reactions || []).map(reaction => { const item = emojis.find(emoji => emoji.id === reaction.id) || getReaction(reaction.id); return <button key={reactionKey(reaction)} type="button" aria-label={`${item?.name || 'Reaction'} · ${reaction.count}${reaction.mine ? ' · Remove your reaction' : ' · Add your reaction'}`} aria-pressed={reaction.mine} disabled={busy || !capabilities.react} onClick={() => react(reaction, reaction.mine)}><ReactionGlyph {...reaction} item={item} size={16} /><span>{reaction.count}</span></button>; })}</div>
    <div className="activity-entry-actions">{capabilities.reply ? <button type="button" onClick={() => setReplyOpen(true)}><MessageCircle />Reply</button> : null}{!draft && !entry.archived_at ? <button type="button" onClick={() => setAskAgent(true)}>Rumbo agent</button> : null}{capabilities.react ? <button type="button" disabled={busy} onClick={() => setPicker(true)}><SmilePlus />React</button> : null}{capabilities.edit ? <button type="button" disabled={busy} onClick={() => setEditing(true)}><Pencil />{draft ? 'Continue draft' : 'Edit'}</button> : null}{!draft ? <button type="button" onClick={() => setHistory(true)}><History />History</button> : null}<button type="button" onClick={async () => { try { await navigator.clipboard.writeText(`${location.origin}${location.pathname}${activityLink(entry)}`); setCopied(true); } catch { setError(new Error('The browser could not copy the link.')); } }}><Link />{copied ? 'Copied' : 'Copy link'}</button>{capabilities.archive ? <button type="button" disabled={busy} onClick={() => requestUpdateNavigation(() => setArchiveConfirm(true))}><Archive />Archive</button> : null}{capabilities.restore ? <button type="button" disabled={busy} onClick={() => mutate(() => rumboApi.updateActivity(entry.id, { workspace_id: workspaceId, version: entry.version, archived_at: null }))}><RotateCcw />Restore</button> : null}</div>
    {replyCount ? <button type="button" className="activity-thread-toggle" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? '+' : '−'} {replyCount} {replyCount === 1 ? 'reply' : 'replies'} · {collapsed ? 'Expand thread' : 'Collapse thread'}</button> : null}
    {replyCount ? <div className="activity-replies" hidden={collapsed}>{entry.replies.map(reply => <ActivityEntry key={reply.id} entry={reply} workspaceId={workspaceId} onChanged={onChanged} />)}</div> : null}
    {replyOpen ? <InlineReply entry={entry} workspaceId={workspaceId} onCancel={() => setReplyOpen(false)} onSaved={result => { setReplyOpen(false); onChanged(result); }} /> : !entry.parent_id && capabilities.reply ? <button type="button" className="activity-reply-prompt" onClick={() => setReplyOpen(true)}><MessageCircle />Leave a reply…</button> : null}</div>
    {askAgent ? <AskUpdateAgent entry={entry} onClose={() => setAskAgent(false)} /> : null}
    {archiveConfirm ? <Dialog title="Archive this update?" onClose={() => setArchiveConfirm(false)}><p>The update and its conversation will be hidden from published feeds. You can restore it from Archived.</p><Button disabled={busy} onClick={() => setArchiveConfirm(false)}>Cancel</Button><Button disabled={busy} onClick={() => mutate(() => rumboApi.archiveActivity(entry.id, { workspace_id: workspaceId, version: entry.version })).then(() => setArchiveConfirm(false))}>Archive update</Button></Dialog> : null}
    {editing ? <Dialog title={draft ? 'Continue private draft' : 'Edit update'} onClose={closeEdit} wide><ActivityComposer workspaceId={workspaceId} targetType={entry.target_type} targetId={entry.target_id} entry={entry} onDirtyChange={setEditDirty} onPendingChange={setEditPending} onSaved={result => { setEditing(false); onChanged(result); }} onCancel={closeEdit} /></Dialog> : null}{discard ? <Dialog title="Discard unsaved changes?" onClose={() => setDiscard(false)}><p>Your last saved version will be kept.</p><div className="activity-editor-toolbar"><Button onClick={() => setDiscard(false)}>Keep editing</Button><Button onClick={() => { setDiscard(false); setEditing(false); }}>Discard changes</Button></div></Dialog> : null}{history ? <ActivityHistoryDialog entry={entry} workspaceId={workspaceId} onClose={() => setHistory(false)} /> : null}{picker ? <ReactionPicker onClose={() => setPicker(false)} busy={busy} error={error} selected={(entry.reactions || []).filter(item => item.mine)} onSelect={reaction => react(reaction, (entry.reactions || []).some(item => reactionKey(item) === reactionKey(reaction) && item.mine))} /> : null}
  </article>;
}

export function ActivityFeed({ workspaceId, targetType, targetId, title = 'Updates & replies', focusEntryId, onDirtyChange = noop, onPendingChange = noop }) {
  const { notify } = useApp();
  const editorState = useUpdateEditorsState();
  const [entries, setEntries] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(null), [reload, setReload] = useState(0);
  const [replyTo, setReplyTo] = useState(null), [state, setState] = useState('published'), [type, setType] = useState(''), [health, setHealth] = useState(''), [search, setSearch] = useState('');
  const [composerDirty, setComposerDirty] = useState(false), [composerPending, setComposerPending] = useState(false), [changeReply, setChangeReply] = useState(null);
  useEffect(() => { onDirtyChange(editorState.dirty); }, [editorState.dirty, onDirtyChange]);
  useEffect(() => { onPendingChange(editorState.pending); }, [editorState.pending, onPendingChange]);
  function chooseReply(target) { if (composerPending) { setError(new Error('Retry the uncertain save before starting another reply.')); return; } if (composerDirty) setChangeReply({ target }); else setReplyTo(target); }
  useEffect(() => { setReplyTo(null); }, [workspaceId, targetType, targetId]);
  useEffect(() => { const controller = new AbortController(); setLoading(true); setError(null); setEntries([]); rumboApi.listActivity({ workspaceId, targetType, targetId, includeArchived: true }, { signal: controller.signal }).then(response => { if (!controller.signal.aborted) { setEntries(response.result); const focused = response.result.find(item => item.id === focusEntryId); if (focused) setState(focused.archived_at ? 'archived' : focused.publication_state || 'published'); } }).catch(cause => { if (!controller.signal.aborted) setError(cause); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [workspaceId, targetType, targetId, reload, focusEntryId]);
  useEffect(() => { if (!loading && focusEntryId) document.getElementById(activityAnchor(focusEntryId))?.scrollIntoView({ block: 'center', behavior: 'instant' }); }, [loading, focusEntryId, state]);
  const threads = useMemo(() => filteredActivityThreads(entries, { state, type, health, search }), [entries, state, type, health, search]);
  function changed(result) { setEntries(current => current.some(item => item.id === result.id) ? current.map(item => item.id === result.id ? result : item) : [...current, result]); }
  function saved(result) { changed(result); setReplyTo(null); notify(result.publication_state === 'draft' ? 'Draft saved privately. Find it under My drafts.' : 'Update published. Find it under Published.'); }
  return <section className="activity-feed" aria-labelledby={`activity-title-${targetId}`}><div className="section-heading"><div><h2 id={`activity-title-${targetId}`}>{title}</h2><p>Progress, decisions, evidence, and conversations in one place.</p></div><span className="activity-count">{entries.filter(item => !item.parent_id && !item.archived_at && item.publication_state !== 'draft').length}</span></div>
    <ActivityComposer key={`${workspaceId}:${targetType}:${targetId}:${replyTo?.id || 'new'}`} workspaceId={workspaceId} targetType={targetType} targetId={targetId} replyTo={replyTo} onSaved={saved} onDirtyChange={setComposerDirty} onPendingChange={setComposerPending} onCancel={replyTo ? () => chooseReply(null) : undefined} />
    <div className="activity-filter-bar"><Select aria-label="Update visibility" value={state} onChange={value => requestUpdateNavigation(() => setState(value))}><option value="published">Published</option><option value="draft">My drafts</option><option value="archived">Archived</option></Select><Select aria-label="Filter update type" value={type} onChange={value => requestUpdateNavigation(() => setType(value))}><option value="">All types</option>{UPDATE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><Select aria-label="Filter health" value={health} onChange={value => requestUpdateNavigation(() => setHealth(value))}><option value="">All health signals</option>{UPDATE_HEALTH.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><SearchField label="Search updates" placeholder="Search updates…" value={search} onChange={value => requestUpdateNavigation(() => setSearch(value))} /></div><ErrorMessage error={error} />
    {loading ? <div className="activity-state" role="status">Loading updates…</div> : error ? <div className="activity-state"><strong>Updates could not be loaded</strong><Button onClick={() => setReload(value => value + 1)}>Try again</Button></div> : threads.length ? <div className="activity-list">{threads.map(entry => <ActivityEntry key={entry.id} entry={entry} workspaceId={workspaceId} focused={entry.id === focusEntryId} onReply={chooseReply} onChanged={changed} />)}</div> : <div className="activity-state"><MessageCircle /><strong>{state === 'draft' ? 'No private drafts' : state === 'archived' ? 'No archived updates' : 'No matching updates'}</strong><span>{search || type || health ? 'Try changing your filters.' : 'Share progress, a decision, or a question above.'}</span></div>}
    {changeReply ? <Dialog title="Discard unsaved text?" onClose={() => setChangeReply(null)}><p>Save your draft first if you want to keep it.</p><div className="activity-editor-toolbar"><Button onClick={() => setChangeReply(null)}>Keep writing</Button><Button onClick={() => { setReplyTo(changeReply.target); setChangeReply(null); }}>Discard and continue</Button></div></Dialog> : null}
    {['document', 'chat'].includes(targetType) ? <ActivityTimeline workspaceId={workspaceId} targetType={targetType} targetId={targetId} /> : null}
  </section>;
}

function InlineReply({ entry, workspaceId, onCancel, onSaved }) {
  const [dirty, setDirty] = useState(false), [pending, setPending] = useState(false), [discard, setDiscard] = useState(false);
  return <div className="inline-update-reply"><ActivityComposer workspaceId={workspaceId} targetType={entry.target_type} targetId={entry.target_id} replyTo={entry} onSaved={onSaved} onDirtyChange={setDirty} onPendingChange={setPending} onCancel={() => { if (!pending) { if (dirty) setDiscard(true); else onCancel(); } }} />{discard ? <Dialog title="Discard reply?" onClose={() => setDiscard(false)}><p>Your reply has not been posted.</p><Button onClick={() => setDiscard(false)}>Keep writing</Button><Button onClick={onCancel}>Discard reply</Button></Dialog> : null}</div>;
}

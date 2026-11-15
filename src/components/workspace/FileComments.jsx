import { useEffect, useId, useRef, useState } from 'react';
import { Button, Dialog, ErrorMessage } from '../../ui.jsx';
import { apiRequest } from '../../data/api.js';
import { directoryApiPath } from '../../lib/directory-drafts.js';
import { beginContextDrag, endWorkspaceContextDrag } from '../../lib/workspace-context-drop.js';
import { commentContextSource, createCommentRetryKeys, fileCommentsApiPath, fileCommentSelection, fileCommentSidebarItems, commentDragProps } from '../../lib/file-comments.js';
import './file-comments.css';
import {copyUserText} from '../../lib/clipboard.js';
import {useUnsavedUpdate,requestUpdateNavigation} from '../UnsavedUpdates.jsx';

function useRetryMutation(workspaceId, bindingVersion, suffix = '') {
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), lock = useRef(false), retries = useRef(null);
  const scope = `${workspaceId}:${bindingVersion}:${suffix}`, currentScope = useRef(scope), mounted = useRef(true); currentScope.current = scope;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  if (!retries.current) retries.current = createCommentRetryKeys();
  async function mutate(action, body) {
    if (lock.current) return null;
    lock.current = true; setBusy(true); setError(null);
    const payload = { ...body, expected_binding_version: bindingVersion, confirmed: true };
    try {
      const { result } = await apiRequest(fileCommentsApiPath(workspaceId, action), { method: 'POST', body: { ...payload, request_id: retries.current.key(action, payload) } });
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('frondose:file-comments-changed', { detail: { workspaceId } }));
      retries.current.forget(action, payload); return mounted.current && currentScope.current === scope ? result : null;
    } catch (cause) { if (mounted.current && currentScope.current === scope) setError(cause); return null; }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return { busy, error, setError, mutate };
}

export function FileCommentComposer({ workspaceId, bindingVersion, path, fileVersion, content, start, end, dirty = false, compact = false, onClose, onCreated }) {
  const [body, setBody] = useState(''), label = useId(), { busy, error, mutate } = useRetryMutation(workspaceId, bindingVersion);
  useUnsavedUpdate(Boolean(body.trim()),busy);
  useEffect(()=>{const guard=event=>{if(body.trim()||busy){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[body,busy]);
  const selected = fileCommentSelection({ content, start, end, fileVersion, dirty });
  async function submit(event) {
    event.preventDefault(); if (!selected || !body.trim()) return;
    const thread = await mutate('threads', { path, expected_file_version: fileVersion, start, end, quote: selected.quote, body });
    if (thread) { setBody(''); onCreated?.(thread); onClose?.(); }
  }
  return <section className={`file-comment-inline ${compact?'is-margin-note':''}`} role="region" aria-label="New review note"><h3>Selected text</h3><form className="file-comment-composer" onSubmit={submit} data-field-defaults-exclude="true">{!compact?<p className="file-comment-source">{path}{selected ? ` · lines ${selected.startLine}–${selected.endLine}` : ''}</p>:null}{selected&&!compact ? <blockquote>{selected.quote}</blockquote> : !selected?<p role="status">Save this file, then select up to 4,000 characters to attach a comment.</p>:null}<label htmlFor={label} className={compact?'sr-only':undefined}>Comment</label><textarea id={label} autoFocus maxLength={8000} rows={4} value={body} onChange={event => setBody(event.target.value)} disabled={busy} placeholder="Discuss this selection…"/>{!compact?<p className="file-comment-hint">@AI mentions stay in the discussion. Drag the thread into an AI CLI to review its context before sending.</p>:null}<ErrorMessage error={error}/><div className="file-comment-actions"><Button disabled={busy} onClick={()=>requestUpdateNavigation(onClose)}>Cancel</Button><Button type="submit" variant="primary" busy={busy} disabled={!selected || !body.trim()}>{compact?'Add note ↵':'Add comment'}</Button></div></form></section>;
}

export function FileCommentHandoff({ workspaceId, bindingVersion, thread, all = false, disabled = false }) {
  const [copyPreview,setCopyPreview]=useState(null);
  const [busy, setBusy] = useState(false), [copied, setCopied] = useState(false), [error, setError] = useState(null);
  const context = all ? { kind: 'comments', rootVersion: bindingVersion } : commentContextSource(thread, bindingVersion);
  async function copy() {
    if (busy) return; setBusy(true); setError(null);
    try { const { result } = await apiRequest(fileCommentsApiPath(workspaceId, 'context', { expected_binding_version: bindingVersion, ...(all ? {} : { thread_id: thread.id }) })); if(await copyUserText(result.text))setCopied(true);else setCopyPreview(result.text); }
    catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  return <div className="file-comment-handoff">{copyPreview!==null?<Dialog title="Copy comment context" onClose={()=>setCopyPreview(null)}><div className="dialog-body"><p>Clipboard access is blocked in this browser. Select the text below and use your system’s Copy shortcut.</p><textarea className="comment-copy-preview" aria-label="Comment context to copy" readOnly value={copyPreview} rows={10} onFocus={event=>event.target.select()} data-field-defaults-exclude="true"/><Button onClick={event=>event.currentTarget.parentElement.querySelector('textarea').focus()}>Select text</Button></div><footer className="dialog-footer"><Button onClick={()=>setCopyPreview(null)}>Close</Button></footer></Dialog>:null}<Button draggable={!disabled && Boolean(context)} disabled={!context} onDragStart={event => { if (!beginContextDrag(event.dataTransfer, workspaceId, context)) event.preventDefault(); }} onDragEnd={endWorkspaceContextDrag} title="Drag into an editor, input or AI CLI to insert reference text">Drag {all ? 'all comments' : 'thread'} to input</Button><Button disabled={disabled || !context || busy} busy={busy} onClick={copy}>{copied ? 'Copied context' : 'Copy context'}</Button><ErrorMessage error={error}/></div>;
}

export function FileCommentThread({ workspaceId, bindingVersion, threadId, refreshKey = 0, onChanged, onOpenFile: openFile }) {
  const onOpenFile = openFile ? (path, line) => openFile(path, line, bindingVersion) : null;
  const [thread, setThread] = useState(null), [loading, setLoading] = useState(true), [readError, setReadError] = useState(null), [revision, setRevision] = useState(0), [reply, setReply] = useState(''), replyLabel = useId();
  const { busy, error, setError, mutate } = useRetryMutation(workspaceId, bindingVersion, threadId);
  useUnsavedUpdate(Boolean(reply.trim()),busy);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setThread(null); setReadError(null);
    apiRequest(fileCommentsApiPath(workspaceId, `threads/${threadId}`, { expected_binding_version: bindingVersion }), { signal: controller.signal }).then(({ result }) => { if (!controller.signal.aborted) setThread(result); }).catch(cause => { if (!controller.signal.aborted) setReadError(cause); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspaceId, bindingVersion, threadId, refreshKey, revision]);
  useEffect(() => { setReply(''); setError(null); }, [workspaceId, bindingVersion, threadId]);
  async function change(action, body) {
    if (!thread) return false;
    const result = await mutate(`threads/${thread.id}/${action}`, { expected_version: thread.version, ...body });
    if (!result) return false;
    setThread(result); onChanged?.(result); return true;
  }
  if (loading) return <p role="status">Loading discussion…</p>;
  if (readError) return <div><ErrorMessage error={readError}/><Button onClick={() => setRevision(value => value + 1)}>Retry</Button></div>;
  if (!thread || thread.id !== threadId) return <p role="status">Loading discussion…</p>;
  return <section {...commentDragProps(workspaceId,thread,bindingVersion)} className="file-comment-thread" aria-label="Comment discussion" data-field-defaults-exclude="true"><header><div><strong>{thread.path}</strong><span>Lines {thread.start_line}–{thread.end_line} · {thread.resolved ? 'Resolved' : 'Open'}</span></div><div className="file-comment-actions">{onOpenFile ? <Button onClick={() => onOpenFile(thread.path, thread.start_line)}>Open file</Button> : null}<Button disabled={busy} onClick={() => change('resolve', { resolved: !thread.resolved })}>{thread.resolved ? 'Reopen' : 'Resolve'}</Button><Button disabled={busy} onClick={() => setRevision(value => value + 1)}>Refresh</Button></div></header><blockquote>{thread.quote}</blockquote>{thread.anchor.status !== 'current' ? <div className="file-comment-outdated" role="status"><p>This file changed. This discussion still refers to its original saved selection.</p>{thread.anchor.relocation ? <Button disabled={busy} onClick={() => change('relocate', { expected_file_version: thread.anchor.relocation.fileVersion })}>Reattach exact quote at lines {thread.anchor.relocation.startLine}–{thread.anchor.relocation.endLine}</Button> : <p>The exact quote is missing or appears more than once; it was not reattached.</p>}</div> : null}<ol className="file-comment-entries">{thread.entries.map(entry => <li key={entry.id}><header><strong>You</strong><time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString()}</time></header><p>{entry.body}</p><div className="file-comment-reactions" aria-label="Reactions">{[['like', 'Like'], ['heart', 'Heart'], ['celebrate', 'Celebrate'], ['question', 'Question']].map(([reaction, name]) => { const active = entry.reactions.some(value => value.reaction === reaction && value.actor_id === 'local-owner'); return <button key={reaction} type="button" disabled={busy} aria-pressed={active} onClick={() => change('reaction', { entry_id: entry.id, reaction, enabled: !active })}>{name}{active ? ' · 1' : ''}</button>; })}</div></li>)}</ol><ErrorMessage error={error}/><form onSubmit={async event => { event.preventDefault(); if (reply.trim() && await change('replies', { body: reply })) setReply(''); }}><label htmlFor={replyLabel}>Reply</label><textarea id={replyLabel} rows={3} maxLength={8000} value={reply} onChange={event => setReply(event.target.value)} disabled={busy}/><div className="file-comment-actions"><Button type="submit" variant="primary" disabled={busy || !reply.trim() || thread.entry_count >= 100}>Reply</Button></div></form><p className="file-comment-hint">Drag this discussion to an input or copy its context.</p><FileCommentHandoff workspaceId={workspaceId} bindingVersion={bindingVersion} thread={thread}/></section>;
}

export function FileCommentsPanel({ workspaceId, path, bindingVersion, refreshKey = 0, threadId = null, onOpenThread, onThreadsChange, onOpenFile }) {
  const [listState, setListing] = useState(null), [error, setError] = useState(null), [revision, setRevision] = useState(0), [selected, setSelected] = useState(threadId), [offset, setOffset] = useState(0);
  const scopeKey = JSON.stringify([workspaceId, bindingVersion, path || '', offset]), listing = listState?.scopeKey === scopeKey ? listState.value : null;
  const callbacks = useRef({ onThreadsChange }); callbacks.current = { onThreadsChange };
  useEffect(() => { setSelected(threadId); setOffset(0); }, [threadId, workspaceId, bindingVersion, path]);
  useEffect(() => {
    const controller = new AbortController(); setError(null);
    apiRequest(fileCommentsApiPath(workspaceId, '', { expected_binding_version: bindingVersion, path, offset }), { signal: controller.signal }).then(({ result }) => { if (!controller.signal.aborted) { setListing({ scopeKey, value: result }); callbacks.current.onThreadsChange?.(fileCommentSidebarItems(result.threads, bindingVersion), result); } }).catch(cause => { if (!controller.signal.aborted) setError(cause); });
    return () => controller.abort();
  }, [workspaceId, bindingVersion, path, refreshKey, revision, offset]);
  return <section className="file-comments-panel" aria-label={path ? 'File comments' : 'Workspace comments'}><header className="file-comments-heading"><h2>Comments</h2><Button onClick={() => setRevision(value => value + 1)}>Refresh</Button></header><ErrorMessage error={error}/>{!listing && !error ? <p role="status">Loading comments…</p> : null}{listing ? <div className={`file-comments-layout ${selected ? 'has-discussion' : ''} ${!listing.threads.length && !selected ? 'is-empty' : ''}`}><aside className="file-comments-list">{listing.threads.length ? <FileCommentHandoff workspaceId={workspaceId} bindingVersion={bindingVersion} all/> : null}{listing.unavailable_count ? <p role="status">Some comments are hidden because their source files are no longer readable.</p> : null}{!listing.threads.length ? <div className="file-comments-start"><h3>No comments yet</h3><p>Select saved file text or hover a line, then choose Comment to start a discussion.</p></div> : <ul>{listing.threads.map(thread => <li key={thread.id}><button type="button" draggable onDragStart={event => { if (!beginContextDrag(event.dataTransfer, workspaceId, commentContextSource(thread, bindingVersion))) event.preventDefault(); }} onDragEnd={endWorkspaceContextDrag} aria-current={selected === thread.id ? 'true' : undefined} onClick={() => { setSelected(thread.id); onOpenThread?.(thread.id); }}><strong>{thread.path}</strong><span>{thread.body}</span><small>Lines {thread.start_line}–{thread.end_line} · {thread.resolved ? 'Resolved' : 'Open'}{thread.anchor.status !== 'current' ? ' · Outdated' : ''} · {thread.entry_count} {thread.entry_count === 1 ? 'entry' : 'entries'}</small></button></li>)}</ul>}<div className="file-comment-actions">{offset > 0 ? <Button onClick={() => setOffset(value => Math.max(0, value - 50))}>Previous</Button> : null}{listing.next_offset !== null ? <Button onClick={() => setOffset(listing.next_offset)}>More comments</Button> : null}</div></aside>{selected ? <FileCommentThread workspaceId={workspaceId} bindingVersion={bindingVersion} threadId={selected} refreshKey={refreshKey} onChanged={() => setRevision(value => value + 1)} onOpenFile={onOpenFile}/> : listing.threads.length ? <div className="file-comments-empty">Choose a discussion to see its saved selection, replies and reactions.</div> : null}</div> : null}</section>;
}

export function FileCommentsPage({ workspaceId, threadId = null, onOpenThread, onThreadsChange, onOpenFile }) {
  const [directoryState, setDirectory] = useState(null), [error, setError] = useState(null), [revision, setRevision] = useState(0);
  const directory = directoryState?.workspaceId === workspaceId ? directoryState.value : null;
  useEffect(() => { const controller = new AbortController(); setError(null); apiRequest(directoryApiPath(workspaceId), { signal: controller.signal }).then(({ result }) => { if (!controller.signal.aborted) setDirectory({ workspaceId, value: result }); }).catch(cause => { if (!controller.signal.aborted) setError(cause); }); return () => controller.abort(); }, [workspaceId, revision]);
  useEffect(() => { const refresh = event => { if (!event.detail?.workspaceId || event.detail.workspaceId === workspaceId) setRevision(value => value + 1); }; const events = ['frondose:repository-connected', 'frondose:directory-changed']; for (const event of events) window.addEventListener(event, refresh); return () => { for (const event of events) window.removeEventListener(event, refresh); }; }, [workspaceId]);
  return <div className="file-comments-page"><ErrorMessage error={error}/>{error ? <Button onClick={() => setRevision(value => value + 1)}>Retry</Button> : !directory ? <p role="status">Opening comments…</p> : !directory.ready ? <div><h1>Comments</h1><p>Choose a workspace directory before attaching comments to saved files.</p>{directory.error ? <p>{directory.error}</p> : null}</div> : <FileCommentsPanel key={`${workspaceId}:${directory.binding.version}`} workspaceId={workspaceId} bindingVersion={directory.binding.version} threadId={threadId} onOpenThread={onOpenThread} onThreadsChange={onThreadsChange} onOpenFile={onOpenFile}/>}</div>;
}

import { useEffect, useState } from 'react';
import { Button, Dialog, ErrorMessage, Field, Select, useApp } from '../ui.jsx';
import { apiRequest } from '../data/api.js';
import { ChangeReview } from './ChangeReview.jsx';
import { pageHash } from '../lib/navigation.js';

const request = async (path, body, signal) => (await apiRequest(`/api/change-reviews${path}`, { ...(body ? { method: 'POST', body } : {}), signal, timeoutMs: 60000 })).result;
async function reviewSubmissionKey(connectionId, input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)));
  const storageKey = `rumbo-review-submit:${connectionId}:${Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('')}`;
  let key = sessionStorage.getItem(storageKey);
  if (!key) { key = crypto.randomUUID(); sessionStorage.setItem(storageKey, key); }
  return key; // Same payload retains its key across dialog closes and page reloads.
}
export function ReviewPanel({ targetType, targetId, projectId, connection, environmentId, defaultOpen = false }) {
  const { page } = useApp();
  const [open, setOpen] = useState(defaultOpen || Boolean(page.reviewId));
  useEffect(() => { if (page.reviewId) setOpen(true); }, [page.reviewId]);
  return <details className="review-source" open={open} onToggle={e => setOpen(e.currentTarget.open)}><summary>{targetType === 'document' ? 'Revision comparison & review' : 'Changes & review'}</summary>{open ? <ReviewWorkspace key={`${targetType}:${targetId}:${environmentId}`} {...{ targetType, targetId, projectId, connection, environmentId }} /> : null}</details>;
}
function ReviewWorkspace({ targetType, targetId, projectId, connection, environmentId }) {
  const { workspace, data, navigate, notify, page } = useApp();
  const [chosenProject, setChosenProject] = useState(projectId || ''), [kind, setKind] = useState(targetType === 'document' ? 'document' : connection ? 'github' : 'local');
  const [mode, setMode] = useState('working'), [base, setBase] = useState('master'), [head, setHead] = useState('HEAD');
  const [connections, setConnections] = useState(connection ? [connection] : []), [connectionId, setConnectionId] = useState(connection?.id || ''), [repo, setRepo] = useState(connection?.settings.selected_resources[0] || ''), [number, setNumber] = useState('');
  const [history, setHistory] = useState([]), [revisionId, setRevisionId] = useState(''), [snapshots, setSnapshots] = useState([]);
  const [comparison, setComparison] = useState(null), [review, setReview] = useState(null), [loadedSource, setLoadedSource] = useState(null);
  const [error, setError] = useState(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [followup, setFollowup] = useState(null), [chatId, setChatId] = useState(''), [recipient, setRecipient] = useState('note');
  const [ghReview, setGhReview] = useState(null), [ghBody, setGhBody] = useState(''), [ghEvent, setGhEvent] = useState('COMMENT'), [pulls, setPulls] = useState([]);
  const scope = { workspace_id: workspace.id, target_type: targetType || 'project', target_id: targetId || chosenProject };
  const selectedConnection = connections.find(item => item.id === connectionId), repositories = selectedConnection?.settings.selected_resources || [];
  const source = kind === 'local' ? { kind, mode, base, head, environment_id: environmentId } : kind === 'document' ? { kind, revision_id: revisionId } : { kind, connection_id: connectionId, resource_id: repo, number };
  async function act(fn) { setBusy(true); setError(null); try { return await fn(); } catch (cause) { setError(cause); throw cause; } finally { setBusy(false); } }
  const perform = fn => act(fn).catch(() => {});
  const refreshList = async () => { if (scope.target_id) setSnapshots(await request(`?${new URLSearchParams(scope)}`)); };
  useEffect(() => {
    if (!page.reviewId) return;
    const controller = new AbortController();
    request(`/${encodeURIComponent(page.reviewId)}`, null, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      if (value.workspace_id !== workspace.id) { setError(new Error('Switch to the workspace that owns this review.')); return; }
      if (targetType === 'project' ? value.project_id !== targetId : value.target_type !== targetType || value.target_id !== targetId) return;
      setReview(value); setComparison(value.comparison); setLoadedSource(value.source); setNotice('Linked saved version, not a live view.');
    }).catch(cause => { if (!controller.signal.aborted) setError(cause); });
    return () => controller.abort();
  }, [page.reviewId, workspace.id, targetType, targetId]);
  function reviewLink(value) {
    const view = value.project_id ? 'projects' : { document: 'documents', route: 'tasks', chat: 'chats', run: 'work', project: 'projects' }[value.target_type];
    return `${location.origin}${location.pathname}${pageHash(view, value.project_id || value.target_id, { reviewId: value.id })}`;
  }
  useEffect(() => {
    const controller = new AbortController();
    if (scope.target_id) request(`?${new URLSearchParams(scope)}`, null, controller.signal).then(setSnapshots).catch(e => { if (!controller.signal.aborted) setError(e); });
    if (!connection) apiRequest(`/api/connection-platform/connections?workspace_id=${encodeURIComponent(workspace.id)}`, { signal: controller.signal }).then(res => { if (!controller.signal.aborted) setConnections(res.result.filter(item => item.provider === 'github')); }).catch(() => {});
    if (targetType === 'document') apiRequest(`/api/history/${targetId}?workspace_id=${workspace.id}`, { signal: controller.signal }).then(res => { setHistory(res.result); setRevisionId(res.result[0]?.id || ''); }).catch(e => { if (!controller.signal.aborted) setError(e); });
    return () => controller.abort();
  }, [workspace.id, scope.target_id, targetType, connection?.id]);
  async function load() { const value = await request('/compare', { ...scope, source }); setLoadedSource(source); setComparison(value); setReview(null); setNotice(''); }
  async function save() { const value = await request('', { ...scope, source: loadedSource, fingerprint: comparison.fingerprint }); setReview(value); setComparison(value.comparison); await refreshList(); return value; }
  async function reviewMutation(action, fields) { const value = await request(`/${review.id}/${action}`, fields); setReview(value); }
  async function checkNewer() {
    if (!review) return load();
    const result = await request(`/${review.id}/refresh`, {});
    setNotice(result.immutable ? 'Run capture is immutable. It records the before/after observation, not the current working folder.' : result.current ? 'This snapshot still matches the source.' : 'Newer changes exist. Comments below remain attached to the saved version. Load a new comparison to review the latest changes.');
  }
  const relevantChats = (data.chats || []).filter(chat => !chat.archived_at && (!projectId || chat.project_id === projectId));
  function openGitHubReview(selection) { setGhReview({ source: loadedSource, head: comparison.head, selection }); setGhBody(selection?.body || ''); setGhEvent('COMMENT'); }
  async function submitGitHubReview() {
    const input = { resource_id: ghReview.source.resource_id, number: String(ghReview.source.number), commit_id: ghReview.head, event: ghEvent, body: ghBody, ...(ghReview.selection ? { path: ghReview.selection.path, line: String(ghReview.selection.line), side: ghReview.selection.side } : {}) };
    const key = await reviewSubmissionKey(ghReview.source.connection_id, input);
    const result = (await apiRequest(`/api/connection-platform/connections/${ghReview.source.connection_id}/actions`, { method: 'POST', body: { action: 'review_pull', idempotency_key: key, input } })).result;
    if (result.approval_required) throw new Error('Approval is pending in Inbox → Access approvals. Retry this same draft after approval.');
    setGhReview(null); notify('Review posted to GitHub.');
  }
  return <div>
    {!targetId ? <Select label="Link review to project" value={chosenProject} onChange={value => { setChosenProject(value); setReview(null); setComparison(null); }}><option value="">Choose project</option>{data.projects.filter(p => !p.archived_at).map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</Select> : null}
    <div className="review-source-fields"><Select label="Comparison source" value={kind} onChange={setKind}>{targetType === 'document' ? <option value="document">Document revisions</option> : null}<option value="local">Local Git</option><option value="github">GitHub pull request</option></Select>
      {kind === 'local' ? <><Select label="Compare" value={mode} onChange={setMode}><option value="working">Working changes</option><option value="staged">Staged changes</option><option value="compare">Branches or commits</option></Select>{mode === 'compare' ? <><Field label="Base branch, tag or SHA"><input value={base} onChange={e => setBase(e.target.value)} /></Field><Field label="Head branch, tag or SHA"><input value={head} onChange={e => setHead(e.target.value)} /></Field></> : null}</> : kind === 'document' ? <Select label="Saved revision" value={revisionId} onChange={setRevisionId}><option value="">Choose revision</option>{history.map(item => <option key={item.id} value={item.id}>{new Date(item.created_at).toLocaleString()} · {item.action}</option>)}</Select> : <><Select label="GitHub connection" value={connectionId} onChange={value => { setConnectionId(value); setRepo(''); setPulls([]); }}><option value="">Choose connection</option>{connections.map(c => <option value={c.id} key={c.id}>{c.account_label || c.name || c.id}</option>)}</Select><Select label="Repository" value={repo} onChange={value => { setRepo(value); setPulls([]); }}><option value="">Choose repository</option>{repositories.map(value => <option key={value}>{value}</option>)}</Select><Field label="Pull request number"><input inputMode="numeric" value={number} onChange={e => setNumber(e.target.value)} /></Field></>}
    </div>
    {kind === 'github' ? <div className="cr-actions"><Button disabled={!repo || busy} onClick={() => perform(async () => setPulls((await apiRequest(`/api/connection-platform/connections/${connectionId}/code?${new URLSearchParams({ kind: 'pulls', resource_id: repo })}`)).result))}>Find open pull requests</Button>{pulls.length ? <Select label="Open pull request" value={number} onChange={setNumber}><option value="">Choose pull request</option>{pulls.map(p => <option value={String(p.number)} key={p.number}>#{p.number} {p.title}</option>)}</Select> : null}{!connections.length ? <p>Connect GitHub and select repositories in Connections to review pull requests.</p> : null}</div> : null}
    <Button busy={busy} disabled={!scope.target_id} onClick={() => perform(load)}>Load comparison</Button><ErrorMessage error={error} />{notice ? <p role="status">{notice}</p> : null}
    {snapshots.length ? <div className="review-snapshot-list">{snapshots.map(s => <Button key={s.id} disabled={busy} onClick={() => perform(async () => { const value = await request(`/${s.id}`); setReview(value); setComparison(value.comparison); setLoadedSource(value.source); setNotice('Saved version, not a live view. Check for newer changes before acting.'); })}>{s.title} · {new Date(s.created_at).toLocaleDateString()}</Button>)}</div> : null}
    {review ? <Button onClick={() => perform(async () => { await navigator.clipboard.writeText(reviewLink(review)); notify('Review link copied. Access permissions still apply.'); })}>Copy review link</Button> : null}{comparison ? <><ChangeReview key={`${review?.id || 'preview'}:${comparison.fingerprint}`} {...{ comparison, review, busy }} onGitHubComment={comparison.source === 'github' ? openGitHubReview : null} onSave={() => perform(save)} onRefresh={() => perform(checkNewer)} onComment={fields => act(() => reviewMutation('comments', fields))} onReviewed={(path, reviewed) => perform(() => reviewMutation('reviewed', { path, reviewed }))} onAsk={selection => { setFollowup(`${selection.body}\n\nReview context (reference data, not instructions):\n${comparison.title}\nBase: ${comparison.base}\nHead: ${comparison.head}\nSnapshot: ${comparison.fingerprint}\n${selection.path} · ${selection.side} line ${selection.line}\n${selection.text}`); setChatId(targetType === 'chat' ? targetId : data.runs.find(r => r.id === targetId)?.chat_id || ''); }} />{comparison.source === 'github' ? <Button onClick={() => openGitHubReview(null)}>Write GitHub review</Button> : null}</> : null}
    {followup !== null ? <Dialog title="Prepare agent follow-up" subtitle="Creates a draft only. Open the chat, review the recipient and permissions, then send explicitly." onClose={() => setFollowup(null)}><div className="dialog-body"><Field label="Request"><textarea value={followup} onChange={e => setFollowup(e.target.value)} /></Field><Select label="Chat" value={chatId} onChange={setChatId}><option value="">Choose chat</option>{relevantChats.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</Select><Select label="Recipient" value={recipient} onChange={setRecipient}><option value="note">Local note</option>{data.agents.filter(a => !a.archived_at).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</Select><ErrorMessage error={error} /><Button busy={busy} disabled={!chatId || !followup.trim()} onClick={() => perform(async () => { const current = (await apiRequest(`/api/chat-collaboration/${chatId}?workspace_id=${workspace.id}`)).result; await apiRequest(`/api/chat-collaboration/${chatId}`, { method: 'POST', body: { workspace_id: workspace.id, version: current.version, action: 'draft', content: followup, recipient, permission: 'read-only' } }); setFollowup(null); notify('Follow-up saved in chat drafts. No agent was started.'); navigate('chats', chatId); })}>Save draft and open chat</Button></div></Dialog> : null}
    {ghReview ? <Dialog title="Submit GitHub review" subtitle="This posts to GitHub. Required connection features, permissions and owner approvals still apply." onClose={() => setGhReview(null)}><div className="dialog-body"><p>{ghReview.source.resource_id} #{ghReview.source.number} · {ghReview.head.slice(0, 12)}</p>{ghReview.selection ? <p>{ghReview.selection.path} · {ghReview.selection.side} line {ghReview.selection.line}</p> : null}<Select label="Decision" value={ghEvent} onChange={setGhEvent}><option value="COMMENT">Comment</option><option value="APPROVE">Approve</option><option value="REQUEST_CHANGES">Request changes</option></Select><Field label="Review summary"><textarea value={ghBody} maxLength={10000} onChange={e => setGhBody(e.target.value)} /></Field><ErrorMessage error={error} /><Button busy={busy} disabled={!ghBody.trim()} onClick={() => perform(submitGitHubReview)}>Submit review to GitHub</Button></div></Dialog> : null}
  </div>;
}

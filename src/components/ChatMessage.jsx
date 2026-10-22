import { ExternalLink, RotateCw, CircleCheck, Copy, Download, FileText, GitBranch, Square, MessageCircle, Pin, PinOff, Ellipsis, Plus } from "./icons.jsx";
import { Button, IconButton, useApp } from '../ui.jsx';
import { DocumentContent } from './DocumentContent.jsx';
import { download, initials, relative, val } from '../lib/model.js';
import { ACTIVE_CHAT_RUNS } from '../lib/chats.js';
import { frondoseActions } from '../data/useFrondose.js';
import { useEffect, useRef, useState } from 'react';
import { Check } from './icons.jsx';
import { ReactionGlyph } from './ReactionGlyph.jsx';
import { customEmojis } from '../lib/custom-emojis.js';
import { getReaction, reactionKey } from '../lib/reaction-catalog.js';
import { AgentActionReview } from './AgentActionReview.jsx';
import { AgentIdentity } from './AgentIdentity.jsx';
import { MessageResources } from './MessageResources.jsx';
import { readerTarget } from '../lib/message-resources.js';
import { pageHash } from '../lib/navigation.js';

export function ChatRunStatus({ run, onRetry, retrying }) {
  const { data, navigate, perform } = useApp();
  const events = data.events.filter(event => val(event, 'run_id') === run.id);
  const event = events.at(-1);
  const active = ACTIVE_CHAT_RUNS.has(run.status);
  const [clock, setClock] = useState(Date.now);
  useEffect(() => { if (!active) return; const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, [active]);
  const summary = event?.summary || (active ? 'The session has started. Its progress will appear here.' : 'Open the session to review its result.');
  const configFailure = /invalid transport|config\.toml|tool configuration/i.test(summary);
  const failed = ['failed', 'interrupted'].includes(run.status);
  const failure = configFailure ? 'The provider could not load its tool configuration. Your message is saved.' : /403|forbidden/i.test(summary) ? 'The provider refused the connection (403). Your message is saved; check provider access before retrying.' : 'The agent could not finish this reply. Your message is saved.';
  const started = Date.parse(val(run, 'started_at') || val(run, 'created_at'));
  const elapsed = Number.isFinite(started) ? Math.max(0, Math.round(((Date.parse(val(run, 'finished_at')) || clock) - started) / 1000)) : 0;
  return <div className={`chat-run-status ${active ? 'is-active' : ''}`}>
    <div className="chat-compact-activity"><span className={`chat-work-dot ${active ? 'is-working' : ''}`} aria-hidden="true" /><span>{run.agent_name || 'Agent'} · {active ? 'Working' : run.status === 'completed' ? 'Work complete' : failed ? 'Reply interrupted' : 'Stopped'} · {elapsed}s{run.mode === 'mock' ? ' · Simulation' : ''}</span></div>
    {failed ? <p role="status">{failure}</p> : null}
    {failed ? <details className="chat-error-details"><summary>Technical details</summary><pre>{summary}</pre></details> : null}
    <div className="chat-run-actions">
      <Button variant="ghost" icon={ExternalLink} onClick={() => navigate('work', run.id)}>Open Active work</Button>
      {active ? <Button variant="ghost" icon={Square} onClick={() => perform(() => frondoseActions.stopRun(run.id), 'Session stopped')}>Stop</Button> : null}
      {['failed', 'stopped', 'cancelled', 'interrupted'].includes(run.status) && onRetry ? <Button variant="ghost" busy={retrying} icon={RotateCw} onClick={onRetry}>Retry reply</Button> : null}
    </div>
  </div>;
}

export function ChatMessage({ message, chat, project, run, onRetry, retrying, onPreview, bookmarked, onBookmark, onReply, onOptions, replyMessage, onJump, replyCount, onThread, onContext, selectionMode, selected, onSelect, reactions = [], onReact, onToggleReaction, reactionBusy }) {
  const { data, page, navigate, perform, notify } = useApp();
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(null);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  const type = val(message, 'sender_type'), isAgent = type === 'agent';
  const profile = data.agents.find(agent => agent.id === val(message, 'sender_id'));
  const provider = profile?.provider || data.runs.find(item => item.id === message.metadata?.run_id)?.provider;
  const replyRun = isAgent ? data.runs.find(item => item.id === message.metadata?.run_id) : null;
  const hasReply = run && data.messages.some(item => item.sender_type === 'agent' && item.metadata?.run_id === run.id);
  const openLink = linked => {
    const target = readerTarget(linked.view, linked.id);
    if (target) navigate('reader', target, { returnTo:pageHash(page.view,page.id,page) });
    else navigate(linked.view, linked.id, linked);
  };
  const ownMessage = type === 'user' && (val(message, 'sender_id') === data.profile?.id || ['local', 'local-owner'].includes(val(message, 'sender_id')) && ['local', 'local-owner'].includes(data.profile?.id));
  const name = ownMessage && data.profile?.self_display_name || val(message, 'sender_name') || (isAgent ? 'Agent' : data.profile?.name || 'You');
  return <article id={`message-${message.id}`} tabIndex={-1} className={`chat-message chat-message-${type === 'user' ? 'user' : isAgent ? 'agent' : 'system'} ${bookmarked ? 'is-bookmarked' : ''} ${selectionMode ? 'is-selectable' : ''} ${selected ? 'is-selected' : ''}`}>
    {selectionMode ? <label className="chat-message-select"><input type="checkbox" aria-label={`Select message from ${name}: ${message.content.slice(0, 50)}`} checked={Boolean(selected)} onChange={onSelect} /></label> : null}
    <span className="chat-message-avatar" aria-hidden="true">{isAgent ? <AgentIdentity agent={profile} provider={provider} compact /> : type === 'system' ? <GitBranch /> : ownMessage && data.profile?.avatar_url ? <img className="human-profile-photo" src={data.profile.avatar_url} alt="" /> : initials(name)}</span>
    <div className="chat-message-main">
      <header><strong>{name}</strong>{isAgent ? <span className="chat-message-kind">{message.metadata?.mode === 'mock' ? 'Simulation' : 'Agent'}</span> : null}<time dateTime={val(message, 'created_at')}>{relative(val(message, 'created_at'))}</time>
        <div className="chat-message-actions">
          {onReact ? <IconButton label="React to message" onClick={onReact}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M20 12a8 8 0 1 1-8-8M8 14c2 3 6 3 8 0M8 9h.01M14 9h.01M19 2v6M16 5h6" /></svg></IconButton> : null}
          <IconButton label={copied ? "Message copied" : "Copy message"} onClick={() => perform(async () => {
            await navigator.clipboard.writeText(message.content);
            setCopied(true);
            clearTimeout(copyTimer.current);
            copyTimer.current = setTimeout(() => setCopied(false), 1600);
            notify('Message copied');
          })}><Copy morphTo={copied ? Check : Copy} /></IconButton>
          {onReply ? <IconButton label="Reply to message" onClick={onReply}><MessageCircle /></IconButton> : null}
          {onBookmark ? <IconButton label={bookmarked ? 'Remove bookmark' : 'Bookmark message'} aria-pressed={Boolean(bookmarked)} onClick={onBookmark}><Pin morphTo={bookmarked ? PinOff : Pin} /></IconButton> : null}
          {onOptions ? <IconButton label="Message actions" onClick={onOptions}><Ellipsis /></IconButton> : null}
        </div>
      </header>
      {replyMessage ? <button className="chat-reply-reference" onClick={() => onJump?.(replyMessage.id)}><MessageCircle /><span>Reply to {val(replyMessage, 'sender_name')}: {replyMessage.content?.slice(0, 140)}</span></button> : null}
      {message.metadata?.delivery === 'branch_reference' ? <p className="chat-reference-label">Copied reference · no agent was run</p> : null}
      <div className="chat-message-body"><DocumentContent content={message.content} emojis={customEmojis(data.workspace_items, chat.workspace_id, true)} onInternalLink={openLink} /></div>
      {isAgent ? <><MessageResources message={message} run={replyRun} />{replyRun ? <AgentActionReview run={replyRun} /> : null}</> : null}
      {reactions.length ? <div className="chat-reactions" role="group" aria-label="Message reactions">{reactions.map(reaction => {
        const item = getReaction(reaction.id, customEmojis(data.workspace_items, chat.workspace_id, true)); if (!item) return null;
        return <button key={reactionKey(reaction)} type="button" aria-label={`Remove ${item.name} reaction${reaction.color ? ` (${reaction.color})` : ''}`} aria-pressed="true" disabled={reactionBusy} onClick={() => onToggleReaction?.(reaction)}><ReactionGlyph item={item} id={reaction.id} color={reaction.color} size={17} /><span>1</span></button>;
      })}<button type="button" className="chat-add-reaction" aria-label="Add another reaction" onClick={onReact}><Plus /></button></div> : null}
      {replyCount || message.metadata?.context_snapshot_id ? <div className="chat-message-footnotes">{replyCount ? <button onClick={onThread}><MessageCircle />{replyCount} {replyCount === 1 ? 'reply' : 'replies'}</button> : null}{message.metadata?.context_snapshot_id ? <button onClick={onContext}><FileText />Inspect selected context</button> : null}</div> : null}
      {message.attachments?.length ? <div className="chat-file-list">{message.attachments.filter(file => file && typeof file.name === 'string').map((file, index) => <div className="chat-file" key={`${file.name}-${index}`}>
        <button onClick={() => onPreview(file.rumbo_context_snapshot ? { ...file, name: 'Selected context snapshot' } : file)}>{file.type?.startsWith('image/') && /^data:image\/(png|jpeg|gif|webp);base64,/.test(file.content) ? <img src={file.content} alt="" /> : <FileText />}<span><strong>{file.rumbo_context_snapshot ? 'Selected context snapshot' : file.name}</strong><small>{file.rumbo_context_snapshot ? 'Frozen source references' : file.size ? `${Math.ceil(file.size / 1024)} KB` : 'Attachment'} · Preview</small></span></button>
        <IconButton label={`Download ${file.name}`} onClick={() => {
          if (typeof file.content !== 'string') return notify('Attachment content is unavailable', 'error');
          if (/^data:image\/(png|jpeg|gif|webp);base64,/.test(file.content)) {
            const link = document.createElement('a'); link.href = file.content; link.download = file.name; link.click();
          } else download(file.name, file.content, file.type || 'text/plain');
        }}><Download /></IconButton>
      </div>)}</div> : null}
      {run && (!hasReply || ACTIVE_CHAT_RUNS.has(run.status) || val(run,'work_mode') === 'project') ? <ChatRunStatus run={run} onRetry={onRetry} retrying={retrying} /> : null}
      {run && !hasReply && !ACTIVE_CHAT_RUNS.has(run.status) ? <AgentActionReview run={run} /> : null}
    </div>
  </article>;
}

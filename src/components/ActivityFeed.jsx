import { useEffect, useMemo, useState } from 'react';
import { Archive, MessageCircle, Plus } from './icons.jsx';
import { rumboApi } from '../data/api.js';
import { activityThreads, mentionedAgents, UPDATE_TYPES } from '../lib/activity.js';
import { parseSlashCommand, searchCommands } from '../lib/commands.js';
import { SlashCommandMenu } from './SlashCommandMenu.jsx';
import { Button, ErrorMessage, Select, useApp } from '../ui.jsx';
import { relative, visible } from '../lib/model.js';
import './activity-feed.css';

const TYPE_LABELS = Object.fromEntries(UPDATE_TYPES);

function FeedEntry({ entry, agents, onReply, onArchive, busy }) {
  const mentions = mentionedAgents(entry.content, agents);
  return <article className={`activity-entry activity-${entry.update_type}`}>
    <div className="activity-entry-marker" aria-hidden="true" />
    <div className="activity-entry-body">
      <header><span className="activity-type">{TYPE_LABELS[entry.update_type]}</span><strong>{entry.actor_name}</strong><time dateTime={entry.created_at}>{relative(entry.created_at)}</time></header>
      <p>{entry.content}</p>
      {mentions.length ? <div className="activity-agent-request"><strong>Agent request recorded</strong><span>{mentions.map(agent => `@${agent.name}`).join(', ')} was mentioned. This is a saved request for review; no agent was started.</span></div> : null}
      <div className="activity-entry-actions"><button type="button" onClick={() => onReply(entry)}><MessageCircle />Reply</button><button type="button" disabled={busy} onClick={() => onArchive(entry)}><Archive />Archive</button></div>
      {entry.replies.length ? <div className="activity-replies">{entry.replies.map(reply => <FeedEntry key={reply.id} entry={reply} agents={agents} onReply={onReply} onArchive={onArchive} busy={busy} />)}</div> : null}
    </div>
  </article>;
}

export function ActivityFeed({ workspaceId, targetType, targetId, title = 'Updates & replies' }) {
  const { data, edit, navigate } = useApp();
  const agents = useMemo(() => visible(data.agents), [data.agents]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [content, setContent] = useState('');
  const [type, setType] = useState('progress');
  const [replyTo, setReplyTo] = useState(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const mentions = useMemo(() => mentionedAgents(content, agents), [content, agents]);
  const threads = useMemo(() => activityThreads(entries), [entries]);
  const commandContext = ['project', 'route', 'request', 'document', 'output'].includes(targetType) ? targetType : 'reply';
  const slashVisible = content.trimStart().startsWith('/') && !content.trimStart().startsWith('//') && !content.includes('\n');
  const slashResults = slashVisible ? searchCommands(content.trimStart().slice(1), { context: commandContext }).slice(0, 10) : [];
  const activityCommands = ['update', 'reply', 'mention', 'agent', 'route.new', 'project.new', 'remember', 'connections', 'settings'];

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError(null);
    rumboApi.listActivity({ workspaceId, targetType, targetId }, { signal: controller.signal })
      .then(response => setEntries(response.result))
      .catch(cause => { if (!controller.signal.aborted) setLoadError(cause); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspaceId, targetType, targetId, reload]);

  async function submit(event) {
    event.preventDefault();
    if (!content.trim() || busy) return;
    const parsed = parseSlashCommand(content);
    if (parsed) {
      if (parsed.type === 'unknown') { setError(new Error(`Unknown command /${parsed.name}.`)); return; }
      if (parsed.error) { setError(new Error(parsed.error)); return; }
      executeCommand(parsed.command, parsed.argv);
      return;
    }
    setBusy(true); setError(null);
    try {
      const response = await rumboApi.createActivity({
        workspace_id: workspaceId, target_type: targetType, target_id: targetId,
        update_type: replyTo ? 'comment' : type, parent_id: replyTo?.id ?? null,
        actor_type: 'user', actor_id: data.profile?.id ?? 'local', actor_name: data.profile?.name || 'You', content: content.trim(),
      });
      setEntries(current => [...current, response.result]);
      setContent(''); setReplyTo(null); setType('progress');
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }

  function executeCommand(command, argv = []) {
    const args = argv.join(' ').trim();
    setError(null);
    if (command.id === 'update') {
      const requested = argv[0]?.toLowerCase();
      if (UPDATE_TYPES.some(([value]) => value === requested)) { setType(requested); setContent(argv.slice(1).join(' ')); }
      else setContent(args);
      return;
    }
    if (command.id === 'reply') {
      if (!replyTo) setError(new Error('Choose Reply on an update first.'));
      else setContent(args);
      return;
    }
    if (command.id === 'mention' || command.id === 'agent') {
      const candidate = agents.find(agent => [agent.name, agent.provider, agent.id].some(value => String(value || '').toLowerCase() === args.toLowerCase()));
      if (!candidate) { setError(new Error(args ? `No agent named “${args}” is available.` : 'Add an agent name after the command.')); return; }
      setContent(`@${candidate.name} `); return;
    }
    if (command.id === 'route.new') { edit('task', null, { title: args || undefined, description: args || undefined, ...(targetType === 'project' ? { project_id: targetId } : {}) }); return; }
    if (command.id === 'project.new') { edit('project', null, { name: args || undefined }); return; }
    if (command.id === 'remember') { edit('memory', null, { content: args }); return; }
    if (command.id === 'connections') { navigate('connections'); return; }
    if (command.id === 'settings') { navigate('settings', args || null); return; }
    if (command.connection) { setError(new Error(`${command.command} is registered, but this connection does not have an executable adapter yet.`)); return; }
    setError(new Error(`${command.command} is not executable in an update. Its catalog entry does not bypass the normal workflow.`));
  }

  function chooseCommand(command) {
    const parsed = parseSlashCommand(content);
    const exact = parsed?.type === 'command' && parsed.command.id === command.id;
    if (!exact && command.usage.includes('[')) { setContent(`${command.command} `); return; }
    executeCommand(command, exact ? parsed.argv : []);
  }

  async function archive(entry) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await rumboApi.updateActivity(entry.id, { workspace_id: workspaceId, version: entry.version, archived_at: true });
      setEntries(current => current.map(item => item.id === entry.id ? response.result : item));
      if (replyTo?.id === entry.id) setReplyTo(null);
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }

  return <section className="activity-feed" aria-labelledby={`activity-title-${targetId}`}>
    <div className="section-heading"><div><h2 id={`activity-title-${targetId}`}>{title}</h2><p>Share progress, decisions, risks, and threaded replies.</p></div><span className="activity-count">{entries.filter(item => !item.archived_at).length}</span></div>
    <ErrorMessage error={error ?? loadError} />
    <form className="activity-composer" onSubmit={submit}>
      <div className="activity-composer-top">
        {replyTo ? <div className="activity-reply-target"><MessageCircle /><span>Replying to <strong>{replyTo.actor_name}</strong></span><button type="button" onClick={() => setReplyTo(null)}>Cancel</button></div> : <Select aria-label="Update type" value={type} onChange={setType}>{UPDATE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>}
      </div>
      <SlashCommandMenu text={content} context={commandContext} activeIndex={slashIndex} onActiveIndexChange={setSlashIndex} onSelect={chooseCommand} executableCommandIds={activityCommands} />
      <textarea aria-label={replyTo ? 'Reply' : 'Update'} rows={3} maxLength={50000} value={content} onChange={event => { setSlashIndex(0); setContent(event.target.value); }} onKeyDown={event => {
        if (slashResults.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setSlashIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + slashResults.length) % slashResults.length); }
        else if (slashVisible && event.key === 'Escape') { event.preventDefault(); setContent(`/${content.trimStart()}`); }
        else if (slashResults.length && ['Enter', 'Tab'].includes(event.key) && !event.shiftKey) { event.preventDefault(); chooseCommand(slashResults[Math.min(slashIndex, slashResults.length - 1)]); }
      }} placeholder={replyTo ? 'Write a reply or type / for commands…' : 'Share an update, mention @agent, or type / for commands…'} />
      {mentions.length ? <div className="activity-mention-review" role="note"><strong>Review agent request</strong><span>{mentions.map(agent => `@${agent.name}`).join(', ')} will be recorded as a request in this thread. Posting will not contact or start an agent.</span></div> : null}
      <div className="activity-composer-actions"><span>{replyTo ? 'Saved as a threaded comment.' : 'Visible to people viewing this item.'}</span><Button type="submit" variant="primary" icon={Plus} busy={busy} disabled={!content.trim()}>{mentions.length ? 'Post reviewed request' : replyTo ? 'Post reply' : 'Post update'}</Button></div>
    </form>
    {loading ? <div className="activity-state" role="status">Loading updates…</div> : loadError && !entries.length ? <div className="activity-state"><strong>Updates could not be loaded</strong><span>Your saved updates were not changed.</span><Button onClick={() => setReload(value => value + 1)}>Try again</Button></div> : threads.length ? <div className="activity-list">{threads.map(entry => <FeedEntry key={entry.id} entry={entry} agents={agents} onReply={setReplyTo} onArchive={archive} busy={busy} />)}</div> : <div className="activity-state"><MessageCircle /><strong>No updates yet</strong><span>Post progress, a decision, or a question to start the thread.</span></div>}
  </section>;
}

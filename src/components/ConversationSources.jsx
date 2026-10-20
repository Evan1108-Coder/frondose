import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { Button, ErrorMessage, SearchField } from '../ui.jsx';
import { relative } from '../lib/model.js';

/** Search happens only on explicit activation. Search previews stay in this
 * mounted component; parent selection contains canonical source IDs only. */
export function ConversationSources({ workspaceId, chatId, selected, onToggle, disabled = false }) {
  const [query, setQuery] = useState(''), [result, setResult] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const pending = useRef(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function search(event) {
    event?.preventDefault();
    if (!query.trim() || disabled) return;
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError(null); setResult(null);
    try {
      const response = await apiRequest(`/api/chat-collaboration/${encodeURIComponent(chatId)}/retrieval?${new URLSearchParams({ workspace_id: workspaceId, query: query.trim() })}`, { signal: controller.signal });
      if (!controller.signal.aborted) setResult(response.result);
    } catch (cause) { if (!controller.signal.aborted) setError(cause); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const selectedMessages = selected.filter(item => item.kind === 'message');
  return <section className="chat-conversation-sources"><h3>Past conversations</h3><p>Search messages from other readable conversations in this workspace, then select exactly what to attach. Search never contacts an AI.</p>
    <div className="chat-retrieval-search"><SearchField label="Search past conversation messages" placeholder="Find a decision or earlier discussion…" value={query} onChange={value => { pending.current?.abort(); setBusy(false); setQuery(value); setResult(null); setError(null); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent?.isComposing) { event.preventDefault(); void search(); } }} maxLength={200} /><Button busy={busy} disabled={disabled || !query.trim()} onClick={search}>Search messages</Button></div>
    <ErrorMessage error={error} />
    <div aria-live="polite">{busy ? <p role="status">Searching readable messages…</p> : null}{result ? <p>{result.results.length ? `${result.results.length} readable match${result.results.length === 1 ? '' : 'es'}` : 'No readable messages matched. Try different words.'} · Up to 20 results from the 500 most recent text matches.</p> : null}</div>
    {result?.results.length ? <div className="chat-source-list">{result.results.map(item => {
      const checked = selectedMessages.some(source => source.id === item.id);
      return <label key={item.id}><input type="checkbox" checked={checked} disabled={disabled || !checked && selected.length >= 20} onChange={() => onToggle({ kind: 'message', id: item.id })} /><span><strong>{item.title}</strong><small>{item.sender_name} · {relative(item.created_at)} · {item.content_characters.toLocaleString()} characters</small><span className="chat-retrieval-excerpt">{item.excerpt}</span></span></label>;
    })}</div> : null}
    {selectedMessages.length ? <p>{selectedMessages.length} past message{selectedMessages.length === 1 ? '' : 's'} selected. Selection is kept when you search again. <Button variant="ghost" disabled={disabled} onClick={() => selectedMessages.forEach(onToggle)}>Clear message selection</Button></p> : null}
  </section>;
}

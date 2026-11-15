import {searchQuickCommands} from '../../lib/quick-command-search.js';
import {copyUserText} from '../../lib/clipboard.js';
import { useMemo, useState } from 'react';
import { Button, Dialog, ErrorMessage, SearchField } from '../../ui.jsx';
import { quickCommandInput } from '../../lib/terminal-launch-ui.js';
import { workbenchRequest } from '../../lib/workbench.js';

export function TerminalQuickCommands({ scope, terminal, commands = [], onChanged, onClose }) {
  const [search, setSearch] = useState(''), [name, setName] = useState(''), [command, setCommand] = useState(''), [editing, setEditing] = useState(null), [deleting, setDeleting] = useState(null);
  const [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const filtered = useMemo(() => searchQuickCommands(commands,search), [commands, search]);
  const running = terminal && ['running', 'stopping'].includes(terminal.status), isCli = /^\[.+ CLI\]$/.test(terminal?.command || '');
  async function save(event) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(null);
    try { await workbenchRequest(scope, editing ? `commands/${editing}` : 'commands', { method: editing ? 'PATCH' : 'POST', body: { name, command } }); setName(''); setCommand(''); setEditing(null); await onChanged(); }
    catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  async function send(item, enter) {
    if (busy || !running) return; setBusy(true); setError(null);
    try { await workbenchRequest(scope, `terminals/${terminal.id}/input`, { method: 'POST', body: { data: quickCommandInput(item.command, enter) } }); onClose(); }
    catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting || busy) return; setBusy(true); setError(null);
    try { await workbenchRequest(scope, `commands/${deleting.id}`, { method: 'DELETE' }); setDeleting(null); await onChanged(); }
    catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  return <Dialog title="Quick Commands" onClose={() => { if (!busy) onClose(); }}><div className="terminal-quick-commands">
    <ErrorMessage error={error} /><p>Saved for this {scope.host === 'workspace' ? 'workspace' : 'project'}. {running ? `Target: ${terminal.name}.` : 'Open a running terminal or CLI to send a command.'} {isCli ? 'Send submits text to this AI CLI and may use provider credits.' : 'Run executes the displayed command with your OS permissions.'}</p>
    <div data-field-default-page="Terminal · Quick Commands" onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();event.currentTarget.nextElementSibling?.querySelector('button:not(:disabled)')?.focus();}}}><SearchField label="Search Quick Commands" placeholder="Search commands or prompts…" value={search} onChange={setSearch}/></div>
    <div className="terminal-quick-command-list" aria-label="Saved Quick Commands">{filtered.length ? filtered.map(item => <section key={item.id}><strong>{item.name}</strong><code>{item.command}</code><div><Button disabled={busy || !running || /[\r\n]/.test(item.command)} onClick={() => send(item, false)}>Insert</Button><Button disabled={busy || !running} onClick={() => send(item, true)}>{isCli ? 'Send' : 'Run'}</Button><Button disabled={busy} onClick={async()=>{try{if(!await copyUserText(item.command))setError(Error('Clipboard access is unavailable. Select the saved text to copy it.'));}catch(error){setError(error);}}}>Copy</Button><button type="button" className="text-button" disabled={busy} onClick={() => { setEditing(item.id); setName(item.name); setCommand(item.command); }}>Edit</button><button type="button" className="text-button" disabled={busy} onClick={() => setDeleting(item)}>Delete</button></div></section>) : <p>{search ? 'No matching commands.' : 'No Quick Commands yet.'}</p>}</div>
    {deleting ? <section className="terminal-quick-command-delete"><p>Delete “{deleting.name}”?</p><div><Button disabled={busy} onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" busy={busy} onClick={remove}>Delete command</Button></div></section> : null}
    <form onSubmit={save} onKeyDown={event=>{if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();event.currentTarget.requestSubmit();}}} data-field-defaults-exclude="true"><h3>{editing ? 'Edit command' : 'Add command'}</h3><label>Name<input value={name} onChange={event => setName(event.target.value)} maxLength={80} required /></label><label>Command or prompt<textarea value={command} onChange={event => setCommand(event.target.value)} maxLength={4000} rows={3} required /></label><div><Button type="submit" variant="primary" busy={busy} disabled={!name.trim() || !command.trim()}>{editing ? 'Save command' : 'Add command'}</Button>{editing ? <Button disabled={busy} onClick={() => { setEditing(null); setName(''); setCommand(''); }}>Cancel edit</Button> : null}</div></form>
  </div></Dialog>;
}

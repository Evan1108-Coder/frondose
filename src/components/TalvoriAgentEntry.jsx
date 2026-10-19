import { useState } from 'react';
import { Button, Dialog, ErrorMessage, Field, useApp } from '../ui.jsx';
import { Bot } from './icons.jsx';
import { requestUpdateNavigation } from './UnsavedUpdates.jsx';
import { defaultTalvoriAgentInstruction, prepareTalvoriAgentEntry, talvoriAgentSourceLabel } from '../lib/talvori-agent-entry.js';

export function TalvoriAgentEntryDialog({ source = null, initialInstruction, onClose }) {
  const { workspace, navigate } = useApp();
  const [instruction, setInstruction] = useState(initialInstruction ?? defaultTalvoriAgentInstruction(source?.type));
  const [error, setError] = useState(null);
  function prepare() {
    if (!instruction.trim()) return;
    requestUpdateNavigation(() => {
      try {
        prepareTalvoriAgentEntry({ workspaceId: workspace.id, source, instruction });
        onClose();
        navigate('rumbo-agent');
      } catch (cause) { setError(cause); }
    });
  }
  return <Dialog title="Ask Talvori" subtitle="Prepare a request and choose an agent. Send captures the current context before starting work." onClose={onClose}>
    <Field label="What would you like help with?"><textarea data-field-default-key="rumbo-agent.entry.request" data-field-default-page="Ask Talvori" data-field-default-label="What would you like help with?" data-field-default-mode="create" autoFocus rows={5} maxLength={10000} value={instruction} onChange={event => setInstruction(event.target.value)} /></Field>
    <p className="muted">{source ? `The saved ${talvoriAgentSourceLabel(source.type)} will be checked for access before it is included. Unsaved edits and attachments are not copied.` : 'Choose the context to include in Talvori.'} Opening the draft does not send a message, run commands, or change workspace content.</p>
    <ErrorMessage error={error} />
    <footer className="form-submit-row"><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Bot} disabled={!instruction.trim()} onClick={prepare}>Prepare in Talvori</Button></footer>
  </Dialog>;
}

export function TalvoriAgentEntryButton({ source = null, initialInstruction, disabled = false, children = 'Ask Talvori' }) {
  const [open, setOpen] = useState(false);
  return <><Button icon={Bot} disabled={disabled} onClick={() => setOpen(true)}>{children}</Button>{open ? <TalvoriAgentEntryDialog source={source} initialInstruction={initialInstruction} onClose={() => setOpen(false)} /> : null}</>;
}

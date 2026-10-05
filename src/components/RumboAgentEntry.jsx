import { useState } from 'react';
import { Button, Dialog, ErrorMessage, Field, useApp } from '../ui.jsx';
import { Bot } from './icons.jsx';
import { requestUpdateNavigation } from './UnsavedUpdates.jsx';
import { defaultRumboAgentInstruction, prepareRumboAgentEntry, rumboAgentSourceLabel } from '../lib/rumbo-agent-entry.js';

export function RumboAgentEntryDialog({ source = null, initialInstruction, onClose }) {
  const { workspace, navigate } = useApp();
  const [instruction, setInstruction] = useState(initialInstruction ?? defaultRumboAgentInstruction(source?.type));
  const [error, setError] = useState(null);
  function prepare() {
    if (!instruction.trim()) return;
    requestUpdateNavigation(() => {
      try {
        prepareRumboAgentEntry({ workspaceId: workspace.id, source, instruction });
        onClose();
        navigate('rumbo-agent');
      } catch (cause) { setError(cause); }
    });
  }
  return <Dialog title="Ask Rumbo agent" subtitle="Prepare a request, then choose a model and review its context before sending." onClose={onClose}>
    <Field label="What would you like help with?"><textarea data-field-default-key="rumbo-agent.entry.request" data-field-default-page="Ask Rumbo Agent" data-field-default-label="What would you like help with?" data-field-default-mode="create" autoFocus rows={5} maxLength={10000} value={instruction} onChange={event => setInstruction(event.target.value)} /></Field>
    <p className="muted">{source ? `The saved ${rumboAgentSourceLabel(source.type)} will be checked for access before it is included. Unsaved edits and attachments are not copied.` : 'Choose the context to include in Rumbo agent.'} Opening the agent does not send a message, run commands, or change workspace content.</p>
    <ErrorMessage error={error} />
    <footer className="form-submit-row"><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Bot} disabled={!instruction.trim()} onClick={prepare}>Prepare in Rumbo agent</Button></footer>
  </Dialog>;
}

export function RumboAgentEntryButton({ source = null, initialInstruction, disabled = false, children = 'Rumbo agent' }) {
  const [open, setOpen] = useState(false);
  return <><Button icon={Bot} disabled={disabled} onClick={() => setOpen(true)}>{children}</Button>{open ? <RumboAgentEntryDialog source={source} initialInstruction={initialInstruction} onClose={() => setOpen(false)} /> : null}</>;
}

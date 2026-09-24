import { useRef, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { Button, Dialog, ErrorMessage, Field, useApp } from '../ui.jsx';
import { Form } from './Form.jsx';
import { ScrollText } from './icons.jsx';
import { requestUpdateNavigation, useUnsavedUpdate } from './UnsavedUpdates.jsx';
import { skillRequestBody } from '../lib/skills.js';

export function SkillFromRunButton({ run }) {
  const [open, setOpen] = useState(false);
  return run.status === 'completed' ? <><Button icon={ScrollText} onClick={() => setOpen(true)}>Make a Skill</Button>{open ? <SkillFromRunDialog run={run} onClose={() => setOpen(false)} /> : null}</> : null;
}
function SkillFromRunDialog({ run, onClose }) {
  const { workspace, navigate } = useApp();
  const [name, setName] = useState(''), [purpose, setPurpose] = useState(''), [instructions, setInstructions] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const request = useRef(null);
  useUnsavedUpdate(Boolean(name || purpose || instructions), busy);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const prepared = skillRequestBody({ workspace_id: workspace.id, run_id: run.id, name, purpose, instructions, inputs: [], required_context: [] }, request.current, () => crypto.randomUUID());
      request.current = prepared.request;
      const { result } = await apiRequest('/api/skills/from-run', { method: 'POST', body: prepared.body });
      onClose(); navigate('skills', result.id);
    } catch (problem) { setError(problem); } finally { setBusy(false); }
  }
  return <Dialog wide title="Turn this result into a reusable Skill" onClose={() => requestUpdateNavigation(onClose)}><Form onSubmit={save}><fieldset className="form-fields" disabled={busy} style={{ border: 0, minWidth: 0 }}><p>Source: {run.title} · {run.mode === 'live' ? 'Live run' : 'Simulation'}. A completed run is not proof of a reusable capability.</p><p>Nothing from the prompt, files, conversation, or output is copied automatically. Remove one-off details, define reusable instructions, then add typed inputs and test cases in the Skill editor. This creates an unpublished draft, not a run.</p><Field label="Skill name"><input required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></Field><Field label="Reusable purpose"><textarea required rows={2} maxLength={2000} value={purpose} onChange={event => setPurpose(event.target.value)} /></Field><Field label="Reusable instructions (optional)"><textarea rows={6} maxLength={30000} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="Write generalized instructions. Do not paste credentials or one-off private context." /></Field><ErrorMessage error={error} /><div className="form-submit-row"><Button disabled={busy} onClick={() => requestUpdateNavigation(onClose)}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Create draft Skill</Button></div></fieldset></Form></Dialog>;
}

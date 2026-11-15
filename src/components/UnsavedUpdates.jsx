import { useCallback, useEffect, useId, useState } from 'react';
import { Button, Dialog } from '../ui.jsx';

const editors = new Map();
const announce = () => window.dispatchEvent(new Event('rumbo:update-editor-state'));
export function unsavedUpdatesSafe() { return ![...editors.values()].some(value => value.dirty || value.pending); }
export function unsavedUpdateBlockers() {
  const values = [...editors.values()];
  const dirty = values.filter(value => value.dirty && !value.pending).length;
  const pending = values.filter(value => value.pending).length;
  return [...(dirty ? [{ kind: 'update-draft', count: dirty }] : []), ...(pending ? [{ kind: 'workspace-save', count: pending }] : [])];
}
export function useUnsavedUpdate(dirty, pending) {
  const id = useId();
  useEffect(() => { editors.set(id, { dirty, pending }); announce(); return () => { editors.delete(id); announce(); }; }, [id, dirty, pending]);
  // A saved editor can release its own guard before React unmounts it.
  return useCallback(() => { if (editors.delete(id)) announce(); }, [id]);
}
export function useUpdateEditorsState() {
  const [state, setState] = useState({ dirty: false, pending: false });
  useEffect(() => {
    const read = () => { const values = [...editors.values()], dirty = values.some(v => v.dirty), pending = values.some(v => v.pending); setState(current => current.dirty === dirty && current.pending === pending ? current : { dirty, pending }); };
    window.addEventListener('rumbo:update-editor-state', read); read();
    return () => window.removeEventListener('rumbo:update-editor-state', read);
  }, []);
  return state;
}
export function requestUpdateNavigation(action) {
  const active = [...editors.values()];
  if (!active.some(value => value.dirty || value.pending)) { action(); return; }
  window.dispatchEvent(new CustomEvent('rumbo:unsaved-update', { detail: { action, pending: active.some(value => value.pending) } }));
}
export function UnsavedUpdatesDialog() {
  const [request, setRequest] = useState(null);
  useEffect(() => { const receive = event => setRequest(event.detail); window.addEventListener('rumbo:unsaved-update', receive); return () => window.removeEventListener('rumbo:unsaved-update', receive); }, []);
  return request ? <Dialog title={request.pending ? 'Finish the pending operation first' : 'Leave unsaved changes?'} onClose={() => setRequest(null)}><p>{request.pending ? 'A file, update, or settings change is still being processed. Complete or retry it before leaving.' : 'Unsaved settings, updates, or reply text on this page may be lost. Save your changes to keep them.'}</p><div className="form-submit-row"><Button onClick={() => setRequest(null)}>Keep editing</Button>{!request.pending ? <Button variant="danger" onClick={() => { const action = request.action; setRequest(null); action(); }}>Discard and continue</Button> : null}</div></Dialog> : null;
}

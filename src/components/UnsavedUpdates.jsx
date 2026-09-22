import { useEffect, useId, useState } from 'react';
import { Button, Dialog } from '../ui.jsx';

const editors = new Map();
const announce = () => window.dispatchEvent(new Event('rumbo:update-editor-state'));
export function useUnsavedUpdate(dirty, pending) {
  const id = useId();
  useEffect(() => { editors.set(id, { dirty, pending }); announce(); return () => { editors.delete(id); announce(); }; }, [id, dirty, pending]);
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
  return request ? <Dialog title={request.pending ? 'Finish the pending update first' : 'Leave unsaved updates?'} onClose={() => setRequest(null)}><p>{request.pending ? 'A file or update is still being processed. Complete or retry it before leaving.' : 'Unsent update and reply text on this page may be lost. Save or publish it to keep it.'}</p><div className="form-submit-row"><Button onClick={() => setRequest(null)}>Keep editing</Button>{!request.pending ? <Button variant="danger" onClick={() => { const action = request.action; setRequest(null); action(); }}>Discard and continue</Button> : null}</div></Dialog> : null;
}

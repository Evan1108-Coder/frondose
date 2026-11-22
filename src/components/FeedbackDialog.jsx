import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, IconButton } from '../ui.jsx';
import { addFeedbackFiles, feedbackFileKey, feedbackFits, feedbackTextBytes } from '../lib/feedback-budget.js';
import { feedbackEmail, feedbackError } from '../lib/feedback-report.js';
import { FileText, Paperclip, X } from './icons.jsx';
import './help-menu.css';

const formatSize = bytes => bytes < 1000 ? `${bytes} B` : bytes < 1_000_000 ? `${(bytes / 1000).toFixed(1)} KB` : `${(bytes / 1_000_000).toFixed(2)} MB`;
const emptyDraft = { message: '', textBytes: 0, files: [], fileBytes: 0, overLimit: false };

export function FeedbackDialog({ onClose, onOpenDocs }) {
  const [draft, setDraft] = useState(emptyDraft);
  const { message, textBytes, files, fileBytes, overLimit } = draft;
  const [email, setEmail] = useState('');
  const [availability, setAvailability] = useState('checking');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [dragging, setDragging] = useState(false);
  const picker = useRef(null), dragDepth = useRef(0), pending = useRef(false), lastReport = useRef(null);
  useEffect(() => {
    const reports = window.frondoseDesktop?.reports;
    let current = true;
    if (reports) {
      reports.status().then(
        result => { if (current) setAvailability(result?.available ? 'available' : 'unavailable'); },
        () => { if (current) setAvailability('unavailable'); },
      );
    } else {
      setAvailability('unavailable');
    }
    return () => { current = false; };
  }, []);
  function clearResult() {
    setSendError('');
    setSubmitted(false);
  }
  function addFiles(incoming) {
    if (pending.current) return;
    clearResult();
    setDraft(current => ({ ...current, ...addFeedbackFiles(current, incoming) }));
  }
  function removeFile(file) {
    if (pending.current) return;
    clearResult();
    const key = feedbackFileKey(file);
    setDraft(current => current.files.some(item => feedbackFileKey(item) === key)
      ? { ...current, files: current.files.filter(item => feedbackFileKey(item) !== key), fileBytes: current.fileBytes - file.size, overLimit: false }
      : current);
  }
  function changeMessage(message) {
    if (pending.current) return;
    clearResult();
    const textBytes = feedbackTextBytes(message);
    setDraft(current => feedbackFits(textBytes + current.fileBytes)
      ? { ...current, message, textBytes, overLimit: false }
      : { ...current, overLimit: true });
  }
  async function send(event) {
    event.preventDefault();
    if (pending.current || availability !== 'available') return;
    clearResult();
    const error = feedbackError(message, email, [fileBytes]);
    if (error) { setSendError(error); return; }
    pending.current = true;
    setSending(true);
    try {
      const replyTo = feedbackEmail(email);
      const previous = lastReport.current;
      const requestId = previous?.message === message && previous.email === replyTo
        && previous.files.length === files.length && files.every((file, index) => file === previous.files[index])
        ? previous.requestId : crypto.randomUUID();
      lastReport.current = { message, email: replyTo, files, requestId };
      const attachments = [];
      for (const file of files) attachments.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
      const result = await window.frondoseDesktop.reports.send({ message, email: replyTo, files: attachments, requestId });
      if (!result?.ok) { setSendError(result?.error ?? 'delivery'); return; }
      lastReport.current = null;
      setDraft(emptyDraft);
      setEmail('');
      setSubmitted(true);
    } catch {
      setSendError('delivery');
    } finally {
      pending.current = false;
      setSending(false);
    }
  }
  return <Dialog title="Contact us" className="rumbo-feedback-dialog" editor closeDisabled={sending} onClose={onClose}>
    <form noValidate onSubmit={send}>
      <div className="rumbo-feedback-body">
        <label className="rumbo-feedback-label" htmlFor="rumbo-feedback-message">Your feedback</label>
        <div className={`rumbo-feedback-drop ${dragging ? 'dragging' : ''}`} onDragEnter={event => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); dragDepth.current += 1; setDragging(true); }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }} onDragLeave={event => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }} onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); addFiles([...event.dataTransfer.files]); }}>
          <textarea id="rumbo-feedback-message" aria-describedby="rumbo-feedback-size" placeholder="How could Frondose work better for you?" value={message} readOnly={sending} onChange={event => changeMessage(event.target.value)} />
        </div>
        <p className="rumbo-feedback-drop-hint">{dragging ? 'Drop files here' : 'Drop screenshots, documents, or other files into the textbox.'}</p>
        <label htmlFor="rumbo-feedback-email" className="rumbo-feedback-email-label">Email (optional)</label>
        <input id="rumbo-feedback-email" type="email" autoComplete="email" maxLength={254} readOnly={sending} value={email} aria-describedby="rumbo-feedback-email-hint" aria-invalid={sendError === 'email' ? true : undefined} placeholder="you@example.com" onChange={event => { clearResult(); setEmail(event.target.value); }} />
        <p className="rumbo-feedback-drop-hint" id="rumbo-feedback-email-hint">Leave an email only if you’d like a reply.</p>
        {files.length ? <ul className="rumbo-feedback-files" aria-label="Feedback attachments">{files.map(file => <li key={feedbackFileKey(file)}><FileText /><span><strong>{file.name}</strong><small>{formatSize(file.size)}</small></span><IconButton disabled={sending} label={`Remove ${file.name}`} onClick={() => removeFile(file)}><X /></IconButton></li>)}</ul> : null}
        {overLimit ? <p role="alert" className="rumbo-feedback-error">Text and attachments must total less than 20 MB.</p> : null}
        {sendError === 'email' ? <p role="alert" className="rumbo-feedback-error">Enter a valid email address or leave it blank.</p> : null}
        {sendError === 'message' ? <p role="alert" className="rumbo-feedback-error">Enter your feedback before sending.</p> : null}
        {sendError === 'size' ? <p role="alert" className="rumbo-feedback-error">The report is too large to send. Try removing an attachment.</p> : null}
        {sendError === 'rate' ? <p role="alert" className="rumbo-feedback-error">Too many reports. Try again in a minute.</p> : null}
        {sendError === 'unavailable' ? <p role="alert" className="rumbo-feedback-error">Feedback delivery is unavailable right now. Your draft is still here.</p> : null}
        {sendError && !['email','message','size','rate','unavailable'].includes(sendError) ? <p role="alert" className="rumbo-feedback-error">Could not confirm delivery. Your draft is still here; try again.</p> : null}
        {submitted ? <p role="status" className="rumbo-feedback-sent">Feedback submitted.</p> : null}
      </div>
      <footer className="rumbo-feedback-footer">
        <input hidden ref={picker} type="file" multiple onChange={event => { addFiles([...event.target.files]); event.target.value = ''; }} />
        <div className="rumbo-feedback-tools">
          <Button icon={Paperclip} disabled={sending} onClick={() => picker.current?.click()}>Attach files</Button>
          <small id="rumbo-feedback-size">{formatSize(textBytes + fileBytes)} / 20 MB</small>
          <a className="rumbo-feedback-docs" href="#/docs/help-feedback" onClick={event => {
            event.preventDefault();
            if (!pending.current && (!(message || email || files.length) || window.confirm('Open Docs and discard this unsent draft?'))) onOpenDocs?.();
          }}>Feedback docs</a>
        </div>
        <div className="rumbo-feedback-send">
          {availability === 'unavailable' ? <small>Sending is unavailable in this build.</small> : null}
          <Button type="submit" variant="primary" busy={sending} disabled={availability !== 'available' || !message.trim()}>Send feedback</Button>
        </div>
      </footer>
    </form>
  </Dialog>;
}

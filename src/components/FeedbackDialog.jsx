import { useRef, useState } from 'react';
import { Button, Dialog, IconButton } from '../ui.jsx';
import { FileText, Paperclip, X } from './icons.jsx';
import './help-menu.css';

const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const fileKey = file => `${file.name}:${file.size}:${file.lastModified}`;
const formatSize = size => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;

export function FeedbackDialog({ onClose }) {
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [previewed, setPreviewed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const picker = useRef(null), dragDepth = useRef(0);
  function addFiles(incoming) {
    const next = [...files], errors = [];
    for (const file of incoming) {
      if (file.size > MAX_BYTES) { errors.push(`${file.name} exceeds 10 MB.`); continue; }
      if (next.some(existing => fileKey(existing) === fileKey(file))) continue;
      if (next.length >= MAX_FILES) { errors.push('Attach up to 5 files.'); break; }
      next.push(file);
    }
    setFiles(next); setError(errors.join(' ')); setPreviewed(false);
  }
  function removeFile(file) {
    setFiles(current => current.filter(item => fileKey(item) !== fileKey(file)));
    setError('');
    setPreviewed(false);
  }
  return <Dialog title="Feedback" subtitle="Help shape Rumbo. Tell us what works, what gets in your way, or what you would like to see next." className="rumbo-feedback-dialog" onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); if (message.trim()) setPreviewed(true); }}>
      <div className="rumbo-feedback-body">
        <div className="rumbo-feedback-notice"><strong>Preview only</strong><span>Feedback delivery is not connected yet. Your message and attachments will not be sent or uploaded. Closing this dialog clears the draft.</span></div>
        <div className={`rumbo-feedback-drop ${dragging ? 'dragging' : ''}`} onDragEnter={event => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); dragDepth.current += 1; setDragging(true); }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }} onDragLeave={event => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }} onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); addFiles([...event.dataTransfer.files]); }}>
          <label htmlFor="rumbo-feedback-message">Your feedback</label>
          <textarea id="rumbo-feedback-message" placeholder="How could Rumbo work better for you?" value={message} maxLength={10000} required onChange={event => { setMessage(event.target.value); setPreviewed(false); }} />
          <div className="rumbo-feedback-drop-hint">{dragging ? 'Drop files here' : 'Drop screenshots, documents, or other files here.'}<span>{message.length.toLocaleString()} / 10,000</span></div>
        </div>
        {files.length ? <ul className="rumbo-feedback-files" aria-label="Feedback attachments">{files.map(file => <li key={fileKey(file)}><FileText /><span><strong>{file.name}</strong><small>{formatSize(file.size)}</small></span><IconButton label={`Remove ${file.name}`} onClick={() => removeFile(file)}><X /></IconButton></li>)}</ul> : null}
        {error ? <p role="alert" className="rumbo-feedback-error">{error}</p> : null}
        {previewed ? <p role="status" className="rumbo-feedback-status">Nothing was sent. Feedback delivery is coming later; your draft is still here while this dialog stays open.</p> : null}
      </div>
      <footer className="rumbo-feedback-footer"><div><input hidden ref={picker} type="file" multiple onChange={event => { addFiles([...event.target.files]); event.target.value = ''; }} /><Button icon={Paperclip} onClick={() => picker.current?.click()} disabled={files.length >= MAX_FILES}>Attach files</Button><small>Up to 5 files, 10 MB each</small></div><Button type="submit" variant="primary" disabled={!message.trim()}>Send feedback</Button></footer>
    </form>
  </Dialog>;
}

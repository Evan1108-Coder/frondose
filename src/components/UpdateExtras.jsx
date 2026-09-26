import { Button, Field, Select, useApp } from '../ui.jsx';
import { STATUSES, PROJECT_STATUSES } from '../lib/model.js';
import { RumboAgentEntryDialog } from './RumboAgentEntry.jsx';

export function UpdateWorkChanges({ targetType, targetId, value, onChange, disabled }) {
  const { data } = useApp();
  const item = (targetType === 'project' ? data.projects : data.tasks).find(item => item.id === targetId);
  if (!item) return null;
  const options = targetType === 'project' ? PROJECT_STATUSES : STATUSES;
  function change(key, after) {
    const next = { ...value };
    if (after === undefined) delete next[key];
    else next[key] = { before: Object.hasOwn(value, key) ? value[key].before : item[key] ?? null, after };
    onChange(next);
  }
  return <details className="update-work-fields"><summary>Update work fields <span>{Object.keys(value).length ? `· ${Object.keys(value).length} changes` : '(optional)'}</span></summary><p>Applied only when published. Reported progress is a manual assessment, separate from calculated sub-route completion.</p><div className="activity-composer-top"><Select label="Change status" disabled={disabled} value={value.status?.after ?? ''} onChange={v => change('status', v || undefined)}><option value="">Keep current status</option>{Object.entries(options).filter(([id]) => id !== 'archived').map(([id,label]) => <option key={id} value={id}>{label}</option>)}</Select>{targetType === 'route' ? <Select label="Change priority" disabled={disabled} value={value.priority?.after ?? ''} onChange={v => change('priority', v || undefined)}><option value="">Keep current priority</option>{['no_priority', 'low', 'medium', 'high', 'urgent'].map(id => <option key={id} value={id}>{id.replaceAll('_',' ')}</option>)}</Select> : null}<Field label="Reported progress (%)"><input type="number" min="0" max="100" step="1" placeholder={item.reported_progress == null ? 'Not set' : String(item.reported_progress)} disabled={disabled} value={value.reported_progress?.after ?? ''} onChange={event => change('reported_progress', event.target.value === '' ? undefined : Number(event.target.value))} /></Field></div><WorkChangeSummary value={value} />{Object.keys(value).length ? <Button disabled={disabled} onClick={() => onChange({})}>Clear proposed changes</Button> : null}</details>;
}

export function WorkChangeSummary({ value }) {
  return Object.keys(value).length ? <dl className="update-change-summary">{Object.entries(value).map(([key, change]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{change.before == null ? 'Not set' : String(change.before).replaceAll('_', ' ')} → {change.after == null ? 'Not set' : String(change.after).replaceAll('_', ' ')}{key === 'reported_progress' ? '%' : ''}</dd></div>)}</dl> : null;
}

export function UpdateAttachments({ value, onChange, disabled, onError, onReadingChange }) {
  async function attach(event) {
    const files = [...event.target.files]; event.target.value = '';
    if (value.length + files.length > 4 || value.reduce((n, f) => n + f.size, 0) + files.reduce((n,f) => n + f.size, 0) > 500000) { onError(new Error('Attach up to four files, totaling no more than 500 KB.')); return; }
    onReadingChange(true);
    try {
      const added = await Promise.all(files.map(file => new Promise((resolve, reject) => {
        if (!['image/png','image/jpeg','image/webp','application/pdf','text/plain'].includes(file.type)) return reject(new Error('Use PNG, JPEG, WebP, PDF or plain-text files.'));
        const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, size: file.size, type: file.type, data: reader.result }); reader.onerror = () => reject(new Error('Could not read the attachment.')); reader.readAsDataURL(file);
      })));
      onChange([...value, ...added]); onError(null);
    } catch (error) { onError(error); } finally { onReadingChange(false); }
  }
  return <div className="update-attachments"><label className="button secondary">Attach files<input type="file" aria-label="Attach update files" accept="image/png,image/jpeg,image/webp,application/pdf,text/plain" multiple disabled={disabled} onChange={attach} /></label><small>4 files · 500 KB total · saved with the update</small>{value.map((file,index) => <div key={`${file.name}:${index}`}><span>{file.name} · {Math.ceil(file.size / 1000)} KB</span><Button disabled={disabled} onClick={() => onChange(value.filter((_, i) => i !== index))}>Remove {file.name}</Button></div>)}</div>;
}

export function AttachmentLinks({ value }) {
  return value.length ? <div className="update-file-links">{value.map((file,index) => <a key={index} download={file.name} href={file.data}>{file.type?.startsWith('image/') ? <img src={file.data} alt={file.name} loading="lazy" /> : null}<span>{file.name} ↓</span></a>)}</div> : null;
}

export function AskUpdateAgent({ entry, onClose }) {
  return <RumboAgentEntryDialog source={{ type: 'update', id: entry.id }} onClose={onClose} />;
}

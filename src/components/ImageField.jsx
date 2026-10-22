import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Button, ErrorMessage } from '../ui.jsx';
import { Folder, Plus, X } from './icons.jsx';
import { imageFileError } from '../lib/image-crop.js';
import './image-field.css';

const ImageCropDialog = lazy(() => import('./ImageCropDialog.jsx'));
export function ImageField({ value, onChange, label = 'Project picture', disabled = false, circle = false }) {
  const input = useRef(null);
  const [source, setSource] = useState(null), [error, setError] = useState(null), [over, setOver] = useState(false);
  useEffect(() => () => { if (source) URL.revokeObjectURL(source); }, [source]);
  function accept(files) {
    if (disabled) return;
    if (files.length !== 1) { setError(new Error('Choose one image at a time.')); return; }
    const message = imageFileError(files[0]);
    if (message) { setError(new Error(message)); return; }
    setError(null); setSource(URL.createObjectURL(files[0]));
  }
  return <div className={`image-field ${circle ? 'image-field-circle' : ''}`}><span className="field-label">{label}</span><div className={`image-dropzone ${over ? 'drag-over' : ''}`}
    onDragOver={e => { e.preventDefault(); if (!disabled) setOver(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
    onDrop={e => { e.preventDefault(); setOver(false); accept(e.dataTransfer.files); }}>
    <div className="image-field-preview">{value ? <img src={value} alt={`${label} preview`} /> : <Folder size={26} />}</div>
    <div><Button disabled={disabled} icon={Plus} onClick={() => input.current?.click()}>{value ? 'Change image' : 'Choose image'}</Button><small>Or drop an image here · PNG, JPEG, WebP · up to 10 MB</small></div>
    {value ? <Button disabled={disabled} variant="ghost" icon={X} onClick={() => onChange(null)}>Remove</Button> : null}
    <input hidden ref={input} type="file" aria-label={`Upload ${label.toLowerCase()}`} accept="image/png,image/jpeg,image/webp" onChange={e => { accept(e.target.files); e.target.value = ''; }} />
  </div><ErrorMessage error={error} />{source ? <Suspense fallback={<p role="status">Opening image editor…</p>}><ImageCropDialog source={source} label={label} onClose={() => setSource(null)} onSave={image => { onChange(image); setSource(null); }} /></Suspense> : null}</div>;
}

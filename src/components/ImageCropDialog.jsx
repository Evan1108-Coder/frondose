import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, ErrorMessage } from '../ui.jsx';
import { cropGeometry } from '../lib/image-crop.js';

export default function ImageCropDialog({ source, label, onClose, onSave }) {
  const [image, setImage] = useState(null), [error, setError] = useState(null), [saving, setSaving] = useState(false);
  const [crop, setCrop] = useState({ zoom: 1, x: 0, y: 0 });
  const drag = useRef(null);
  useEffect(() => {
    let active = true;
    const next = new Image();
    next.onload = () => { if (active) { if (next.naturalWidth * next.naturalHeight > 40_000_000) setError(new Error('This image is too large. Use an image under 40 megapixels.')); else setImage(next); } };
    next.onerror = () => { if (active) setError(new Error('This image could not be decoded. Try another PNG, JPEG, or WebP.')); };
    next.src = source;
    return () => { active = false; next.onload = null; next.onerror = null; };
  }, [source]);
  const geometry = image ? cropGeometry(image.naturalWidth, image.naturalHeight, crop.zoom, crop.x, crop.y) : null;
  function move(e) {
    if (!drag.current || !geometry) return;
    const { clientX, clientY, x, y, width } = drag.current;
    const dx = (e.clientX - clientX) * geometry.side / width, dy = (e.clientY - clientY) * geometry.side / width;
    const clamp = n => Math.max(-1, Math.min(1, n));
    setCrop(current => ({ ...current, x: clamp(x - 2 * dx / Math.max(1, image.naturalWidth - geometry.side)), y: clamp(y - 2 * dy / Math.max(1, image.naturalHeight - geometry.side)) }));
  }
  async function save() {
    if (!image || !geometry || saving) return;
    setSaving(true); setError(null);
    try {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, geometry.sx, geometry.sy, geometry.side, geometry.side, 0, 0, 512, 512);
      let result = canvas.toDataURL('image/webp', 0.88);
      if (result.length > 330000) result = canvas.toDataURL('image/jpeg', 0.78);
      if (result.length > 330000) throw new Error('This crop is too detailed to save. Try a smaller source image.');
      onSave(result);
    } catch (cause) { setError(cause); } finally { setSaving(false); }
  }
  return <Dialog title={`Crop ${label.toLowerCase()}`} subtitle="Drag to reposition. The square preview is exactly what will be saved." onClose={saving ? () => {} : onClose}>
    <div className="image-crop-body"><div className="image-crop-stage" aria-label="Image crop preview"
      onPointerDown={e => { if (!image) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { clientX: e.clientX, clientY: e.clientY, x: crop.x, y: crop.y, width: e.currentTarget.clientWidth }; }}
      onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      {image ? <img src={source} alt="Crop preview" draggable={false} style={{ width: `${image.naturalWidth / geometry.side * 100}%`, height: `${image.naturalHeight / geometry.side * 100}%`, transform: `translate(${-geometry.sx / image.naturalWidth * 100}%, ${-geometry.sy / image.naturalHeight * 100}%)` }} /> : <span role="status">{error ? 'Image unavailable' : 'Loading image…'}</span>}
      <div className="image-crop-grid" aria-hidden="true" />
    </div><p className="muted">Use the sliders to position the image with a keyboard.</p>
    {[['zoom', 'Zoom', 1, 3], ['x', 'Horizontal position', -1, 1], ['y', 'Vertical position', -1, 1]].map(([key, title, min, max]) => <label className="image-crop-control" key={key}><span>{title}</span><input type="range" aria-label={title} min={min} max={max} step="0.01" disabled={!image || saving} value={crop[key]} onChange={e => setCrop(current => ({ ...current, [key]: Number(e.target.value) }))} /></label>)}
    <ErrorMessage error={error} /></div><footer className="dialog-footer"><Button disabled={saving} onClick={() => setCrop({ zoom: 1, x: 0, y: 0 })}>Reset crop</Button><Button disabled={saving} onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!image} busy={saving} onClick={save}>Use image</Button></footer>
  </Dialog>;
}

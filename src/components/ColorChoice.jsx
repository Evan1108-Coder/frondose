import { useEffect, useId, useState } from 'react';
import { REACTION_COLORS, normalizeReactionColor } from '../lib/reaction-catalog.js';
import { Check } from './icons.jsx';
import './team-appearance.css';

/** Authored swatches + hex input; no native color dialog or unsafe CSS values. */
export function ColorChoice({ label, value = '', onChange, disabled = false }) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const valid = normalizeReactionColor(draft) !== undefined;
  return <div className="color-choice"><span id={id}>{label}</span><div className="color-choice-controls">
    <div className="reaction-swatches" role="group" aria-labelledby={id}>{REACTION_COLORS.map(swatch => <button type="button" key={swatch.name} disabled={disabled} aria-label={`${label}: ${swatch.name}`} aria-pressed={(value || null) === swatch.value} onClick={() => onChange(swatch.value || '')}><span style={{ background: swatch.value || 'var(--muted)' }}>{(value || null) === swatch.value ? <Check interactive={false} /> : null}</span></button>)}</div>
    <div className="color-choice-custom"><input aria-label={`${label} hex`} aria-invalid={!valid} placeholder="Theme default" maxLength={7} value={draft} spellCheck={false} disabled={disabled} onChange={event => setDraft(event.target.value)} /><button type="button" disabled={disabled || !valid || draft === value} onClick={() => onChange(normalizeReactionColor(draft) || '')}>Apply</button></div>
    {!valid ? <small role="alert">Use # and six hexadecimal digits.</small> : null}
  </div></div>;
}

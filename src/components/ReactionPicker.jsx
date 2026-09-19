import { useMemo, useState } from 'react';
import { Dialog, ErrorMessage, SearchField } from '../ui.jsx';
import { Check } from './icons.jsx';
import { ICON_REACTIONS, EMOJI_REACTIONS, REACTION_COLORS, normalizeReactionColor, reactionKey } from '../lib/reaction-catalog.js';
import { ReactionGlyph } from './ReactionGlyph.jsx';
import './reaction-picker.css';

/** Reusable for reactions and future entity icon selection. Values are stable
 * catalog IDs + an optional six-digit tint, never arbitrary SVG or markup. */
export default function ReactionPicker({ onSelect, onClose, selected = [], busy = false, error, title = 'Add reaction' }) {
  const [tab, setTab] = useState('icon'), [query, setQuery] = useState(''), [category, setCategory] = useState('All');
  const [color, setColor] = useState(null), [custom, setCustom] = useState(false), [hex, setHex] = useState('#818cf8'), [highlighted, setHighlighted] = useState(null);
  const [focusedId, setFocusedId] = useState(null);
  const source = tab === 'icon' ? ICON_REACTIONS : EMOJI_REACTIONS;
  const categories = useMemo(() => ['All', ...new Set(source.map(item => item.category))], [source]);
  const items = useMemo(() => source.filter(item => (category === 'All' || item.category === category) && `${item.name} ${item.category}`.toLowerCase().includes(query.trim().toLowerCase())), [source, category, query]);
  const selectedKeys = new Set(selected.map(reactionKey));
  const customValid = /^#[0-9a-f]{6}$/i.test(hex);
  const focusIndex = Math.max(0, items.findIndex(item => item.id === focusedId));
  function changeTab(id) { setTab(id); setCategory('All'); setHighlighted(null); setFocusedId(null); }
  function gridKey(event) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const grid = event.currentTarget, buttons = [...grid.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : index + ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols })[event.key];
    event.preventDefault(); buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
  }
  return <Dialog title={title} onClose={onClose} className="reaction-picker-dialog">
    <div className="reaction-picker-tabs" role="tablist" aria-label="Reaction type" onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const id = event.key === 'Home' ? 'icon' : event.key === 'End' ? 'emoji' : tab === 'icon' ? 'emoji' : 'icon'; changeTab(id); event.currentTarget.querySelector(`[data-reaction-tab="${id}"]`)?.focus(); } }}>{[['icon', 'Icons'], ['emoji', 'Emojis']].map(([id, label]) => <button key={id} data-reaction-tab={id} role="tab" tabIndex={tab === id ? 0 : -1} aria-selected={tab === id} onClick={() => changeTab(id)}>{label}<span>{id === 'icon' ? ICON_REACTIONS.length : EMOJI_REACTIONS.length}</span></button>)}</div>
    <div className="reaction-picker-search"><SearchField label="Search reactions" value={query} onChange={setQuery} placeholder={tab === 'icon' ? 'Search icons…' : 'Search emojis…'} autoFocus /><ErrorMessage error={error} /></div>
    {tab === 'icon' ? <div className="reaction-picker-colors"><span>Color</span><div className="reaction-swatches" role="group" aria-label="Icon color">{REACTION_COLORS.map(swatch => <button key={swatch.name} type="button" aria-label={`${swatch.name} icon color`} aria-pressed={color === swatch.value} onClick={() => { setColor(swatch.value); setCustom(false); }}><span style={{ background: swatch.value || 'var(--muted)' }}>{color === swatch.value ? <Check interactive={false} /> : null}</span></button>)}<button type="button" className="reaction-custom-color" aria-label="Custom icon color" aria-expanded={custom} aria-pressed={color !== null && !REACTION_COLORS.some(swatch => swatch.value === color)} onClick={() => setCustom(!custom)}><span /></button></div>{custom ? <label className="reaction-hex-input">Hex color<input aria-label="Custom hex color" maxLength={7} value={hex} onChange={event => { const value = event.target.value; setHex(value); const next = normalizeReactionColor(value); if (next) setColor(next); }} placeholder="#818cf8" spellCheck={false} aria-invalid={!customValid} /><small>Use # and six hexadecimal digits.</small></label> : null}</div> : null}
    <div className="reaction-categories" role="group" aria-label="Reaction categories">{categories.map(item => <button key={item} aria-pressed={category === item} onClick={() => { setCategory(item); setHighlighted(null); }}>{item}</button>)}</div>
    <div className="reaction-picker-results" role="tabpanel" aria-label={tab === 'icon' ? 'Icons' : 'Emojis'}><div className="reaction-picker-grid" onKeyDown={gridKey}>{items.map((item, index) => {
      const value = { id: item.id, color: tab === 'icon' ? color : null }, picked = selectedKeys.has(reactionKey(value));
      return <button key={item.id} type="button" tabIndex={index === focusIndex ? 0 : -1} aria-label={item.name} aria-pressed={picked} disabled={busy || tab === 'icon' && custom && !customValid} onMouseEnter={() => setHighlighted(item)} onFocus={() => { setHighlighted(item); setFocusedId(item.id); }} onClick={() => onSelect(value)}><ReactionGlyph {...value} size={24} />{picked ? <span className="reaction-picked"><Check interactive={false} /></span> : null}</button>;
    })}</div>{!items.length ? <p className="reaction-no-results">No matching {tab === 'icon' ? 'icons' : 'emojis'}. Try another word or category.</p> : null}</div>
    <footer className="reaction-picker-footer"><span>{highlighted?.name || `${items.length} ${tab === 'icon' ? 'icons' : 'emojis'}`}</span><small>{highlighted?.category || 'Choose one to react'}</small></footer>
  </Dialog>;
}

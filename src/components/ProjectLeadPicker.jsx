import { useEffect, useId, useRef, useState } from 'react';
import { Bot, Check, ChevronDown, CircleUser } from './icons.jsx';
import { usePopupPosition } from './usePopupPosition.js';
import { usePopupMotion } from './usePopupMotion.js';
import './project-lead-picker.css';

// Leads remain names, matching existing project data and portable exports.
// Selecting an agent here does not launch it or grant it permissions.
export function ProjectLeadPicker({ id, value = '', agents = [], onChange, disabled, ...props }) {
  const panelId = useId();
  const root = useRef(null), trigger = useRef(null), input = useRef(null), search = useRef(null), panel = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const name = query.trim();
  const matches = agents.filter(agent => agent.name.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
  const position = usePopupPosition(open, trigger, { width: 300, height: Math.min(320, 66 + 41 * (matches.length + 1 + (name ? 1 : 0))) });
  const popup = usePopupMotion(open, panel, { ready: Boolean(position) });
  const selectedAgent = agents.some(agent => agent.name === value);
  function close(restore = false) { setOpen(false); if (restore) input.current?.focus(); }
  function choose(next) { onChange(next); close(true); }
  useEffect(() => {
    if (!open) return;
    if (position) search.current?.focus();
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, [open, Boolean(position)]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <div ref={root} className="project-lead-picker" onKeyDown={event => {
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); event.stopPropagation();
      const controls = [...root.current.querySelectorAll('.project-lead-panel input, .project-lead-option')];
      const index = controls.indexOf(document.activeElement);
      controls[(index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length]?.focus();
    }
  }}>
    <div ref={trigger} className="rumbo-select-trigger project-lead-trigger">
      {value ? selectedAgent ? <Bot aria-hidden="true" /> : <CircleUser aria-hidden="true" /> : <span className="no-lead-icon" aria-hidden="true" />}
      <input {...props} ref={input} id={id} aria-label="Project lead" role="combobox" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} value={value} placeholder="No lead" maxLength={200} disabled={disabled} onClick={() => { setQuery(''); setOpen(true); }} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); event.stopPropagation(); setQuery(''); setOpen(true); } }} />
      <button type="button" aria-label="Choose project lead" disabled={disabled} onClick={() => { setQuery(''); setOpen(current => !current); }}><ChevronDown aria-hidden="true" /></button>
    </div>
    {popup.present ? <div {...popup.motionProps} ref={panel} id={panelId} className="project-lead-panel rumbo-select-panel" role="dialog" aria-label="Choose project lead" data-rumbo-popup={open ? 'project-lead' : undefined} style={position ?? { visibility: 'hidden' }}>
      <input ref={search} data-field-defaults-exclude aria-label="Search agents or type a lead name" placeholder="Search agents or type a name…" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (name) choose(name); }
      }} />
      <button type="button" className="project-lead-option" aria-pressed={!value} onClick={() => choose('')}><span className="no-lead-icon" aria-hidden="true" /><span>No lead</span>{!value ? <Check aria-hidden="true" /> : null}</button>
      {matches.map(agent => <button key={agent.id} type="button" className="project-lead-option" aria-pressed={value === agent.name} onClick={() => choose(agent.name)}><Bot aria-hidden="true" /><span>{agent.name}</span>{value === agent.name ? <Check aria-hidden="true" /> : null}</button>)}
      {name ? <button type="button" className="project-lead-option custom-lead-option" onClick={() => choose(name)}><CircleUser aria-hidden="true" /><span>Use “{name}”</span></button> : null}
    </div> : null}
  </div>;
}

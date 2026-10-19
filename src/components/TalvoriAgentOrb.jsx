import { useRef } from 'react';
import './talvori-agent-orb.css';

export const TALVORI_AGENT_COLORS = ['blue', 'cyan', 'green', 'gold', 'coral', 'purple'];

export function TalvoriAgentOrb({ color = 'blue', compact = false, className = '' }) {
  const container = useRef(null);
  const safeColor = TALVORI_AGENT_COLORS.includes(color) ? color : 'blue';
  function move(event) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const bounds = container.current?.getBoundingClientRect();
    if (!bounds) return;
    container.current.style.setProperty('--orb-pointer-x', `${event.clientX - bounds.left}px`);
    container.current.style.setProperty('--orb-pointer-y', `${event.clientY - bounds.top}px`);
    container.current.style.setProperty('--orb-beam-tilt', `${Math.max(-8, Math.min(8, ((event.clientX - bounds.left) / bounds.width - .5) * 16))}deg`);
  }
  return <span ref={container} aria-hidden="true" className={`rumbo-agent-orb rumbo-agent-orb-${safeColor}${compact ? ' rumbo-agent-orb-compact' : ''} ${className}`} onPointerMove={compact ? undefined : move}>
    <img src={`/agent-orbs/${safeColor}.webp`} alt="" draggable="false" />
    <span className="talvori-agent-monogram" />
  </span>;
}

export function TalvoriAgentColorChoice({ value, onChange, label = 'Agent color' }) {
  return <fieldset className="rumbo-agent-color-choice"><legend>{label}</legend><div>{TALVORI_AGENT_COLORS.map(color => <button key={color} type="button" aria-label={`${color} orb`} aria-pressed={value === color} className={`rumbo-agent-color-swatch rumbo-agent-color-${color}`} onClick={() => onChange(color)}><span /></button>)}</div></fieldset>;
}

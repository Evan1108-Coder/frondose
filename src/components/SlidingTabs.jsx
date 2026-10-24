import { useLayoutEffect, useRef } from 'react';
import { currentMotionPreference, MOTION } from '../lib/motion.js';
import { nextSlidingTab } from '../lib/sliding-tabs.js';
import './sliding-tabs.css';

/** A single-choice filter, not a tabpanel controller. State updates immediately. */
export function SlidingTabs({ value, onChange, options, label, className = '' }) {
  const groupRef = useRef(null);
  const plateRef = useRef(null);
  const buttonsRef = useRef(new Map());
  const positionRef = useRef(null);
  const animationRef = useRef(null);
  const selected = options.some(option => option.value === value && !option.disabled) ? value : options.find(option => !option.disabled)?.value;
  useLayoutEffect(() => {
    const group = groupRef.current, plate = plateRef.current;
    const measure = () => {
      const button = buttonsRef.current.get(selected);
      if (!group || !plate || !button) { if (plate) plate.hidden = true; return; }
      const next = { x: button.offsetLeft, width: button.offsetWidth, height: button.offsetHeight, y: button.offsetTop };
      const previous = positionRef.current;
      if (previous && Object.keys(next).every(key => next[key] === previous[key])) return;
      // The plate alone changes geometry; text never scales or waits for motion.
      const computed = animationRef.current ? new DOMMatrix(getComputedStyle(plate).transform) : null;
      if (computed && previous) computed.a *= previous.width / next.width;
      animationRef.current?.cancel();
      Object.assign(plate.style, { width: `${next.width}px`, height: `${next.height}px`, top: `${next.y}px`, transform: `translateX(${next.x}px)` });
      plate.hidden = false;
      if (previous && currentMotionPreference().movement && plate.animate) {
        animationRef.current = plate.animate([
          { transform: computed ? computed.toString() : `translateX(${previous.x}px) scaleX(${previous.width / next.width})` },
          { transform: `translateX(${next.x}px) scaleX(1)` },
        ], { duration: 220, easing: MOTION.easeOut });
      }
      positionRef.current = next;
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (group) observer.observe(group);
    for (const button of buttonsRef.current.values()) observer.observe(button);
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stopSpatial = () => { if (!currentMotionPreference().movement) { animationRef.current?.cancel(); animationRef.current = null; } };
    const preferenceObserver = new MutationObserver(stopSpatial);
    preferenceObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion', 'data-input-modality'] });
    media.addEventListener('change', stopSpatial);
    return () => { observer.disconnect(); preferenceObserver.disconnect(); media.removeEventListener('change', stopSpatial); };
  }, [selected, options]);
  useLayoutEffect(() => () => animationRef.current?.cancel(), []);
  const keyDown = event => {
    const next = nextSlidingTab(options, selected, event.key, getComputedStyle(groupRef.current).direction);
    if (next == null) return;
    event.preventDefault();
    buttonsRef.current.get(next)?.focus();
    if (next !== value) onChange(next);
  };
  return <div ref={groupRef} className={`sliding-tabs ${className}`} role="radiogroup" aria-label={label} aria-orientation="horizontal" onKeyDown={keyDown}>
    <span ref={plateRef} className="sliding-tabs-plate" aria-hidden="true" hidden />
    {options.map(option => <button key={option.value} ref={node => { if (node) buttonsRef.current.set(option.value, node); else buttonsRef.current.delete(option.value); }} type="button" role="radio" aria-checked={value === option.value} disabled={option.disabled} tabIndex={selected === option.value ? 0 : -1} onClick={() => { if (option.value !== value) onChange(option.value); }}>{option.label}</button>)}
  </div>;
}

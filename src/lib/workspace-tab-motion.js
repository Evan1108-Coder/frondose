import { useLayoutEffect, useRef } from 'react';
import { currentMotionPreference, MOTION } from './motion.js';
import { workspaceTabViews } from './workspace-tabs.js';

// Animate chrome, never duplicate or transform a live Chromium guest. Layout,
// focus and process lifetime are committed synchronously by the tab reducer.
export function tabMotionPlan({ movement, fadeMs }, browser = false) {
  return { duration: movement ? 260 : fadeMs, travel: movement && !browser ? 7 : 0 };
}

export function useWorkspaceTabMotion({ row, strip, marker, pane, tabs, active, size }) {
  const previous = useRef(null), animations = useRef(new Set()), ghosts = useRef(new Set());
  const animate = (element, frames, duration) => {
    if (!element?.animate || !duration) return;
    const animation = element.animate(frames, { duration, easing: MOTION.easeOut });
    animations.current.add(animation);
    animation.finished.catch(() => {}).finally(() => animations.current.delete(animation));
    return animation;
  };
  useLayoutEffect(() => {
    const root = strip.current, container = row.current;
    if (!root || !container) return;
    const preference = currentMotionPreference();
    const containsBrowser = workspaceTabViews(active).some(view => view.contentType === 'browser');
    const plan = tabMotionPlan(preference, containsBrowser);
    const bounds = container.getBoundingClientRect();
    const entries = new Map([...root.querySelectorAll('[data-workspace-tab-id]')].map(element => {
      const rect = element.getBoundingClientRect();
      return [element.dataset.workspaceTabId, { element, left: rect.left - bounds.left, top: rect.top - bounds.top, width: rect.width, height: rect.height, label: element.querySelector('[role="tab"] span')?.textContent || 'Tab' }];
    }));
    const prior = previous.current;
    if (prior) {
      for (const [id, entry] of entries) {
        const old = prior.entries.get(id);
        if (!old) animate(entry.element, [{ opacity: 0, clipPath: 'inset(0 70% 0 0 round 7px)', transform: preference.movement ? 'translateY(5px)' : 'none' }, { opacity: 1, clipPath: 'inset(0 0 0 0 round 7px)', transform: 'none' }], plan.duration);
        else if (preference.movement && Math.abs(old.left - entry.left) > 1) animate(entry.element, [{ transform: `translateX(${old.left - entry.left}px)` }, { transform: 'none' }], plan.duration);
      }
      for (const [id, old] of prior.entries) if (!entries.has(id) && plan.duration) {
        // A bounded text-only exit picture contains no live pane, ID, event
        // listener, URL, form value, iframe, preload bridge or focusable control.
        const ghost = document.createElement('span');
        ghost.className = 'workspace-tab-exit'; ghost.textContent = old.label;
        ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
        Object.assign(ghost.style, { left: `${old.left}px`, top: `${old.top}px`, width: `${old.width}px`, height: `${old.height}px` });
        container.append(ghost); ghosts.current.add(ghost);
        while (ghosts.current.size > 3) { const first = ghosts.current.values().next().value; first.remove(); ghosts.current.delete(first); }
        const animation = animate(ghost, [{ opacity: .8, transform: 'none', clipPath: 'inset(0 0 0 0 round 7px)' }, { opacity: 0, transform: preference.movement ? 'translateY(-5px)' : 'none', clipPath: 'inset(0 35% 0 0 round 7px)' }], Math.min(220, plan.duration));
        const remove = () => { ghost.remove(); ghosts.current.delete(ghost); };
        if (animation) animation.finished.catch(() => {}).finally(remove); else remove();
      }
      const identity = `${active.id}:${active.contentType}:${active.page ? JSON.stringify(active.page) : active.entityId}`;
      if (identity !== prior.identity && pane.current) {
        pane.current.getAnimations().forEach(animation => animation.cancel());
        if (!containsBrowser) animate(pane.current, [{ opacity: .45, transform: plan.travel ? `translateY(${plan.travel}px)` : 'none' }, { opacity: 1, transform: 'none' }], plan.duration);
      }
    }
    const entry = entries.get(active.id), plate = marker.current;
    if (entry && plate) {
      const next = { left: entry.element.offsetLeft, width: entry.element.offsetWidth };
      // Sample the in-flight plate before cancelling so rapid clicks reverse
      // naturally instead of jumping back to the previous tab's start.
      const computed = getComputedStyle(plate);
      const from = { left: computed.left, width: computed.width };
      plate.getAnimations().forEach(animation => animation.cancel());
      plate.style.left = `${next.left}px`; plate.style.width = `${next.width}px`;
      if (prior && preference.movement) animate(plate, [from, { left: `${next.left}px`, width: `${next.width}px` }], 280);
    }
    previous.current = { entries, identity: `${active.id}:${active.contentType}:${active.page ? JSON.stringify(active.page) : active.entityId}` };
  }, [tabs, active.id, active.contentType, active.entityId, JSON.stringify(active.page), size]);
  useLayoutEffect(() => {
    const cancel = () => { for (const animation of animations.current) animation.cancel(); animations.current.clear(); for (const ghost of ghosts.current) ghost.remove(); ghosts.current.clear(); };
    const root = document.documentElement;
    const observer = new MutationObserver(() => { if (!currentMotionPreference().movement) cancel(); });
    observer.observe(root, { attributes: true, attributeFilter: ['data-motion', 'data-input-modality'] });
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    media.addEventListener('change', cancel);
    return () => { observer.disconnect(); media.removeEventListener('change', cancel); cancel(); };
  }, []);
}

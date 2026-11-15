import { useLayoutEffect, useRef, useState } from 'react';
import { currentMotionPreference, MOTION } from '../lib/motion.js';
import { popupMotionDuration, popupMotionFrames, popupCompletionIsCurrent, settlePopupMotion } from '../lib/popup-motion.js';

/** Retain visual presence only; selection, focus, ARIA and actions use `open`. */
export function usePopupMotion(open, panelRef, { ready = true } = {}) {
  const [retained, setRetained] = useState(open);
  const animation = useRef(null), interruptedFrame = useRef(null), generation = useRef(0), openRef = useRef(open);
  openRef.current = open;
  const present = open || retained;
  useLayoutEffect(() => {
    const node = panelRef.current;
    if (!present || !node) return;
    if (open) setRetained(true);
    if (!ready && open) return;
    const version = ++generation.current;
    const previous = animation.current;
    const computed = previous ? getComputedStyle(node) : null;
    const from = computed ? { opacity: computed.opacity, transform: computed.transform } : interruptedFrame.current;
    interruptedFrame.current = null;
    previous?.cancel();
    animation.current = null;
    node.dataset.popupPhase = open ? 'opening' : 'closing';
    const preference = currentMotionPreference(), duration = popupMotionDuration(preference, !open);
    let timeout;
    const finish = () => {
      if (version !== generation.current) return;
      window.clearTimeout(timeout);
      interruptedFrame.current = null;
      settlePopupMotion(node, currentMotionPreference(), openRef.current);
      animation.current?.cancel();
      animation.current = null;
      node.dataset.popupPhase = openRef.current ? 'open' : 'closed';
      if (popupCompletionIsCurrent(version, generation.current, openRef.current)) setRetained(false);
    };
    if (!duration || !node.animate || document.visibilityState === 'hidden') finish();
    else {
      const effect = node.animate(popupMotionFrames(preference, open, from), { duration, easing: MOTION.easeOut, fill: 'both' });
      animation.current = effect;
      effect.finished.then(finish, () => {});
      // A browser can suspend/drop an animation's completion event. Never leave
      // an inert closing panel resident indefinitely.
      timeout = window.setTimeout(finish, duration + 64);
    }
    const snap = () => { if (!currentMotionPreference().movement || document.visibilityState === 'hidden') finish(); };
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const observer = new MutationObserver(snap);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion', 'data-input-modality'] });
    media.addEventListener('change', snap);
    document.addEventListener('visibilitychange', snap);
    return () => {
      ++generation.current;
      window.clearTimeout(timeout);
      observer.disconnect();
      media.removeEventListener('change', snap);
      document.removeEventListener('visibilitychange', snap);
      if (animation.current) {
        const current = getComputedStyle(node);
        interruptedFrame.current = { opacity: current.opacity, transform: current.transform };
      }
      animation.current?.cancel();
      animation.current = null;
    };
  }, [open, present, ready, panelRef]);
  return {
    present,
    motionProps: {
      'data-popup-motion': 'true',
      'data-popup-closing': !open || undefined,
      'aria-hidden': !open || undefined,
      inert: !open || undefined,
    },
  };
}

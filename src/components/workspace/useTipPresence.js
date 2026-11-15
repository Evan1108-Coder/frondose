import { useLayoutEffect, useRef, useState } from 'react';
import { currentMotionPreference } from '../../lib/motion.js';

export function tipExitTransform(width, side = 'right') {
  const distance = Math.max(32, Number.isFinite(width) ? width + 32 : 420);
  return `translateX(${side === 'left' ? -distance : distance}px)`;
}

// Keep the real tip mounted during dismissal; do not abruptly unmount it or
// animate the live workspace. A reopened tip cancels an in-flight exit safely.
export function useTipPresence(show, movement = true) {
  const [present, setPresent] = useState(show);
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (show && !present) { setPresent(true); return undefined; }
    if (!present) return undefined;
    const element = ref.current;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = () => !movement || media.matches || !currentMotionPreference().movement;
    let cancelled = false, timer;
    const complete = () => { if (!cancelled && !show) setPresent(false); };
    if (!element?.animate || reduced()) { complete(); return undefined; }
    const style = getComputedStyle(element);
    const frames = show
      ? [{ transform: 'translateX(46px)', opacity: 0 }, { transform: 'translateX(-4px)', opacity: 1, offset: .78 }, { transform: 'translateX(0)', opacity: 1 }]
      : [{ transform: style.transform, opacity: style.opacity }, { transform: tipExitTransform(element.getBoundingClientRect().width), opacity: 0 }];
    const animation = element.animate(frames, { duration: show ? 320 : 200, easing: show ? 'cubic-bezier(.2,.8,.2,1)' : 'cubic-bezier(.4,0,1,1)', fill: 'both' });
    animation.onfinish = complete;
    if (!show) timer = setTimeout(complete, 260);
    const settle = () => { if (reduced()) { animation.cancel(); complete(); } };
    media.addEventListener('change', settle);
    const observer = new MutationObserver(settle);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion', 'data-input-modality'] });
    return () => { cancelled = true; clearTimeout(timer); animation.cancel(); media.removeEventListener('change', settle); observer.disconnect(); };
  }, [show, present, movement]);
  return { present, ref, closing: !show };
}

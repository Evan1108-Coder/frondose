import { MOTION } from './motion.js';

export const POPUP_OPEN_FRAME = Object.freeze({ opacity: 1, transform: 'translateY(0px) scale(1)' });
export const POPUP_HIDDEN_FRAME = Object.freeze({ opacity: 0, transform: 'translateY(8px) scale(.95)' });

export function popupMotionDuration(preference, closing = false) {
  return preference.movement ? closing ? 140 : 220 : preference.fadeMs ? MOTION.reducedFadeMs : 0;
}

export function popupMotionFrames(preference, opening, current) {
  const hidden = preference.movement ? POPUP_HIDDEN_FRAME : { opacity: 0, transform: 'none' };
  const shown = preference.movement ? POPUP_OPEN_FRAME : { opacity: 1, transform: 'none' };
  return [current ?? (opening ? hidden : shown), opening ? shown : hidden];
}

/** WAAPI completion can reject on reversal. Only the latest lifecycle owns removal. */
export function popupCompletionIsCurrent(generation, latest, open) {
  return generation === latest && !open;
}

// Keep the settled frame after removing a fill:'both' animation. Cancelling a
// closing effect before React removes its retained DOM otherwise exposes the
// base opacity:1 frame for one paint (the visible close/reopen flash).
export function settlePopupMotion(node, preference, open) {
  const frame = popupMotionFrames(preference, open).at(-1);
  node.style.opacity = String(frame.opacity);
  node.style.transform = frame.transform;
}

// Pointer-down happens before focus/blur. The eventual click must honor that
// intent, not invert a state that a blur handler already closed in between.
export function popupTriggerNextOpen(open, pointerDownOpen) {
  return !(typeof pointerDownOpen === 'boolean' ? pointerDownOpen : open);
}

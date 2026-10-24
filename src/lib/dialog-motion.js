import { MOTION } from './motion.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Bounded reveal geometry. Clipping the panel reveals actual-size text. */
export function dialogRevealFrame(panel, opener) {
  const width = Math.max(1, Number(panel?.width) || 1), height = Math.max(1, Number(panel?.height) || 1);
  const validOpener = opener?.width > 0 && opener?.height > 0;
  const centerX = validOpener ? opener.left + opener.width / 2 - panel.left : width / 2;
  const centerY = validOpener ? opener.top + opener.height / 2 - panel.top : height / 2;
  const size = Math.min(56, width, height);
  const x = clamp(centerX - size / 2, 0, width - size), y = clamp(centerY - size / 2, 0, height - size);
  const inset = [y / height, (width - x - size) / width, (height - y - size) / height, x / width].map(value => `${Math.max(0, value * 100).toFixed(3)}%`).join(' ');
  const dx = validOpener ? clamp(centerX - (x + size / 2), -96, 96) : 0;
  const dy = validOpener ? clamp(centerY - (y + size / 2), -96, 96) : 0;
  return { clipPath: `inset(${inset} round 14px)`, transform: `translate(${dx}px, ${dy}px)`, opacity: 0 };
}

export const DIALOG_REVEALED_FRAME = Object.freeze({ clipPath: 'inset(0% 0% 0% 0% round 14px)', transform: 'translate(0px, 0px)', opacity: 1 });

export function dialogMotionDuration(preference, closing = false) {
  return preference.movement ? closing ? 160 : 240 : preference.fadeMs ? MOTION.reducedFadeMs : 0;
}

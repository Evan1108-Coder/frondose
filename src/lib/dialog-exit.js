import { currentMotionPreference, MOTION } from './motion.js';
import { dialogMotionDuration, dialogRevealFrame, DIALOG_REVEALED_FRAME } from './dialog-motion.js';

export const DIALOG_EXIT_LIMITS = Object.freeze({ count: 3, nodes: 800, lifetimeMs: 260 });
const ghosts = new Set();
const unsafeTags = new Set(['SCRIPT', 'STYLE', 'LINK', 'BASE', 'META', 'IFRAME', 'WEBVIEW', 'OBJECT', 'EMBED', 'AUDIO', 'VIDEO', 'SOURCE', 'TRACK', 'IMG', 'PICTURE', 'CANVAS']);
const privateWidget = '.xterm, .monaco-editor, .cm-editor, [contenteditable="true"], textarea';

function shallowSnapshot(panel, document) {
  const clone = document.createElement('section');
  clone.className = 'dialog';
  const heading = document.createElement('header');
  heading.className = 'dialog-heading';
  const title = document.createElement('h2');
  title.textContent = (panel.getAttribute('aria-label') || panel.querySelector('h2')?.textContent || '').slice(0, 300);
  heading.append(title);
  clone.append(heading);
  return clone;
}

/** A static paint-only snapshot. No IDs, controls, private editor DOM, network
 * references, embedded documents, event listeners or React roots survive. */
export function dialogExitSnapshot(panel) {
  const document = panel.ownerDocument;
  const walker = document.createTreeWalker(panel, 1);
  let count = 0;
  while (walker.nextNode()) if (++count > DIALOG_EXIT_LIMITS.nodes) return shallowSnapshot(panel, document);
  const clone = panel.cloneNode(true);
  for (const widget of clone.querySelectorAll(privateWidget)) widget.replaceWith(document.createElement('div'));
  for (const node of [clone, ...clone.querySelectorAll('*')]) {
    if (unsafeTags.has(node.tagName)) { node.remove(); continue; }
    for (const attribute of [...node.attributes]) {
      if (/^(?:id|name|role|tabindex|autofocus|contenteditable|src|srcdoc|srcset|href|xlink:href|poster|action|formaction|form|data|value|background|ping|codebase|archive|manifest)$/i.test(attribute.name) || /^(?:on|aria-|data-)/i.test(attribute.name)) node.removeAttribute(attribute.name);
    }
    if (/url\s*\(/i.test(node.getAttribute('style') || '')) node.removeAttribute('style');
    if (node.matches('input, select, button')) { node.setAttribute('disabled', ''); node.setAttribute('tabindex', '-1'); }
    if (node.tagName === 'FORM') node.replaceWith(...node.childNodes);
  }
  return clone;
}

/** Real close/save/stop/navigation and focus cleanup happen immediately. Only a
 * short inert picture remains after an actual unmount, never after a refused
 * dirty-close or React's development effect replay. */
export function retainDialogExit(panel, opener) {
  if (!panel?.isConnected || panel.classList.contains('command-dialog') || !panel.animate) return;
  const document = panel.ownerDocument, window = document.defaultView;
  const preference = currentMotionPreference(), duration = dialogMotionDuration(preference, true);
  if (!duration || document.visibilityState === 'hidden') return;
  const bounds = panel.getBoundingClientRect();
  if (!bounds.width || !bounds.height || !Number.isFinite(bounds.width + bounds.height) || bounds.width > 10000 || bounds.height > 10000) return;
  const computed = window.getComputedStyle(panel);
  const from = { clipPath: computed.clipPath === 'none' ? DIALOG_REVEALED_FRAME.clipPath : computed.clipPath, transform: computed.transform, opacity: computed.opacity };
  const clone = dialogExitSnapshot(panel), backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.setAttribute('inert', '');
  backdrop.dataset.dialogReveal = 'true';
  backdrop.dataset.dialogExitGhost = 'true';
  Object.assign(backdrop.style, { pointerEvents: 'none', zIndex: '69', transition: 'none', animation: 'none' });
  Object.assign(clone.style, { position: 'fixed', left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px`, minWidth: '0', maxWidth: 'none', maxHeight: 'none', margin: '0', overflow: 'hidden', pointerEvents: 'none', transition: 'none', animation: 'none' });
  backdrop.append(clone);
  let timeout, animation, fade, observer;
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const dispose = () => {
    window.clearTimeout(timeout);
    animation?.cancel(); fade?.cancel(); observer?.disconnect();
    document.removeEventListener('visibilitychange', stop);
    media.removeEventListener('change', stop);
    backdrop.remove(); ghosts.delete(dispose);
  };
  const stop = () => { if (!currentMotionPreference().movement || document.visibilityState === 'hidden') dispose(); };
  window.requestAnimationFrame(() => {
    if (panel.isConnected || !dialogMotionDuration(currentMotionPreference(), true) || document.visibilityState === 'hidden') return;
    while (ghosts.size >= DIALOG_EXIT_LIMITS.count) ghosts.values().next().value();
    ghosts.add(dispose);
    document.body.append(backdrop);
    const to = preference.movement ? dialogRevealFrame(bounds, opener?.isConnected ? opener.getBoundingClientRect() : null) : { ...DIALOG_REVEALED_FRAME, opacity: 0 };
    animation = clone.animate([from, to], { duration, easing: MOTION.easeOut, fill: 'forwards' });
    fade = backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease-out', fill: 'forwards' });
    animation.finished.then(dispose, dispose);
    timeout = window.setTimeout(dispose, Math.min(DIALOG_EXIT_LIMITS.lifetimeMs, duration + 64));
    observer = new MutationObserver(stop);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion', 'data-input-modality'] });
    document.addEventListener('visibilitychange', stop);
    media.addEventListener('change', stop);
  });
}

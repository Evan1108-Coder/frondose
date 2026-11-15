import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck, Info, X } from './icons.jsx';
import { notifications, notify, notificationSpring, readNotificationDuration } from '../lib/notifications.js';
import './notifications.css';

export function useNotificationDuration() {
  const [duration, setDuration] = useState(readNotificationDuration);
  useEffect(() => {
    const update = () => setDuration(readNotificationDuration());
    window.addEventListener('storage', update);
    window.addEventListener('rumbo-notification-preferences', update);
    return () => { window.removeEventListener('storage', update); window.removeEventListener('rumbo-notification-preferences', update); };
  }, []);
  return duration;
}

// Existing error boundaries/forms can report a failure without laying a box
// underneath the field or duplicating it when the same component re-renders.
export function ErrorNotification({ error }) {
  useEffect(() => {
    if (error && error.name !== 'AbortError') notify(typeof error === 'string' ? error : error.message, error.code === 'read_only_demo' ? 'info' : 'error');
  }, [error]);
  return null;
}

function Notification({ item, duration }) {
  const ref = useRef(null), animation = useRef(null), timer = useRef(null);
  const returnFocus = useRef(document.activeElement);
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const [acting, setActing] = useState(false), actionInFlight = useRef(false);
  const lifetime = duration === 0 ? 0 : item.undo ? Math.max(10000, duration) : duration;
  const remaining = useRef(lifetime);
  useEffect(() => { const change = () => setHidden(document.hidden); document.addEventListener('visibilitychange', change); return () => document.removeEventListener('visibilitychange', change); }, []);
  useEffect(() => { remaining.current = lifetime; }, [lifetime, item.revision]);
  useEffect(() => {
    if (!lifetime || hovered || focused || hidden || acting || item.closing) return;
    const started = performance.now();
    timer.current = setTimeout(() => notifications.dismiss(item.id), Math.max(0, remaining.current));
    return () => { clearTimeout(timer.current); remaining.current = Math.max(0, remaining.current - (performance.now() - started)); };
  }, [lifetime, item.revision, hovered, focused, hidden, acting, item.closing, item.id]);
  useEffect(() => {
    const element = ref.current;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = () => media.matches || document.documentElement.dataset.motion === 'reduced';
    const complete = () => { if (item.closing) notifications.remove(item.id); };
    if (reduced() || !element.animate) { complete(); return; }
    // Exit begins at the currently rendered position, even during arrival.
    const from = { transform: getComputedStyle(element).transform, opacity: getComputedStyle(element).opacity };
    animation.current?.cancel();
    const distance = element.getBoundingClientRect().bottom - new DOMMatrixReadOnly(from.transform).m42 + 24;
    const entrance = notificationSpring.map(frame => ({ ...frame, transform: `translateY(${Number(frame.transform.match(/[-\d.]+/)[0]) / 130 * distance}px)` }));
    animation.current = element.animate(item.closing ? [from, { transform: `translateY(-${distance}px)`, opacity: 0 }] : entrance, {
      duration: item.closing ? 180 : 560, easing: item.closing ? 'cubic-bezier(.4,0,1,1)' : 'linear', fill: 'both',
    });
    animation.current.onfinish = complete;
    const change = () => { if (reduced()) { animation.current?.cancel(); complete(); } };
    media.addEventListener('change', change);
    const observer = new MutationObserver(change);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    return () => { media.removeEventListener('change', change); observer.disconnect(); };
  }, [item.closing, item.id]);
  useEffect(() => () => { animation.current?.cancel(); clearTimeout(timer.current); }, []);
  const dismiss = () => {
    // A disappearing close/action button must not strand focus in the body.
    if (ref.current?.contains(document.activeElement)) {
      const previous = returnFocus.current;
      const target = previous?.isConnected && previous !== document.body && !previous.closest('[inert]') ? previous : [...document.querySelectorAll('[role="dialog"] .dialog-heading button')].at(-1) || document.querySelector('#main-content');
      target?.focus({ preventScroll: true });
    }
    notifications.dismiss(item.id);
  };
  const Icon = item.type === 'error' ? CircleAlert : item.type === 'info' ? Info : CircleCheck;
  return <article ref={ref} className={`rumbo-notice ${item.type}`} data-closing={item.closing || undefined}
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <Icon aria-hidden="true" interactive={false} />
    <span role={item.type === 'error' ? 'alert' : 'status'} aria-atomic="true">{item.message}</span>
    {item.undo || item.action ? <button className="rumbo-notice-action" disabled={acting || item.closing} onClick={async () => {
      if (actionInFlight.current) return;
      actionInFlight.current = true; setActing(true);
      try { await (item.undo || item.action)(); dismiss(); } catch (error) { notify(error.message || 'The action could not be completed.', 'error'); }
      finally { actionInFlight.current = false; setActing(false); }
    }}>{item.undo ? 'Undo' : item.actionLabel || 'Retry'}</button> : null}
    <button className="rumbo-notice-close" aria-label="Dismiss notification" onClick={dismiss}><X aria-hidden="true" interactive={false} /></button>
  </article>;
}

export function Notifications() {
  const items = useSyncExternalStore(notifications.subscribe, notifications.getSnapshot);
  const layout = useRef(new Map());
  const duration = useNotificationDuration();
  useLayoutEffect(() => {
    const previous = layout.current, next = new Map();
    const reduced = document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const slot of document.querySelectorAll('[data-notice-slot]')) {
      const id = slot.dataset.noticeSlot;
      const offset = new DOMMatrixReadOnly(getComputedStyle(slot).transform).m42;
      slot.getAnimations().forEach(animation => animation.cancel());
      const top = slot.getBoundingClientRect().top;
      if (!reduced && previous.has(id) && slot.animate) {
        const delta = previous.get(id) + offset - top;
        if (Math.abs(delta) > 1) slot.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
      next.set(id, top);
    }
    layout.current = next;
  }, [items]);
  useEffect(() => {
    // Used by the isolated landing adapter; it conveys a notice, not authority.
    const onNotice = event => { if (typeof event.detail?.message === 'string') notify(event.detail.message.slice(0, 1600), event.detail.type === 'error' ? 'error' : 'info'); };
    window.addEventListener('rumbo:notice', onNotice);
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const settle = () => {
      if (media.matches || document.documentElement.dataset.motion === 'reduced')
        document.querySelectorAll('[data-notice-slot]').forEach(slot => slot.getAnimations().forEach(animation => animation.cancel()));
    };
    media.addEventListener('change', settle);
    const observer = new MutationObserver(settle);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    return () => { window.removeEventListener('rumbo:notice', onNotice); media.removeEventListener('change', settle); observer.disconnect(); };
  }, []);
  return createPortal(<section className="rumbo-notifications" data-rumbo-notifications aria-label="Notifications">{items.slice(-3).map(item => <div key={item.id} data-notice-slot={item.id}><Notification item={item} duration={duration} /></div>)}</section>, document.body);
}

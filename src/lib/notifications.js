// One bounded, browser-local notification channel. No workspace mutation.
export const NOTIFICATION_KEY = 'rumbo.notifications.v1';
export const NOTIFICATION_DURATIONS = [3000, 5000, 8000, 12000, 0];
export const DEFAULT_NOTIFICATION_DURATION = 8000;
export function normalizeNotificationDuration(value) {
  return NOTIFICATION_DURATIONS.includes(value) ? value : DEFAULT_NOTIFICATION_DURATION;
}
export function readNotificationDuration(storage) {
  try { return normalizeNotificationDuration(JSON.parse((storage ?? globalThis.localStorage).getItem(NOTIFICATION_KEY))?.duration); }
  catch { return DEFAULT_NOTIFICATION_DURATION; }
}
export function saveNotificationDuration(value, storage = globalThis.localStorage) {
  const duration = normalizeNotificationDuration(value);
  storage.setItem(NOTIFICATION_KEY, JSON.stringify({ duration }));
  globalThis.window?.dispatchEvent(new Event('rumbo-notification-preferences'));
  return duration;
}

export function createNotificationStore() {
  let items = [], sequence = 0;
  const listeners = new Set();
  const emit = () => listeners.forEach(listener => listener());
  return {
    getSnapshot: () => items,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    show(message, type = 'success', undo, options = {}) {
      if (!message) return null;
      const text = String(message);
      const duplicate = items.find(item => !item.closing && item.message === text && item.type === type);
      if (duplicate) {
        items = items.map(item => item === duplicate ? { ...item, revision: item.revision + 1, undo, ...options } : item);
        emit(); return duplicate.id;
      }
      const id = ++sequence;
      items = [...items.filter(item => !item.closing), { id, message: text, type, undo, revision: 0, ...options }].slice(-8);
      emit(); return id;
    },
    dismiss(id) { items = items.map(item => item.id === id ? { ...item, closing: true } : item); emit(); },
    remove(id) { items = items.filter(item => item.id !== id); emit(); },
  };
}
export const notifications = createNotificationStore();
export const notify = (message, type, undo, options) => notifications.show(message, type, undo, options);

// A damped spring sampled once, not a render-loop or a continuously moving UI.
export const notificationSpring = Array.from({ length: 41 }, (_, index) => {
  const t = index / 40;
  const displacement = Math.exp(-8 * t) * (Math.cos(11 * t) + (8 / 11) * Math.sin(11 * t));
  return { offset: t, transform: `translateY(${index === 40 ? 0 : -displacement * 130}%)`, opacity: Math.min(1, t * 7) };
});

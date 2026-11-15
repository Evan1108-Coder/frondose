import { readWorkspaceOnboarding } from './workspace-onboarding.js';

const observedEvents = new Set();
const pendingBrowserPermissions = new WeakMap();

export function notificationResultMessage(result) {
  if (!result?.supported || result.delivery === 'unsupported') return 'System notifications are unavailable here.';
  if (result.delivery === 'failed') return result.error || 'The system could not deliver the notification. Check notification settings.';
  if (result.delivery === 'shown') return 'The system accepted the notification. Banner visibility and sound follow your system settings.';
  if (result.delivery === 'cancelled') return 'The notification request was cancelled.';
  if (result.delivery === 'idle') return result.permission === 'granted' ? 'This browser allows notifications.' : 'System permission has not been checked yet.';
  if (result.delivery === 'pending' && result.permission === 'default' && !result.requested) return 'Notification permission is still pending. You can continue without allowing notifications and enable them later in settings.';
  return 'Waiting for the system. Allow Frondose notifications in the system prompt; Focus or notification settings may hide banners.';
}

export async function requestWorkspaceNotification({ native = globalThis.frondoseDesktop?.notifications, NotificationClass = globalThis.Notification, silent = false, test = false, requestPermission = true, permissionTimeoutMs = 6000 } = {}) {
  if (native?.test) return native.test({ silent,...(test?{test:true}:{}) });
  if (!NotificationClass) return { supported: false, requested: false, delivery: 'unsupported', permission: 'unavailable' };
  let permission = NotificationClass.permission;
  if (permission === 'default' && requestPermission) {
    let timer;
    try {
      let pending = pendingBrowserPermissions.get(NotificationClass);
      if (!pending) {
        pending = Promise.resolve().then(() => NotificationClass.requestPermission());
        pendingBrowserPermissions.set(NotificationClass, pending);
        const clear = () => { if (pendingBrowserPermissions.get(NotificationClass) === pending) pendingBrowserPermissions.delete(NotificationClass); };
        void pending.then(clear, clear);
      }
      const timeout = Number.isFinite(permissionTimeoutMs) ? Math.max(1, Math.min(6000, permissionTimeoutMs)) : 6000;
      const result = await Promise.race([pending.then(value => ({ permission: value })), new Promise(resolve => { timer = setTimeout(() => resolve({ pending: true }), timeout); })]);
      // A hidden/embedded browser may never answer. Do not trap onboarding or
      // create a notification later if this request eventually resolves.
      if (result.pending) return { supported: true, requested: false, delivery: 'pending', permission: 'default' };
      permission = result.permission;
    } catch (cause) {
      return { supported: true, requested: false, delivery: 'failed', permission: 'default', error: cause?.message || 'This browser could not request notification permission. You can continue without notifications.' };
    } finally { clearTimeout(timer); }
  }
  if (permission !== 'granted') return { supported: true, requested: false, delivery: 'failed', permission, error: permission === 'denied' ? 'Notifications are blocked in this browser. Allow them in browser settings to receive alerts.' : 'Allow notifications to receive alerts. Your browser may require the Allow notifications button.' };
  return displayBrowserNotification({ NotificationClass, title: 'Frondose', body: test?'This is a test notification from Frondose.':'Your workspace is ready. Frondose will let you know when work needs attention.', silent, permission });
}

function displayBrowserNotification({ NotificationClass, title, body, silent, permission }) {
  return new Promise(resolve => {
    let notice, settled = false;
    const finish = result => { if (!settled) { settled = true; resolve({ supported: true, requested: true, permission, ...result }); } };
    try {
      notice = new NotificationClass(title, { body, silent });
      notice.onshow = () => finish({ delivery: 'shown', error: null });
      notice.onerror = () => finish({ delivery: 'failed', error: 'This browser could not deliver the notification. Check notification settings or use the desktop app.' });
      // Some browsers never emit show. Do not claim visible delivery from construction.
      const pendingTimer = setTimeout(() => finish({ delivery: 'pending', error: null }), 1500);
      const closeTimer = setTimeout(() => notice?.close(), 12000);
      pendingTimer?.unref?.(); closeTimer?.unref?.();
    } catch (cause) { finish({ delivery: 'failed', error: cause.message || 'This browser could not display a notification.' }); }
  });
}

// Only observed live transitions should call this. Never ask for a new OS/browser
// permission when work ends; a saved preference and already-authorized path are
// required. Bounded session-local dedupe survives view duplication and reloads.
export async function notifyWorkspaceEvent({ workspaceId, key, title, body }, environment = {}) {
  if (typeof workspaceId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(workspaceId) || typeof key !== 'string' || !/^[a-zA-Z0-9_.:-]{1,240}$/.test(key)) throw Error('A valid workspace and notification event identity are required.');
  const preference = readWorkspaceOnboarding(workspaceId, environment.preferenceStorage);
  if (!preference.notificationsEnabled) return { requested: false, delivery: 'disabled' };
  const identity = `${workspaceId}:${key}`, storageKey = `frondose.system-notification-events.v1:${workspaceId}`;
  let storage, saved = [];
  try {
    storage = environment.storage ?? globalThis.sessionStorage;
    const value = JSON.parse(storage?.getItem(storageKey) || '[]');
    if (Array.isArray(value)) saved = value.filter(item => typeof item === 'string' && item.length <= 370).slice(-256);
  } catch { /* A private window may block storage; bounded memory still dedupes. */ }
  if (observedEvents.has(identity) || saved.includes(identity)) return { requested: false, delivery: 'duplicate' };
  observedEvents.add(identity); while (observedEvents.size > 1024) observedEvents.delete(observedEvents.values().next().value);
  try { storage?.setItem(storageKey, JSON.stringify([...saved, identity].slice(-256))); } catch {}
  const silent = preference.notificationSound === 'silent';
  const payload = { title: String(title || 'Frondose').slice(0, 120), body: String(body || 'Work needs attention.').slice(0, 240), silent };
  const native = environment.native ?? globalThis.frondoseDesktop?.notifications;
  if (native?.notify) return native.notify(payload);
  const NotificationClass = environment.NotificationClass ?? globalThis.Notification;
  if (!NotificationClass || NotificationClass.permission !== 'granted') return { requested: false, supported: Boolean(NotificationClass), delivery: 'unavailable', permission: NotificationClass?.permission || 'unavailable' };
  return displayBrowserNotification({ NotificationClass, ...payload, permission: 'granted' });
}

export function createNotificationStepTrigger() {
  const entered = new Set();
  return {
    enter(workspaceId, open, step, callback) {
      if (!open || step !== 3 || !workspaceId || entered.has(workspaceId)) return false;
      entered.add(workspaceId); callback(); return true;
    },
    reset(workspaceId) { entered.delete(workspaceId); },
  };
}

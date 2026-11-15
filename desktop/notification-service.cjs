'use strict';
const { notificationPayload } = require('./browser-policy.cjs');

function notificationSettingsTarget(platform) {
  if (platform === 'darwin') return 'x-apple.systempreferences:com.apple.Notifications-Settings.extension?appBundleId=app.frondose.desktop';
  if (platform === 'win32') return 'ms-settings:notifications';
  return null;
}

// Availability is not permission or delivery. Resolve on the native show/failed
// event, and retain late results after a bounded IPC wait (e.g. permission UI).
function createNativeNotificationService({ Notification, onOpen = () => {}, onStatus = () => {}, platform = process.platform, isPackaged = false, timeoutMs = 6000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const notices = new Set();
  let sequence = 0, last = { delivery: 'idle', error: null, id: null };
  const supported = () => { try { return Notification.isSupported() === true; } catch { return false; } };
  const status = () => ({ supported: supported(), permission: supported() ? 'unknown' : 'unavailable', native: true, platform, packaged: isPackaged, requiresSignedApp: platform === 'darwin', settingsAvailable: Boolean(notificationSettingsTarget(platform)), ...last });
  const publish = result => { last = result; onStatus(status()); return status(); };
  function send(input) {
    const payload = notificationPayload(input);
    if (!supported()) return Promise.resolve(publish({ requested: false, delivery: 'unsupported', error: 'System notifications are unavailable on this computer.', id: null }));
    while (notices.size >= 8) notices.values().next().value.close();
    const id = `notice_${++sequence}`;
    return new Promise(resolve => {
      let notification, timer, resolved = false;
      const settle = result => { const next = publish({ requested: true, id, ...result }); if (!resolved) { resolved = true; clearTimer(timer); resolve(next); } };
      const close = () => { notices.delete(entry); clearTimer(timer); if (!resolved) { resolved = true; resolve({ ...status(), requested: true, id, delivery: 'cancelled' }); } try { notification?.close(); } catch {} };
      const entry = { close };
      try {
        notification = new Notification({ title: payload.title, body: payload.body, silent: payload.silent });
        notices.add(entry);
        notification.once('show', () => settle({ delivery: 'shown', error: null }));
        notification.once('failed', (_event, cause) => {
          notices.delete(entry);
          const details = String(cause || 'The operating system rejected the notification.').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 240);
          settle({ delivery: 'failed', error: platform === 'darwin' ? `macOS could not deliver the notification. Check notification permission and use a signed Frondose app. ${details}` : `The system could not deliver the notification. ${details}` });
        });
        notification.once('close', () => { notices.delete(entry); if (!resolved) settle({ delivery: 'unknown', error: null }); });
        notification.on('click', () => onOpen(payload.action));
        publish({ requested: true, id, delivery: 'pending', error: null });
        timer = setTimer(() => settle({ delivery: 'pending', error: null }), timeoutMs);
        timer?.unref?.();
        notification.show();
      } catch (cause) {
        notices.delete(entry);
        settle({ delivery: 'failed', error: String(cause?.message || 'The system could not create a notification.').slice(0, 240) });
      }
    });
  }
  return { status, send, close() { for (const notice of [...notices]) notice.close(); notices.clear(); } };
}
module.exports = { createNativeNotificationService, notificationSettingsTarget };

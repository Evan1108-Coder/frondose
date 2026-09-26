import { Button, Select } from '../../ui.jsx';
import { useNotificationDuration } from '../../components/Notifications.jsx';
import { notify, saveNotificationDuration, NOTIFICATION_DURATIONS } from '../../lib/notifications.js';

export function NotificationPreferences() {
  const duration = useNotificationDuration();
  return <section className="settings-group" data-notification-preferences><h2>On-screen notices</h2><div className="settings-panel">
    <div className="setting-row"><span><strong>Display duration</strong><small>Errors and confirmations appear at the top. The timer pauses while hovered, focused, or in a hidden tab. Saved for this browser only.</small></span>
      <Select aria-label="Notification display duration" value={String(duration)} onChange={value => {
        try { saveNotificationDuration(Number(value)); notify('Notification duration updated. This preference only affects your browser.', 'info'); }
        catch { notify('Your browser could not save the notification preference.', 'error'); }
      }}>{NOTIFICATION_DURATIONS.map(value => <option key={value} value={String(value)}>{value ? `${value / 1000} seconds${value === 8000 ? ' (default)' : ''}` : 'Until dismissed'}</option>)}</Select>
    </div>
    <div className="setting-row"><span><strong>Preview notification</strong><small>Close any notice with ×. Motion follows your reduced-motion preference. Undo remains available for at least 10 seconds.</small></span><Button onClick={() => notify('This is a preview. Notices arrive here without interrupting your work.', 'info')}>Preview notification</Button></div>
  </div></section>;
}

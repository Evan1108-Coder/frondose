import { useEffect, useRef, useState } from 'react';
import { Button, Select, Toggle } from '../../ui.jsx';
import { readWorkspaceOnboarding, saveWorkspaceOnboarding } from '../../lib/workspace-onboarding.js';
import { notificationResultMessage, requestWorkspaceNotification } from '../../lib/system-notifications.js';
import { useInterfaceLanguage } from '../InterfaceLanguage.jsx';
import { interfaceText } from '../../lib/interface-language.js';

export function SystemNotificationSettings({ workspaceId }) {
  const language=useInterfaceLanguage();
  const [preferences, setPreferences] = useState(() => readWorkspaceOnboarding(workspaceId));
  const [status, setStatus] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const alive = useRef(true), currentWorkspace = useRef(workspaceId);
  currentWorkspace.current = workspaceId;
  useEffect(() => {
    alive.current = true; setPreferences(readWorkspaceOnboarding(workspaceId)); setBusy(false); setError('');
    const native = globalThis.frondoseDesktop?.notifications;
    if (native?.status) void native.status().then(result => { if (alive.current) setStatus(result); }).catch(cause => { if (alive.current) setError(cause.message); });
    else setStatus({ supported: Boolean(globalThis.Notification), permission: globalThis.Notification?.permission || 'unavailable', delivery: 'idle' });
    const unsubscribe = native?.onStatus?.(result => { if (alive.current) setStatus(result); });
    return () => { alive.current = false; unsubscribe?.(); };
  }, [workspaceId]);
  function save(patch) {
    try { setPreferences(saveWorkspaceOnboarding(workspaceId, patch)); setError(''); }
    catch (cause) { setError(cause.message || 'This browser could not save notification preferences.'); }
  }
  async function enable(enabled) {
    if (!enabled) { save({ notificationsEnabled: false }); return; }
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await requestWorkspaceNotification({ silent: preferences.notificationSound === 'silent' });
      if (!alive.current || currentWorkspace.current !== workspaceId) return;
      setStatus(result); save({ notificationsEnabled: result.requested === true && result.supported === true && result.delivery!=='failed' });
    } catch (cause) { if (alive.current && currentWorkspace.current === workspaceId) setError(cause.message); }
    finally { if (alive.current && currentWorkspace.current === workspaceId) setBusy(false); }
  }
  async function testNotification() {
    if(busy)return;
    setBusy(true);setError('');
    try {
      const result=await requestWorkspaceNotification({silent:preferences.notificationSound==='silent',test:true});
      if(alive.current&&currentWorkspace.current===workspaceId)setStatus(result);
    }catch(cause){
      if(alive.current&&currentWorkspace.current===workspaceId)setError(cause.message);
    }finally{
      if(alive.current&&currentWorkspace.current===workspaceId)setBusy(false);
    }
  }
  const native = globalThis.frondoseDesktop?.notifications;
  return <section className="settings-group"><h2>System notifications</h2><div className="settings-panel">
    <Toggle label="Work alerts" description="Notify when live work finishes or needs attention. Delivery follows your system notification settings." checked={preferences.notificationsEnabled} disabled={busy} onChange={enable}/>
    <div className="setting-row"><span><strong>System delivery</strong><small role="status">{interfaceText(busy?'Waiting for the system notification…':status?notificationResultMessage(status):'Reading notification status…',language)}</small></span><div className="notification-test-actions"><Button disabled={busy} onClick={testNotification}>Test notification</Button>{native?.openSettings ? <Button onClick={async () => { try { const result = await native.openSettings(); if (!result.opened) setError(result.error); } catch (cause) { setError(cause.message); } }}>Open system settings</Button> : null}</div></div>
    <div className="setting-row"><span><strong>Notification sound</strong></span><Select aria-label="System notification sound" value={preferences.notificationSound} onChange={notificationSound => save({ notificationSound })}><option value="system">System default</option><option value="silent">Silent</option></Select></div>
    {error ? <p className="workspace-welcome-error" role="alert">{error}</p> : null}
  </div></section>;
}

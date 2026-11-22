import { useEffect, useRef, useState } from 'react';
import { Button, ErrorMessage, Select, Toggle, useApp } from '../../ui.jsx';
import { apiRequest } from '../../data/api.js';
import { frondoseActions } from '../../data/useFrondose.js';
import { workbenchRequest } from '../../lib/workbench.js';
import { normalizeWorkspaceTabAppearance } from '../../lib/local-settings-catalog.js';
import { readTipPreferences, saveTipPreferences, TIP_DURATIONS } from '../../lib/workspace-onboarding.js';
import { useUnsavedUpdate } from '../../components/UnsavedUpdates.jsx';
import { NotificationPreferences } from './NotificationPreferences.jsx';
import { SystemNotificationSettings } from '../../components/workspace/SystemNotificationSettings.jsx';

import { LocalSessionHistorySettings } from '../../components/workspace/SessionHistorySearch.jsx';
import { TerminalShell } from './TerminalShell.jsx';
import { BranchTabsSettings } from '../../components/workspace/BranchTabsSettings.jsx';
import { TerminalPreferences } from './TerminalPreferences.jsx';
import { TerminalSessions } from './TerminalSessions.jsx';
import { localTerminalSettingsTarget, assertLocalTerminalSettingsTarget } from '../../lib/local-terminal-settings.js';

function Heading({ title, children }) { return <header className="settings-heading"><div><h1>{title}</h1>{children ? <p>{children}</p> : null}</div></header>; }
function Group({ title, children }) { return <section className="settings-group"><h2>{title}</h2><div className="settings-panel">{children}</div></section>; }
function Row({ title, description, children }) { return <div className="setting-row"><span><strong>{title}</strong>{description ? <small>{description}</small> : null}</span>{children}</div>; }

export function LocalWorkspaceSettings({ section = 'workspace-tabs' }) {
  const { data, workspace, navigate, showShortcuts, edit } = useApp();
  const [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const locked = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useUnsavedUpdate(false, busy);
  const update = async (group, patch) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null);
    try { await frondoseActions.updateSettings({ [group]: patch }); }
    catch (cause) { if (alive.current) setError(cause); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  };
  const tabs = normalizeWorkspaceTabAppearance(data.settings?.appearance);
  if (section === 'preferences') return <><Heading title="General">Local workspace preferences. CLI sign-in and model options stay in each CLI.</Heading><ErrorMessage error={error}/><Group title="Dates"><Row title="First day of the week" description="Applies to Frondose’s date pickers."><Select aria-label="First day of week" disabled={busy} value={data.settings?.preferences?.weekStart || 'monday'} onChange={weekStart => update('preferences', { weekStart })}><option value="monday">Monday</option><option value="sunday">Sunday</option></Select></Row></Group><Group title="Your workspace"><Row title="Workspace tabs"><Button onClick={() => navigate('settings', 'workspace-tabs')}>Configure tabs</Button></Row><Row title="Terminal"><Button onClick={() => navigate('settings', 'terminal')}>Configure terminal</Button></Row><Row title="Keyboard shortcuts"><Button onClick={showShortcuts}>View shortcuts</Button></Row></Group></>;
  if (section === 'session-history') return <><Heading title="Session history search">Search supported native CLI histories locally, only with your permission.</Heading><LocalSessionHistorySettings workspaceId={workspace.id}/></>;
  if (section === 'privacy') return <><Heading title="Privacy">Local storage and explicit native execution.</Heading><Group title="Data on this computer"><Row title="Frondose analytics" description="Analytics and crash reporting remain disabled in this build."><span>Disabled</span></Row><Row title="Native tools" description="Terminals and CLIs run as your OS user and may use files and the network. A selected project directory is not a sandbox."><span>Explicit launch</span></Row><Row title="Provider accounts" description="Each CLI manages its own sign-in and provider terms. A local Frondose workspace does not make cloud AI offline."/></Group><Group title="Manage your data"><Row title="Workspace archive"><Button onClick={() => navigate('settings', 'storage')}>Import & export</Button></Row></Group></>;
  if (section === 'workspace') return <><Heading title="Workspace">One project directory per workspace. Existing content stays on this computer.</Heading><Group title="Identity"><Row title={workspace.name} description={workspace.description || 'Your local project workspace.'}><Button onClick={() => edit('workspace', workspace)}>Edit workspace</Button></Row></Group><Group title="Workspace data"><Row title="Another project directory"><Button onClick={() => edit('workspace')}>New workspace</Button></Row><Row title="Portable archive"><Button onClick={() => navigate('settings', 'storage')}>Import & export</Button></Row></Group></>;
  return <><Heading title="Workspace tabs">Adjust the tab strip without changing files or running sessions.</Heading><ErrorMessage error={error}/><Group title="Tab appearance"><Row title="Tab size"><Select aria-label="Workspace tab size" disabled={busy} value={tabs.workspaceTabSize} onChange={workspaceTabSize => update('appearance', { workspaceTabSize })}><option value="compact">Compact</option><option value="comfortable">Comfortable</option></Select></Row><Row title="Close buttons" description="Hover mode still shows the close control on keyboard focus and touch devices."><Select aria-label="Workspace tab close buttons" disabled={busy} value={tabs.workspaceTabCloseButtons} onChange={workspaceTabCloseButtons => update('appearance', { workspaceTabCloseButtons })}><option value="always">Always visible</option><option value="hover">On hover or focus</option></Select></Row></Group><BranchTabsSettings/><Group title="Safe navigation"><Row title="Unsaved files" description="Save, discard, or cancel before replacing a draft. Failed saves keep the draft."><span>Protected</span></Row><Row title="Running CLI sessions" description="Closing a view does not stop its process unless you explicitly choose Stop and close."><span>Separate lifetime</span></Row></Group></>;
}

export function LocalTerminalSettings() {
  const { workspace } = useApp();
  const [target, setTarget] = useState(null), [terminalRoot, setTerminalRoot] = useState(null), [settings, setSettings] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const alive = useRef(true), locked = useRef(null), generation = useRef(0), currentWorkspace = useRef(workspace.id);
  currentWorkspace.current = workspace.id;
  useUnsavedUpdate(false, busy);
  useEffect(() => {
    alive.current = true; const controller = new AbortController(), revision = ++generation.current, workspaceId = workspace.id;
    const current = () => !controller.signal.aborted && alive.current && revision === generation.current && currentWorkspace.current === workspaceId;
    locked.current = null; setBusy(false); setTarget(null); setTerminalRoot(null); setSettings(null); setError(null); setLoaded(false);
    apiRequest(`/api/directory-workspace?workspace_id=${encodeURIComponent(workspace.id)}`, { signal: controller.signal }).then(async ({ result }) => {
      if (!current()) return;
      const nextTarget = localTerminalSettingsTarget(workspaceId, result);
      const summary = await workbenchRequest(nextTarget.scope, '', { signal: controller.signal });
      if (current()) { setTarget(nextTarget); setTerminalRoot(summary.terminalRoot || summary.root || null); setSettings(summary.settings); setLoaded(true); if (summary.folderError || result.error) setError(new Error(summary.folderError || result.error)); }
    }).catch(cause => { if (current()) { setError(cause); setLoaded(true); } });
    return () => { alive.current = false; controller.abort(); };
  }, [workspace.id]);
  const update = async patch => {
    if (locked.current || !settings || !target || target.scope.workspaceId !== workspace.id) return;
    const token = Symbol('terminal-settings'), revision = generation.current, workspaceId = workspace.id, selected = target;
    const current = () => alive.current && generation.current === revision && currentWorkspace.current === workspaceId;
    locked.current = token; setBusy(true); setError(null);
    try {
      const { result } = await apiRequest(`/api/directory-workspace?workspace_id=${encodeURIComponent(workspaceId)}`);
      if (!current()) return;
      assertLocalTerminalSettingsTarget(selected, result);
      const response = await workbenchRequest(selected.scope, 'settings', { method: 'PATCH', body: { ...patch, expected_binding_version: selected.expectedBindingVersion } });
      if (!current()) return;
      const fresh = await apiRequest(`/api/directory-workspace?workspace_id=${encodeURIComponent(workspaceId)}`);
      if (!current()) return;
      assertLocalTerminalSettingsTarget(selected, fresh.result);
      setSettings(response.settings);
    } catch (cause) { if (current()) setError(cause); }
    finally { if (locked.current === token) locked.current = null; if (current()) setBusy(false); }
  };
  return <><Heading title="Terminal">Preferences for native terminal and CLI tabs. Without a linked directory, new terminals use your OS home directory.</Heading><ErrorMessage error={error}/>{!loaded ? <p role="status">Reading terminal preferences…</p> : settings ? <Group title="This workspace"><Row title={target?.home ? 'Home directory' : 'Project directory'} description={terminalRoot || target?.binding?.path || 'The terminal directory is currently unavailable.'}/><Row title="Terminal font size"><Select aria-label="Terminal font size" value={String(settings.terminalFontSize)} disabled={busy} onChange={value => update({ terminalFontSize: Number(value) })}>{Array.from({ length: 12 }, (_, index) => index + 11).map(value => <option key={value} value={String(value)}>{value}px</option>)}</Select></Row><Row title="Maximum active terminals" description="Lowering the limit never stops existing sessions. The new limit applies to future launches."><Select aria-label="Maximum active terminals" value={String(settings.maxTerminals)} disabled={busy} onChange={value => update({ maxTerminals: Number(value) })}>{Array.from({ length: 8 }, (_, index) => index + 1).map(value => <option key={value} value={String(value)}>{value}</option>)}</Select></Row></Group> : <p>Terminal preferences could not be loaded. Reopen this settings page to retry.</p>}<TerminalShell/><TerminalPreferences/>{target ? <TerminalSessions target={target}/> : null}<Group title="Execution"><Row title="Native shell permissions" description="Terminals run with your OS user’s permissions, not in a project sandbox. Changing these display preferences never launches or stops a process."/></Group></>;
}

export function LocalNotificationSettings() {
  const { workspace } = useApp();
  const [tips, setTips] = useState(readTipPreferences), [error, setError] = useState(null);
  useEffect(() => { const update = () => setTips(readTipPreferences()); window.addEventListener('storage', update); return () => window.removeEventListener('storage', update); }, []);
  const update = patch => { try { setTips(saveTipPreferences(patch)); setError(null); } catch (cause) { setError(cause); } };
  return <><Heading title="Notifications & tips">System alerts and on-screen feedback.</Heading>{workspace?.id ? <SystemNotificationSettings workspaceId={workspace.id}/> : null}<NotificationPreferences/><Group title="Workspace tips"><Toggle label="Show contextual tips" checked={tips.enabled} onChange={enabled => update({ enabled })}/><Row title="Tip duration"><Select aria-label="Workspace tip duration" value={String(tips.duration)} onChange={value => update({ duration: Number(value) })}>{TIP_DURATIONS.map(value => <option key={value} value={String(value)}>{value ? `${value / 1000} seconds` : 'Until dismissed'}</option>)}</Select></Row><Toggle label="Tip entrance motion" description="Always respects your reduced-motion preference." checked={tips.movement} onChange={movement => update({ movement })}/><Row title="Previously hidden tips"><Button onClick={() => update({ dismissedCategories: [] })}>Reset hidden tips</Button></Row></Group><ErrorMessage error={error}/></>;
}

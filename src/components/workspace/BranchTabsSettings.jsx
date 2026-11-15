import { useEffect, useState } from 'react';
import { Button, ErrorMessage, Toggle, useApp } from '../../ui.jsx';
import { branchTabsPreferenceKey, clearBranchTabMemory, readBranchTabsPreference, saveBranchTabsPreference } from '../../lib/branch-workspace-tabs.js';

export function BranchTabsSettings({ workspaceId: providedWorkspaceId }) {
  const { workspace } = useApp(), workspaceId = providedWorkspaceId || workspace?.id;
  const [enabled, setEnabled] = useState(() => readBranchTabsPreference(globalThis.localStorage, workspaceId)), [error, setError] = useState(null), [cleared, setCleared] = useState(false);
  useEffect(() => {
    const refresh = event => { if (!event?.key || event.key === branchTabsPreferenceKey(workspaceId)) setEnabled(readBranchTabsPreference(globalThis.localStorage, workspaceId)); };
    refresh(); setError(null); setCleared(false); window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [workspaceId]);
  return <section className="settings-panel identity-setup"><h2>Branch tab layouts</h2><Toggle label="Remember file and page tabs per branch" checked={enabled} onChange={value => {
    if (!saveBranchTabsPreference(globalThis.localStorage, workspaceId, value)) { setError(Error('This browser could not save the preference. The previous setting is unchanged.')); return; }
    setEnabled(value); setError(null); setCleared(false);
  }}/><p>Off by default. When off, switching a branch refreshes files and keeps your current tabs. When on, this workspace remembers clean file/page layouts for each repository branch; a new branch starts with a new tab.</p><p>Terminals, AI CLIs, browser tabs, draft files and splits containing them stay shared across branches. They are never stopped, relaunched or hidden by this setting. Unsaved or pending editors prevent layout replacement. Only bounded tab metadata is stored on this device—not source content or launch commands.</p><ErrorMessage error={error}/><Button onClick={() => { if (clearBranchTabMemory(globalThis.localStorage, workspaceId)) { setCleared(true); setError(null); } else setError(Error('The saved branch tab metadata could not be cleared.')); }}>Forget saved branch tab layouts</Button>{cleared ? <p role="status">Saved branch layouts cleared. Current tabs and files are unchanged.</p> : null}</section>;
}

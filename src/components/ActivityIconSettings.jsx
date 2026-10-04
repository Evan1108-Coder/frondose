import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, useApp } from '../ui.jsx';
import { UPDATE_TYPES } from '../lib/activity.js';
import { RUN_ACTIVITY_TYPES, resetActivityIcon, saveActivityIcon, useActivityIcon } from '../lib/activity-icons.js';
import { ActivityTypeIcon } from './ActivityTypeIcon.jsx';
import ReactionPicker from './ReactionPicker.jsx';

function IconRow({ workspaceId, type, label, onPick }) {
  const id = useActivityIcon(workspaceId, type);
  return <div className="setting-row"><span className="activity-icon-setting-label"><ActivityTypeIcon workspaceId={workspaceId} type={type} size={20} /><strong>{label}</strong></span><div className="activity-icon-setting-actions"><Button onClick={() => onPick(type, label, id)}>Change icon</Button><Button onClick={() => resetActivityIcon(workspaceId, type)}>Reset</Button></div></div>;
}

export function ActivityIconSettings() {
  const { workspace } = useApp();
  const [editing, setEditing] = useState(null);
  return <section className="settings-group"><h2>Activity type icons</h2><p className="muted">Choose a distinct icon for updates and run events. Your choices stay in this browser and workspace; they do not change teammates’ views.</p><div className="settings-panel">
    {[...UPDATE_TYPES, ...RUN_ACTIVITY_TYPES].map(([type, label]) => <IconRow key={type} workspaceId={workspace.id} type={type} label={label} onPick={(id, name, selected) => setEditing({ id, name, selected })} />)}
  </div>{editing ? createPortal(<ReactionPicker iconsOnly title={`Choose ${editing.name} icon`} selected={[{ id: editing.selected }]} onClose={() => setEditing(null)} onSelect={icon => { saveActivityIcon(workspace.id, editing.id, icon.id); setEditing(null); }} />, document.body) : null}</section>;
}

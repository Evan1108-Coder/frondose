import { useEffect, useState } from 'react';
import { apiRequest } from '../../data/api.js';
import { Button, ErrorMessage } from '../../ui.jsx';
import { Activity, RotateCw } from '../../components/icons.jsx';
import { useInterfaceLanguage } from '../../components/InterfaceLanguage.jsx';
import { interfaceText } from '../../lib/interface-language.js';
import './workspace-activity.css';

const labels = {
  'file.saved': 'File saved', 'directory.linked': 'Directory linked',
  'git.committed': 'Commit created', 'git.pushed': 'Push completed', 'git.branch_changed': 'Branch changed',
  'route.created': 'Route created', 'route.updated': 'Route updated', 'route.archived': 'Route archived',
  'project.created': 'Project created', 'project.updated': 'Project updated', 'project.archived': 'Project archived',
  'document.created': 'Document created', 'document.updated': 'Document updated', 'document.archived': 'Document archived',
  'area.created': 'Area created', 'area.updated': 'Area updated', 'area.archived': 'Area archived',
  'resource.created': 'Resource added', 'resource.updated': 'Resource updated', 'resource.archived': 'Resource archived',
  'todo.created': 'To-do created', 'todo.updated': 'To-do updated', 'todo.archived': 'To-do archived', 'todo.deleted': 'To-do deleted',
  'update.published': 'Update published', 'terminal.started': 'Terminal started', 'terminal.stopped': 'Terminal ended',
  'chat.started': 'Chat turn accepted', 'chat.finished': 'Chat turn ended',
  'automation.started': 'Automation dispatched', 'automation.finished': 'Automation ended',
};

export function WorkspaceActivitySettings({ workspaceId }) {
  const [rows, setRows] = useState([]), [revision, refresh] = useState(0), [busy, setBusy] = useState(true), [error, setError] = useState(null);
  const language = useInterfaceLanguage();
  const dates = new Intl.DateTimeFormat(language || undefined, { dateStyle: 'medium', timeStyle: 'short' });
  useEffect(() => {
    const controller = new AbortController();
    apiRequest('/api/workspace-activity?' + new URLSearchParams({ workspace_id: workspaceId, limit: '60' }), { signal: controller.signal })
      .then(({ result }) => { if (!controller.signal.aborted) setRows(result.rows); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [workspaceId, revision]);
  return <section className="workspace-recording">
    <header className="settings-heading"><div><h1><Activity aria-hidden="true" /> Workspace activity</h1><p>Recent actions recorded in this workspace.</p></div><Button icon={RotateCw} disabled={busy} onClick={() => { setError(null); setBusy(true); refresh(n => n + 1); }}>Refresh</Button></header>
    <p>Activity stays on this device unless you add it to Chat or enable it for a scheduled automation. It tracks saved actions, not drafts, file contents, passwords, or terminal commands and output. Edits and Git commands made outside Frondose are not recorded.</p>
    <ErrorMessage error={error} />
    {busy && rows.length === 0 ? <p role="status">Loading activity…</p> : null}
    {!busy && !error && rows.length === 0 ? <p className="workspace-recording-empty">No activity yet. Saved actions will appear here.</p> : null}
    {rows.length ? <ol aria-label="Recent workspace activity">{rows.map((row, index) => {
      const source = Object.hasOwn(labels, row.kind) ? labels[row.kind] : undefined;
      const label = source ? interfaceText(source, language) : row.title;
      const detail = row.path || (/^(route|project|document|area|todo|update)\./.test(row.kind) && source && row.title !== source ? row.title : '');
      return <li key={`${row.recordedAt}:${row.kind}:${row.entityId || ''}:${index}`}><div><strong>{label}</strong>{detail ? <span>{detail}</span> : null}</div><time dateTime={row.recordedAt}>{dates.format(new Date(row.recordedAt))}</time></li>;
    })}</ol> : null}
    <p className="workspace-recording-retention">Shows up to 60 recent events. The local history is capped and events older than 30 days are excluded.</p>
  </section>;
}

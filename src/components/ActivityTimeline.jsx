import { useEffect, useState } from 'react';
import { frondoseApi } from '../data/api.js';
import { Button, ErrorMessage, useApp } from '../ui.jsx';
import { Activity, ChevronDown, RotateCw } from './icons.jsx';
import { relative } from '../lib/model.js';
import './activity-timeline.css';

const names = { reported_progress: 'Reported progress', parent: 'Parent route', archived_at: 'Archived', publication_state: 'Publication', status: 'Status', priority: 'Priority', health: 'Health', target_date: 'Target date', due_at: 'Due date' };
const display = (field, value) => value == null ? 'Not set' : field === 'reported_progress' ? `${value}%` : field === 'archived_at' ? 'Archived' : String(value).replaceAll('_', ' ');
export function ActivityTimeline({ workspaceId, targetType, targetId }) {
  const { data } = useApp();
  return <TimelinePage key={`${workspaceId}:${targetType}:${targetId}:${data.audit_log?.[0]?.id || ''}`} workspaceId={workspaceId} targetType={targetType} targetId={targetId} />;
}
function TimelinePage({ workspaceId, targetType, targetId }) {
  const [items, setItems] = useState([]), [cursor, setCursor] = useState(null), [next, setNext] = useState(null), [error, setError] = useState(null), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null);
    frondoseApi.timeline({ workspaceId, targetType, targetId, cursor }, { signal: controller.signal }).then(({ result }) => {
      if (controller.signal.aborted) return;
      setItems(current => cursor ? [...new Map([...current, ...result.items].map(item => [item.id, item])).values()] : result.items); setNext(result.next_cursor);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspaceId, targetType, targetId, cursor, refresh]);
  return <section className="event-timeline" aria-label="Activity"><div className="section-heading"><h2>Activity</h2><Button icon={RotateCw} onClick={() => { setCursor(null); setRefresh(value => value + 1); }}>Refresh activity</Button></div><ErrorMessage error={error} /><ol>{items.map(item => <li key={item.id}><span className="event-marker"><Activity size={15} /></span><div><p><strong>{item.actor_name}</strong> {item.action} {item.href ? <a href={item.href}>{item.title}</a> : item.title}<span className="event-time"> · <time dateTime={item.created_at} title={new Date(item.created_at).toLocaleString()}>{relative(item.created_at)}</time></span></p>{item.changes.length ? <details><summary>{item.changes.length} {item.changes.length === 1 ? 'change' : 'changes'}<ChevronDown size={12} /></summary><dl>{item.changes.map(change => <div key={change.field}><dt>{names[change.field] || change.field}</dt><dd>{display(change.field, change.before)} <span aria-label="changed to">→</span> {display(change.field, change.after)}</dd></div>)}</dl></details> : null}<small>{item.source}</small></div></li>)}</ol>{loading ? <p role="status">Loading activity…</p> : !error && !items.length ? <p className="event-empty">No recorded activity yet. Changes to this work will appear here.</p> : null}{next && !loading ? <Button onClick={() => setCursor(next)}>Load more activity</Button> : null}</section>;
}

import { useMemo, useState } from 'react';
import { Button, Empty, Toggle, useApp } from '../ui.jsx';
import { projectTimeline } from '../lib/project-timeline.js';
import { pretty } from '../lib/settings-catalog.js';
import './project-timeline.css';
const label = at => at === null ? 'No date' : new Date(at).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
export function ProjectTimeline({ project }) {
  const { data, navigate, edit } = useApp();
  const [completed, setCompleted] = useState(true);
  const timeline = useMemo(() => projectTimeline(data, project, { completed }), [data, project, completed]);
  const open = row => row.kind === 'route' ? navigate('tasks', row.id, { projectId: project.id }) : edit('milestone', row.item);
  const description = row => <><small>{pretty(row.kind)} · {pretty(row.status)} · {label(row.end)}</small>{row.dependencies.length ? <span className="timeline-dependencies">Needs: {row.dependencies.map((d, i) => <span key={d.id}>{i ? ', ' : ''}{d.available ? <button onClick={() => navigate('tasks', d.id)}>{d.title}</button> : d.title}{d.complete ? ' (done)' : d.late ? ' (due after this route)' : ''}</span>)}</span> : null}</>;
  return <section className="project-timeline" aria-label="Project timeline"><div className="space-section-toolbar"><p className="muted">Actual dates and dependencies. Route markers show due dates, not estimated durations.</p><Toggle label="Include completed work" checked={completed} onChange={setCompleted} /></div>
    {timeline.min !== null ? <><div className="timeline-axis" aria-hidden="true"><span>{label(timeline.min)}</span><span>{label(timeline.max)}</span></div><div className="timeline-project-row"><Button onClick={() => edit('project', project)}>Project dates</Button><span>{label(timeline.projectStart)} → {label(timeline.projectEnd)}</span></div>{timeline.projectStart !== null && timeline.projectEnd !== null ? <div className="timeline-range" aria-label={`Project from ${label(timeline.projectStart)} to ${label(timeline.projectEnd)}`}><span style={{ left: `${timeline.percent(timeline.projectStart)}%`, width: `${Math.max(0, timeline.percent(timeline.projectEnd) - timeline.percent(timeline.projectStart))}%` }} /></div> : null}
      <ol className="timeline-list">{timeline.dated.map(row => <li key={row.id}><div className="timeline-label"><button onClick={() => open(row)}>{row.title}</button>{description(row)}</div><div className="timeline-track" aria-hidden="true"><span className={row.kind} style={{ left: `${timeline.percent(row.end)}%` }} /></div></li>)}</ol></> : <Empty compact kind="routes" title="Give the project a few checkpoints" description="Add project dates, route due dates, or milestone targets. Undated work stays visible below." action="Set project dates" onAction={() => edit('project', project)} />}
    {timeline.undated.length ? <section className="timeline-undated"><h2>Not scheduled <span>{timeline.undated.length}</span></h2>{timeline.undated.map(row => <div key={row.id} className="timeline-label"><button onClick={() => open(row)}>{row.title}</button>{description(row)}</div>)}</section> : null}
  </section>;
}

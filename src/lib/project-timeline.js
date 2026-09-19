const DAY = 86400000;
export function calendarDay(value) {
  if (typeof value !== 'string') return null;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const at = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === day ? at : null;
}
/** A date map, not a forecast. Undated work gets no invented start or duration. */
export function projectTimeline(data, project, { completed = true } = {}) {
  const allRoutes = new Map((data.tasks ?? []).filter(t => !t.archived_at).map(t => [t.id, t]));
  const agreements = new Map((data.route_workflows ?? []).map(w => [w.id, w]));
  const rows = [...allRoutes.values()].filter(t => t.project_id === project.id && (completed || !['done', 'cancelled'].includes(t.status))).map(t => {
    const due = calendarDay(t.due_at);
    const dependencies = (agreements.get(t.id)?.dependency_ids ?? []).map(id => {
      const upstream = allRoutes.get(id), date = calendarDay(upstream?.due_at);
      return { id, title: upstream?.title || 'Unavailable route', available: Boolean(upstream), complete: upstream?.status === 'done', late: due !== null && date !== null && date > due && upstream?.status !== 'done' };
    });
    return { id: t.id, kind: 'route', title: t.title, status: t.status, start: due, end: due, dependencies, item: t };
  });
  for (const m of data.milestones ?? []) if (!m.archived_at && m.project_id === project.id && (completed || m.status !== 'completed')) rows.push({ id: m.id, kind: 'milestone', title: m.title, status: m.status, start: calendarDay(m.target_date), end: calendarDay(m.target_date), dependencies: [], item: m });
  const dated = rows.filter(r => r.end !== null).sort((a,b) => a.end - b.end || a.title.localeCompare(b.title));
  const undated = rows.filter(r => r.end === null).sort((a,b) => a.title.localeCompare(b.title));
  const start = calendarDay(project.start_date), end = calendarDay(project.target_date);
  const range = [start, end, ...dated.map(r => r.end)].filter(v => v !== null);
  const min = range.length ? Math.min(...range) - DAY * 2 : null;
  const max = range.length ? Math.max(...range) + DAY * 2 : null;
  return { dated, undated, min, max, projectStart: start, projectEnd: end, percent: at => at === null || min === null ? null : Math.max(0, Math.min(100, (at - min) / (max - min) * 100)) };
}

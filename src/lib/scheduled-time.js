const parts = (date, timezone) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]));

export function validTimezone(timezone) {
  try { return typeof timezone === 'string' && timezone.length <= 80 && Boolean(new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(0)); } catch { return false; }
}

export function localScheduleTime(instant, timezone) {
  const p = parts(new Date(instant), timezone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// Resolve actual zone offsets on both sides of the date. Reject nonexistent
// spring-forward times; a repeated fall-back time consistently means its first
// occurrence. Recurrence sends once per local calendar date, not twice on folds.
export function scheduleInstant(localTime, timezone) {
  if (!validTimezone(timezone) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localTime)) throw new Error('Choose a valid date, time and time zone.');
  const naive = Date.parse(`${localTime}:00Z`);
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 16) !== localTime) throw new Error('Choose a real calendar date and time.');
  const candidates = [];
  for (const hours of [-48, -24, 0, 24, 48]) {
    const probe = naive + hours * 3600000;
    const offset = Date.parse(`${localScheduleTime(probe, timezone)}:00Z`) - probe;
    const candidate = naive - offset;
    if (localScheduleTime(candidate, timezone) === localTime) candidates.push(candidate);
  }
  if (!candidates.length) throw new Error('This local time does not exist because the clocks change. Choose another time.');
  return new Date(Math.min(...candidates)).toISOString();
}

export function nextScheduledTime(previous, recurrence, timezone, after = previous) {
  if (recurrence === 'none') return null;
  if (!['daily','weekly'].includes(recurrence) || !validTimezone(timezone) || !Number.isFinite(Date.parse(previous)) || !Number.isFinite(Date.parse(after))) throw new Error('Choose a valid recurrence and reference time.');
  const wall = localScheduleTime(previous, timezone), day = Date.parse(`${wall.slice(0, 10)}T12:00:00Z`), clock = wall.slice(11);
  const increment = recurrence === 'weekly' ? 7 : 1;
  for (let offset = increment; offset < 3700; offset += increment) {
    const date = new Date(day + offset * 86400000).toISOString().slice(0, 10);
    let next;
    try { next = scheduleInstant(`${date}T${clock}`, timezone); } catch { continue; }
    if (Date.parse(next) > Date.parse(after)) return next;
  }
  throw new Error('Could not calculate the next scheduled time.');
}

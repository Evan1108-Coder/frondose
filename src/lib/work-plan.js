export const WORK_PLAN_LANES = Object.freeze([
  ['first','Do first','Work through these in order.'],
  ['parallel','In parallel','These can happen alongside the main sequence.'],
  ['tomorrow','Tomorrow','Save a spot on the next calendar day.'],
  ['later','Later','Keep these in view without picking a date.'],
  ['unplanned','Unplanned','New active work lands here.'],
]);
const laneIds = new Set(WORK_PLAN_LANES.map(([id]) => id));
export const workPlanKey = value => typeof value === 'string' && /^(todo|route):[a-zA-Z0-9_-]{1,128}$/.test(value);
const cleanDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
export function tomorrowPlanDate(now = new Date()) {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  return [next.getFullYear(), next.getMonth()+1, next.getDate()].map(n=>String(n).padStart(2,'0')).join('-');
}
export function normalizeWorkPlan(input) {
  const seen = new Set();
  const columns = Object.fromEntries(WORK_PLAN_LANES.map(([lane]) => [lane, (Array.isArray(input?.columns?.[lane]) ? input.columns[lane] : []).filter(card => {
    if (!workPlanKey(card?.key) || seen.has(card.key) || seen.size >= 3000) return false;
    seen.add(card.key); return true;
  }).map(card => ({ key:card.key, ...(lane === 'tomorrow' && cleanDate(card.date) ? {date:card.date} : {}) }))]));
  return { includeRoutes:input?.includeRoutes === true, columns };
}
export function moveWorkPlan(input, { key, lane, before = null, date }) {
  if (!workPlanKey(key) || !laneIds.has(lane) || (before !== null && !workPlanKey(before)) || (lane === 'tomorrow' && !cleanDate(date))) throw new TypeError('Choose a valid destination in Work Plan.');
  const plan = normalizeWorkPlan(input);
  if (key === before) return plan;
  for (const [id] of WORK_PLAN_LANES) plan.columns[id] = plan.columns[id].filter(entry => entry.key !== key);
  const destination = plan.columns[lane];
  const index = destination.findIndex(entry => entry.key === before);
  destination.splice(index < 0 ? destination.length : index, 0, { key, ...(lane === 'tomorrow' ? {date} : {}) });
  return plan;
}
export function groupWorkPlan(plan, items) {
  const remaining = new Map(items.map(item=>[item.key,item]));
  const columns = Object.fromEntries(WORK_PLAN_LANES.map(([lane]) => [lane, (plan.columns[lane] ?? []).flatMap(({key,date})=>{
    const item = remaining.get(key);
    if (!item) return [];
    remaining.delete(key);
    return [{...item, date}];
  })]));
  columns.unplanned.push(...remaining.values());
  return columns;
}

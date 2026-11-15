export const WORKSPACE_ONBOARDING_PREFIX = 'frondose.workspace-onboarding.v1:';
export const WORKSPACE_TIPS_KEY = 'frondose.workspace-tips.v1';
export const TIP_DURATIONS = Object.freeze([3000, 5000, 8000, 12000, 0]);
const cleanId = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value) ? value : '';

export function onboardingKey(workspaceId) {
  const id = cleanId(workspaceId);
  if (!id) throw Error('A workspace identity is required for setup preferences.');
  return WORKSPACE_ONBOARDING_PREFIX + id;
}
export function normalizeWorkspaceOnboarding(input) {
  return { version: 1, step: Number.isInteger(input?.step) ? Math.max(0, Math.min(3, input.step)) : 0, completed: input?.completed === true, skipped: input?.skipped === true, defaultCli: cleanId(input?.defaultCli), notificationsEnabled: input?.notificationsEnabled === true, notificationSound: input?.notificationSound === 'silent' ? 'silent' : 'system' };
}
export function readWorkspaceOnboarding(workspaceId, storage = globalThis.localStorage) {
  try { return normalizeWorkspaceOnboarding(JSON.parse(storage.getItem(onboardingKey(workspaceId)) || '{}')); }
  catch { return normalizeWorkspaceOnboarding(); }
}
export function saveWorkspaceOnboarding(workspaceId, patch, storage = globalThis.localStorage) {
  const next = normalizeWorkspaceOnboarding({ ...readWorkspaceOnboarding(workspaceId, storage), ...patch });
  storage.setItem(onboardingKey(workspaceId), JSON.stringify(next));
  return next;
}
export function normalizeTipPreferences(input) {
  return { version: 1, enabled: input?.enabled !== false, duration: TIP_DURATIONS.includes(input?.duration) ? input.duration : 8000, movement: input?.movement !== false, dismissedCategories: Array.isArray(input?.dismissedCategories) ? [...new Set(input.dismissedCategories.filter(value => typeof value === 'string' && /^[a-z-]{1,60}$/.test(value)))].slice(0, 30) : [], tourSeen: input?.tourSeen === true };
}
export function readTipPreferences(storage = globalThis.localStorage) {
  try { return normalizeTipPreferences(JSON.parse(storage.getItem(WORKSPACE_TIPS_KEY) || '{}')); }
  catch { return normalizeTipPreferences(); }
}
export function saveTipPreferences(patch, storage = globalThis.localStorage) {
  const next = normalizeTipPreferences({ ...readTipPreferences(storage), ...patch });
  storage.setItem(WORKSPACE_TIPS_KEY, JSON.stringify(next));
  return next;
}
export function remainingTipDuration(remaining, startedAt, pausedAt) {
  return Math.max(0, remaining - Math.max(0, pausedAt - startedAt));
}
export function tourPosition(rect, viewport, width = 320, height = 192) {
  const cardWidth = Math.max(180, Math.min(width, viewport.width - 24));
  const left = Math.max(12, Math.min(rect.left, viewport.width - cardWidth - 12));
  const below = rect.bottom + height + 20 <= viewport.height;
  const top = below ? rect.bottom + 12 : Math.max(12, rect.top - height - 12);
  return { left, top, width: cardWidth, arrowLeft: Math.max(20, Math.min(cardWidth - 20, rect.left + rect.width / 2 - left)), above: !below };
}

/** Observed status edges only, not a scan of old completed history. This stays
 * bounded and cannot start work, approve a request or claim OS delivery. */
export function createRunNoticeTracker() {
  let scope = null, previous = null;
  const emitted = new Set();
  return {
    observe(runs, workspaceId) {
      const rows = (Array.isArray(runs) ? runs : []).filter(run => run.workspace_id === workspaceId && cleanId(run.id) && !run.archived_at && !['demo', 'mock', 'simulation'].includes(run.mode))
        .sort((a, b) => (Date.parse(b.updated_at || b.created_at) || 0) - (Date.parse(a.updated_at || a.created_at) || 0)).slice(0, 256);
      if (scope !== workspaceId) { scope = workspaceId; previous = null; emitted.clear(); }
      const next = new Map(rows.map(run => [run.id, run.status]));
      const notices = [];
      if (previous) for (const run of rows) {
        const old = previous.get(run.id);
        if (!['queued', 'starting', 'running', 'needs_input', 'paused'].includes(old) || old === run.status || !['completed', 'needs_input', 'failed'].includes(run.status)) continue;
        const key = `${run.id}:${run.status}:${String(run.updated_at || run.finished_at || '')}`;
        if (emitted.has(key)) continue;
        emitted.add(key);
        if (notices.length < 8) notices.push({ workspaceId, runId: run.id, title: `${String(run.agent_name || 'Agent').slice(0, 60)} ${run.status === 'completed' ? 'finished' : run.status === 'failed' ? 'needs attention' : 'needs input'}`, body: String(run.title || 'Agent work').slice(0, 240) });
      }
      previous = next;
      while (emitted.size > 256) emitted.delete(emitted.values().next().value);
      return notices;
    },
  };
}

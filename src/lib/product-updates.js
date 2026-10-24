/** Every entry must link to an authored in-app Docs article. Newest first. */
export const PRODUCT_UPDATES = Object.freeze([
  Object.freeze({ id: 'your-agents-library', title: 'Your Agents, connected', date: '2026-10-24', articleId: 'your-agents-library', cover: '/agent-connections/codex-feature.png', coverAlt: 'Illustrated Codex connection preview in Frondose', coverCaption: 'Product illustration · not live account data' }),
  Object.freeze({ id: 'initial-launch', title: 'Initial Launch', date: '2026-10-19', articleId: 'initial-launch' }),
]);
export function publishedProductUpdates(updates = PRODUCT_UPDATES, now = new Date()) {
  const today = now instanceof Date && Number.isFinite(now.getTime()) ? now.toISOString().slice(0, 10) : '';
  return updates.filter(update => typeof update?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(update.date) &&
    Number.isFinite(Date.parse(`${update.date}T00:00:00Z`)) && new Date(`${update.date}T00:00:00Z`).toISOString().slice(0, 10) === update.date && update.date <= today)
    .slice().sort((a, b) => b.date.localeCompare(a.date));
}
export function recentProductUpdates(updates = PRODUCT_UPDATES, now = new Date()) {
  return publishedProductUpdates(updates, now).slice(0, 3);
}

/** Every entry must link to an authored in-app Docs article. Newest first. */
export const PRODUCT_UPDATES = Object.freeze([
  Object.freeze({ id: 'initial-launch', title: 'Initial Launch', date: '2026-10-19', articleId: 'initial-launch' }),
]);
export function recentProductUpdates(updates = PRODUCT_UPDATES) {
  return [...updates].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
}

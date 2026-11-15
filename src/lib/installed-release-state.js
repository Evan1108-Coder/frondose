import { productUpdateForVersion } from './product-updates.js';

// A presentation receipt scoped to this desktop installation's browser storage
// and the local actor/workspace. It neither checks nor downloads an update.
const PREFIX = 'frondose.installed-release.v1.';
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const validVersion = value => typeof value === 'string' && value.length <= 128 && VERSION.test(value);
export function installedReleaseScope(scope) { return typeof scope === 'string' && scope ? PREFIX + encodeURIComponent(scope) : null; }
export function readInstalledReleaseVersion(storage, key) {
  try { const value = JSON.parse(storage?.getItem(key)); return value?.version === 1 && validVersion(value.appVersion) ? value.appVersion : null; } catch { return null; }
}
export function recordInstalledReleaseVersion(storage, key, appVersion) {
  if (!key || !validVersion(appVersion)) return false;
  try { storage?.setItem(key, JSON.stringify({ version: 1, appVersion })); return Boolean(storage); } catch { return false; }
}
export function installedReleaseFor(info, previous, updates, articles) {
  if (info?.packaged !== true || !validVersion(info.version) || /^0\.0\.0(?:[-+]|$)/.test(info.version) || !validVersion(previous) || previous === info.version) return null;
  const update = productUpdateForVersion(info.version, updates);
  const authored = update && articles.some(article => article.id === update.articleId && article.group === 'updates') ? update : null;
  // Do not misattribute an older release's notes to an unknown installed build.
  return authored ? { ...authored, installedVersion: info.version } : { id: `installed-${info.version}`, title: `Frondose ${info.version}`, articleId: null, installedVersion: info.version };
}

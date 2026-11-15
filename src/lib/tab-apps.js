export const TAB_WEB_APPS = Object.freeze([
  { id: 'vscode', name: 'VS Code Web', description: 'Microsoft’s local web runtime' },
  { id: 'guacamole', name: 'Apache Guacamole', description: 'Remote desktops through your existing gateway' },
  { id: 'parallels-ras', name: 'Parallels RAS Web', description: 'Your HTML5-enabled RAS portal, not Parallels Desktop' },
  { id: 'web-console', name: 'Web console', description: 'An existing browser-compatible application' },
]);
export const tabWebApp = id => TAB_WEB_APPS.find(item => item.id === id);
export function tabAppUrl(value, appId) {
  if (!tabWebApp(appId) || typeof value !== 'string' || value.length > 4096 || /[\\\u0000-\u0020\u007f]/.test(value)) throw Error('Enter a complete web application address.');
  let url; try { url = new URL(value); } catch { throw Error('Enter a complete web application address.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || !['http:', 'https:'].includes(url.protocol) || (url.protocol !== 'https:' && !loopback)) throw Error('Use HTTPS, or HTTP on this computer’s loopback address. Do not include a username or password in the address.');
  if (appId === 'vscode' && !loopback) throw Error('VS Code Web setup connects only to a local loopback runtime.');
  if (appId !== 'vscode' && (url.search || url.hash)) throw Error('Use the portal’s base address without tokens, query parameters or fragments. Sign in inside its isolated tab.');
  if (appId === 'vscode' && ([...url.searchParams.keys()].some(key => key !== 'tkn') || url.hash)) throw Error('Use the local URL printed by code serve-web, with only its optional tkn parameter.');
  if (typeof location !== 'undefined' && url.origin === location.origin) throw Error('Choose the application server, not Frondose’s own privileged UI.');
  return url.href;
}
export function existingTabApp(tabs, appId) {
  for (const tab of tabs) {
    const view = (tab.contentType === 'group' ? tab.views : [tab]).find(item => item.contentType === 'web-app' && item.appId === appId);
    if (view) return { tab, view };
  }
  return null;
}
export function repositorySourceKey(state) { return JSON.stringify([state.workspaceId, state.bindingVersion, state.github?.slug, state.connectionVersion, state.head, state.branch]); }
export function repositoryCheckSummary(checks) {
  if (!checks?.total) return 'No checks reported';
  if (checks.failed) return `${checks.failed} failed · ${checks.total} checks`;
  if (checks.pending) return `${checks.pending} pending · ${checks.total} checks`;
  return `${checks.total} checks · none failed or pending`;
}

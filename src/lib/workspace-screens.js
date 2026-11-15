// These are full screens with their own navigation, never workspace tabs.
const standalone = new Set(['settings', 'docs']);
export function isWorkspaceStandalonePage(pageOrView) {
  return standalone.has(typeof pageOrView === 'string' ? pageOrView : pageOrView?.view);
}

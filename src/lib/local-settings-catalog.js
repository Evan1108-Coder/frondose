import { LOCAL_SIDEBAR_PAGES } from './local-navigation.js';
const isLocalProduct = data => data?.meta?.product?.edition === 'local';

const LOCAL_GROUPS = [
  ['This workspace', [['onboarding-checklist', 'Onboarding Checklist'], ['cli-agents', 'CLI Agents'], ['workspace-activity', 'Workspace activity']]],
  ['This computer', [['local-installation', 'Local installation'], ['app-updates', 'App updates'], ['integrations', 'Integrations'], ['computer-use', 'Computer Use'], ['dictation', 'Dictation'], ['emulators', 'Emulators & environments']]],
  ['Personal', [['preferences', 'General'], ['languages', 'Languages'], ['profile', 'Profile'], ['appearance', 'Appearance'], ['workspace-tabs', 'Workspace tabs'], ['terminal', 'Terminal'], ['session-history', 'Session history search'], ['notifications', 'Notifications'], ['code-reviews', 'Code appearance'], ['field-defaults', 'Field defaults'], ['personal-security', 'Local lock & sessions'], ['privacy', 'Privacy']]],
  ['Routes', [['route-labels', 'Labels'], ['route-templates', 'Templates'], ['route-workflow', 'Workflow']]],
  ['Projects', [['project-labels', 'Labels'], ['project-templates', 'Templates'], ['project-statuses', 'Statuses']]],
  ['Workspace tools', [['github', 'GitHub'], ['documents', 'Documents'], ['views', 'Saved views'], ['reviews', 'Reviews & deliverables']]],
  ['Workspace & data', [['workspace', 'Workspace'], ['retention', 'Data & retention'], ['storage', 'Import & export'], ['audit', 'Audit log']]],
];

/** Presentation only: old configuration and records remain stored unchanged. */
export function localWorkspaceSettingsGroups(groups, data) {
  return isLocalProduct(data) ? LOCAL_GROUPS.map(([label, items]) => [label, items.map(item => [...item])]) : groups;
}

export function localWorkspaceQuickAccess(ids, data) {
  if (!isLocalProduct(data)) return ids;
  const visible = new Set([...LOCAL_SIDEBAR_PAGES.map(page => page.id), 'settings']);
  return ids.filter(id => visible.has(id));
}

export function normalizeWorkspaceTabAppearance(appearance) {
  return { workspaceTabSize: appearance?.workspaceTabSize === 'comfortable' ? 'comfortable' : 'compact', workspaceTabCloseButtons: appearance?.workspaceTabCloseButtons === 'hover' ? 'hover' : 'always' };
}

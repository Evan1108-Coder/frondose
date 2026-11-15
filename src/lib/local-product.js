// Presentation follows the server's edition; never use this as authorization.
import { localWorkspaceSettingsGroups } from './local-settings-catalog.js';
export const LOCAL_HIDDEN_SETTINGS = new Set(['members', 'security', 'access-approvals', 'applications', 'api', 'billing']);
export const isLocalProduct = data => data?.meta?.product?.edition === 'local';
export function localSettingsGroups(groups, data) {
  return localWorkspaceSettingsGroups(groups, data);
}

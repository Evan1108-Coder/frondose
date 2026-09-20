import { providerError } from './adapters.mjs';

// Explicit user-triggered diagnostics only. Never called by catalog or page loading.
export async function readProviderIdentity(family, request) {
  let id, label;
  if (family === 'github') { const user = await request('https://api.github.com/user'); id = user.id; label = user.login; }
  if (family === 'google') { const { user } = await request('https://www.googleapis.com/drive/v3/about?fields=user(displayName,permissionId)'); id = user?.permissionId; label = user?.displayName; }
  if (family === 'linear') { const result = await request('https://api.linear.app/graphql', { method: 'POST', body: { query: '{ viewer { id name } }' } }); if (!result.errors?.length) { id = result.data?.viewer?.id; label = result.data?.viewer?.name; } }
  if (family === 'slack') { const result = await request('https://slack.com/api/auth.test', { method: 'POST', body: {} }); if (result.ok) { id = result.user_id; label = [result.team, result.user].filter(Boolean).join(' / '); } }
  if (family === 'figma') { const user = await request('https://api.figma.com/v1/me'); id = user.id; label = user.handle; }
  if (family === 'jira') {
    const sites = await request('https://api.atlassian.com/oauth/token/accessible-resources');
    const site = Array.isArray(sites) && sites.find(item => typeof item.id === 'string' && /^[a-zA-Z0-9-]+$/.test(item.id));
    if (!site) throw providerError('provider_permission', 'No authorized Jira site is available. Reconnect and grant a site.', 409);
    const user = await request(`https://api.atlassian.com/ex/jira/${encodeURIComponent(site.id)}/rest/api/3/myself`); id = user.accountId; label = user.displayName;
  }
  if ((typeof id !== 'string' && typeof id !== 'number') || !String(id) || typeof label !== 'string' || !label) throw providerError('identity_unverified', 'The provider did not return a usable account identity. Review consent and reconnect.', 409);
  return { id: String(id).slice(0, 300), label: label.replace(/[\x00-\x1f]/g, '').slice(0, 300) };
}

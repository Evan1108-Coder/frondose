'use strict';
const CATALOG = Object.freeze(require('./integration-catalog.json').map(Object.freeze));
const text = (value, max = 300) => typeof value === 'string' || typeof value === 'number' ? String(value).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, max) : '';
const encode = encodeURIComponent;
function credentials(provider, input = {}) {
  if (!CATALOG.some(item => item.id === provider)) throw Error('Choose a supported integration.');
  if (typeof input.token !== 'string' || input.token.length < 8 || input.token.length > 4096 || /[\s\x00-\x1f]/.test(input.token)) throw Error('Enter a valid provider API token, not your password.');
  const result = { token: input.token };
  if (['jira', 'bitbucket'].includes(provider)) { if (typeof input.email !== 'string' || input.email.length > 254 || !/^[^\s:@]+@[^\s:@]+\.[^\s:@]+$/.test(input.email)) throw Error('Enter the Atlassian account email for this API token.'); result.email = input.email; }
  if (provider === 'azure-devops') { if (typeof input.organization !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(input.organization)) throw Error('Enter the Azure DevOps organization name, not a URL.'); result.organization = input.organization; }
  if (provider === 'jira') { if (typeof input.site !== 'string' || !/^[a-z0-9][a-z0-9-]{0,99}\.atlassian\.net$/i.test(input.site)) throw Error('Enter your Jira site, such as example.atlassian.net.'); result.site = input.site.toLowerCase(); if (input.cloudId) { if (typeof input.cloudId !== 'string' || !/^[a-f\d-]{36}$/i.test(input.cloudId)) throw Error('Enter a valid Jira Cloud ID for scoped API tokens.'); result.cloudId = input.cloudId; } }
  if (['gitlab', 'gitea'].includes(provider)) { const host = input.host || (provider === 'gitlab' ? 'gitlab.com' : 'gitea.com'); if (typeof host !== 'string' || host.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/i.test(host) || /(?:^|\.)(localhost|local|internal|test|invalid)$/i.test(host)) throw Error('Enter a public HTTPS provider hostname without a path or port.'); result.host = host.toLowerCase(); }
  return result;
}
function base(provider, account) {
  return ({ github: 'https://api.github.com', gitlab: `https://${account.host}/api/v4`, gitea: `https://${account.host}/api/v1`, bitbucket: 'https://api.bitbucket.org/2.0', 'azure-devops': `https://dev.azure.com/${account.organization}/_apis`, linear: 'https://api.linear.app/graphql', jira: account.cloudId ? `https://api.atlassian.com/ex/jira/${account.cloudId}/rest/api/3` : `https://${account.site}/rest/api/3` })[provider];
}
function auth(provider, account) { return provider === 'gitlab' ? { 'PRIVATE-TOKEN': account.token } : { Authorization: provider === 'linear' ? account.token : ['jira', 'bitbucket', 'azure-devops'].includes(provider) ? `Basic ${Buffer.from(`${account.email || ''}:${account.token}`).toString('base64')}` : `${provider === 'gitea' ? 'token' : 'Bearer'} ${account.token}` }; }
function createProviderClient(provider, account, request) {
  const call = (route = '', body) => request(base(provider, account) + route, { headers: { ...auth(provider, account), Accept: 'application/json', 'User-Agent': 'Frondose-local-integrations', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body), method: 'POST' } : { method: 'GET' }) });
  const graph = async (query, variables = {}) => { const result = await call('', { query, variables }); if (result.errors?.length || !result.data) throw Error('The provider did not grant this query. Check API-key permissions.'); return result.data; };
  const resource = (id, name) => { id = text(id, 500); const slug = /^(?!\.{1,2}\/)[A-Za-z0-9_.-]+\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/; if (['github', 'gitea', 'bitbucket'].includes(provider) ? !slug.test(id) : ['gitlab', 'jira'].includes(provider) ? !/^\d{1,20}$/.test(id) : !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id)) throw Error('The provider returned an invalid resource identity.'); return { id, name: text(name, 300) }; };
  const array = value => { if (!Array.isArray(value)) throw Error('The provider returned an invalid result list.'); return value; };
  function bitbucketSlug(value) {
    if(typeof value!=='string'||! /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,128}$/.test(value)) throw Error('Bitbucket returned an invalid workspace identity.');
    return value;
  }
  async function identity() {
    if (provider === 'linear') { const data = await graph('{ viewer { id name } }'); if (!data.viewer?.id) throw Error('Provider identity was not verified.'); return text(data.viewer.name); }
    if (provider === 'azure-devops') { const data = await call('/projects?api-version=7.1&$top=1'); if (!Array.isArray(data.value)) throw Error('Organization access could not be verified.'); return `${account.organization} — token access verified`; }
    const data = await call(provider === 'jira' ? '/myself' : '/user');
    const id = data.id || data.accountId || data.uuid; if (!id) throw Error('Provider identity was not verified.');
    return text(data.login || data.username || data.displayName || data.display_name || data.name || id);
  }
  async function resources() {
    if (provider === 'linear') { const data = await graph('{ teams(first:100) { nodes { id name } } }'); return (data.teams?.nodes || []).map(item => resource(item.id, item.name)); }
    if (provider === 'github') return (await call('/user/repos?per_page=100&sort=updated')).map(item => resource(item.full_name, item.full_name));
    if (provider === 'gitlab') return (await call('/projects?membership=true&per_page=100&order_by=last_activity_at')).map(item => resource(item.id, item.path_with_namespace));
    if (provider === 'gitea') return (await call('/user/repos?limit=100')).map(item => resource(item.full_name, item.full_name));
    if (provider === 'bitbucket') {
      const data = await call('/user/workspaces?pagelen=10&fields=values.workspace.slug');
      const workspaces=[...new Set(array(data.values).slice(0,10).map(item=>bitbucketSlug(item.workspace?.slug)))];
      const groups=await Promise.all(workspaces.map(slug=>call('/repositories/'+encode(slug)+'?pagelen=100&fields=values.full_name')));
      return groups.flatMap(group=>array(group.values)).slice(0,100).map(item=>resource(item.full_name,item.full_name));
    }
    if (provider === 'azure-devops') { const data = await call('/git/repositories?api-version=7.1'); return (data.value || []).map(item => resource(item.id, `${item.project?.name || ''} / ${item.name}`)); }
    const data = await call('/project/search?maxResults=100'); return (data.values || []).map(item => resource(item.id, `${item.key} — ${item.name}`));
  }
  async function items(selected, kind = 'issues') {
    if (provider==='bitbucket') {
      const path=resource(selected,selected).id.split('/').map(encode).join('/');
      const current=await call('/repositories/'+path+'?fields=full_name');
      if(current.full_name!==selected)throw Error('This repository is no longer accessible under its selected name.');
    } else {
      const current = await resources(); if (!current.some(item => item.id === selected)) throw Error('This resource is no longer accessible. Select it again.');
    }
    let data, rows;
    if (provider === 'linear') { data = await graph('query($id:String!){ team(id:$id){ issues(first:50, filter:{state:{type:{nin:["completed","canceled"]}}}){nodes{id identifier title state{name} updatedAt}} } }', { id: selected }); rows = array(data.team?.issues?.nodes); }
    else if (provider === 'jira') { if (!/^\d+$/.test(selected)) throw Error('Invalid project identity.'); data = await call(`/search/jql?jql=${encode(`project = ${selected} AND statusCategory != Done ORDER BY updated DESC`)}&maxResults=50&fields=summary,status,updated`); rows = array(data.issues); }
    else if (provider === 'github') { const slug = selected.split('/').map(encode).join('/'); rows = await call(`/repos/${slug}/${kind === 'pulls' ? 'pulls' : 'issues'}?state=open&per_page=50`); if (kind === 'issues') rows = rows.filter(item => !item.pull_request); }
    else if (provider === 'gitlab') rows = await call(`/projects/${encode(selected)}/${kind === 'pulls' ? 'merge_requests' : 'issues'}?state=opened&per_page=50`);
    else if (provider === 'gitea') rows = await call(`/repos/${selected.split('/').map(encode).join('/')}/${kind === 'pulls' ? 'pulls' : 'issues'}?state=open&limit=50`);
    else if (provider === 'bitbucket') { data = await call(`/repositories/${selected.split('/').map(encode).join('/')}/pullrequests?state=OPEN&pagelen=50&fields=values.id,values.title,values.state,values.updated_on`); rows = array(data.values); }
    else { data = await call(`/git/repositories/${encode(selected)}/pullrequests?searchCriteria.status=active&$top=50&api-version=7.1`); rows = data.value || []; }
    if (!Array.isArray(rows)) throw Error('The provider returned an invalid item list.');
    return rows.slice(0, 50).map(item => ({ id: text(item.identifier || item.key || item.number || item.iid || item.pullRequestId || item.id, 100), title: text(item.title || item.fields?.summary), state: text(item.state?.name || item.fields?.status?.name || item.state || item.status, 80), updatedAt: text(item.updatedAt || item.updated_at || item.updated_on || item.fields?.updated || item.creationDate, 80) }));
  }
  return { identity, resources, items };
}
module.exports = { CATALOG, credentials, createProviderClient };

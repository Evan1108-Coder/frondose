// Only fixed provider hosts and authored paths reach the transport. No client-supplied URL is fetched.
export const providerError = (code, message, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const segment = value => {
  if (typeof value !== 'string' || !value || value.length > 300 || /[\x00-\x20/?#\\]/.test(value) || value === '.' || value === '..') throw providerError('invalid_resource', 'Choose a valid provider resource.');
  return encodeURIComponent(value);
};
const repo = value => { const parts = String(value).split('/'); if (parts.length !== 2) throw providerError('invalid_repository', 'Use repository owner/name.'); return parts.map(segment).join('/'); };
const clean = value => JSON.parse(JSON.stringify(value ?? null));
const webUrl = value => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } };
const object = (id, title, kind, url, content, updated_at) => ({ external_id: String(id), title: String(title || id), kind, url: webUrl(url), content: clean(content), provider_updated_at: updated_at || null });
const resource = (id, name, type, url) => ({ id: String(id), name, type, url: webUrl(url) });
const adf = text => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const page = (items, cursor = null) => ({ items, cursor });

export function createProviderAdapter(provider, request) {
  const gh = (path, options) => request(`https://api.github.com${path}`, { ...options, headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...options?.headers } });
  const google = (host, path, options) => request(`https://${host}.googleapis.com${path}`, options);
  const linear = async (query, variables = {}) => {
    const result = await request('https://api.linear.app/graphql', { method: 'POST', body: { query, variables } });
    if (result.errors?.length) throw providerError('provider_rejected', 'Linear rejected this request. Check fields and permissions.', 422);
    return result.data;
  };
  const slack = async (method, body = {}) => { const data = await request(`https://slack.com/api/${method}`, { method: 'POST', body }); if (!data.ok) throw providerError('provider_rejected', `Slack could not complete the action (${String(data.error || 'unknown_error').replace(/[^a-z_]/g, '').slice(0, 80)}).`, 422); return data; };
  const figma = (path, options) => request(`https://api.figma.com/v1${path}`, options);
  const jira = (id, path, options) => request(`https://api.atlassian.com/ex/jira/${segment(id)}/rest/api/3${path}`, options);
  const jiraResource = id => { const [site, project, ...rest] = String(id).split(':'); if (!site || !project || rest.length || !/^[A-Za-z0-9_-]+$/.test(project)) throw providerError('invalid_resource', 'Select a Jira site and project.'); return [site, project]; };

  async function resources({ cursor, resource_id } = {}) {
    if (provider.startsWith('github')) {
      const pageNumber = Math.max(1, Math.min(10000, Number(cursor) || 1));
      const rows = await gh(`/user/repos?per_page=100&page=${pageNumber}&sort=updated`);
      return page(rows.map(x => resource(x.full_name, x.full_name, 'repository', x.html_url)), rows.length === 100 ? String(pageNumber + 1) : null);
    }
    if (provider.startsWith('google')) {
      const mime = { 'google-docs': 'application/vnd.google-apps.document', 'google-sheets': 'application/vnd.google-apps.spreadsheet', 'google-slides': 'application/vnd.google-apps.presentation' }[provider];
      const query = new URLSearchParams({ pageSize: '100', fields: 'nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime)', q: `trashed=false${mime ? ` and mimeType='${mime}'` : ''}` });
      if (cursor) query.set('pageToken', cursor);
      const data = await google('www', `/drive/v3/files?${query}`);
      return page((data.files || []).map(x => resource(x.id, x.name, x.mimeType, x.webViewLink)), data.nextPageToken);
    }
    if (provider === 'linear') {
      const data = await linear('query($after:String){teams(first:100,after:$after){nodes{id name key} pageInfo{hasNextPage endCursor}}}', { after: cursor || null });
      return page(data.teams.nodes.map(x => resource(x.id, `${x.name} (${x.key})`, 'team')), data.teams.pageInfo.hasNextPage ? data.teams.pageInfo.endCursor : null);
    }
    if (provider === 'jira') {
      if (!resource_id) { const sites = await request('https://api.atlassian.com/oauth/token/accessible-resources'); return page(sites.map(x => resource(x.id, x.name, 'site', x.url))); }
      const data = await jira(resource_id, `/project/search?maxResults=100&startAt=${Math.max(0, Number(cursor) || 0)}`);
      return page(data.values.map(x => resource(`${resource_id}:${x.key}`, x.name, 'project')), data.isLast ? null : String(data.startAt + data.maxResults));
    }
    if (provider === 'slack') { const data = await slack('conversations.list', { limit: 200, exclude_archived: true, types: 'public_channel,private_channel', ...(cursor ? { cursor } : {}) }); return page(data.channels.filter(x => x.is_member).map(x => resource(x.id, x.name, 'channel')), data.response_metadata?.next_cursor || null); }
    if (provider === 'figma' || provider === 'figjam') {
      if (!resource_id) return { items: [], cursor: null, requires_resource: true };
      let id = resource_id.startsWith('file:') ? resource_id.slice(5) : resource_id;
      if (resource_id.startsWith('https://')) { const url = new URL(resource_id); if (!['figma.com', 'www.figma.com'].includes(url.hostname) || !/^\/(file|design|board|slides)\/[^/]+/.test(url.pathname)) throw providerError('invalid_file_url', 'Paste a Figma file or board URL.'); id = url.pathname.split('/')[2]; }
      if (id.includes(':')) throw providerError('file_selection_required', 'Public Figma apps cannot enumerate folders. Paste a file or board URL.');
      const file = await figma(`/files/${segment(id)}?depth=1`); return page([resource(id, file.name, file.editorType === 'figjam' ? 'board' : 'file', `https://www.figma.com/file/${segment(id)}`)]);
    }
    throw providerError('unsupported_provider', 'Provider is not supported.');
  }

  async function sync({ resource_id, kind, cursor, range = 'A1:Z200', package_type = 'container' }) {
    if (provider.startsWith('github')) {
      const target = repo(resource_id), p = Math.max(1, Number(cursor) || 1);
      if (kind === 'packages' && !['container', 'npm', 'maven', 'rubygems', 'docker', 'nuget'].includes(package_type)) throw providerError('invalid_package_type', 'Choose a supported package ecosystem.');
      const packageOwner = kind === 'packages' ? await gh(`/repos/${target}`) : null;
      const path = kind === 'runs' ? `/repos/${target}/actions/runs` : kind === 'workflows' ? `/repos/${target}/actions/workflows` : kind === 'packages' ? `/${packageOwner?.owner?.type === 'Organization' ? 'orgs' : 'users'}/${segment(resource_id.split('/')[0])}/packages?package_type=${segment(package_type)}` : `/repos/${target}/${kind}`;
      const data = await gh(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${p}`);
      const allRows = Array.isArray(data) ? data : data.workflow_runs || data.workflows || [];
      const rows = kind === 'packages' ? allRows.filter(x => x.repository?.full_name === resource_id) : allRows;
      return page(rows.map(x => object(x.id || x.sha || x.name, x.title || x.name || x.commit?.message, kind, x.html_url, x, x.updated_at || x.commit?.committer?.date)), allRows.length === 100 ? String(p + 1) : null);
    }
    if (provider === 'google-drive') {
      const data = await google('www', `/drive/v3/files/${segment(resource_id)}?fields=id,name,mimeType,description,webViewLink,modifiedTime,size,parents`);
      return page([object(data.id, data.name, 'file', data.webViewLink, data, data.modifiedTime)]);
    }
    if (provider === 'google-docs') { const data = await google('docs', `/v1/documents/${segment(resource_id)}?includeTabsContent=true`); return page([object(data.documentId, data.title, 'document', `https://docs.google.com/document/d/${segment(resource_id)}/edit`, data)]); }
    if (provider === 'google-sheets') { const data = await google('sheets', `/v4/spreadsheets/${segment(resource_id)}?includeGridData=true&ranges=${encodeURIComponent(range)}`); return page([object(data.spreadsheetId, data.properties?.title, 'spreadsheet', data.spreadsheetUrl, data)]); }
    if (provider === 'google-slides') { const data = await google('slides', `/v1/presentations/${segment(resource_id)}`); return page([object(data.presentationId, data.title, 'presentation', `https://docs.google.com/presentation/d/${segment(resource_id)}/edit`, data)]); }
    if (provider === 'linear') {
      const fields = kind === 'projects' ? 'id name description url updatedAt' : 'id identifier title description url updatedAt priority state{id name} assignee{id name} project{id name}';
      const data = await linear(`query($id:String!,$after:String){team(id:$id){${kind}(first:100,after:$after){nodes{${fields}} pageInfo{hasNextPage endCursor}}}}`, { id: resource_id, after: cursor || null });
      const result = data.team?.[kind]; if (!result) throw providerError('resource_missing', 'The Linear team is unavailable.', 404);
      return page(result.nodes.map(x => object(x.id, x.title || x.name, kind, x.url, x, x.updatedAt)), result.pageInfo.hasNextPage ? result.pageInfo.endCursor : null);
    }
    if (provider === 'jira') {
      const [site, project] = jiraResource(resource_id);
      const params = new URLSearchParams({ jql: `project = "${project}" ORDER BY updated DESC`, maxResults: '100', fields: 'summary,description,status,assignee,priority,updated,project' }); if (cursor) params.set('nextPageToken', cursor);
      const data = await jira(site, `/search/jql?${params}`);
      return page((data.issues || []).map(x => object(x.id, x.fields?.summary, 'issues', null, { ...x, site }, x.fields?.updated)), data.nextPageToken || null);
    }
    if (provider === 'slack') { const data = await slack('conversations.history', { channel: resource_id, limit: 100, ...(cursor ? { cursor } : {}) }); return page((data.messages || []).map(x => object(x.ts, x.text?.slice(0, 120), 'message', null, x)), data.response_metadata?.next_cursor || null); }
    if (provider === 'figma' || provider === 'figjam') {
      const suffix = kind === 'comments' ? '/comments' : kind === 'versions' ? '/versions' : '?depth=4';
      const data = await figma(`/files/${segment(resource_id)}${suffix}`);
      const rows = kind === 'comments' ? data.comments : kind === 'versions' ? data.versions : [{ ...data, id: resource_id }];
      return page((rows || []).map(x => object(x.id, x.name || x.label || x.message?.slice(0, 120), kind, `https://www.figma.com/file/${segment(resource_id)}`, x, x.lastModified || x.created_at)));
    }
  }

  async function execute(action, input) {
    const { resource_id } = input;
    if (provider === 'github') {
      const target = repo(resource_id);
      if (action === 'create_issue') return gh(`/repos/${target}/issues`, { method: 'POST', body: { title: input.title, body: input.body || '' } });
      if (action === 'comment') return gh(`/repos/${target}/issues/${segment(input.number)}/comments`, { method: 'POST', body: { body: input.body } });
      if (action === 'create_pull') return gh(`/repos/${target}/pulls`, { method: 'POST', body: { title: input.title, head: input.head, base: input.base, body: input.body || '' } });
    }
    if (provider === 'github-actions') {
      const target = repo(resource_id);
      if (action === 'dispatch_workflow') return gh(`/repos/${target}/actions/workflows/${segment(input.workflow_id)}/dispatches`, { method: 'POST', body: { ref: input.ref } });
      if (action === 'cancel_run') return gh(`/repos/${target}/actions/runs/${segment(input.run_id)}/cancel`, { method: 'POST', body: {} });
    }
    if (provider === 'google-drive' && action === 'create_folder') return google('www', '/drive/v3/files', { method: 'POST', body: { name: input.name, mimeType: 'application/vnd.google-apps.folder', parents: [resource_id] } });
    if (provider === 'google-docs') {
      if (action === 'create_document') return google('docs', '/v1/documents', { method: 'POST', body: { title: input.title } });
      if (action === 'append_text') return google('docs', `/v1/documents/${segment(resource_id)}:batchUpdate`, { method: 'POST', body: { requests: [{ insertText: { endOfSegmentLocation: {}, text: input.text } }] } });
    }
    if (provider === 'google-sheets') {
      if (action === 'create_spreadsheet') return google('sheets', '/v4/spreadsheets', { method: 'POST', body: { properties: { title: input.title } } });
      if (action === 'append_rows') { const values = typeof input.values === 'string' ? JSON.parse(input.values) : input.values; if (!Array.isArray(values) || values.length > 1000 || values.some(row => !Array.isArray(row) || row.length > 100 || row.some(x => !['string', 'number', 'boolean'].includes(typeof x)))) throw providerError('invalid_rows', 'Enter at most 1,000 rows of simple values.'); return google('sheets', `/v4/spreadsheets/${segment(resource_id)}/values/${encodeURIComponent(input.range)}:append?valueInputOption=RAW`, { method: 'POST', body: { values } }); }
    }
    if (provider === 'google-slides') {
      if (action === 'create_presentation') return google('slides', '/v1/presentations', { method: 'POST', body: { title: input.title } });
      if (action === 'add_slide') return google('slides', `/v1/presentations/${segment(resource_id)}:batchUpdate`, { method: 'POST', body: { requests: [{ createSlide: { slideLayoutReference: { predefinedLayout: 'BLANK' } } }] } });
    }
    if (provider === 'linear') {
      if (action !== 'create_issue') { const current = await linear('query($id:String!){issue(id:$id){team{id}}}', { id: input.issue_id }); if (current.issue?.team?.id !== resource_id) throw providerError('resource_scope', 'This issue is outside the selected team.', 403); }
      if (action === 'create_issue') return linear('mutation($input:IssueCreateInput!){issueCreate(input:$input){success issue{id title url}}}', { input: { teamId: resource_id, title: input.title, description: input.description || '' } });
      if (action === 'comment') return linear('mutation($input:CommentCreateInput!){commentCreate(input:$input){success comment{id body}}}', { input: { issueId: input.issue_id, body: input.body } });
      if (action === 'update_issue') return linear('mutation($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success issue{id title url}}}', { id: input.issue_id, input: { ...(input.title ? { title: input.title } : {}), ...(input.description !== undefined ? { description: input.description } : {}), ...(input.state_id ? { stateId: input.state_id } : {}) } });
    }
    if (provider === 'jira') {
      const [site, project] = jiraResource(resource_id);
      if (action === 'create_issue') return jira(site, '/issue', { method: 'POST', body: { fields: { project: { key: project }, summary: input.title, issuetype: { id: input.issue_type }, ...(input.description ? { description: adf(input.description) } : {}) } } });
      if (action === 'comment') { const existing = await jira(site, `/issue/${segment(input.issue_id)}?fields=project`); if (existing.fields?.project?.key !== project) throw providerError('resource_scope', 'This issue is outside the selected project.', 403); return jira(site, `/issue/${segment(input.issue_id)}/comment`, { method: 'POST', body: { body: adf(input.body) } }); }
    }
    if (provider === 'slack' && action === 'send_message') return slack('chat.postMessage', { channel: resource_id, text: input.text, ...(input.thread_ts ? { thread_ts: input.thread_ts } : {}) });
    if ((provider === 'figma' || provider === 'figjam') && action === 'comment') return figma(`/files/${segment(resource_id)}/comments`, { method: 'POST', body: { message: input.message } });
    throw providerError('unsupported_action', 'This provider action is not supported.');
  }
  async function readCode({ resource_id, kind = 'tree', path = '', ref = 'HEAD', base, head }) {
    if (!provider.startsWith('github')) throw providerError('unsupported_provider', 'Code browsing requires a GitHub connection.');
    const target = repo(resource_id);
    if (typeof path !== 'string' || path.length > 2000 || path.split('/').some(part => ['.', '..'].includes(part)) || /[\x00-\x1f\\]/.test(path)) throw providerError('invalid_path', 'Choose a valid repository path.');
    const encodedPath = path.split('/').filter(Boolean).map(segment).join('/');
    if (kind === 'branches') return gh(`/repos/${target}/branches?per_page=100`);
    if (kind === 'compare') {
      if (!safeRef(base) || !safeRef(head)) throw providerError('invalid_ref', 'Select a base and head reference.');
      return gh(`/repos/${target}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=100`);
    }
    if (!safeRef(ref) || !['tree', 'file'].includes(kind)) throw providerError('invalid_ref', 'Select a valid reference and code view.');
    const data = await gh(`/repos/${target}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`);
    if (Array.isArray(data)) return { kind: 'tree', entries: data.map(({ name, path, type, sha, size, html_url }) => ({ name, path, type, sha, size, url: html_url })) };
    if (data.type !== 'file' || data.encoding !== 'base64' || data.size > 1000000) return { kind: data.type, path: data.path, size: data.size, url: data.html_url, unavailable_reason: 'Only text files up to 1 MB can be previewed.' };
    const buffer = Buffer.from(data.content, 'base64');
    if (buffer.includes(0)) return { kind: 'file', path: data.path, size: data.size, url: data.html_url, unavailable_reason: 'Binary file: open it on GitHub.' };
    return { kind: 'file', path: data.path, sha: data.sha, size: data.size, url: data.html_url, content: buffer.toString('utf8') };
  }
  return { resources, sync, execute, readCode };
}

function safeRef(value) { return typeof value === 'string' && value.length > 0 && value.length <= 300 && !/[\x00-\x20?#]/.test(value); }

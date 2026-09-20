export const PACKAGE_TYPES = Object.freeze(['container', 'npm', 'maven', 'rubygems', 'docker', 'nuget']);

export function connectionReadOptions(provider, input = {}, fields = []) {
  const options = Object.fromEntries(fields.filter(field => typeof input[field.name] === 'string').map(field => [field.name, input[field.name]]));
  if (provider === 'google-sheets') options.range = typeof input.range === 'string' ? input.range : 'A1:Z200';
  if (provider === 'github-packages') options.package_type = PACKAGE_TYPES.includes(input.package_type) ? input.package_type : 'container';
  return options;
}

// A page token belongs to one exact resource, content kind and read policy.
export function connectionQueryKey(connectionId, query = {}) {
  return JSON.stringify([connectionId, Object.entries(query).filter(([key]) => key !== 'cursor').sort(([left], [right]) => left.localeCompare(right))]);
}

export function matchingConnectionCursor(page, queryKey) {
  return page?.queryKey === queryKey ? page.cursor : null;
}

export function selectedConnectionResources(ids, discovered = []) {
  const byId = new Map(discovered.map(item => [item.id, item]));
  return [...new Set(ids)].map(id => byId.get(id) ?? { id, name: id, type: 'saved selection' });
}

export function connectionScopes(scopes) {
  return [...new Set((Array.isArray(scopes) ? scopes : String(scopes ?? '').split(/[\s,]+/)).filter(scope => typeof scope === 'string' && scope.trim()))];
}

// Never infer safety from an HTTP status: a provider may have accepted a write
// before its response was lost. Only server-certified preflight/rejection codes
// allow a new editable request; unknown and uncertain errors retain their key.
export function canEditRejectedConnectionAction(error) {
  return ['action_not_sent', 'action_rejected', 'required_field', 'invalid_field', 'invalid_action', 'feature_disabled', 'resource_not_selected'].includes(error?.code);
}

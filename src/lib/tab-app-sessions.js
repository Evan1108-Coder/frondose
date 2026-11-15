// Runtime URLs may contain authentication. Never persist them to tab metadata,
// Field Defaults, localStorage or exports. The native guest owns its session.
const addresses = new Map();
const key = (workspaceId, entityId) => JSON.stringify([workspaceId, entityId]);
export function tabAppAddress(workspaceId, entityId) { return addresses.get(key(workspaceId, entityId)) || ''; }
export function rememberTabAppAddress(workspaceId, entityId, address) {
  const id = key(workspaceId, entityId); addresses.delete(id); addresses.set(id, address);
  while (addresses.size > 12) addresses.delete(addresses.keys().next().value);
}
export function forgetTabAppAddress(workspaceId, entityId) { addresses.delete(key(workspaceId, entityId)); }

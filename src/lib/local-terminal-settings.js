const changed = () => new Error('The workspace directory changed. Reopen Terminal settings before saving.');
// Display settings have a separate workspace host when no directory is linked.
// Choosing that host never binds the home directory or creates a project.
export function localTerminalSettingsTarget(workspaceId, directory) {
  if (typeof workspaceId !== 'string' || !workspaceId || !directory || typeof directory !== 'object') throw changed();
  const binding = directory.binding || null;
  if (binding && (typeof binding.projectId !== 'string' || !binding.projectId || !binding.version || typeof binding.path !== 'string')) throw changed();
  const scope = binding ? { workspaceId, projectId: binding.projectId } : { workspaceId, projectId: null, host: 'workspace' };
  return { scope, binding, home: !binding, expectedBindingVersion: binding?.version ?? null,
    identity: JSON.stringify([workspaceId, binding?.projectId ?? null, binding?.version ?? null, binding?.path ?? null, directory.ready === true]) };
}
export function assertLocalTerminalSettingsTarget(target, directory) {
  const current = localTerminalSettingsTarget(target?.scope?.workspaceId, directory);
  if (current.identity !== target.identity) throw changed();
  return current;
}

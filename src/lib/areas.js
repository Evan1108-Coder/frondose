/** Area is the product identity; legacy team IDs remain stable storage keys. */
export const AREA_READ_TOOLS = ['search_workspace', 'get_area_context', 'get_project_context', 'get_route', 'search_knowledge', 'read_document'];
export function areaContactsVisible(data, areaId, settings) {
  const policy = settings ?? data.area_settings?.find(item => item.id === areaId);
  return policy?.contacts_enabled === true || (data.team_members ?? []).some(item => item.team_id === areaId);
}
export function areaSettingsFields(settings) {
  return { instructions: settings.instructions ?? '', default_agent_ids: settings.default_agent_ids ?? [], context_pack_ids: settings.context_pack_ids ?? [], allowed_tools: settings.allowed_tools ?? [], permission_policy: 'review', contacts_enabled: settings.contacts_enabled === true };
}
/** A redacted response is not the complete stored reference list. Never replace it. */
export function areaSettingsPatch(settings, form) {
  const initial = areaSettingsFields(settings), next = areaSettingsFields(form);
  const patch = { version: settings.version };
  for (const key of Object.keys(initial)) {
    if (settings.references_redacted && ['default_agent_ids', 'context_pack_ids'].includes(key)) continue;
    if (JSON.stringify(initial[key]) !== JSON.stringify(next[key])) patch[key] = next[key];
  }
  return patch;
}

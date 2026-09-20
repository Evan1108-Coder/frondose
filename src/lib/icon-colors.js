import { normalizeReactionColor } from './reaction-catalog.js';

export const TEAM_COLOR_POLICIES = ['team', 'global'];
export const LABEL_COLOR_POLICIES = ['global', 'icon', 'neutral'];
export function colorPolicy(value, allowed, fallback) {
  return allowed.includes(value) ? value : normalizeReactionColor(value) || fallback;
}
export function teamColor(team) {
  // Old records used gray as a default rather than an intentional choice.
  const color = normalizeReactionColor(team?.color) || '';
  return team?.tab_icon_color === undefined && color === '#8b95a5' ? '' : color;
}
export function resolveTeamColor(team, kind, globalColor = '') {
  const policy = colorPolicy(team?.[kind], TEAM_COLOR_POLICIES, 'team');
  return policy === 'global' ? globalColor : policy === 'team' ? teamColor(team) || globalColor : policy;
}
export function resolveNavColors(settings = {}, team, override = {}) {
  const globalIcon = settings.tabIconColor || '';
  const inheritedIcon = team ? resolveTeamColor(team, 'tab_icon_color', globalIcon) : globalIcon;
  const iconPolicy = colorPolicy(override.icon, ['inherit', 'global'], 'inherit');
  const icon = iconPolicy === 'global' ? globalIcon : iconPolicy === 'inherit' ? inheritedIcon : iconPolicy;
  let labelPolicy = colorPolicy(override.label, ['inherit', ...LABEL_COLOR_POLICIES], 'inherit');
  if (labelPolicy === 'inherit') labelPolicy = team ? colorPolicy(team.tab_label_color, LABEL_COLOR_POLICIES, 'global') : 'global';
  if (labelPolicy === 'global') labelPolicy = colorPolicy(settings.tabLabelColor, ['icon', 'neutral'], 'neutral');
  return { icon, label: labelPolicy === 'icon' ? icon : labelPolicy === 'neutral' ? '' : labelPolicy };
}
export function normalizeTabColors(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).filter(([key]) => key.length < 400 && !['__proto__', 'constructor', 'prototype'].includes(key)).slice(0, 3000).map(([key, value]) => [key, {
    icon: colorPolicy(value?.icon, ['inherit', 'global'], 'inherit'),
    label: colorPolicy(value?.label, ['inherit', ...LABEL_COLOR_POLICIES], 'inherit'),
  }]));
}
export function groupColorDefaults(override = {}) {
  return {
    tab_icon_color: colorPolicy(override.icon, ['global'], 'global'),
    tab_label_color: colorPolicy(override.label, LABEL_COLOR_POLICIES, 'global'),
  };
}
export function pageTeam(page, data) {
  const entity = (Array.isArray(data[page.view]) ? data[page.view] : []).find(item => item.id === page.id);
  const projectId = page.projectId || (['projects', 'workbench'].includes(page.view) ? page.id : entity?.project_id);
  const project = data.projects?.find(item => item.id === projectId);
  const id = page.view === 'teams' ? page.id : page.view === 'settings' && page.id?.startsWith('team:') ? page.id.slice(5) : entity?.team_id || project?.team_id;
  return data.teams?.find(team => team.id === id);
}

import { getReaction, normalizeReactionColor } from './reaction-catalog.js';
import { colorPolicy, teamColor, TEAM_COLOR_POLICIES, LABEL_COLOR_POLICIES } from './icon-colors.js';

export function teamAppearance(team = {}) {
  return {
    icon: getReaction(team.icon)?.type === 'icon' ? team.icon : 'icon:users',
    color: teamColor(team),
    icon_color: normalizeReactionColor(team.icon_color) || '',
    tab_icon_color: colorPolicy(team.tab_icon_color, TEAM_COLOR_POLICIES, 'team'),
    empty_icon_color: colorPolicy(team.empty_icon_color, TEAM_COLOR_POLICIES, 'team'),
    tab_label_color: colorPolicy(team.tab_label_color, LABEL_COLOR_POLICIES, 'global'),
  };
}

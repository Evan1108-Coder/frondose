import { getReaction, normalizeReactionColor } from './reaction-catalog.js';

export function teamAppearance(team = {}) {
  return {
    icon: getReaction(team.icon)?.type === 'icon' ? team.icon : 'icon:users',
    color: normalizeReactionColor(team.color) || '',
    icon_color: normalizeReactionColor(team.icon_color) || '',
  };
}

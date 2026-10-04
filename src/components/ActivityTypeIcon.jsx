import { useActivityIcon } from '../lib/activity-icons.js';
import { ReactionGlyph } from './ReactionGlyph.jsx';

export function ActivityTypeIcon({ workspaceId, type, size = 20 }) {
  const id = useActivityIcon(workspaceId, type);
  return <ReactionGlyph id={id} size={size} />;
}

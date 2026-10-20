import { useEffect, useState } from 'react';
import { apiRequest } from '../data/api.js';

export const DEFAULT_FRONDOSE_AGENT_APPEARANCE = Object.freeze({ display_name: 'Frondose', orb_color: 'blue', image_url: null });
const EVENT = 'rumbo:agent-appearance';
const colors = new Set(['blue', 'cyan', 'green', 'gold', 'coral', 'purple']);
function toAppearance(preferences) {
  return {
    display_name: typeof preferences?.display_name === 'string' && preferences.display_name.trim() ? preferences.display_name : DEFAULT_FRONDOSE_AGENT_APPEARANCE.display_name,
    orb_color: colors.has(preferences?.orb_color) ? preferences.orb_color : DEFAULT_FRONDOSE_AGENT_APPEARANCE.orb_color,
    image_url: typeof preferences?.image_url === 'string' && /^data:image\/(?:png|jpeg|webp);base64,/.test(preferences.image_url) ? preferences.image_url : null,
  };
}

export function announceFrondoseAgentAppearance(workspaceId, preferences) {
  if (typeof window !== 'undefined' && workspaceId && preferences) window.dispatchEvent(new CustomEvent(EVENT, { detail: { workspaceId, preferences } }));
}

export function useFrondoseAgentAppearance(workspaceId) {
  const [appearance, setAppearance] = useState(DEFAULT_FRONDOSE_AGENT_APPEARANCE);
  useEffect(() => {
    if (!workspaceId) { setAppearance(DEFAULT_FRONDOSE_AGENT_APPEARANCE); return undefined; }
    const controller = new AbortController();
    setAppearance(DEFAULT_FRONDOSE_AGENT_APPEARANCE);
    apiRequest(`/api/frondose-agent?workspace_id=${encodeURIComponent(workspaceId)}`, { signal: controller.signal })
      .then(response => { if (!controller.signal.aborted) setAppearance(toAppearance(response.result?.preferences)); })
      .catch(() => {});
    const update = event => { if (event.detail?.workspaceId === workspaceId) { controller.abort(); setAppearance(toAppearance(event.detail.preferences)); } };
    window.addEventListener(EVENT, update);
    return () => { controller.abort(); window.removeEventListener(EVENT, update); };
  }, [workspaceId]);
  return appearance;
}

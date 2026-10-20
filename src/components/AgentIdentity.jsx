import { Bot } from "./icons.jsx";
import { ServiceLogo } from './ServiceLogo.jsx';
import { FrondoseAgentOrb } from './FrondoseAgentOrb.jsx';
import { useFrondoseAgentAppearance } from '../lib/frondose-agent-appearance.js';
import { val } from '../lib/model.js';
import './agent-identity.css';

function FrondoseProfileMark({ workspaceId, compact }) {
  const appearance = useFrondoseAgentAppearance(workspaceId);
  return <FrondoseAgentOrb color={appearance.orb_color} compact className={compact ? 'agent-orb-small' : ''} />;
}

/** Consistent provider identity across roster, connections and chat. */
export function AgentIdentity({ agent, provider, compact = false }) {
  const kind = provider ?? agent?.provider;
  const isFrondose = typeof agent?.id === 'string' && agent.id.startsWith('rumbo_agent_');
  const image = val(agent, 'image_url');
  return <span className={`agent-identity ${compact ? "compact" : ""}`} aria-hidden="true">{image ? <img className="agent-custom-picture" src={image} alt="" draggable="false" /> : isFrondose ? <FrondoseProfileMark workspaceId={agent.workspace_id || agent.workspaceId} compact={compact} /> : kind ? <ServiceLogo name={kind} /> : <Bot />}</span>;
}

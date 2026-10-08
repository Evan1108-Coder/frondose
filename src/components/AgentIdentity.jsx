import { Bot } from "./icons.jsx";
import { ServiceLogo } from './ServiceLogo.jsx';
import { RumboAgentOrb } from './RumboAgentOrb.jsx';
import { useRumboAgentAppearance } from '../lib/rumbo-agent-appearance.js';

function RumboProfileMark({ workspaceId, compact }) {
  const appearance = useRumboAgentAppearance(workspaceId);
  return <RumboAgentOrb color={appearance.orb_color} compact className={compact ? 'agent-orb-small' : ''} />;
}

/** Consistent provider identity across roster, connections and chat. */
export function AgentIdentity({ agent, provider, compact = false }) {
  const kind = provider ?? agent?.provider;
  const isRumbo = typeof agent?.id === 'string' && agent.id.startsWith('rumbo_agent_');
  return <span className={`agent-identity ${compact ? "compact" : ""}`} aria-hidden="true">{isRumbo ? <RumboProfileMark workspaceId={agent.workspace_id || agent.workspaceId} compact={compact} /> : kind ? <ServiceLogo name={kind} /> : <Bot />}</span>;
}

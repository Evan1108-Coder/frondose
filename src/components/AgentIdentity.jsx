import { Bot } from "./icons.jsx";
import { ServiceLogo } from './ServiceLogo.jsx';
import { TalvoriAgentOrb } from './TalvoriAgentOrb.jsx';
import { useTalvoriAgentAppearance } from '../lib/talvori-agent-appearance.js';

function TalvoriProfileMark({ workspaceId, compact }) {
  const appearance = useTalvoriAgentAppearance(workspaceId);
  return <TalvoriAgentOrb color={appearance.orb_color} compact className={compact ? 'agent-orb-small' : ''} />;
}

/** Consistent provider identity across roster, connections and chat. */
export function AgentIdentity({ agent, provider, compact = false }) {
  const kind = provider ?? agent?.provider;
  const isTalvori = typeof agent?.id === 'string' && agent.id.startsWith('rumbo_agent_');
  return <span className={`agent-identity ${compact ? "compact" : ""}`} aria-hidden="true">{isTalvori ? <TalvoriProfileMark workspaceId={agent.workspace_id || agent.workspaceId} compact={compact} /> : kind ? <ServiceLogo name={kind} /> : <Bot />}</span>;
}

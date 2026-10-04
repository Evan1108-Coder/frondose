import { Bot } from "./icons.jsx";
import { ServiceLogo } from './ServiceLogo.jsx';
import { RumboSymbol } from './Brand.jsx';

/** Consistent provider identity across roster, connections and chat. */
export function AgentIdentity({ agent, provider, compact = false }) {
  const kind = provider ?? agent?.provider;
  const isRumbo = typeof agent?.id === 'string' && agent.id.startsWith('rumbo_agent_');
  return <span className={`agent-identity ${compact ? "compact" : ""}`} aria-hidden="true">{isRumbo ? <RumboSymbol size={compact ? 22 : 30} decorative /> : kind ? <ServiceLogo name={kind} /> : <Bot />}</span>;
}

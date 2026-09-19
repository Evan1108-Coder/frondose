import { Bot } from "./icons.jsx";
import { ServiceLogo } from './ServiceLogo.jsx';

/** Consistent provider identity across roster, connections and chat. */
export function AgentIdentity({ agent, provider, compact = false }) {
  const kind = provider ?? agent?.provider;
  return <span className={`agent-identity ${compact ? "compact" : ""}`} aria-hidden="true">{kind ? <ServiceLogo name={kind} /> : <Bot />}</span>;
}

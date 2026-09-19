import { Code, Terminal, Asterisk, Bot } from "./icons.jsx";

/** Provider/capability glyphs, not representations of vendor trademarks. */
export function AgentIdentity({ agent, provider, compact = false }) {
  const name = agent?.name ?? "";
  const kind = provider ?? agent?.provider;
  const Glyph = kind === "claude" ? Asterisk : kind === "codex" ? /review/i.test(name) ? Code : Terminal : Bot;
  return <span className={`agent-identity ${compact ? "compact" : ""}`} aria-hidden="true"><Glyph /></span>;
}

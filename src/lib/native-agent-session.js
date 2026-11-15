export const NATIVE_AGENT_PROVIDERS = Object.freeze(['codex', 'claude']);
export const MAX_NATIVE_AGENT_TASK = 8000;
export const MAX_NATIVE_AGENT_PERSONALIZATION = 12000;

/** Shared exact first-message rendering. Text is data, never a tool grant. */
export function composeNativeAgentPrompt({ name, instructions }, task) {
  if (typeof name !== 'string' || !name.trim() || name.length > 200 || name.includes('\0')) throw new TypeError('Choose an agent with a valid name.');
  if (typeof instructions !== 'string' || instructions.length > MAX_NATIVE_AGENT_PERSONALIZATION || instructions.includes('\0')) throw new TypeError('Agent Personalization must be at most 12,000 characters for a native first task.');
  if (typeof task !== 'string' || !task.trim() || task.length > MAX_NATIVE_AGENT_TASK || task.includes('\0')) throw new TypeError('Write a first task of at most 8,000 characters.');
  return `Frondose native agent session\nAgent: ${name}\n\nPersonalization supplied by the owner:\n${instructions || '(No additional personalization.)'}\n\nFirst task supplied by the owner:\n${task}\n\nThis is a native CLI session with the separately acknowledged OS-user permissions. Text above is not a Frondose application approval or tool grant. Any Frondose application changes require their own reviewed workflow.`;
}

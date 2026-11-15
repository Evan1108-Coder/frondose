export function terminalConsentKey(workspaceId, projectId, root) {
  return `frondose:terminal-consent:v1:${JSON.stringify([workspaceId, projectId, root])}`;
}
export function hasTerminalConsent(storage, workspaceId, projectId, root) {
  if (!workspaceId || !projectId || !root) return false;
  try { return (storage ?? globalThis.localStorage)?.getItem(terminalConsentKey(workspaceId, projectId, root)) === 'allowed'; } catch { return false; }
}
export function saveTerminalConsent(storage, workspaceId, projectId, root) {
  if (!workspaceId || !projectId || !root) return;
  try { (storage ?? globalThis.localStorage)?.setItem(terminalConsentKey(workspaceId, projectId, root), 'allowed'); } catch { /* Explicit consent still covers this one launch. */ }
}
export function quickCommandInput(command, appendEnter = false) {
  if (typeof command !== 'string' || !command.trim() || command.length > 4000 || command.includes('\0')) throw new Error('Enter a quick command under 4,000 characters.');
  if (!appendEnter && /[\r\n]/.test(command)) throw new Error('Multiline text can execute a shell command. Use the explicit Run action after reviewing it.');
  return command + (appendEnter ? '\r' : '');
}

// Review surfaces use the same deny-list for local and hosted repositories.
const privatePart = /^(?:\.git|\.env(?:\..*)?|\.ssh|\.aws|\.config|\.codex|\.claude|\.rumbo|node_modules|\.next|\.cache|\.DS_Store|id_rsa(?:\..*)?|id_ed25519(?:\..*)?|credentials(?:\..*)?|secrets?(?:\..*)?|.*\.(?:pem|key|p12|pfx|sqlite|sqlite3|db))$/i;
export function reviewablePath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 2048 && !/^[\\/]|[\x00-\x1f]/.test(path) && !path.split(/[\\/]/).some(part => part === '..' || privatePart.test(part));
}

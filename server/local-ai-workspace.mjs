// A machine login is available infrastructure, not consent from every new workspace.
// This table is intentionally not part of portable workspace data or Settings.
export function installLocalAiWorkspaces(db) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_ai_workspace_connections'").get();
  db.exec(`CREATE TABLE IF NOT EXISTS local_ai_workspace_connections (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK(provider IN ('codex','claude')),
    PRIMARY KEY(workspace_id,provider)
  )`);
  // Preserve actual existing profile bindings, not every empty workspace that
  // happened to see the machine's old global status. Never repeat on restart.
  if (!exists) for (const agent of db.prepare("SELECT DISTINCT workspace_id,provider FROM agents WHERE workspace_id IS NOT NULL AND provider IN ('codex','claude') AND provider_connection_id=('conn_' || provider)").all()) enableLocalAi(db, agent.workspace_id, agent.provider);
}

export function enableLocalAi(db, workspaceId, provider) {
  db.prepare('INSERT OR IGNORE INTO local_ai_workspace_connections(workspace_id,provider) VALUES (?,?)').run(workspaceId, provider);
}

export function localAiEnabled(db, workspaceId, provider) {
  return Boolean(db.prepare('SELECT 1 FROM local_ai_workspace_connections WHERE workspace_id=? AND provider=?').get(workspaceId, provider));
}

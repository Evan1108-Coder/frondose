import { randomUUID, createHash } from 'node:crypto';

export const GOVERNANCE_RANKS = Object.freeze({ Owner: 100, Admin: 80, Manager: 50, Member: 10 });
const BASE_PERMISSIONS = [
  ['workspace.read', 'View workspace', 'Workspace'], ['workspace.edit', 'Edit workspace', 'Workspace'],
  ['members.read', 'View members', 'People'], ['members.manage', 'Manage lower-ranked members', 'People'],
  ['roles.manage', 'Manage custom roles and grants', 'People'], ['audit.read', 'Read audit history', 'Security'],
  ['connections.read', 'View connections', 'Connections'], ['connections.manage', 'Configure connections', 'Connections'],
  ['connections.use', 'Use enabled connections', 'Connections'], ['connections.write', 'Write through connections', 'Connections'],
  ['connections.view', 'View connection resources', 'Connections'], ['connections.sync', 'Synchronize selected connection resources', 'Connections'],
  ['projects.read', 'Read projects', 'Projects'], ['projects.write', 'Create and update projects', 'Projects'],
  ['routes.read', 'Read Routes', 'Routes'], ['routes.write', 'Create and update Routes', 'Routes'],
  ['documents.read', 'Read documents', 'Knowledge'], ['documents.write', 'Create and update documents', 'Knowledge'],
  ['agents.use', 'Use agents', 'Agents'], ['agents.manage', 'Configure agents', 'Agents'],
  ['workbench.use', 'Use project Workbench', 'Code'], ['automations.manage', 'Manage automations', 'Automation'],
  ['approvals.read', 'View approval requests', 'Security'], ['data.export', 'Export accessible data', 'Security'],
  ...['workspace', 'projects', 'routes', 'chats', 'documents', 'settings'].flatMap(domain => ['read', 'write', 'delete'].map(action => [`${domain}.${action}`, `${action[0].toUpperCase() + action.slice(1)} ${domain}`, domain])),
  ...['read', 'write', 'run', 'delete'].map(action => [`agents.${action}`, `${action} agents`, 'Agents']),
  ...['read', 'write', 'execute'].map(action => [`workbench.${action}`, `${action} Workbench`, 'Code']),
];
const READ = BASE_PERMISSIONS.filter(([id]) => id.endsWith('.read')).map(([id]) => id);
const MEMBER = [...READ.filter(id => id !== 'audit.read'), 'connections.use', 'connections.view', 'connections.sync', 'projects.write', 'routes.write', 'chats.write', 'documents.write', 'agents.use', 'agents.run'];
const MANAGER = [...MEMBER, 'members.manage', 'connections.manage', 'connections.write', 'agents.manage', 'agents.write', 'automations.manage', 'workbench.use', 'workbench.write', 'workbench.execute'];
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const id = prefix => `${prefix}_${randomUUID()}`;
const parse = value => JSON.parse(value);
const string = (value, name, max = 200) => typeof value === 'string' && value.trim() && value.length <= max && !value.includes('\0') ? value.trim() : fail(`${name} must be non-empty text of at most ${max} characters.`);
const unpack = row => row && Object.fromEntries(Object.entries(row).map(([key, value]) => key.endsWith('_json') ? [key.slice(0, -5), parse(value)] : [key, value]));

export function installGovernance(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS governance_members (id TEXT NOT NULL, workspace_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', rank TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, PRIMARY KEY(workspace_id,id));
    CREATE TABLE IF NOT EXISTS governance_roles (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, permissions_json TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS governance_grants (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, member_id TEXT NOT NULL, role_id TEXT, permission TEXT, effect TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, starts_at TEXT NOT NULL, expires_at TEXT, reason TEXT NOT NULL, created_by TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS governance_approvals (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, kind TEXT NOT NULL, target_id TEXT NOT NULL, requester_id TEXT NOT NULL, payload_json TEXT NOT NULL, owners_json TEXT NOT NULL, votes_json TEXT NOT NULL, status TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT);
    CREATE TABLE IF NOT EXISTS governance_audit (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT, detail_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS governance_permissions (id TEXT PRIMARY KEY, label TEXT NOT NULL, category TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS governance_grants_member ON governance_grants(workspace_id,member_id);
    CREATE INDEX IF NOT EXISTS governance_audit_workspace ON governance_audit(workspace_id,created_at);
    CREATE TABLE IF NOT EXISTS governance_approval_consumptions (approval_id TEXT PRIMARY KEY, consumed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS governance_rank_policies (workspace_id TEXT NOT NULL, rank TEXT NOT NULL, permissions_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(workspace_id,rank));
  `);
  for (const [permission, label, category] of BASE_PERMISSIONS) db.prepare('INSERT OR IGNORE INTO governance_permissions VALUES(?,?,?)').run(permission, label, category);
}

export function createGovernanceService({ db, now = () => new Date().toISOString() }) {
  installGovernance(db);
  const instant = () => { const value = now(); return value instanceof Date ? value.toISOString() : value; };
  const rows = (table, ws) => db.prepare(`SELECT * FROM ${table} WHERE workspace_id=?`).all(ws).map(unpack);
  const workspace = ws => { if (!db.prepare('SELECT id FROM workspaces WHERE id=?').get(ws)) fail('Workspace not found.', 404); };
  const member = (ws, uid, active = true) => { const row = db.prepare('SELECT * FROM governance_members WHERE workspace_id=? AND id=?').get(ws, uid); if (!row || active && row.status !== 'active') fail('Active workspace membership required.', 403); return row; };
  const audit = (ws, actor, action, target, detail = {}) => db.prepare('INSERT INTO governance_audit VALUES(?,?,?,?,?,?,?)').run(id('audit'), ws, actor, action, target ?? null, JSON.stringify(detail), instant());
  const owners = ws => rows('governance_members', ws).filter(m => m.status === 'active' && m.rank === 'Owner').map(m => m.id).sort();
  const scope = (ws, input = {}) => {
    const type = input.scope_type || 'workspace'; const sid = input.scope_id || (type === 'workspace' ? ws : '');
    if (type === 'workspace') { if (sid !== ws) fail('Scope must belong to this workspace.'); }
    else if (['team', 'project', 'agent'].includes(type)) {
      const table = { team: 'teams', project: 'projects', agent: 'agents' }[type];
      if (!db.prepare(`SELECT id FROM ${table} WHERE id=? AND workspace_id=?`).get(sid, ws)) fail('Scope not found in this workspace.', 404);
    } else if (type === 'connection') { string(sid, 'Connection ID'); }
    else fail('Unsupported permission scope.');
    return { scope_type: type, scope_id: sid };
  };
  const matches = (grant, target) => grant.scope_type === 'workspace' || grant.scope_type === target.scope_type && grant.scope_id === target.scope_id || grant.scope_type === 'team' && target.scope_type === 'project' && db.prepare('SELECT * FROM projects WHERE id=?').get(target.scope_id)?.team_id === grant.scope_id;
  const permission = p => { if (!db.prepare('SELECT id FROM governance_permissions WHERE id=?').get(p)) fail('Unknown permission.'); return p; };
  const activeGrants = (ws, uid) => rows('governance_grants', ws).filter(g => {
    if (g.member_id !== uid || g.revoked_at || g.starts_at > instant() || g.expires_at && g.expires_at <= instant()) return false;
    const grantor = db.prepare('SELECT * FROM governance_members WHERE workspace_id=? AND id=?').get(ws, g.created_by);
    const recipient = member(ws, uid);
    return grantor?.status === 'active' && GOVERNANCE_RANKS[grantor.rank] > GOVERNANCE_RANKS[recipient.rank];
  });
  const grantPermissions = (ws, g) => g.role_id ? rows('governance_roles', ws).find(r => r.id === g.role_id)?.permissions || [] : [g.permission];
  function explain(ws, uid, p, target = {}, ancestry = []) {
    workspace(ws); const actor = member(ws, uid); permission(p); const at = scope(ws, target);
    if (actor.rank === 'Owner') return { allowed: true, permission: p, ...at, reasons: ['Workspace Owner'], actor_id: uid };
    if (ancestry.includes(uid) || ancestry.length > 8) return { allowed: false, permission: p, ...at, reasons: ['Invalid delegation chain'], actor_id: uid };
    const grants = activeGrants(ws, uid).filter(g => matches(g, at) && grantPermissions(ws, g).includes(p)).filter(g => {
      const chain = [...ancestry, uid];
      return explain(ws, g.created_by, p, at, chain).allowed && explain(ws, g.created_by, 'roles.manage', at, chain).allowed;
    });
    const denied = grants.find(g => g.effect === 'deny');
    if (denied) return { allowed: false, permission: p, ...at, reasons: [`Explicit deny: ${denied.reason}`], grant_id: denied.id, actor_id: uid };
    const allowed = grants.find(g => g.effect === 'allow');
    if (allowed) return { allowed: true, permission: p, ...at, reasons: [`Granted: ${allowed.reason}`], grant_id: allowed.id, expires_at: allowed.expires_at, actor_id: uid };
    const policy = db.prepare('SELECT permissions_json FROM governance_rank_policies WHERE workspace_id=? AND rank=?').get(ws, actor.rank);
    const baseline = policy ? parse(policy.permissions_json) : actor.rank === 'Admin' ? BASE_PERMISSIONS.map(([x]) => x).filter(x => !x.endsWith('.delete') && x !== 'connections.manage') : actor.rank === 'Manager' ? MANAGER : MEMBER;
    const permitted = baseline.includes(p);
    return { allowed: permitted, permission: p, ...at, reasons: [permitted ? `${actor.rank} default permission` : 'No matching permission grant'], actor_id: uid };
  }
  const authorize = (ws, uid, p, target) => { const decision = explain(ws, uid, p, target); if (!decision.allowed) fail(`Permission required: ${p}. ${decision.reasons.join(' ')}`, 403); return decision; };
  const manageTarget = (ws, uid, target) => { const actor = member(ws, uid); const other = member(ws, target); if (uid === target || GOVERNANCE_RANKS[actor.rank] <= GOVERNANCE_RANKS[other.rank]) fail('You may only manage a lower-ranked member.', 403); return { actor, other }; };
  const rank = value => Object.hasOwn(GOVERNANCE_RANKS, value) ? value : fail('Choose Owner, Admin, Manager, or Member.');
  const validatePermissions = value => { if (!Array.isArray(value) || value.length > 300) fail('Choose a bounded list of permissions.'); return [...new Set(value.map(permission))]; };
  const transaction = fn => { db.exec('SAVEPOINT governance_change'); try { const result = fn(); db.exec('RELEASE governance_change'); return result; } catch (error) { db.exec('ROLLBACK TO governance_change; RELEASE governance_change'); throw error; } };
  function isApprovalCurrent(ws, rawApproval) {
    const approval = rawApproval?.payload_json ? unpack(rawApproval) : rawApproval;
    if (!approval || approval.workspace_id !== ws || !['pending', 'approved'].includes(approval.status)) return false;
    if (approval.kind !== 'protected_action' && approval.status === 'approved') return true;
    if (approval.expires_at <= instant()) return false;
    if (JSON.stringify(owners(ws)) !== JSON.stringify(approval.owners)) return false;
    const requester = db.prepare("SELECT * FROM governance_members WHERE workspace_id=? AND id=? AND status='active'").get(ws, approval.requester_id);
    if (!requester) return false;
    if (approval.kind === 'protected_action') {
      if (requester.version !== approval.payload.requester_version) return false;
      try { return explain(ws, requester.id, approval.payload.permission, approval.payload.scope).allowed; } catch { return false; }
    }
    const target = db.prepare("SELECT * FROM governance_members WHERE workspace_id=? AND id=? AND status='active'").get(ws, approval.target_id);
    return requester.rank === 'Owner' && Boolean(target) && target.version === approval.payload.version;
  }
  function expireStaleApprovals(ws) {
    workspace(ws);
    for (const approval of rows('governance_approvals', ws)) {
      if (!['pending', 'approved'].includes(approval.status) || approval.status === 'approved' && approval.kind !== 'protected_action') continue;
      if (db.prepare('SELECT 1 FROM governance_approval_consumptions WHERE approval_id=?').get(approval.id)) continue;
      if (isApprovalCurrent(ws, approval)) continue;
      db.prepare("UPDATE governance_approvals SET status='expired',resolved_at=? WHERE id=?").run(instant(), approval.id);
      audit(ws, 'system', 'approval.expired', approval.id, { reason: approval.expires_at <= instant() ? 'time_limit' : 'authority_changed' });
    }
  }
  function request(ws, uid, kind, target, payload = {}) {
    const roster = owners(ws); const requestId = id('approval');
    db.prepare('INSERT INTO governance_approvals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(requestId, ws, kind, target, uid, JSON.stringify(payload), JSON.stringify(roster), '{}', 'pending', new Date(Date.parse(instant()) + 7 * 86400000).toISOString(), instant(), null);
    audit(ws, uid, 'approval.requested', requestId, { kind, target });
    return unpack(db.prepare('SELECT * FROM governance_approvals WHERE id=?').get(requestId));
  }
  function bootstrap(ws, actor = { id: 'local-owner', name: 'You' }) {
    workspace(ws);
    if (!db.prepare('SELECT 1 FROM governance_members WHERE workspace_id=?').get(ws)) {
      db.prepare('INSERT INTO governance_members(id,workspace_id,name,rank,created_at) VALUES(?,?,?,?,?)').run(string(actor.id, 'Actor ID'), ws, string(actor.name || 'You', 'Name'), 'Owner', instant());
      audit(ws, actor.id, 'workspace.bootstrapped', ws, { mode: 'local-development' });
    }
    return db.prepare('SELECT * FROM governance_members WHERE workspace_id=? AND id=?').get(ws, actor.id) || null;
  }
  function snapshot(ws, uid) {
    const currentUser = member(ws, uid); authorize(ws, uid, 'members.read');
    expireStaleApprovals(ws);
    const policies = rows('governance_rank_policies', ws);
    return { mode: 'local-development', authenticated: false, current_user: currentUser, members: rows('governance_members', ws), roles: rows('governance_roles', ws), grants: rows('governance_grants', ws), rank_policies: ['Admin', 'Manager', 'Member'].map(rank => policies.find(p => p.rank === rank) || { rank, version: 0, permissions: [...new Set(rank === 'Admin' ? BASE_PERMISSIONS.map(([x]) => x).filter(x => !x.endsWith('.delete') && x !== 'connections.manage') : rank === 'Manager' ? MANAGER : MEMBER)] }), approvals: rows('governance_approvals', ws).map(a => a.status === 'pending' && a.expires_at <= instant() ? { ...a, status: 'expired' } : a), audit: explain(ws, uid, 'audit.read').allowed ? rows('governance_audit', ws).slice(-200).reverse() : [], permissions: db.prepare('SELECT * FROM governance_permissions ORDER BY category,id').all(), ranks: GOVERNANCE_RANKS };
  }
  function command(ws, uid, action, input = {}) {
    workspace(ws); const actor = member(ws, uid);
    expireStaleApprovals(ws);
    return transaction(() => {
      if (action === 'set_rank_permissions') {
        if (actor.rank !== 'Owner') fail('Only Owners can change default rank policies.', 403);
        const desired = rank(input.rank); if (desired === 'Owner') fail('Owner authority is protected.');
        const permissions = validatePermissions(input.permissions); const current = db.prepare('SELECT version FROM governance_rank_policies WHERE workspace_id=? AND rank=?').get(ws, desired);
        if (input.version !== (current?.version || 0)) fail('Rank policy changed. Refresh before editing.', 409);
        db.prepare('INSERT INTO governance_rank_policies VALUES(?,?,?,1) ON CONFLICT(workspace_id,rank) DO UPDATE SET permissions_json=excluded.permissions_json,version=governance_rank_policies.version+1').run(ws, desired, JSON.stringify(permissions));
        audit(ws, uid, 'rank.policy_updated', desired, { permissions }); return unpack(db.prepare('SELECT * FROM governance_rank_policies WHERE workspace_id=? AND rank=?').get(ws, desired));
      }
      if (action === 'create_member') {
        authorize(ws, uid, 'members.manage'); const desired = rank(input.rank || 'Member');
        if (desired === 'Owner' || GOVERNANCE_RANKS[desired] > GOVERNANCE_RANKS[actor.rank]) fail('Use an owner approval request to grant ownership; ranks above yours cannot be delegated.', 403);
        const memberId = id('person'); db.prepare('INSERT INTO governance_members(id,workspace_id,name,email,rank,created_at) VALUES(?,?,?,?,?,?)').run(memberId, ws, string(input.name, 'Name'), typeof input.email === 'string' ? input.email.slice(0, 320) : '', desired, instant());
        audit(ws, uid, 'member.created', memberId, { rank: desired }); return member(ws, memberId);
      }
      if (action === 'set_rank' || action === 'remove_member') {
        authorize(ws, uid, 'members.manage'); const { other } = manageTarget(ws, uid, input.member_id);
        if (input.version !== other.version) fail('Membership changed. Refresh and try again.', 409);
        if (action === 'set_rank') { const desired = rank(input.rank); if (desired === 'Owner' || GOVERNANCE_RANKS[desired] > GOVERNANCE_RANKS[actor.rank]) fail('This rank requires higher authority or owner approval.', 403); db.prepare('UPDATE governance_members SET rank=?,version=version+1 WHERE workspace_id=? AND id=?').run(desired, ws, other.id); }
        else db.prepare("UPDATE governance_members SET status='removed',version=version+1 WHERE workspace_id=? AND id=?").run(ws, other.id);
        audit(ws, uid, action, other.id, { from: other.rank, to: input.rank || 'removed' }); return member(ws, other.id, false);
      }
      if (action === 'leave') {
        if (actor.rank === 'Owner') { if (owners(ws).length < 2) fail('Transfer ownership before the last Owner leaves.', 409); return request(ws, uid, 'owner_leave', uid, { version: actor.version }); }
        db.prepare("UPDATE governance_members SET status='left',version=version+1 WHERE workspace_id=? AND id=?").run(ws, uid); audit(ws, uid, 'member.left', uid); return { left: true };
      }
      if (action === 'create_role' || action === 'update_role') {
        const at = scope(ws, input); authorize(ws, uid, 'roles.manage', at); const permissions = validatePermissions(input.permissions);
        for (const p of permissions) authorize(ws, uid, p, at);
        const name = string(input.name, 'Role name', 80); if (Object.hasOwn(GOVERNANCE_RANKS, name)) fail('Default ranks cannot be impersonated by a custom role.');
        if (action === 'create_role') { const rid = id('role'); db.prepare('INSERT INTO governance_roles VALUES(?,?,?,?,?,?,1,?,?)').run(rid, ws, name, JSON.stringify(permissions), at.scope_type, at.scope_id, uid, instant()); audit(ws, uid, 'role.created', rid, { permissions, ...at }); return rows('governance_roles', ws).find(r => r.id === rid); }
        const role = rows('governance_roles', ws).find(r => r.id === input.role_id); if (!role) fail('Role not found.', 404); if (role.version !== input.version) fail('Role changed. Refresh before editing.', 409);
        authorize(ws, uid, 'roles.manage', role);
        // Changing an assigned role could silently escalate a peer. Require removing its grants first.
        if (rows('governance_grants', ws).some(g => g.role_id === role.id && !g.revoked_at)) fail('Revoke this role’s assignments before editing its permissions or scope.', 409);
        db.prepare('UPDATE governance_roles SET name=?,permissions_json=?,scope_type=?,scope_id=?,version=version+1 WHERE id=?').run(name, JSON.stringify(permissions), at.scope_type, at.scope_id, role.id); audit(ws, uid, 'role.updated', role.id, { permissions }); return rows('governance_roles', ws).find(r => r.id === role.id);
      }
      if (action === 'grant') {
        const at = scope(ws, input); authorize(ws, uid, 'roles.manage', at); const { other } = manageTarget(ws, uid, input.member_id);
        const role = input.role_id ? rows('governance_roles', ws).find(r => r.id === input.role_id) : null;
        if (input.role_id && !role) fail('Role not found.', 404);
        if (role && (role.scope_type !== at.scope_type || role.scope_id !== at.scope_id)) fail('Role assignments must use the role’s scope.');
        const permissions = role ? role.permissions : [permission(input.permission)];
        const starts = input.starts_at ? new Date(Date.parse(input.starts_at)) : new Date(instant()); const end = input.expires_at ? new Date(Date.parse(input.expires_at)) : null;
        if (!Number.isFinite(starts.getTime()) || end && (!Number.isFinite(end.getTime()) || end <= starts || end <= new Date(instant()))) fail('Choose valid start and expiry dates.');
        const expires = end?.toISOString() || null;
        const management = authorize(ws, uid, 'roles.manage', at); if (management.expires_at && (!expires || expires > management.expires_at)) fail('Delegated access cannot outlast your management authority.', 403);
        for (const p of permissions) { const authority = authorize(ws, uid, p, at); if (authority.expires_at && (!expires || expires > authority.expires_at)) fail('Delegated access cannot outlast your own access.', 403); }
        if (!['allow', 'deny'].includes(input.effect || 'allow')) fail('Grant effect must be allow or deny.');
        const gid = id('grant'); db.prepare('INSERT INTO governance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(gid, ws, other.id, role?.id || null, role ? null : input.permission, input.effect || 'allow', at.scope_type, at.scope_id, starts.toISOString(), expires, string(input.reason, 'Reason', 1000), uid, null, instant()); audit(ws, uid, 'grant.created', gid, { member_id: other.id, permissions, ...at }); return rows('governance_grants', ws).find(g => g.id === gid);
      }
      if (action === 'revoke_grant') {
        const grant = rows('governance_grants', ws).find(g => g.id === input.grant_id); if (!grant) fail('Grant not found.', 404); authorize(ws, uid, 'roles.manage', grant); manageTarget(ws, uid, grant.member_id);
        db.prepare('UPDATE governance_grants SET revoked_at=? WHERE id=?').run(instant(), grant.id); audit(ws, uid, 'grant.revoked', grant.id); return { revoked: true };
      }
      if (action === 'request_owner') {
        if (actor.rank !== 'Owner') fail('Only Owners can propose a new Owner.', 403); const target = member(ws, input.member_id); if (target.rank === 'Owner') fail('This member is already an Owner.');
        return request(ws, uid, 'owner_promotion', target.id, { version: target.version });
      }
      if (action === 'decide_approval') {
        const approval = rows('governance_approvals', ws).find(a => a.id === input.approval_id); if (!approval) fail('Approval not found.', 404);
        if (approval.status !== 'pending' || approval.expires_at <= instant()) fail('This approval is no longer pending.', 409);
        if (actor.rank !== 'Owner' || !approval.owners.includes(uid)) fail('Only the original Owners can decide this request.', 403);
        if (JSON.stringify(owners(ws)) !== JSON.stringify(approval.owners)) fail('Owner roster changed. Create a fresh request.', 409);
        if (uid === approval.target_id && approval.kind !== 'protected_action') fail('You cannot approve a request affecting your own ownership.', 403);
        if (approval.kind === 'protected_action' && uid === approval.requester_id && approval.owners.length > 1) fail('Another Owner must approve your protected action.', 403);
        if (!['approve', 'reject'].includes(input.decision)) fail('Choose approve or reject.');
        if (approval.votes[uid]) fail('Your decision is already recorded.', 409);
        const votes = { ...approval.votes, [uid]: input.decision }; const needed = approval.kind === 'protected_action' ? approval.owners.filter(owner => approval.owners.length === 1 || owner !== approval.requester_id) : approval.owners.filter(owner => owner !== approval.target_id); let status = input.decision === 'reject' ? 'rejected' : needed.every(owner => votes[owner] === 'approve') ? 'approved' : 'pending';
        if (status === 'approved' && approval.kind !== 'protected_action') { const target = member(ws, approval.target_id); if (target.version !== approval.payload.version) fail('Target membership changed. Create a fresh request.', 409);
          if (approval.kind === 'owner_promotion') db.prepare("UPDATE governance_members SET rank='Owner',version=version+1 WHERE workspace_id=? AND id=?").run(ws, target.id);
          else { if (owners(ws).length < 2) fail('The last Owner cannot leave.', 409); db.prepare("UPDATE governance_members SET status='left',version=version+1 WHERE workspace_id=? AND id=?").run(ws, target.id); }
        }
        db.prepare('UPDATE governance_approvals SET votes_json=?,status=?,resolved_at=? WHERE id=?').run(JSON.stringify(votes), status, status === 'pending' ? null : instant(), approval.id); audit(ws, uid, 'approval.decided', approval.id, { decision: input.decision, status }); return rows('governance_approvals', ws).find(a => a.id === approval.id);
      }
      fail('Unknown governance action.');
    });
  }
  const registerPermissions = entries => { for (const entry of entries) { if (!/^[a-z][a-z0-9_.-]+$/.test(entry.id)) fail('Invalid permission identifier.'); db.prepare('INSERT OR IGNORE INTO governance_permissions VALUES(?,?,?)').run(entry.id, string(entry.label, 'Permission label'), string(entry.category || 'Connections', 'Category')); } };
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  const digest = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
  function requestProtectedAction(ws, uid, { permission: capability, scope: at = {}, action, target_id: target, payload }) {
    authorize(ws, uid, capability, at);
    expireStaleApprovals(ws);
    return request(ws, uid, 'protected_action', string(target, 'Target'), { permission: capability, scope: scope(ws, at), action: string(action, 'Action'), content: payload, digest: digest(payload), requester_version: member(ws, uid).version });
  }
  function consumeApproval(ws, uid, approvalId, { action, target_id: target, payload }) {
    expireStaleApprovals(ws);
    return transaction(() => {
      const approval = rows('governance_approvals', ws).find(a => a.id === approvalId);
      if (!approval || approval.kind !== 'protected_action' || approval.requester_id !== uid || approval.status !== 'approved' || approval.expires_at <= instant()) fail('An approved current action request is required.', 403);
      if (JSON.stringify(owners(ws)) !== JSON.stringify(approval.owners) || member(ws, uid).version !== approval.payload.requester_version) fail('Membership changed since approval.', 409);
      if (action !== approval.payload.action || target !== approval.target_id || digest(payload) !== approval.payload.digest) fail('Approval does not match this exact action.', 409);
      authorize(ws, uid, approval.payload.permission, approval.payload.scope);
      if (db.prepare('SELECT 1 FROM governance_approval_consumptions WHERE approval_id=?').get(approvalId)) fail('Approval was already used.', 409);
      db.prepare('INSERT INTO governance_approval_consumptions VALUES(?,?)').run(approvalId, instant()); audit(ws, uid, 'approval.consumed', approvalId, { action, target }); return approval;
    });
  }
  return { bootstrap, snapshot, explain, authorize, command, registerPermissions, registerCapabilities: registerPermissions, requestProtectedAction, consumeApproval, isApprovalCurrent, expireStaleApprovals };
}

export async function governanceRoute({ db, req, res, path, url, readBody, send, actor }) {
  if (!['/governance', '/governance/access'].includes(path)) return false;
  if (!actor?.id) fail('A server-resolved identity is required.', 401);
  const service = createGovernanceService({ db });
  if (req.method === 'GET') { const ws = url.searchParams.get('workspace_id'); const result = path.endsWith('/access') ? service.explain(ws, actor.id, url.searchParams.get('permission'), { scope_type: url.searchParams.get('scope_type'), scope_id: url.searchParams.get('scope_id') }) : { ...service.snapshot(ws, actor.id), authenticated: actor.authenticated === true, mode: actor.authenticated ? 'account' : 'local-development' }; send(res, 200, { result }); return true; }
  if (req.method === 'POST' && path === '/governance') { const input = await readBody(req); if (input.actor_id || input.actor || input.current_user) fail('Actor identity is supplied by the server.'); const result = service.command(input.workspace_id, actor.id, input.action, input); send(res, 200, { result }); return true; }
  fail('Method not allowed.', 405);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createGovernanceService, governanceRoute } from '../server/governance-service.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE workspaces(id TEXT PRIMARY KEY); INSERT INTO workspaces VALUES('ws'),('foreign'); CREATE TABLE teams(id TEXT, workspace_id TEXT); INSERT INTO teams VALUES('team','ws'),('other-team','foreign'); CREATE TABLE projects(id TEXT,workspace_id TEXT); CREATE TABLE agents(id TEXT,workspace_id TEXT);`);
  let time = '2026-09-19T12:00:00.000Z';
  const service = createGovernanceService({ db, now: () => time }); service.bootstrap('ws'); service.bootstrap('foreign', { id: 'foreign-owner' });
  const add = (name, rank = 'Member', actor = 'local-owner') => service.command('ws', actor, 'create_member', { name, rank });
  return { db, service, add, clock: value => { time = value; } };
}

test('bootstrap is explicit, stable and cannot seize an existing workspace', () => {
  const { db, service } = fixture();
  assert.equal(service.snapshot('ws', 'local-owner').current_user.rank, 'Owner');
  assert.equal(service.bootstrap('ws', { id: 'attacker' }), null);
  assert.throws(() => service.snapshot('foreign', 'local-owner'), /membership/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM governance_members WHERE workspace_id=?').get('ws').n, 1); db.close();
});

test('rank management allows equal promotions but forbids peer edits and escalating above actor', () => {
  const { db, service, add } = fixture(); const admin = add('Admin', 'Admin'); const manager = add('Manager', 'Manager'); const m = add('Member');
  service.command('ws', admin.id, 'set_rank', { member_id: m.id, rank: 'Admin', version: 1 });
  assert.throws(() => service.command('ws', admin.id, 'remove_member', { member_id: m.id, version: 2 }), /lower-ranked/);
  assert.throws(() => add('Owner', 'Owner', admin.id), /owner approval/);
  assert.throws(() => add('Admin', 'Admin', manager.id), /above yours/);
  assert.throws(() => service.command('ws', m.id, 'set_rank', { member_id: manager.id, rank: 'Member', version: 8 }), /changed/); db.close();
});

test('scoped custom roles are isolated, expire, explain access, and invalidate on grantor departure', () => {
  const { db, service, add, clock } = fixture(); const member = add('Member'); const admin = add('Admin', 'Admin');
  service.command('ws', 'local-owner', 'grant', { member_id: admin.id, permission: 'connections.manage', reason: 'Delegate connection administration' });
  const role = service.command('ws', 'local-owner', 'create_role', { name: 'Team connections', permissions: ['connections.manage'], scope_type: 'team', scope_id: 'team' });
  const grant = service.command('ws', admin.id, 'grant', { member_id: member.id, role_id: role.id, scope_type: 'team', scope_id: 'team', reason: 'One day cover', expires_at: '2026-09-20T12:00:00.000Z' });
  assert.equal(service.explain('ws', member.id, 'connections.manage', { scope_type: 'team', scope_id: 'team' }).allowed, true);
  assert.equal(service.explain('ws', member.id, 'connections.manage').allowed, false);
  assert.throws(() => service.explain('ws', member.id, 'connections.manage', { scope_type: 'team', scope_id: 'other-team' }), /not found/);
  assert.throws(() => service.command('ws', 'local-owner', 'update_role', { role_id: role.id, version: 1, name: 'Edited', permissions: ['roles.manage'], scope_type: 'team', scope_id: 'team' }), /Revoke/);
  clock('2026-09-21T12:00:00.000Z'); assert.equal(service.explain('ws', member.id, 'connections.manage', { scope_type: 'team', scope_id: 'team' }).allowed, false);
  clock('2026-09-19T12:00:00.000Z'); service.command('ws', admin.id, 'leave'); assert.equal(service.explain('ws', member.id, 'connections.manage', { scope_type: 'team', scope_id: 'team' }).allowed, false);
  assert.ok(grant.id); db.close();
});

test('explicit denies win and forbidden permissions cannot be manufactured', () => {
  const { db, service, add } = fixture(); const m = add('Member'); const admin = add('Admin', 'Admin');
  service.command('ws', 'local-owner', 'grant', { member_id: m.id, permission: 'projects.write', effect: 'deny', reason: 'Read only' });
  assert.equal(service.explain('ws', m.id, 'projects.write').allowed, false);
  assert.throws(() => service.command('ws', admin.id, 'create_role', { name: 'Can delete', permissions: ['workspace.delete'] }), /Permission required/);
  assert.throws(() => service.command('ws', 'local-owner', 'create_role', { name: 'Owner', permissions: [] }), /impersonated/);
  assert.throws(() => service.command('ws', 'local-owner', 'create_role', { name: 'Hidden', permissions: ['owner.elevate'] }), /Unknown permission/); db.close();
});

test('owner promotion requires all existing owners; stale membership and roster invalidate requests', () => {
  const { db, service, add } = fixture(); const one = add('Second'); const two = add('Third');
  let request = service.command('ws', 'local-owner', 'request_owner', { member_id: one.id });
  service.command('ws', 'local-owner', 'decide_approval', { approval_id: request.id, decision: 'approve' });
  request = service.command('ws', 'local-owner', 'request_owner', { member_id: two.id });
  assert.equal(service.command('ws', 'local-owner', 'decide_approval', { approval_id: request.id, decision: 'approve' }).status, 'pending');
  assert.equal(service.command('ws', one.id, 'decide_approval', { approval_id: request.id, decision: 'approve' }).status, 'approved');
  assert.throws(() => service.command('ws', one.id, 'decide_approval', { approval_id: request.id, decision: 'approve' }), /no longer pending/);
  const third = add('Fourth'); const stale = service.command('ws', 'local-owner', 'request_owner', { member_id: third.id });
  service.command('ws', 'local-owner', 'set_rank', { member_id: third.id, rank: 'Manager', version: 1 });
  assert.throws(() => service.command('ws', 'local-owner', 'decide_approval', { approval_id: stale.id, decision: 'approve' }), /no longer pending/);
  assert.equal(service.snapshot('ws', two.id).approvals.find(a => a.id === stale.id).status, 'expired'); db.close();
});

test('members can leave voluntarily; last owner cannot leave; owner leave needs remaining owner votes', () => {
  const { db, service, add } = fixture(); assert.throws(() => service.command('ws', 'local-owner', 'leave'), /last Owner/);
  const m = add('Member'); assert.deepEqual(service.command('ws', m.id, 'leave'), { left: true });
  const second = add('Owner two'); const promotion = service.command('ws', 'local-owner', 'request_owner', { member_id: second.id }); service.command('ws', 'local-owner', 'decide_approval', { approval_id: promotion.id, decision: 'approve' });
  const leave = service.command('ws', 'local-owner', 'leave'); assert.throws(() => service.command('ws', 'local-owner', 'decide_approval', { approval_id: leave.id, decision: 'approve' }), /your own/);
  service.command('ws', second.id, 'decide_approval', { approval_id: leave.id, decision: 'approve' }); assert.throws(() => service.snapshot('ws', 'local-owner'), /membership/); db.close();
});

test('protected action binds payload actor target and owner roster; consumption is exactly once', () => {
  const { db, service } = fixture(); const payload = { route: 'route1', change: { archived: true } };
  const request = service.requestProtectedAction('ws', 'local-owner', { permission: 'routes.delete', action: 'route.delete', target_id: 'route1', payload });
  service.command('ws', 'local-owner', 'decide_approval', { approval_id: request.id, decision: 'approve' });
  assert.throws(() => service.consumeApproval('ws', 'local-owner', request.id, { action: 'route.delete', target_id: 'route2', payload }), /exact action/);
  service.consumeApproval('ws', 'local-owner', request.id, { action: 'route.delete', target_id: 'route1', payload });
  assert.throws(() => service.consumeApproval('ws', 'local-owner', request.id, { action: 'route.delete', target_id: 'route1', payload }), /already used/); db.close();
});

test('HTTP route rejects body impersonation and never bootstraps unauthenticated users', async () => {
  const { db } = fixture(); const args = { db, req: { method: 'POST' }, res: {}, path: '/governance', url: new URL('http://localhost/governance'), send() {}, readBody: async () => ({ workspace_id: 'ws', action: 'create_member', name: 'Fake', actor_id: 'local-owner' }) };
  await assert.rejects(governanceRoute(args), /server-resolved identity/);
  await assert.rejects(governanceRoute({ ...args, actor: { id: 'local-owner' } }), /supplied by the server/); db.close();
});

test('revoking management authority invalidates delegated access and forbids grants that outlive it', () => {
  const { db, service, add } = fixture(); const manager = add('Manager', 'Manager'); const m = add('Member');
  const delegated = service.command('ws', 'local-owner', 'grant', { member_id: manager.id, permission: 'roles.manage', reason: 'Temporary team coordinator', scope_type: 'team', scope_id: 'team', expires_at: '2026-09-20T12:00:00.000Z' });
  assert.throws(() => service.command('ws', manager.id, 'grant', { member_id: m.id, permission: 'projects.write', reason: 'Ongoing', scope_type: 'team', scope_id: 'team' }), /outlast/);
  service.command('ws', manager.id, 'grant', { member_id: m.id, permission: 'workbench.execute', reason: 'Task', scope_type: 'team', scope_id: 'team', expires_at: '2026-09-20T11:00:00.000Z' });
  assert.equal(service.explain('ws', m.id, 'workbench.execute', { scope_type: 'team', scope_id: 'team' }).allowed, true);
  service.command('ws', 'local-owner', 'revoke_grant', { grant_id: delegated.id });
  assert.equal(service.explain('ws', m.id, 'workbench.execute', { scope_type: 'team', scope_id: 'team' }).allowed, false); db.close();
});

test('team restrictions inherit to projects and policy edits use optimistic versions', () => {
  const { db, service, add } = fixture(); db.exec("ALTER TABLE projects ADD COLUMN team_id TEXT; INSERT INTO projects VALUES('p','ws','team');"); const m = add('Member');
  service.command('ws', 'local-owner', 'grant', { member_id: m.id, permission: 'projects.write', effect: 'deny', reason: 'Team restriction', scope_type: 'team', scope_id: 'team' });
  assert.equal(service.explain('ws', m.id, 'projects.write', { scope_type: 'project', scope_id: 'p' }).allowed, false);
  service.registerCapabilities([{ id: 'connection.linear.sync', label: 'Sync Linear', category: 'Linear' }]);
  service.command('ws', 'local-owner', 'set_rank_permissions', { rank: 'Member', version: 0, permissions: ['members.read', 'connection.linear.sync'] });
  assert.equal(service.explain('ws', m.id, 'connection.linear.sync').allowed, true);
  assert.throws(() => service.command('ws', 'local-owner', 'set_rank_permissions', { rank: 'Member', version: 0, permissions: [] }), /changed/);
  assert.throws(() => service.command('ws', m.id, 'set_rank_permissions', { rank: 'Admin', version: 0, permissions: [] }), /Only Owners/); db.close();
});

test('unconsumed approvals expire on authority changes and can be replaced without reusing old decisions', () => {
  const { db, service, add, clock } = fixture();
  const action = { permission: 'projects.delete', action: 'archive', target_id: 'project', payload: { archived: true } };
  const approved = service.requestProtectedAction('ws', 'local-owner', action);
  service.command('ws', 'local-owner', 'decide_approval', { approval_id: approved.id, decision: 'approve' });
  const second = add('Second Owner'); const promotion = service.command('ws', 'local-owner', 'request_owner', { member_id: second.id });
  service.command('ws', 'local-owner', 'decide_approval', { approval_id: promotion.id, decision: 'approve' });
  assert.equal(service.isApprovalCurrent('ws', approved), false);
  service.expireStaleApprovals('ws'); assert.equal(service.snapshot('ws', second.id).approvals.find(a => a.id === approved.id).status, 'expired');
  const fresh = service.requestProtectedAction('ws', 'local-owner', action); assert.notEqual(fresh.id, approved.id);
  assert.deepEqual(fresh.votes, {});
  clock('2026-10-01T12:00:00.000Z'); service.expireStaleApprovals('ws');
  assert.equal(db.prepare('SELECT status FROM governance_approvals WHERE id=?').get(fresh.id).status, 'expired'); db.close();
});

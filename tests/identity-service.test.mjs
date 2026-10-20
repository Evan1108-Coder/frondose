import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createIdentityService } from '../server/identity-service.mjs';
import { createGovernanceService } from '../server/governance-service.mjs';

test('account setup replaces implicit local authority; cookies are opaque, expiring and revocable', async () => {
  const db = new DatabaseSync(':memory:');
  let time = 1000000;
  const identity = createIdentityService({ db, now: () => time });
  const owner = identity.resolve({ headers: {} });
  assert.equal(owner.id, 'local-owner');
  const session = await identity.setup({ email: 'owner@example.com', name: 'Owner', password: 'correct long password' }, owner);
  assert.equal(identity.resolve({ headers: {} }), null);
  const req = { headers: { cookie: `frondose_session=${session.token}` } };
  const actor = identity.resolve(req);
  assert.equal(actor.id, 'local-owner');
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM identity_sessions').all()).includes(session.token));
  assert.match(identity.cookie(session.token), /HttpOnly; SameSite=Lax/);
  await assert.rejects(identity.login({ email: 'owner@example.com', password: 'bad' }), /incorrect/);
  identity.revoke(actor, actor.session_id);
  assert.equal(identity.resolve(req), null);
  const next = await identity.login({ email: 'owner@example.com', password: 'correct long password' });
  time += 8 * 86400000;
  assert.equal(identity.resolve({ headers: { cookie: `frondose_session=${next.token}` } }), null);
  await assert.rejects(identity.setup({ email: 'x@y.com', password: 'another password' }, owner), /already complete/);
  db.close();
});

test('invitation activation is single-use and binds identity to its invited member', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY); INSERT INTO workspaces VALUES('ws');");
  const governance = createGovernanceService({ db }); governance.bootstrap('ws');
  const member = governance.command('ws', 'local-owner', 'create_member', { name: 'Member', email: 'member@example.com' });
  const identity = createIdentityService({ db });
  await identity.setup({ email: 'owner@example.com', password: 'owner long password' }, { id: 'local-owner' });
  const invite = identity.invite({ user_id: member.id, email: 'member@example.com', name: 'Member', workspace_id: 'ws' }, { id: 'local-owner' });
  const result = await identity.accept({ token: invite.invitation_token, password: 'member long password', user_id: 'local-owner' });
  assert.equal(result.user.id, member.id);
  assert.equal(result.user.email, 'member@example.com');
  await assert.rejects(identity.accept({ token: invite.invitation_token, password: 'member long password' }), /invalid or expired/);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM identity_invites').all()).includes(invite.invitation_token));
  for (let i = 0; i < 8; i++) await assert.rejects(identity.login({ email: 'member@example.com', password: 'bad' }), /incorrect/);
  await assert.rejects(identity.login({ email: 'member@example.com', password: 'member long password' }), /Too many/);
  db.close();
});

test('reissued and stale invitations cannot activate removed members or changed authority', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY); INSERT INTO workspaces VALUES('ws');");
  const governance = createGovernanceService({ db }); governance.bootstrap('ws');
  const identity = createIdentityService({ db });
  await identity.setup({ email: 'owner@example.com', password: 'owner long password' }, { id: 'local-owner' });
  const admin = governance.command('ws', 'local-owner', 'create_member', { name: 'Admin', email: 'admin@example.com', rank: 'Admin' });
  const member = governance.command('ws', 'local-owner', 'create_member', { name: 'Member', email: 'member@example.com' });
  const input = { user_id: member.id, email: member.email, name: member.name, workspace_id: 'ws' };
  const first = identity.invite(input, { id: admin.id });
  const next = identity.invite(input, { id: admin.id });
  await assert.rejects(identity.accept({ token: first.invitation_token, password: 'member long password' }), /invalid or expired/);
  governance.command('ws', 'local-owner', 'set_rank', { member_id: admin.id, rank: 'Member', version: 1 });
  await assert.rejects(identity.accept({ token: next.invitation_token, password: 'member long password' }), /active membership/);
  const final = identity.invite(input, { id: 'local-owner' });
  governance.command('ws', 'local-owner', 'remove_member', { member_id: member.id, version: 1 });
  await assert.rejects(identity.accept({ token: final.invitation_token, password: 'member long password' }), /active membership/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM identity_users WHERE id=?').get(member.id).n, 0); db.close();
});

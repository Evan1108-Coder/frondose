// Legacy account behavior is a test fixture for permission regressions only.
// This module is never loaded by the app, local server, or browser bundle.
import { createLocalApi as createApi } from '../../server/local-api.mjs';
import { validationError } from '../../server/validation.mjs';
import { createIdentityService } from './legacy-identity.mjs';
import { createDeploymentPolicy } from './legacy-deployment.mjs';

async function identityRequest({ req, res, path, db, actor, identity, deployment, product, governance, readBody, send, fail }) {
  if (path === '/identity' && req.method === 'GET') return send(res, 200, { result: { configured: identity.configured(), product: product.descriptor, user: actor && { id: actor.id, name: actor.name, email: actor.email, mode: actor.mode } } });
  if (path.startsWith('/identity/')) {
    const body = req.method === 'GET' ? {} : await readBody(req);
    if (['/identity/setup', '/identity/login', '/identity/accept'].includes(path) && req.method === 'POST') {
      const result = path.endsWith('/setup') ? await identity.setup(body, actor) : path.endsWith('/login') ? await identity.login(body) : await identity.accept(body);
      return send(res, 200, { result: { user: result.user } }, { 'Set-Cookie': identity.cookie(result.token, deployment.hosted) });
    }
    if (!actor) return fail(res, 401, 'sign_in_required', 'Sign in to continue.');
    if (path === '/identity/sessions' && req.method === 'GET') return send(res, 200, { result: identity.sessions(actor) });
    if (path === '/identity/logout' && req.method === 'POST') { identity.revoke(actor, actor.session_id || ''); return send(res, 200, { result: { signed_out: true } }, { 'Set-Cookie': identity.cookie('', deployment.hosted) }); }
    if (path === '/identity/revoke' && req.method === 'POST') { identity.revoke(actor, body.session_id); return send(res, 200, { result: { revoked: true } }); }
    if (path === '/identity/invite' && req.method === 'POST') {
      governance.authorize(body.workspace_id, actor.id, 'members.manage');
      const target = db.prepare("SELECT * FROM governance_members WHERE workspace_id=? AND id=? AND status='active'").get(body.workspace_id, body.member_id);
      if (!target || !target.email) throw validationError('Choose an active member with an email address.');
      const ranks = { Owner: 100, Admin: 80, Manager: 50, Member: 10 };
      const issuer = db.prepare('SELECT * FROM governance_members WHERE workspace_id=? AND id=?').get(body.workspace_id, actor.id);
      if (ranks[issuer.rank] <= ranks[target.rank]) return fail(res, 403, 'access_denied', 'Invitations can only be issued for lower-ranked members.');
      return send(res, 201, { result: identity.invite({ workspace_id: body.workspace_id, user_id: target.id, name: target.name, email: target.email }, actor) });
    }
    return fail(res, 404, 'not_found', 'Identity action not found.');
  }
  return fail(res, 404, 'not_found', 'Identity action not found.');
}

function scheduleActor(db, identity, id, localOwner) {
  const user = db.prepare('SELECT id,name FROM identity_users WHERE id=?').get(id);
  if (user) return { ...user, mode: 'account' };
  return id === 'local-owner' && !identity.configured() ? localOwner() : null;
}

export function createLocalApi(options) {
  return createApi({ ...options, testSupport: { createIdentityService, createDeploymentPolicy, identityRequest, scheduleActor } });
}

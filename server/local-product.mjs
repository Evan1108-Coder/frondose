const fail = message => Object.assign(new Error(message), { statusCode: 403, code: 'local_only_product' });
export function createLocalProductPolicy({ mode = 'compatible', hosted = false } = {}) {
  if (!['local', 'compatible'].includes(mode)) throw new Error('Unknown Frondose product mode.');
  const local = mode === 'local';
  if (local && hosted) throw new Error('This Frondose edition is local-only. Public hosting is not enabled.');
  const descriptor = Object.freeze({ edition: local ? 'local' : 'compatible', singleOwner: local,
    storage: 'this-computer', offlineInference: false, members: !local, cloudSync: false });
  function checkPath(path, method) {
    if (!local) return;
    if (['/identity/invite', '/identity/accept'].includes(path)
      || /^\/team[_-]members(?:\/|$)/.test(path)
      || path === '/governance' && method !== 'GET') throw fail('Members, invitations and role administration are unavailable in the local edition. Existing records are preserved.');
  }
  function checkOwner(actor) {
    if (local && actor && actor.id !== 'local-owner') throw fail('This installation is for its local owner only.');
  }
  function checkRunnerSettings(input) {
    if (local && (input.usage_scope && input.usage_scope !== 'private' || input.usage_member_ids?.length)) throw fail('Local agents belong to you; workspace-member sharing is unavailable.');
  }
  return { local, descriptor, checkPath, checkOwner, checkRunnerSettings };
}

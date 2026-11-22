import { frondoseEnvironment } from './brand-config.mjs';

const localPeers = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function createDeploymentPolicy(env = {}) {
  const mode = frondoseEnvironment(env).FRONDOSE_DEPLOYMENT_MODE || 'local';
  if (mode !== 'local') throw new Error('Frondose is local-only; hosted account deployments are not supported.');
  return {
    hosted: false,
    origin: null,
    checkRequest(req) {
      const peer = req.socket?.remoteAddress;
      if (peer && !localPeers.has(peer)) {
        throw Object.assign(new Error('Frondose only accepts connections from this computer.'), { statusCode: 403, code: 'non_local_peer' });
      }
    },
  };
}

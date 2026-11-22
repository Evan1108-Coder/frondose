'use strict';
const { releaseConfiguration } = require('./update-service.cjs');
const { verificationKey } = require('./release-signature.cjs');

function releaseBuild(env, platform, args = []) {
  if (env.FRONDOSE_RELEASE_BUILD !== '1') return null;
  if (args.includes('--dir')) throw Error('A release build must produce an installer and update metadata.');
  const config = releaseConfiguration({
    feedUrl: env.FRONDOSE_RELEASE_FEED_URL,
    downloadsUrl: env.FRONDOSE_RELEASE_DOWNLOADS_URL,
    macTeamId: env.FRONDOSE_RELEASE_MAC_TEAM_ID,
    windowsPublisherName: env.FRONDOSE_RELEASE_WINDOWS_PUBLISHER,
  });
  if (!config.feedUrl || !config.downloadsUrl) throw Error('Supply both public HTTPS release and download URLs.');
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(env.FRONDOSE_DESKTOP_BUILD_VERSION || '') || env.FRONDOSE_DESKTOP_BUILD_VERSION === '0.0.0') throw Error('Supply a nonzero stable release version.');
  if (platform === 'darwin' && (!config.macTeamId || !env.CSC_LINK || !env.CSC_KEY_PASSWORD ||
      !env.APPLE_API_KEY || !env.APPLE_API_KEY_ID || !env.APPLE_API_ISSUER)) {
    throw Error('macOS release requires Developer ID signing and Apple notarization credentials.');
  }
  if (platform === 'win32' && (!config.windowsPublisherName || !windowsSigning(env, config) ||
      !env.AZURE_TENANT_ID || !env.AZURE_CLIENT_ID || !env.AZURE_CLIENT_SECRET)) {
    throw Error('Windows release requires the expected publisher and Artifact Signing credentials.');
  }
  if (platform === 'linux') {
    verificationKey(env.FRONDOSE_RELEASE_LINUX_PUBLIC_KEY);
    config.linuxUpdatePublicKey = env.FRONDOSE_RELEASE_LINUX_PUBLIC_KEY;
  }
  return config;
}

function windowsSigning(env, config) {
  const values = [env.FRONDOSE_WIN_SIGN_ENDPOINT, env.FRONDOSE_WIN_SIGN_ACCOUNT, env.FRONDOSE_WIN_SIGN_PROFILE];
  if (!values.every(Boolean)) return null;
  const [endpoint, codeSigningAccountName, certificateProfileName] = values;
  if (!/^https:\/\/[a-z0-9.-]+\/?$/i.test(endpoint) || !/^[\w-]{3,128}$/.test(codeSigningAccountName) ||
      !/^[\w-]{3,128}$/.test(certificateProfileName)) throw Error('Invalid Windows Artifact Signing configuration.');
  return { endpoint, codeSigningAccountName, certificateProfileName, publisherName: config.windowsPublisherName };
}

module.exports = { releaseBuild, windowsSigning };

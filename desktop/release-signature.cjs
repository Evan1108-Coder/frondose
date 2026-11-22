'use strict';
const { createPrivateKey, createPublicKey, sign, verify } = require('node:crypto');

const publicPattern = /^[A-Za-z0-9+/]{59}=$/;
const digestPattern = /^[A-Za-z0-9+/]{86}==$/;
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function verificationKey(value) {
  if (typeof value !== 'string' || !publicPattern.test(value)) throw Error('An Ed25519 release verification key is required.');
  const der = Buffer.from(value, 'base64');
  if (der.toString('base64') !== value || der.length !== 44) throw Error('Invalid Ed25519 release verification key.');
  const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ed25519') throw Error('The release verification key is not Ed25519.');
  return key;
}
function signaturePayload(info, target) {
  if (target !== 'linux-x64' || typeof info?.version !== 'string' || info.version.length > 60 || !stable.test(info.version)
      || info.version === '0.0.0' || info.stagingPercentage != null || info.packages != null
      || !Array.isArray(info.files) || info.files.length !== 1) throw Error('Invalid Linux release metadata.');
  const [file] = info.files;
  if (typeof file?.url !== 'string' || !/^Frondose[-_ .A-Za-z0-9]{1,150}\.AppImage$/.test(file.url)
      || !file.url.includes('-' + info.version + '.') && !file.url.includes('-' + info.version + '-')
      || !Number.isSafeInteger(file.size) || file.size < 1 || typeof file.sha512 !== 'string' || !digestPattern.test(file.sha512)
      || file.sha2 != null || info.sha2 != null || (info.path != null || info.sha512 != null) && (info.path !== file.url || info.sha512 !== file.sha512)) throw Error('Invalid Linux release artifact metadata.');
  return Buffer.from(JSON.stringify(['frondose-stable-update-v1', target, info.version, file.url, file.size, file.sha512]));
}
function signLinuxRelease(info, { privateKey, publicKey }) {
  if (typeof privateKey !== 'string' || !/^[A-Za-z0-9+/]{64}$/.test(privateKey)) throw Error('An Ed25519 release signing key is required.');
  const key = createPrivateKey({ key: Buffer.from(privateKey, 'base64'), format: 'der', type: 'pkcs8' });
  const expected = verificationKey(publicKey);
  if (key.asymmetricKeyType !== 'ed25519' || !createPublicKey(key).equals(expected)) throw Error('Linux signing and verification keys do not match.');
  return { ...info, frondoseSignature: sign(null, signaturePayload(info, 'linux-x64'), key).toString('base64') };
}
function verifyLinuxRelease(info, key) {
  try {
    const signature = info?.frondoseSignature;
    return typeof signature === 'string' && digestPattern.test(signature)
      && verify(null, signaturePayload(info, 'linux-x64'), key, Buffer.from(signature, 'base64'));
  } catch { return false; }
}
module.exports = { signLinuxRelease, verificationKey, verifyLinuxRelease };

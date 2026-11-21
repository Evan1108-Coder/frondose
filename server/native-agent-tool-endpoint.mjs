import { posix } from 'node:path';

const windowsPrefix = '\\\\.\\pipe\\frondose-native-tools-';

export function windowsNativeToolEndpoint(nonce) {
  if (!/^[a-f0-9]{32}$/.test(nonce)) throw Error('Invalid native tool endpoint identity.');
  return windowsPrefix + nonce;
}

export function isNativeToolEndpoint(value, platform = process.platform) {
  if (typeof value !== 'string' || value.length > 500 || /[\0\r\n]/.test(value)) return false;
  if (platform === 'win32') return value.startsWith(windowsPrefix) && /^[a-f0-9]{32}$/.test(value.slice(windowsPrefix.length));
  return posix.isAbsolute(value) && posix.basename(value) === 'bridge.sock';
}

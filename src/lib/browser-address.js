/* Address-bar search classification adapted from stablyai/orca
 * src/shared/browser-url.ts @00de405c5c0cffea06c2beb6eb0a0038b5d53fe6.
 * Copyright (c) 2026 Lovecast Inc. MIT; third-party/orca/LICENSE.
 * Frondose deliberately keeps native navigation HTTP(S)-only. */
export function browserInputUrl(value) {
  if(typeof value!=='string')throw Error('Enter a web address or search.');
  const input=value.trim();
  if(!input||input.length>4096||/[\u0000-\u001f\u007f]/.test(input))throw Error('Enter a web address or search.');
  if(input==='about:blank')return input;
  // Never send local paths, credentials or explicit unsupported schemes to a search engine.
  if(/^(?:[A-Za-z]:[\\/]|[\\/]|\.{1,2}[\\/]|~[a-z\d_.-]*[\\/])/i.test(input))throw Error('Open local files from the file explorer.');
  const hostPort=/^(?:\[[a-f\d:.]+\]|[a-z\d_.-]+):\d+(?:[/?#]|$)/i.test(input);
  if(!hostPort&&/^[A-Za-z][A-Za-z\d+.-]*:/.test(input))return browserAddressUrl(input);
  if(!/\s/.test(input)&&(/^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[[a-f\d:]+\])(?:[/?#:]|$)/i.test(input)||input.includes('.')||hostPort))return browserAddressUrl(input);
  if(input.includes('@'))throw Error('Use an address without embedded credentials.');
  return 'https://www.google.com/search?q='+encodeURIComponent(input.toWellFormed());
}

/** Resolve typed web addresses without interpreting localhost:port as a URL
 * scheme. Local loopback development servers default to HTTP; public names
 * default to HTTPS. Explicit protocols are never rewritten or broadened. */
export function browserAddressUrl(value) {
  const trimmed = value.trim();
  if (trimmed === 'about:blank') return trimmed;
  if (!trimmed || /[\u0000-\u0020\u007f]/.test(trimmed)) throw Error('Enter a web address.');
  const hostWithPort = /^(?:\[[a-f\d:.]+\]|[a-z\d_.-]+):\d+(?:[/?#]|$)/i.test(trimmed);
  const explicit = !hostWithPort && /^[A-Za-z][A-Za-z\d+.-]*:/.test(trimmed);
  const url = new URL(explicit ? trimmed : `https://${trimmed}`);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('Use an HTTP or HTTPS address without an embedded password.');
  if (!explicit && (url.hostname.toLowerCase() === 'localhost' || /^127\./.test(url.hostname) || url.hostname === '[::1]')) url.protocol = 'http:';
  return url.href;
}

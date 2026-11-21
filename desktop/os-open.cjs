'use strict';
const { open, lstat } = require('node:fs/promises');
const { constants } = require('node:fs');
const { basename, extname, isAbsolute } = require('node:path');
const { fileURLToPath } = require('node:url');

const maxBytes = 512 * 1024;
const extensions = ['md', 'markdown', 'txt', 'csv', 'tsv'];
const fileFilter = Object.freeze({ name: 'Text documents', extensions });
const routes = new Map([
  ['frondose://workspace', 'workspace'],
  ['frondose://settings', 'settings'],
  ['frondose://settings/desktop', 'settings'],
  ['frondose://settings/updates', 'updates'],
]);
function osTarget(input) {
  if (typeof input !== 'string' || input.length > 8192 || /[\u0000-\u001f]/.test(input)) return null;
  const route = routes.get(input.replace(/\/$/, ''));
  if (route) return { route };
  let path = input;
  if (input.startsWith('file:')) {
    try { path = fileURLToPath(input); } catch { return null; }
  }
  if (!isAbsolute(path) || !extensions.includes(extname(path).toLowerCase().slice(1))) return null;
  return { path };
}
const escape = text => text.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);

async function documentHtml(path) {
  if (!osTarget(path)?.path) throw Error('Choose a supported Markdown, text, CSV or TSV file.');
  const info = await lstat(path);
  if (!info.isFile() || info.size > maxBytes) throw Error('Choose a regular text file up to 512 KiB.');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  let content;
  try {
    const current = await handle.stat();
    if (!current.isFile() || current.size > maxBytes || current.ino !== info.ino || current.dev !== info.dev) throw Error('The selected file changed. Open it again.');
    const buffer = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > maxBytes) throw Error('The selected file grew past the 512 KiB preview limit.');
    content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset));
    if (content.includes('\u0000')) throw Error('The selected file is not plain text.');
  } finally { await handle.close(); }
  const name = escape(basename(path));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${name} — Frondose preview</title><style>:root{color-scheme:light dark}body{font:15px system-ui;margin:0;padding:1.6rem}header{border-bottom:1px solid GrayText;padding-bottom:.85rem}h1{font-size:1.25rem;margin:0 0 .4rem;overflow-wrap:anywhere}p{margin:0;color:GrayText}pre{white-space:pre-wrap;overflow-wrap:anywhere;tab-size:4;line-height:1.6}</style></head><body><header><h1>${name}</h1><p>Read-only preview · Not added to a workspace</p></header><pre>${escape(content)}</pre></body></html>`;
}
module.exports = { osTarget, documentHtml, fileFilter, maxBytes };

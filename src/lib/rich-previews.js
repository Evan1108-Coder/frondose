const TYPES = {
  png: ['image', 'image/png'], jpg: ['image', 'image/jpeg'], jpeg: ['image', 'image/jpeg'], webp: ['image', 'image/webp'], gif: ['image', 'image/gif'], svg: ['image', 'image/svg+xml'],
  pdf: ['pdf', 'application/pdf'], html: ['html', 'text/html'], htm: ['html', 'text/html'],
  mp3: ['audio', 'audio/mpeg'], wav: ['audio', 'audio/wav'], ogg: ['audio', 'audio/ogg'], m4a: ['audio', 'audio/mp4'], flac: ['audio', 'audio/flac'],
  mp4: ['video', 'video/mp4'], webm: ['video', 'video/webm'], mov: ['video', 'video/quicktime'],
  csv: ['table', 'text/csv'], tsv: ['table', 'text/tab-separated-values'], mmd: ['mermaid', 'text/plain'], mermaid: ['mermaid', 'text/plain'], ipynb: ['notebook', 'application/json'],
};
export const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;
export function richPreviewType(path) {
  const match = TYPES[String(path || '').split('.').at(-1).toLowerCase()];
  return match ? { kind: match[0], mime: match[1] } : null;
}
/** Bounded RFC-style delimited reader; quoted multiline cells stay in one row. */
export function previewTable(text, delimiter = ',', limit = 500) {
  const rows = []; let row = [], cell = '', quoted = false, truncated = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && c === delimiter) { row.push(cell); cell = ''; if (row.length > 100) { truncated = true; break; } }
    else if (!quoted && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
      if (rows.length >= limit) { truncated = i < text.length - 1; break; }
    } else cell += c;
  }
  if (!truncated && (cell || row.length)) { row.push(cell); rows.push(row); }
  return { rows, truncated, malformed: quoted };
}
export function safePreviewHtml(source) {
  // No scripts, forms, frames, network, plugins or downloads. The iframe also
  // has an empty sandbox. Explicitly approved relative assets are future work.
  return '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; font-src \'none\'; form-action \'none\'; base-uri \'none\'">' + source;
}

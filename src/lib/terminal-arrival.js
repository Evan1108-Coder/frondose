// Only mirror complete, plain-text lines. Interactive terminal control sequences
// can repaint existing rows; xterm remains the sole source of truth for those.
export function terminalArrivals(previous, output, { initial = false } = {}) {
  if (!output) return { pending: previous || '', lines: [] };
  if (initial) return { pending: output.endsWith('\n') ? '' : null, lines: [] };
  if (/[\x00-\x09\x0b-\x0c\x0e-\x1f\x7f]/.test(output)) return { pending: '', lines: [] };
  if (previous === null) {
    const boundary = output.indexOf('\n');
    if (boundary < 0) return { pending: null, lines: [] };
    output = output.slice(boundary + 1);
  }
  const text = `${previous || ''}${output.replace(/\r\n/g, '\n')}`;
  if (text.includes('\r')) return { pending: '', lines: [] };
  const parts = text.split('\n');
  const pending = parts.pop().slice(-160);
  const lines = parts.filter(line => line.trim() && line.length <= 160).slice(-2);
  return { pending, lines };
}

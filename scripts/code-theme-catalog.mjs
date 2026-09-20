// Rebuild with: node scripts/code-theme-catalog.mjs > /tmp/rumbo-code-themes.json
// Review the output before replacing src/lib/code-themes.json.
// Palettes adapted from the pinned @shikijs/themes; never ship its full grammars.
import { readdirSync } from 'node:fs';
const hex = value => typeof value === 'string' && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value);
const rgb = color => { const h = color.slice(1); return (h.length === 3 ? [...h].map(c => c + c).join('') : h).match(/../g).map(c => parseInt(c, 16)); };
const luminance = color => rgb(color).map(c => { const v = c / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const opaque = (color, bg) => /^#[0-9a-f]{8}$/i.test(color ?? '') ? '#' + rgb(color.slice(0, 7)).map((v, i) => Math.round(v * parseInt(color.slice(7), 16) / 255 + rgb(bg)[i] * (1 - parseInt(color.slice(7), 16) / 255)).toString(16).padStart(2, '0')).join('') : color;
function readable(color, bg) {
  const channels = rgb(color), target = luminance(bg) > .18 ? 0 : 255;
  for (let amount = 0; amount <= 1; amount += .025) {
    const result = '#' + channels.map(c => Math.round(c + (target - c) * amount).toString(16).padStart(2, '0')).join('');
    if (contrast(result, bg) >= 4.5) return result;
  }
  return target ? '#ffffff' : '#000000';
}
const result = [];
for (const file of readdirSync('node_modules/@shikijs/themes/dist').filter(name => name.endsWith('.mjs') && !['index.mjs', 'aurora-x.mjs'].includes(name))) {
  const id = file.replace('.mjs', ''), theme = (await import(`@shikijs/themes/${id}`)).default;
  const base = theme.tokenColors?.find(rule => !rule.scope)?.settings ?? {};
  const bg = theme.colors?.['editor.background'] ?? base.background ?? (theme.type === 'light' ? '#ffffff' : '#111111');
  const fg = opaque(theme.colors?.['editor.foreground'] ?? base.foreground ?? (theme.type === 'light' ? '#222222' : '#eeeeee'), bg);
  if (!hex(bg) || !hex(fg)) throw new Error(`Invalid palette ${id}`);
  function token(scope) {
    let best = fg, specificity = -1;
    for (const rule of theme.tokenColors ?? []) {
      const foreground = opaque(rule.settings?.foreground, bg);
      if (!hex(foreground)) continue;
      for (const match of (Array.isArray(rule.scope) ? rule.scope : [rule.scope ?? '']).flatMap(s => s.split(','))) {
        const value = match.trim();
        if ((scope === value || scope.startsWith(value + '.')) && value.length >= specificity) { best = foreground; specificity = value.length; }
      }
    }
    return readable(best, bg);
  }
  result.push({ id, label: theme.displayName ?? id, tone: theme.type, colors: { bg, fg: readable(fg, bg), comment: token('comment'), keyword: token('keyword'), string: token('string'), number: token('constant.numeric') } });
}
console.log(JSON.stringify(result, null, 2));

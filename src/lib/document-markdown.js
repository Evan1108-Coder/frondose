import { parsePage, pageHash } from './navigation.js';
import { safeWebsiteUrl } from './service-brands.js';
import { isEmojiImage } from './custom-emojis.js';

const ROUTE_ALIASES = { teams: 'areas', 'rumbo-agent': 'frondose-agent', 'talvori-agent': 'frondose-agent', today: 'overview', conversations: 'chats', knowledge: 'library', runs: 'work' };

/** Links never inherit a browser-relative protocol or carry credentials. */
export function documentLink(value) {
  const href = String(value ?? '');
  if (!href || href.length > 8192 || /[\u0000-\u0020\u007f]/.test(href)) return null;
  if (href.startsWith('#/')) {
    const page = parsePage(href);
    const original = href.split('?')[0].replace(/^#\/([^/]+)/, (_, view) => `#/${ROUTE_ALIASES[view] || view}`).replace(/^#\/settings\/(?:talvori|rumbo)-agent$/, '#/settings/frondose-agent');
    if (pageHash(page.view, page.id).split('?')[0] !== original) return null;
    return { kind: 'internal', href, page };
  }
  // GFM footnotes use fragment-only anchors, never arbitrary page URLs.
  if (/^#[A-Za-z][\w.:-]*$/.test(href)) return { kind: 'anchor', href };
  const website = safeWebsiteUrl(href);
  return website ? { kind: 'external', href: website.href, origin: website.origin } : null;
}

/** No local-service favicon probes and no third-party favicon aggregators. */
export function websiteFavicon(value) {
  const website = safeWebsiteUrl(value);
  if (!website) return null;
  const hostname = website.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname.includes('.') || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname === '::1' || hostname.includes(':')) return null;
  if (/^\d+(?:\.\d+){3}$/.test(hostname)) return null;
  return `${website.origin}/favicon.ico`;
}

export function emojiLookup(emojis = []) {
  const byId = new Map(), byShortcode = new Map();
  for (const emoji of emojis) {
    if (!emoji || typeof emoji.id !== 'string' || !/^:[a-z0-9_-]+:$/.test(emoji.shortcode ?? '') || !isEmojiImage(emoji.glyph)) continue;
    byId.set(emoji.id, emoji);
    byShortcode.set(emoji.shortcode, emoji);
  }
  return { byId, byShortcode };
}

/** Replace only ordinary text AST nodes, never code or author-supplied HTML. */
export function remarkWorkspaceEmojis({ byShortcode = new Map() } = {}) {
  return tree => {
    const walk = parent => {
      if (!Array.isArray(parent.children)) return;
      parent.children = parent.children.flatMap(node => {
        if (node.type !== 'text') { walk(node); return [node]; }
        // Retain exact parser positions for untouched text. Replacing all text
        // nodes erased anchors even when no workspace emoji was present.
        if(!byShortcode.size||!node.value.match(/:[a-z0-9_-]+:/g)?.some(value=>byShortcode.has(value)))return [node];
        return node.value.split(/(:[a-z0-9_-]+:)/g).filter(Boolean).map(value => {
          const emoji = byShortcode.get(value);
          return emoji ? { type: 'image', url: '', alt: value, title: emoji.name, data: { hProperties: { 'data-workspace-emoji': emoji.id } } } : { type: 'text', value };
        });
      });
    };
    walk(tree);
  };
}

// This scanner only protects Markdown code; CommonMark remains the actual parser.
function outsideCode(source, transform) {
  let result = '', start = 0, index = 0;
  while (index < source.length) {
    let end = -1;
    if (index === 0 || source[index - 1] === '\n') {
      const fence = /^( {0,3})(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(source.slice(index));
      if (fence) {
        const close = new RegExp(`^ {0,3}${fence[2][0]}{${fence[2].length},}[ \\t]*(?:\\n|$)`, 'gm');
        close.lastIndex = index + fence[0].length;
        const match = close.exec(source);
        end = match ? match.index + match[0].length : source.length;
      }
    }
    if (end < 0 && source[index] === '`') {
      const ticks = /^`+/.exec(source.slice(index))[0];
      let close = source.indexOf(ticks, index + ticks.length);
      while (close >= 0 && (source[close - 1] === '`' || source[close + ticks.length] === '`')) close = source.indexOf(ticks, close + ticks.length);
      if (close >= 0) end = close + ticks.length;
    }
    if (end >= 0) {
      result += transform(source.slice(start, index)) + source.slice(index, end);
      start = index = end;
    } else index++;
  }
  return result + transform(source.slice(start));
}

/** Chat providers also emit \(…\) and \[…\]. Preserve all fenced/inline code. */
export function normalizeMathDelimiters(value) {
  const source = String(value ?? '').replaceAll('\r\n', '\n');
  return outsideCode(source, part => part
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => `\n\n$$\n${math.trim()}\n$$\n\n`)
    .replace(/\\\(([^\n]*?)\\\)/g, (_, math) => `$${math}$`));
}

export function hasMathSyntax(value) {
  const source = String(value ?? '');
  let found = false;
  outsideCode(source, part => { if (/\\[([]|\$\$|\$(?!\s|\d[\d,.]*(?:\s|$))[^$\n]+\$/.test(part)) found = true; return part; });
  return found;
}

/** Bound expansion independently of KaTeX's own macro and size limits. */
export function remarkBoundMath() {
  return tree => {
    const walk = parent => {
      for (const node of parent.children ?? []) {
        if (node.type === 'code' && node.lang === 'math') {
          // A quoted fenced block remains code even when another paragraph has math.
          node.lang = 'tex';
        } else if ((node.type === 'math' || node.type === 'inlineMath') && node.value.length > 4096) {
          node.type = node.type === 'math' ? 'code' : 'inlineCode';
          node.lang = 'tex';
          delete node.data;
        } else walk(node);
      }
    };
    walk(tree);
  };
}

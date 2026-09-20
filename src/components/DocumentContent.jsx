import { isEmojiImage } from '../lib/custom-emojis.js';
import { Fragment } from "react";
import { safeUrl } from "../lib/model.js";
import { parsePage, pageHash } from '../lib/navigation.js';
import "./document-content.css";
import { ServiceLogo } from './ServiceLogo.jsx';
import { serviceBrand } from '../lib/service-brands.js';
import { CodeViewer } from './CodeViewer.jsx';
import { ChangeReview } from './ChangeReview.jsx';
import { patchFiles } from '../lib/change-review.js';

// Deliberately small Markdown subset. React escapes all text; raw HTML and
// remote images never execute or load as a side effect of reading a document.
function Inline({ text, emojis = [] }) {
  const tokens = String(text).split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|\[[^\]\n]+\]\([^\s)]+\))/g);
  return tokens.map((token, index) => {
    if (token.startsWith("`") && token.endsWith("`")) return <code key={index}>{token.slice(1, -1)}</code>;
    if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) return <strong key={index}>{token.slice(2, -2)}</strong>;
    if (token.startsWith("*") && token.endsWith("*")) return <em key={index}>{token.slice(1, -1)}</em>;
    const link = token.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/);
    if (link?.[2].startsWith('#/')) {
      const page = parsePage(link[2]);
      const base = link[2].split('?')[0];
      if (pageHash(page.view,page.id).split('?')[0] === base) return <a key={index} href={link[2]}>{link[1]}</a>;
    }
    if (link && safeUrl(link[2])) return <a key={index} href={safeUrl(link[2])} target="_blank" rel="noreferrer noopener">{serviceBrand(null, link[2]) ? <ServiceLogo url={link[2]} className="inline-service-logo" /> : null}{link[1]}</a>;
    const parts = token.split(/(:[a-z0-9_-]+:)/g);
    return <Fragment key={index}>{parts.map((part, position) => { const emoji = emojis.find(item => item.shortcode === part); return emoji && isEmojiImage(emoji.glyph) ? <img key={position} src={emoji.glyph} alt={part} title={emoji.name} width="22" height="22" style={{ objectFit: 'contain', verticalAlign: 'middle', display: 'inline-block' }} /> : part; })}</Fragment>;
  });
}

export function DocumentContent({ content, className = "", emojis = [] }) {
  const lines = String(content ?? "").replaceAll("\r\n", "\n").split("\n");
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const key = index;
    if (!line.trim()) { index++; continue; }
    if (/^\s*```/.test(line)) {
      const language = line.trim().slice(3).trim();
      const code = [];
      index++;
      while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index++;
      const source = code.join('\n'), files = /^(diff|patch)$/i.test(language) ? patchFiles(source) : [];
      blocks.push(files.length ? <ChangeReview key={key} comparison={{ title: 'Quoted patch', base: 'Before (quoted)', head: 'After (quoted)', notice: 'Unverified patch text from this message or document, not a repository snapshot. Reading it does not apply changes.', files }} /> : <div className="document-code" key={key}>{language ? <span>{language}</span> : null}<CodeViewer content={source} label={language || 'Code block'} /></div>);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const Tag = `h${Math.min(heading[1].length + 1, 6)}`;
      blocks.push(<Tag key={key}><Inline emojis={emojis} text={heading[2]} /></Tag>);
      index++;
      continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { blocks.push(<hr key={key} />); index++; continue; }
    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={key}><Inline emojis={emojis} text={quote.join("\n")} /></blockquote>);
      continue;
    }
    const list = line.match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);
    if (list) {
      const ordered = Boolean(list[2]);
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);
        if (!item || Boolean(item[2]) !== ordered) break;
        const check = item[3].match(/^\[([ xX])\]\s+(.+)$/);
        items.push(<li key={index}>{check ? <><span className="document-task-mark" aria-label={check[1] === " " ? "Unchecked" : "Checked"}>{check[1] === " " ? "☐" : "☑"}</span><Inline emojis={emojis} text={check[2]} /></> : <Inline emojis={emojis} text={item[3]} />}</li>);
        index++;
      }
      blocks.push(ordered ? <ol key={key} start={Number(list[2])}>{items}</ol> : <ul key={key}>{items}</ul>);
      continue;
    }
    const paragraph = [line];
    index++;
    while (index < lines.length && lines[index].trim() && !/^(#{1,6}\s|>\s?|\s*```|\s*[-*+]\s|\s*\d+\.\s)/.test(lines[index])) paragraph.push(lines[index++]);
    blocks.push(<p key={key}><Inline emojis={emojis} text={paragraph.join("\n")} /></p>);
  }
  return <div className={`document-content ${className}`}>{blocks}</div>;
}

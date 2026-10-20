import { lazy, Suspense, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { documentLink, emojiLookup, hasMathSyntax, normalizeMathDelimiters, remarkWorkspaceEmojis } from '../lib/document-markdown.js';
import './document-content.css';
import { ServiceLogo } from './ServiceLogo.jsx';
import { FileText } from './icons.jsx';
import { CodeViewer } from './CodeViewer.jsx';
import { ChangeReview } from './ChangeReview.jsx';
import { patchFiles } from '../lib/change-review.js';

const MathDocument = lazy(() => import('./DocumentMath.jsx'));
const GFM_OPTIONS = { singleTilde: false };
const EMPTY_EMOJIS = Object.freeze([]);

/** Markdown URLs are stricter than browser URLs; image sources never come from text. */
export function documentUrlTransform(url, key) {
  return key === 'href' ? documentLink(url)?.href : undefined;
}

function QuotedCode({ node, children }) {
  const code = node?.children?.find(child => child.tagName === 'code');
  if (!code) return <pre>{children}</pre>;
  const language = code.properties?.className?.find(name => name.startsWith('language-'))?.slice(9) ?? '';
  const source = code.children?.map(child => child.value ?? '').join('').replace(/\n$/, '') ?? '';
  const files = /^(diff|patch)$/i.test(language) ? patchFiles(source) : [];
  return files.length ? <ChangeReview comparison={{ title: 'Quoted patch', base: 'Before (quoted)', head: 'After (quoted)', notice: 'Unverified patch text from this message or document, not a repository snapshot. Reading it does not apply changes.', files }} />
    : <div className="document-code">{language ? <span>{language}</span> : null}<CodeViewer content={source} label={language || 'Code block'} /></div>;
}

function InternalLink({ link, children, title, onInternalLink }) {
  const docs = ['docs', 'documents', 'reader'].includes(link.page?.view);
  return <a href={link.href} title={title} className={docs ? 'document-doc-link' : undefined} onClick={event => {
    if (!onInternalLink || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    onInternalLink(link.page, link.href);
  }}>{docs ? <FileText className="document-link-icon" interactive={false} aria-hidden="true" /> : null}{children}</a>;
}

/** CommonMark + GFM, with escaped HTML, blocked image embeds and strict links. */
export function DocumentContent({ content, className = '', emojis = EMPTY_EMOJIS, onInternalLink }) {
  const source = String(content ?? '').replaceAll('\r\n', '\n');
  const lookup = useMemo(() => emojiLookup(emojis), [emojis]);
  const remarkPlugins = useMemo(() => [[remarkGfm, GFM_OPTIONS], [remarkWorkspaceEmojis, lookup]], [lookup]);
  const components = useMemo(() => ({
    h1: ({ children }) => <h2>{children}</h2>,
    h2: ({ children }) => <h3>{children}</h3>,
    h3: ({ children }) => <h4>{children}</h4>,
    h4: ({ children }) => <h5>{children}</h5>,
    h5: ({ children }) => <h6>{children}</h6>,
    h6: ({ children }) => <h6>{children}</h6>,
    pre: QuotedCode,
    a: ({ href, title, children }) => {
      const link = documentLink(href);
      if (!link) return <>{children}</>;
      if (link.kind === 'internal') return <InternalLink link={link} title={title} onInternalLink={onInternalLink}>{children}</InternalLink>;
      if (link.kind === 'anchor') return <a href={link.href} title={title}>{children}</a>;
      return <a href={link.href} title={title} target="_blank" rel="noreferrer noopener"><ServiceLogo url={link.href} className="inline-service-logo" />{children}</a>;
    },
    img: ({ node, alt }) => {
      const emoji = lookup.byId.get(node?.properties?.['data-workspace-emoji']);
      return emoji ? <img className="document-custom-emoji" src={emoji.glyph} alt={emoji.shortcode} title={emoji.name} width="22" height="22" /> : <span className="document-image-placeholder">[Image{alt ? `: ${alt}` : ''}]</span>;
    },
    table: ({ children }) => <div className="document-table-scroll" role="region" aria-label="Table" tabIndex={0}><table>{children}</table></div>,
    input: ({ checked }) => <span className="document-task-mark" role="img" aria-label={checked ? 'Checked' : 'Unchecked'}>{checked ? '☑' : '☐'}</span>,
  }), [lookup, onInternalLink]);
  const props = { components, remarkPlugins, urlTransform: documentUrlTransform };
  const fallback = <Markdown {...props}>{source}</Markdown>;
  return <div className={`document-content ${className}`}>{hasMathSyntax(source) ? <Suspense fallback={fallback}><MathDocument {...props} content={normalizeMathDelimiters(source)} /></Suspense> : fallback}</div>;
}

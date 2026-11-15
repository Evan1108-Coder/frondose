import {PRODUCT_UPDATES} from '../lib/product-updates.js';
import {scrollToDocsSection} from '../lib/docs-scroll.js';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { BookOpen, Code, Search, ChevronRight, ChevronDown, ArrowLeft, ArrowRight, Copy, Menu, X, MessageCircle, Sun, Moon, FileText, Compass, Folder, GitBranch, Bot, Terminal, Settings, Users, Plug, LibraryBig, Workflow } from '../components/icons.jsx';
import { FrondoseSymbol } from '../components/Brand.jsx';
import { Button, Dialog, IconButton, SearchField, useApp } from '../ui.jsx';
import { frondoseActions } from '../data/useFrondose.js';
import { DOC_GROUPS as ALL_DOC_GROUPS, DOC_ARTICLES as ALL_DOC_ARTICLES } from '../lib/docs-content.js';
import { isLocalProduct } from '../lib/local-product.js';
import { localDocsCatalog } from '../lib/local-docs-catalog.js';
import { articleMarkdown, articleText, docsArticlesInNavigationOrder, searchDocs } from '../lib/docs-utils.js';
import { UiIcon } from '../components/icons.jsx';
import { DOC_ARTICLE_ICONS } from '../lib/docs-icons.js';
import { ConnectionPreview } from '../components/ConnectionPreview.jsx';
import { CONNECTION_PREVIEWS } from '../lib/connection-previews.js';
import { getRunnerProvider } from '../lib/runner-provider-catalog.js';
import { AgentIdentity } from '../components/AgentIdentity.jsx';
import { DocsArticleSections } from '../components/DocsArticleSections.jsx';
import { Collapse } from '../components/Collapse.jsx';
import { useInterfaceLanguage } from '../components/InterfaceLanguage.jsx';
import { formatInterfaceText, interfaceText } from '../lib/interface-language.js';
import { localizeBuiltInDoc } from '../lib/built-in-copy.js';
import './connection-platform.css';
import './docs.css';

const ARTICLE_DATES = new Map(PRODUCT_UPDATES.map(update=>[update.articleId,update.date]));
const GROUP_ICONS = { 'getting-started': Compass, workspace: Users, 'projects-routes': GitBranch, 'chats-agents': Bot, workbench: Terminal, knowledge: LibraryBig, integrations: Plug, settings: Settings, workflows: Workflow, developers: Code };
const SCREENSHOTS = new Set(['projects', 'chats', 'settings', 'teams', 'structured-templates', 'field-defaults', 'computer-connections', 'computer-agent-settings']);
function useRenderedTheme() {
  const read = () => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const [theme, setTheme] = useState(read);
  useEffect(() => { const observer = new MutationObserver(() => setTheme(read())); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); return () => observer.disconnect(); }, []);
  return theme;
}
function DocsScreenshot({ name, theme, caption, article }) {
  if (article?.connectionProvider) return <ConnectionIllustration article={article} />;
  if (!SCREENSHOTS.has(name)) return article ? <ArticleConnectionReferences article={article} /> : null;
  const wideScreenshot = ['settings', 'structured-templates', 'field-defaults', 'computer-connections', 'computer-agent-settings'].includes(name);
  return <figure className="docs-screenshot"><img src={`/docs/${name}-${theme}.png`} alt={`${caption} in Frondose, ${theme} theme`} loading="lazy" width={wideScreenshot ? 1440 : 1088} height={wideScreenshot ? 980 : 912} /><figcaption>{caption} · Example workspace</figcaption></figure>;
}
function ConnectionIllustration({ article }) {
  const previews = CONNECTION_PREVIEWS[article.connectionProvider];
  if (!previews) return null;
  const provider = { id: article.connectionProvider, name: article.title.replace(/ in Frondose$/, '') };
  return <figure className="docs-connection-illustration"><div className="cp-workflow-grid">{previews.map(preview => <ConnectionPreview key={preview.title} provider={provider} preview={preview} />)}</div><figcaption>Illustrated workflow examples · not screenshots or live account data</figcaption><div className="docs-provider-sources" aria-label="Official provider references"><span>Provider references</span>{article.sources?.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.label}<ArrowRight aria-hidden="true" /></a>)}</div></figure>;
}
function ArticleCard({ article, onOpen }) {
  return <button className="docs-card" onClick={() => onOpen(article.id)}><span className="docs-card-symbol"><ArticleIcon article={article} /></span><strong>{article.title}</strong>{ARTICLE_DATES.has(article.id)?<time className="docs-release-date" dateTime={ARTICLE_DATES.get(article.id)}>{ARTICLE_DATES.get(article.id)}</time>:null}<p>{article.description}</p><span className="docs-card-link">Read guide<ArrowRight /></span></button>;
}
function ArticleIcon({ article }) {
  return <UiIcon icon={DOC_ARTICLE_ICONS[article.id]} interactive={false} aria-hidden="true" data-doc-icon={article.id} />;
}
function ArticleConnectionReferences({ article }) {
  const runtime = getRunnerProvider(article.runnerProvider);
  return <>{runtime ? <figure className="docs-runner-flow"><ol><li><FrondoseSymbol size={24} decorative /><strong>Frondose</strong><span>Reviewed request</span></li><li><Terminal aria-hidden="true" /><strong>Your computer</strong><span>Local execution policy</span></li><li><AgentIdentity compact provider={runtime.id} /><strong>{runtime.title}</strong><span>{runtime.protocol}</span></li></ol><figcaption>Connection path · the runtime uses your computer’s OS account, not a Frondose sandbox</figcaption></figure> : null}{article.sources?.length && !article.connectionProvider ? <nav className="docs-provider-sources" aria-label="Provider setup references"><span>Provider references</span>{article.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.label}<ArrowRight aria-hidden="true" /></a>)}</nav> : null}</>;
}
export function DocsView() {
  const { data, page, navigate, closeDocs, showFeedback, perform, notify } = useApp();
  const localEdition = isLocalProduct(data);
  const language=useInterfaceLanguage();
  const t=text=>interfaceText(text,language);
  const catalog = useMemo(() => localDocsCatalog(ALL_DOC_GROUPS, ALL_DOC_ARTICLES, { meta: { product: { edition: localEdition ? 'local' : null } } }), [localEdition]);
  const { articles: DOC_ARTICLES, groups: DOC_GROUPS } = useMemo(()=>({
    articles:docsArticlesInNavigationOrder(catalog.articles,PRODUCT_UPDATES).map(article=>localizeBuiltInDoc(article,language)),
    groups:catalog.groups.map(group=>localizeBuiltInDoc(group,language)),
  }),[catalog,language]);
  const [searchOpen, setSearchOpen] = useState(false), [query, setQuery] = useState(''), [mobileNav, setMobileNav] = useState(false);
  const article = DOC_ARTICLES.find(item => item.id === page.id);
  const selectedGroup = DOC_GROUPS.find(group => `group-${group.id}` === page.id);
  const [expanded, setExpanded] = useState(() => new Set(article ? [article.group] : []));
  const [activeSection, setActiveSection] = useState(null);
  const scrollRef = useRef(null), headingRef = useRef(null), navTrigger = useRef(null), navPanel = useRef(null);
  const navigationId = useId();
  const theme = useRenderedTheme();
  const group = DOC_GROUPS.find(item => item.id === article?.group);
  const docsById=new Map(DOC_ARTICLES.map(item=>[item.id,item]));
  const resultIds=new Set([...searchDocs(DOC_ARTICLES, query),...searchDocs(catalog.articles,query)].map(item=>item.id));
  const results=[...resultIds].map(id=>docsById.get(id));
  const groupArticles = selectedGroup ? DOC_ARTICLES.filter(item => item.group === selectedGroup.id) : [];
  const featured = DOC_GROUPS.filter(g => g.id !== 'developers').slice(0,4).map(g => DOC_ARTICLES.find(a => a.group === g.id)).filter(Boolean);
  const openArticle = id => { if (mobileNav && id === page.id) navTrigger.current?.focus(); navigate('docs', id); setSearchOpen(false); setQuery(''); setMobileNav(false); };
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setActiveSection(article?.sections[0]?.id ?? null);
    if (article) setExpanded(current => new Set([...current, article.group]));
    headingRef.current?.focus({ preventScroll: true });
    document.title = `${article?.title ?? selectedGroup?.title ?? interfaceText('Home',language)} · Frondose`;
    return () => { document.title = 'Frondose'; };
  }, [page.id,language]);
  useEffect(() => {
    if (!article || !scrollRef.current) return;
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting).sort((a,b) => a.boundingClientRect.top-b.boundingClientRect.top);
      if (visible[0]) setActiveSection(visible[0].target.dataset.section);
    }, { root: scrollRef.current, rootMargin: '-10% 0px -60% 0px' });
    scrollRef.current.querySelectorAll('[data-section]').forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [article]);
  useEffect(() => {
    if (!mobileNav || searchOpen) return;
    const close = event => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault(); setMobileNav(false); navTrigger.current?.focus();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [mobileNav, searchOpen]);
  useEffect(() => {
    // Navigation is an inline disclosure on small screens, not a second modal.
    // Its content can scroll independently without covering the article/header.
    if (!mobileNav) return;
    navPanel.current?.querySelector('button')?.focus();
    const desktop = matchMedia('(min-width: 701px)');
    const resize = () => { if (desktop.matches) setMobileNav(false); };
    desktop.addEventListener('change', resize);
    return () => desktop.removeEventListener('change', resize);
  }, [mobileNav]);
  const copy = async text => { try { await navigator.clipboard.writeText(text); notify('Copied to clipboard'); } catch { notify('Clipboard unavailable. You can select and copy the article text.', 'error'); } };
  const toggleGroup = id => setExpanded(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const related = article ? (article.related ?? []).map(id => DOC_ARTICLES.find(a => a.id === id)).filter(Boolean) : [];
  const siblings = article ? DOC_ARTICLES.filter(a => a.group === article.group) : [];
  const articleIndex = siblings.findIndex(a => a.id === article?.id);
  return <div className="docs-shell" data-mobile-navigation={mobileNav ? 'open' : 'closed'}>
    <header className="docs-brand"><button onClick={() => openArticle(null)} aria-label="Frondose Docs home"><FrondoseSymbol size={26} decorative /><span>Docs</span></button><IconButton label="Search documentation" onClick={() => setSearchOpen(true)}><Search /></IconButton></header>
    <header className="docs-topbar"><button ref={navTrigger} type="button" aria-label={t(mobileNav ? 'Close documentation navigation' : 'Open documentation navigation')} className="icon-button docs-mobile-toggle" aria-controls={navigationId} aria-expanded={mobileNav} onClick={() => setMobileNav(v => !v)}>{mobileNav ? <X /> : <Menu />}</button><div className="docs-breadcrumb"><button onClick={() => openArticle(null)}>Home</button>{group || selectedGroup ? <><ChevronRight /><button onClick={() => openArticle(`group-${(group ?? selectedGroup).id}`)}>{(group ?? selectedGroup).title}</button></> : null}{article ? <><ChevronRight /><span>{article.title}</span></> : null}</div><div className="docs-top-actions"><IconButton label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => perform(() => frondoseActions.updateSettings({ appearance: { theme: theme === 'dark' ? 'light' : 'dark' } }))}><Sun morphTo={theme === 'dark' ? Sun : Moon} /></IconButton>{article ? <Button className="docs-copy" icon={Copy} onClick={() => copy(articleMarkdown(article))}>Copy page</Button> : null}<Button onClick={() => localEdition ? closeDocs ? closeDocs() : navigate('workspace') : navigate('overview')}>{localEdition ? 'Back to workspace' : 'Open app'}<ArrowRight /></Button></div></header>
    <aside id={navigationId} ref={navPanel} className={`docs-sidebar ${mobileNav ? 'is-open' : ''}`} aria-label="Documentation navigation"><nav className="docs-category-nav">{DOC_GROUPS.map(item => <div key={item.id} className="docs-nav-group"><button className={`docs-category ${group?.id === item.id || selectedGroup?.id === item.id ? 'is-active' : ''}`} aria-expanded={expanded.has(item.id)} aria-controls={`docs-group-${item.id}`} onClick={() => toggleGroup(item.id)}>{item.title}<ChevronRight morphTo={expanded.has(item.id) ? ChevronDown : undefined} /></button><Collapse open={expanded.has(item.id)} id={`docs-group-${item.id}`} className="docs-article-nav"><button onClick={() => openArticle(`group-${item.id}`)}>{formatInterfaceText('Browse {{name}}',{name:item.title},language)}</button>{DOC_ARTICLES.filter(a => a.group === item.id).map(a => <button key={a.id} aria-current={article?.id === a.id ? 'page' : undefined} onClick={() => openArticle(a.id)}>{a.title}</button>)}</Collapse></div>)}</nav><footer className="docs-sidebar-footer"><button aria-current={!article && !selectedGroup ? 'page' : undefined} onClick={() => openArticle(null)}><BookOpen />Docs</button>{DOC_GROUPS.some(item => item.id === 'developers') ? <button onClick={() => openArticle('group-developers')}><Code />Developers</button> : null}<button onClick={showFeedback}><MessageCircle />Feedback</button></footer></aside>
    <main id="main-content" ref={scrollRef} tabIndex={-1} className="docs-main">
      {article ? <div className="docs-article-layout"><article className="docs-article"><span className="docs-card-symbol"><ArticleIcon article={article} /></span><p className="docs-eyebrow">{group?.title} <span>· {Math.max(1, Math.ceil(articleText(article).split(/\s+/).length / 210))} min read</span>{ARTICLE_DATES.has(article.id)?<span> · <time dateTime={ARTICLE_DATES.get(article.id)}>{ARTICLE_DATES.get(article.id)}</time></span>:null}</p><h1 ref={headingRef} tabIndex={-1}>{article.title}</h1><p className="docs-lead">{article.description}</p><DocsScreenshot article={article} name={article.image} theme={theme} caption={article.title} /><DocsArticleSections article={article} />{article.appLink ? <Button onClick={() => navigate(article.appLink.view, article.appLink.id ?? null)}>{article.appLink.label ?? 'Open in Frondose'}<ArrowRight /></Button> : null}{related.length ? <section className="docs-related"><h2>Related guides</h2>{related.map(a => <button key={a.id} onClick={() => openArticle(a.id)}>{a.title}<ArrowRight /></button>)}</section> : null}<div className="docs-pagination">{siblings[articleIndex-1] ? <button onClick={() => openArticle(siblings[articleIndex-1].id)}><ArrowLeft /><span><small>Previous</small>{siblings[articleIndex-1].title}</span></button> : <span />}{siblings[articleIndex+1] ? <button onClick={() => openArticle(siblings[articleIndex+1].id)}><span><small>Next</small>{siblings[articleIndex+1].title}</span><ArrowRight /></button> : null}</div><div className="docs-article-feedback"><span>Something missing or unclear?</span><button onClick={showFeedback}>Leave feedback<ArrowRight /></button></div></article><aside className="docs-toc" aria-label="On this page"><strong>On this page</strong>{article.sections.map(s => <button key={s.id} aria-current={activeSection === s.id ? 'location' : undefined} onClick={event => { scrollToDocsSection(event.currentTarget.closest('.docs-article-layout')?.querySelector(`[data-section="${s.id}"]`)); setActiveSection(s.id); }}>{s.title}</button>)}</aside></div> : selectedGroup ? <div className="docs-home"><p className="docs-eyebrow">Explore Frondose</p><h1 ref={headingRef} tabIndex={-1}>{selectedGroup.title}</h1><p className="docs-lead">{selectedGroup.description}</p><div className="docs-card-grid">{groupArticles.map(a => <ArticleCard key={a.id} article={a} onOpen={openArticle} />)}</div></div> : page.id ? <div className="docs-home"><h1 ref={headingRef} tabIndex={-1}>Article not found</h1><p className="docs-lead">This documentation link no longer matches an article. Search the library or return home.</p><Button onClick={() => openArticle(null)}>Browse documentation</Button></div> : <div className="docs-home"><p className="docs-eyebrow">The Frondose handbook</p><h1 ref={headingRef} tabIndex={-1}>Frondose Docs</h1><p className="docs-lead">{localEdition ? 'Files, native terminals, and direct CLI work in your project directory. Plan outcomes and review results locally.' : 'From your first project to working with agents. Explore the tools, understand the boundaries, and find a workflow that fits.'}</p><button className="docs-home-search" onClick={() => setSearchOpen(true)}><Search /><span>Search documentation…</span><ArrowRight /></button><section><div className="docs-section-heading"><h2>Start here</h2><span>Make your first steps count</span></div><div className="docs-card-grid docs-featured">{featured.map(a => <ArticleCard key={a.id} article={a} onOpen={openArticle} />)}</div></section><section><div className="docs-section-heading"><h2>Explore the workspace</h2></div><div className="docs-topic-grid">{DOC_GROUPS.map(item => { const Icon = GROUP_ICONS[item.id] ?? Folder; return <button key={item.id} onClick={() => openArticle(`group-${item.id}`)}><Icon /><div><strong>{item.title}</strong><p>{item.description}</p></div><ArrowRight /></button>; })}</div></section><section className="docs-help-callout"><BookOpen /><div><h2>Built around how Frondose works today</h2><p>These guides explain working features and call out setup requirements and limitations. Feedback and app downloads are currently previews.</p></div><Button onClick={showFeedback}>Give feedback<ArrowRight /></Button></section></div>}
    </main>
    {searchOpen ? <Dialog title="Search Frondose Docs" subtitle="Search titles, steps, explanations, and troubleshooting." onClose={() => setSearchOpen(false)}><div className="docs-search-dialog"><SearchField value={query} onChange={setQuery} label="Search documentation articles" placeholder="What would you like to do?" /><p className="docs-search-count" role="status">{query ? `${results.length} matching articles` : 'Browse the handbook or start typing'}</p><div className="docs-search-results">{results.map(a => <button key={a.id} onClick={() => openArticle(a.id)}><ArticleIcon article={a} /><span><strong>{a.title}</strong><small>{DOC_GROUPS.find(g => g.id === a.group)?.title} · {a.description}</small></span><ArrowRight /></button>)}{!results.length ? <p>{localEdition ? 'No results. Try “files”, “terminal”, “Markdown”, or a CLI name.' : 'No results. Try a feature name such as “Routes”, “memory”, or “GitHub”.'}</p> : null}</div></div></Dialog> : null}
  </div>;
}

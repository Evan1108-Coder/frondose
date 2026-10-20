import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, FileText, RotateCcw } from '../components/icons.jsx';
import { FrondoseSymbol } from '../components/Brand.jsx';
import { DocumentContent } from '../components/DocumentContent.jsx';
import { Button, useApp } from '../ui.jsx';
import { apiRequest } from '../data/api.js';
import { parseReaderTarget, readerTarget } from '../lib/message-resources.js';
import { pageHash } from '../lib/navigation.js';
import { customEmojis } from '../lib/custom-emojis.js';
import { decodeReaderText, readableResource, readerBackPage, readerRecord, readerResourceTarget, READER_TEXT_LIMIT } from '../lib/reader-content.js';
import './reader.css';

const PAGE_NAMES = { chats: 'Conversations', teams: 'Areas', projects: 'Projects', documents: 'Documents', library: 'Knowledge', work: 'Active work', 'rumbo-agent': 'Frondose', overview: 'Today' };

async function readResource(target, workspaceId, signal) {
  const ids = readerResourceTarget(target.id);
  if (!ids) throw new Error('This document link is invalid. Return to its source and open it again.');
  const query = `?workspace_id=${encodeURIComponent(workspaceId)}&team_id=${encodeURIComponent(ids.teamId)}`;
  const base = `/api/team-resources/${encodeURIComponent(ids.resourceId)}`;
  const { result: item } = await apiRequest(base + query, { signal });
  if (item?.workspace_id !== workspaceId || item.team_id !== ids.teamId || item.archived_at || item.kind !== 'file') throw new Error('This resource is no longer available in this Area.');
  const result = { title: item.name, item, download: `${base}/content${query}`, source: { view: 'teams', id: ids.teamId, section: 'resources' } };
  if (!readableResource(item)) return { ...result, unsupported: true };
  const response = await fetch(result.download, { credentials: 'same-origin', signal });
  if (!response.ok) throw new Error('The file could not be opened. Your access may have changed. Return to the Area to check it.');
  const length = Number(response.headers.get('content-length'));
  if (length > READER_TEXT_LIMIT) throw new Error('This file is too large for the document reader. Download the original instead.');
  const stream = response.body?.getReader();
  const chunks = [];
  let size = 0;
  if (stream) {
    try {
      for (;;) {
        const { done, value } = await stream.read();
        if (done) break;
        size += value.length;
        if (size > READER_TEXT_LIMIT) { await stream.cancel(); throw new Error('This file is too large for the document reader.'); }
        chunks.push(value);
      }
    } finally { stream.releaseLock(); }
  } else {
    const value = new Uint8Array(await response.arrayBuffer());
    size = value.length; chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const text = decodeReaderText(bytes);
  return { ...result, content: text, plain: /\.txt$/i.test(item.file_name) };
}

async function loadReader(target, workspaceId, signal) {
  if (!target) throw new Error('This document link is invalid. Return to its source and open it again.');
  if (target.kind === 'guide') {
    const [{ DOC_ARTICLES }, { articleMarkdown }] = await Promise.all([import('../lib/docs-content.js'), import('../lib/docs-utils.js')]);
    const article = DOC_ARTICLES.find(item => item.id === target.id);
    if (!article) throw new Error('This guide was not found. Browse Frondose Docs for the current articles.');
    return { title: article.title, content: articleMarkdown(article).replace(/^# [^\n]*\n\n/, ''), source: { view: 'docs', id: article.id } };
  }
  if (target.kind === 'resource') return readResource(target, workspaceId, signal);
  const { result } = await apiRequest('/api/bootstrap', { signal });
  const record = readerRecord(result, workspaceId, target);
  if (!record) throw new Error('This document is unavailable. It may have moved, been archived, or no longer be shared with you.');
  return record;
}

export function Reader() {
  const { page, workspace, navigate, data } = useApp();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ key: '', loading: true });
  const heading = useRef(null);
  const scroll = useRef(null);
  const key = `${workspace.id}:${page.id}`;
  const back = readerBackPage(page.returnTo);
  const backLabel = PAGE_NAMES[back.view] || 'workspace';
  const current = state.key === key ? state : { loading: true };

  useEffect(() => {
    const controller = new AbortController();
    setState({ key, loading: true });
    loadReader(parseReaderTarget(page.id), workspace.id, controller.signal).then(record => {
      if (!controller.signal.aborted) setState({ key, loading: false, record });
    }).catch(error => { if (!controller.signal.aborted) setState({ key, loading: false, error }); });
    return () => controller.abort();
  }, [key, page.id, workspace.id, attempt]);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') setAttempt(value => value + 1); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);

  useEffect(() => {
    scroll.current?.scrollTo({ top: 0 });
  }, [key]);

  useEffect(() => {
    if (current.loading) return;
    document.title = `${current.record?.title || 'Document unavailable'} · Frondose`;
    heading.current?.focus({ preventScroll: true });
    return () => { document.title = 'Frondose'; };
  }, [current.loading, current.record?.title]);

  function internalLink(next) {
    const target = readerTarget(next.view, next.id);
    if (target) navigate('reader', target, { returnTo: page.returnTo || pageHash(back.view, back.id, back) });
    else navigate(next.view, next.id, next);
  }

  return <div className="reader-shell">
    <header className="reader-topbar">
      <button className="reader-back" type="button" onClick={() => navigate(back.view, back.id, back)}><ArrowLeft aria-hidden="true" /><span>Back to {backLabel}</span></button>
      <nav className="reader-breadcrumb" aria-label="Breadcrumb"><button type="button" onClick={() => navigate('overview')}><FrondoseSymbol size={22} decorative /><span>{workspace.name}</span></button><span aria-hidden="true">/</span><strong aria-current="page">Docs</strong></nav>
    </header>
    <main id="main-content" className="reader-scroll" tabIndex={-1} ref={scroll}>
      <article className="reader-document">
        {current.loading ? <p role="status" className="reader-loading">Opening document…</p> : current.error ? <div className="reader-unavailable" role="alert"><h1 ref={heading} tabIndex={-1}>Document unavailable</h1><p>{current.error.message}</p><Button icon={RotateCcw} onClick={() => setAttempt(value => value + 1)}>Try again</Button></div> : <>
          <div className="reader-document-heading"><FileText aria-hidden="true" /><h1 ref={heading} tabIndex={-1}>{current.record.title || 'Untitled document'}</h1></div>
          {current.record.version ? <p className="reader-version">Version {current.record.version}</p> : null}
          {current.record.unsupported ? <div className="reader-unavailable"><p>This file does not have a document preview. Download the original to open it in an appropriate app.</p><p>Frondose can read UTF-8 .txt and Markdown files up to 512 KB here.</p></div> : current.record.plain ? <div className="reader-plain">{current.record.content}</div> : <DocumentContent content={current.record.content} emojis={customEmojis(data.workspace_items, workspace.id, true)} onInternalLink={internalLink} />}
          <footer className="reader-document-footer"><Button icon={ArrowRight} onClick={() => navigate(current.record.source.view, current.record.source.id, current.record.source)}>Open {current.record.source.view === 'docs' ? 'in handbook' : current.record.source.view === 'teams' ? 'Area resources' : 'original'}</Button>{current.record.download ? <a className="button" href={current.record.download} download={current.record.item.file_name}><Download aria-hidden="true" />Download original</a> : null}</footer>
        </>}
      </article>
    </main>
  </div>;
}

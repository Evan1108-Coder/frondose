import { useEffect, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { Button, useApp } from '../ui.jsx';
import { FileText, Code, ChevronRight, ExternalLink } from './icons.jsx';
import { ServiceLogo } from './ServiceLogo.jsx';
import { messageLinks, recordedOutputs, runReviewRevision } from '../lib/message-resources.js';
import { pageHash } from '../lib/navigation.js';
import { val } from '../lib/model.js';

export function MessageResources({ message, run }) {
  const { data, page, navigate } = useApp();
  const resources = [...recordedOutputs(data, run?.id), ...messageLinks(message.content)];
  const seen = new Set();
  const unique = resources.filter(item => { const key = item.target || item.href; if (seen.has(key)) return false; seen.add(key); return true; });
  const returnTo = pageHash(page.view, page.id, page);
  return <>{unique.length ? <div className="chat-message-resources" aria-label="Message resources">{unique.map(item => item.kind === 'document' ? <button key={item.target} onClick={() => navigate('reader', item.target, { returnTo })}><FileText /><span>{item.title}</span><ChevronRight /></button> : <a className="chat-website-result" key={item.href} href={item.href} target="_blank" rel="noopener noreferrer"><ServiceLogo url={item.href} name={new URL(item.href).hostname} /><span><strong>{item.title}</strong><small>{new URL(item.href).hostname}</small></span><ExternalLink /></a>)}</div> : null}{run?.status === 'completed' && val(run,'project_id') ? <RunChangeSummary run={run} /> : null}</>;
}

/** Only immutable server-observed comparisons, never model-claimed edit counts. */
function RunChangeSummary({ run }) {
  const { data, navigate } = useApp();
  const [review, setReview] = useState(null);
  const [detail, setDetail] = useState(null), [expanded, setExpanded] = useState(false), [error, setError] = useState(null);
  const publicHost = data.meta?.deploymentMode === 'public';
  const captureRevision = runReviewRevision(data.events,run.id);
  useEffect(() => {
    if (publicHost) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ workspace_id:val(run,'workspace_id'),target_type:'run',target_id:run.id });
    setReview(null); setDetail(null); setError(null); setExpanded(false);
    apiRequest(`/api/change-reviews?${query}`, { signal:controller.signal }).then(response => {
      const rows = response.result?.reviews || response.result || response.reviews || [];
      if (!controller.signal.aborted) setReview(Array.isArray(rows) ? rows.find(item => item.source === 'run' && item.files > 0) || null : null);
    }).catch(() => { /* A comparison is optional; unavailable evidence is not an edit claim. */ });
    return () => controller.abort();
  }, [run.id, run.status, publicHost, captureRevision]);
  useEffect(() => {
    if (!expanded || !review) return;
    const controller = new AbortController();
    setDetail(null); setError(null);
    apiRequest(`/api/change-reviews/${encodeURIComponent(review.id)}`, { signal:controller.signal }).then(response => { if (!controller.signal.aborted) setDetail(response.result); }).catch(problem => { if (!controller.signal.aborted) setError(problem); });
    return () => controller.abort();
  }, [expanded, review?.id]);
  if (!review) return null;
  const files = detail?.comparison?.files || [];
  const totals = files.reduce((sum,file) => { for (const line of String(file.patch || '').split('\n')) { if (line.startsWith('+') && !line.startsWith('+++')) sum.added++; if (line.startsWith('-') && !line.startsWith('---')) sum.removed++; } return sum; }, { added:0, removed:0 });
  return <section className="chat-change-result" aria-label="Observed code changes"><header><Code /><div><strong>{review.files} {review.files === 1 ? 'file' : 'files'} changed</strong><small>Observed during this run{detail ? <> · <span className="change-added">+{totals.added}</span> <span className="change-removed">−{totals.removed}</span> in captured patches</> : null}</small></div><Button onClick={() => navigate('workbench', val(run,'project_id'), { projectId:val(run,'project_id'), reviewId:review.id })}>View changes</Button></header><button className="chat-change-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide files' : 'Show changed files'}<ChevronRight /></button>{expanded ? <div>{error ? <p role="alert">{error.message}</p> : !detail ? <p role="status">Loading captured comparison…</p> : <><ul>{files.slice(0,20).map(file => <li key={file.path}><code>{file.path}</code><span>{file.status}</span></li>)}</ul>{files.length > 20 ? <p>{files.length-20} more files in Workbench</p> : null}<p>{detail.comparison?.notice || 'Concurrent edits may be included. Open the comparison before restoring anything.'}</p></>}</div> : null}</section>;
}

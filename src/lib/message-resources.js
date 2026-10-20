import { parsePage, pageHash } from './navigation.js';
import { safeUrl, val } from './model.js';

export function readerTarget(view,id) {
  const kind = { documents:'document', docs:'guide', library:'output' }[view];
  return kind && typeof id === 'string' && id && id.length <= 480 && !/[\/\\\u0000-\u001f\u007f]/.test(id) ? `${kind}:${id}` : null;
}
export function parseReaderTarget(value) {
  const match = /^(document|guide|output|resource):([^\/\\\u0000-\u001f\u007f]{1,480})$/.exec(value || '');
  return match ? {kind:match[1],id:match[2]} : null;
}
export function messageLinks(content) {
  const result = [], seen = new Set();
  for (const match of String(content || '').slice(0,100000).matchAll(/\[([^\]\n]{1,200})\]\(([^\s)]+)\)/g)) {
    const [,title,href]=match;
    if (seen.has(href)) continue;
    if (href.startsWith('#/')) {
      const page=parsePage(href), target=readerTarget(page.view,page.id);
      if (!target || pageHash(page.view,page.id,page)!==href) continue;
      result.push({kind:'document',title,href,target});
    } else { const url=safeUrl(href); if (!url || !/^https?:\/\//i.test(url)) continue; result.push({kind:'website',title,href:url}); }
    seen.add(href); if(result.length>=8) break;
  }
  return result;
}
export function recordedOutputs(data,runId) {
  if (!runId) return [];
  return (data.outputs || []).filter(item=>!val(item,'archived_at') && val(item,'run_id')===runId).slice(0,8).map(item=>({kind:'document',title:item.title,href:pageHash('library',item.id),target:readerTarget('library',item.id),id:item.id}));
}

export function runReviewRevision(events, runId) {
  return (events || []).findLast(event=>val(event,'run_id')===runId && ['review.captured','review.unavailable'].includes(event.type))?.id || '';
}

import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../ui.jsx';
import { apiRequest } from '../../data/api.js';
import { directoryApiPath } from '../../lib/directory-drafts.js';
import { fileCommentsApiPath, fileCommentSidebarItems } from '../../lib/file-comments.js';
import { beginContextDrag, endWorkspaceContextDrag } from '../../lib/workspace-context-drop.js';
import { FileCommentsPage } from './FileComments.jsx';
import './workspace-comments.css';

export function WorkspaceCommentsView() {
  const { workspace, page, navigate } = useApp();
  return <FileCommentsPage key={workspace.id} workspaceId={workspace.id} threadId={page.id} onOpenThread={id => navigate('comments', id)} onOpenFile={(path, line, rootVersion) => window.dispatchEvent(new CustomEvent('frondose:open-comment-file', { detail: { workspaceId: workspace.id, path, rootVersion } }))} />;
}

export function FileCommentsSidebar({ workspaceId, selectedId, onOpen, onRootVersion }) {
  const [items, setItems] = useState([]), [more, setMore] = useState(false);
  const callbacks = useRef({ onRootVersion }); callbacks.current = { onRootVersion };
  useEffect(() => {
    let controller;
    const read = async event => {
      if (event?.detail?.workspaceId && event.detail.workspaceId !== workspaceId) return;
      controller?.abort(); const request = new AbortController(); controller = request;
      setItems([]); callbacks.current.onRootVersion?.(null);
      try {
        const { result: directory } = await apiRequest(directoryApiPath(workspaceId), { signal: request.signal });
        if (!directory.ready || request.signal.aborted) return;
        const version = directory.binding.version;
        const { result } = await apiRequest(fileCommentsApiPath(workspaceId, '', { expected_binding_version: version }), { signal: request.signal });
        if (request.signal.aborted) return;
        setItems(fileCommentSidebarItems(result.threads, version)); callbacks.current.onRootVersion?.(version);
      } catch { if (!request.signal.aborted) { setItems([]); callbacks.current.onRootVersion?.(null); } }
    };
    read(); const events = ['frondose:file-comments-changed', 'frondose:repository-connected', 'frondose:directory-changed'];
    events.forEach(name => window.addEventListener(name, read));
    return () => { controller?.abort(); events.forEach(name => window.removeEventListener(name, read)); };
  }, [workspaceId]);
  return items.length ? <div className="sidebar-comment-threads" aria-label="Comment discussions">{items.slice(0, more ? 50 : 8).map(item => <button key={item.id} type="button" className={`sidebar-comment-thread ${selectedId === item.id ? 'active' : ''}`} aria-current={selectedId === item.id ? 'page' : undefined} draggable title={`${item.path} · ${item.title}`} onDragStart={event => { if (!beginContextDrag(event.dataTransfer, workspaceId, item.context)) event.preventDefault(); }} onDragEnd={endWorkspaceContextDrag} onClick={() => onOpen(item.id)}><i aria-hidden="true">{item.resolved ? '✓' : '·'}</i><span>{item.title}</span></button>)}{items.length > 8 ? <button type="button" className="sidebar-comment-more" onClick={() => setMore(value => !value)}>{more ? 'Show less' : 'More comments'}</button> : null}</div> : null;
}

import { lazy, Suspense, useState } from 'react';
import { Button, Empty, PageHeader, SearchField, useApp } from '../ui.jsx';
import { ArrowLeft, ArrowRight, Copy, Download, FileText, Pencil, Plus } from '../components/icons.jsx';
import { DocumentContent } from '../components/DocumentContent.jsx';
import { ReviewPanel } from '../components/ReviewPanel.jsx';
import { TalvoriAgentEntryButton } from '../components/TalvoriAgentEntry.jsx';
import { RouteRows } from './Projects.jsx';
import { featureItems, matchingRoutes, pretty } from '../lib/settings-catalog.js';
import { documentFilename } from '../lib/workspace-spaces.js';
import { download, relative, visible } from '../lib/model.js';
import { pageHash } from '../lib/navigation.js';
import './workspace-spaces.css';
import './settings/settings-center.css';
const ResourcePage = lazy(() => import('./settings/ResourcePage.jsx').then(m => ({ default: m.ResourcePage })));
const ResourceEditor = lazy(() => import('./settings/ResourcePage.jsx').then(m => ({ default: m.ResourceEditor })));
const ActivityFeed = lazy(() => import('../components/ActivityFeed.jsx').then(module => ({ default: module.ActivityFeed })));

export function DocumentsView() {
  const { data, page, navigate, edit, perform } = useApp();
  const [query, setQuery] = useState('');
  const document = visible(data.documents).find(row => row.id === page.id && (!page.projectId || row.project_id === page.projectId));
  const copy = () => perform(() => navigator.clipboard.writeText(`${location.origin}/${pageHash('documents', document.id)}`), 'Document link copied');
  if (page.id && !document) return <main className="page"><Empty kind="documents" title="Document unavailable" description="It may be archived or belong to another workspace. Your content has not been changed." action="All documents" onAction={() => navigate('documents')} /></main>;
  if (document) return <main className="page document-page"><button className="back-link" onClick={() => navigate('documents', null, { projectId: page.projectId })}><ArrowLeft />All documents</button><PageHeader title={document.title} description={`Updated ${relative(document.updated_at)}`}><TalvoriAgentEntryButton source={{ type: 'document', id: document.id }} /><Button icon={Copy} onClick={copy}>Copy link</Button><Button icon={Download} onClick={() => download(documentFilename(document.title), `# ${document.title}\n\n${document.content ?? ''}`, 'text/markdown')}>Export</Button><Button variant="primary" icon={Pencil} onClick={() => edit('document', document)}>Edit document</Button></PageHeader><div className="space-section-toolbar">{document.project_id ? <Button onClick={() => navigate('projects', document.project_id)}>Open project<ArrowRight /></Button> : null}{document.team_id ? <Button onClick={() => navigate('teams', document.team_id)}>Open team<ArrowRight /></Button> : null}</div><article className="document-reading">{document.content ? <DocumentContent content={document.content} /> : <p className="muted">This document is empty. Add context when you are ready.</p>}</article><ReviewPanel targetType="document" targetId={document.id} projectId={document.project_id} /><Suspense fallback={<p role="status">Opening document updates…</p>}><ActivityFeed key={document.id} workspaceId={document.workspace_id} targetType="document" targetId={document.id} /></Suspense></main>;
  const documents = visible(data.documents).filter(row => (!page.projectId || row.project_id === page.projectId) && `${row.title} ${row.content}`.toLowerCase().includes(query.toLowerCase()));
  return <main className="page"><PageHeader title="Documents" description="Plans, decisions, and source material across your workspace."><Button variant="primary" icon={Plus} onClick={() => edit('document', null, { project_id: page.projectId })}>New document</Button></PageHeader><SearchField value={query} onChange={setQuery} placeholder="Find a document…" />{documents.length ? <div className="space-document-list">{documents.map(row => <button key={row.id} className="space-linked-row" onClick={() => navigate('documents', row.id, { projectId: page.projectId })}><FileText /><span><strong>{row.title}</strong><small>{data.projects.find(p => p.id === row.project_id)?.name || data.teams.find(t => t.id === row.team_id)?.name || 'Workspace'} · {row.content?.replace(/[#*`>\n]/g, ' ').slice(0, 140)}</small></span><ArrowRight /></button>)}</div> : <Empty kind="documents" title={query ? 'No matching documents' : 'Make context easy to find'} description="Write a brief, preserve a decision, or collect sources. Documents stay connected to their project or team." action={query ? 'Clear search' : 'New document'} onAction={() => query ? setQuery('') : edit('document', null, { project_id: page.projectId })} />}</main>;
}

export function SavedViews() {
  const { data, page, navigate, perform } = useApp();
  const [editing, setEditing] = useState(false);
  const item = featureItems(data, 'saved_view').find(row => row.id === page.id);
  if (!page.id) return <main className="page"><Suspense fallback={<p role="status">Opening saved views…</p>}><ResourcePage kind="saved_view" /></Suspense></main>;
  if (!item) return <main className="page"><Empty kind="saved_view" title="View unavailable" description="It may be archived or belong to another workspace." action="All saved views" onAction={() => navigate('views')} /></main>;
  const routes = matchingRoutes(data, item), filters = item.payload;
  const scope = [filters.status !== 'all' ? pretty(filters.status) : 'All stages', filters.query ? `Title contains “${filters.query}”` : '', ...(filters.project_ids ?? []).map(id => data.projects.find(p => p.id === id)?.name || 'Unavailable project'), ...(filters.agent_ids ?? []).map(id => data.agents.find(a => a.id === id)?.name || 'Unavailable agent')].filter(Boolean);
  return <main className="page"><button className="back-link" onClick={() => navigate('views')}><ArrowLeft />All saved views</button><PageHeader title={item.name} description="A live view of your routes. Changes to the original work appear here automatically."><Button icon={Copy} onClick={() => perform(() => navigator.clipboard.writeText(`${location.origin}/${pageHash('views', item.id)}`), 'View link copied')}>Copy link</Button><Button variant="primary" icon={Pencil} onClick={() => setEditing(true)}>Edit view</Button></PageHeader><p className="space-section-note">{scope.join(' · ')} · {routes.length} matching routes</p>{routes.length ? <RouteRows routes={routes} /> : <Empty compact kind="saved_view" title="No work matches this view yet" description="Change the saved filters or create work that matches. This view never duplicates routes." action="Edit view" onAction={() => setEditing(true)} />}{editing ? <Suspense fallback={null}><ResourceEditor kind="saved_view" item={item} onClose={() => setEditing(false)} /></Suspense> : null}</main>;
}

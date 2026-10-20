import { pageHash, parsePage } from './navigation.js';
import { val } from './model.js';

export const READER_TEXT_LIMIT = 512 * 1024;

/** A temporary reader only returns to another canonical in-app page. */
export function readerBackPage(returnTo) {
  if (typeof returnTo === 'string' && returnTo.startsWith('#/') && returnTo.length <= 2000) {
    const page = parsePage(returnTo);
    if (page.view !== 'reader' && pageHash(page.view, page.id, page) === returnTo) return page;
  }
  return { view: 'chats', id: null, projectId: null };
}

/** Resolve only from a fresh actor-filtered snapshot, never the open app's cache. */
export function readerRecord(snapshot, workspaceId, target) {
  if (!target || !['document', 'output'].includes(target.kind)) return null;
  const collection = target.kind === 'document' ? snapshot?.documents : snapshot?.outputs;
  const item = collection?.find(row => row.id === target.id && val(row, 'workspace_id') === workspaceId && !val(row, 'archived_at'));
  if (!item) return null;
  if (target.kind === 'document') return { title: item.title, content: item.content || '', item, source: { view: 'documents', id: item.id } };
  const version = snapshot.output_versions?.find(row => row.output_id === item.id && row.workspace_id === workspaceId && row.number === item.current_version);
  if (!version) return null;
  return { title: item.title, content: version.content || '', item, version: version.number, source: { view: 'library', id: item.id } };
}

export function readerResourceTarget(id) {
  if (typeof id !== 'string') return null;
  const parts = id.split(':');
  return parts.length === 2 && parts.every(part => /^[A-Za-z0-9_. -]{1,200}$/.test(part) && !['.', '..'].includes(part))
    ? { teamId: parts[0], resourceId: parts[1] } : null;
}

export function readableResource(item) {
  return item?.kind === 'file' && !item.archived_at && item.byte_size > 0 && item.byte_size <= READER_TEXT_LIMIT && /\.(?:txt|md|markdown)$/i.test(item.file_name || '');
}

export function decodeReaderText(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > READER_TEXT_LIMIT) throw new Error('This file is too large for the document reader. Download the original instead.');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('This file is not a UTF-8 text document. Download the original instead.'); }
  if (text.includes('\u0000')) throw new Error('This file is not a UTF-8 text document. Download the original instead.');
  return text;
}

const ENTITY_COLLECTIONS = { projects: 'projects', teams: 'teams', tasks: 'tasks', chats: 'chats', agents: 'agents', documents: 'documents', library: 'outputs', work: 'runs', memory: 'memories' };

export function breadcrumbItems({ page, workspace, data, labels = {} }) {
  const items = [{ label: workspace.name, view: 'overview', id: null }];
  const projectId = page.projectId || (['projects', 'workbench'].includes(page.view) ? page.id : null);
  const project = data.projects?.find(row => row.id === projectId && !val(row, 'archived_at'));
  if (project) {
    items.push({ label: 'Projects', view: 'projects', id: null });
    if (page.view === 'projects') return [...items, { label: project.name, current: true }];
    items.push({ label: project.name, view: 'projects', id: project.id });
  }
  const label = labels[page.view] || { work: 'Active work', chats: 'Conversations', teams: 'Areas', 'rumbo-agent': 'Frondose', documents: 'Documents', reader: 'Docs' }[page.view] || 'Workspace';
  const entity = ENTITY_COLLECTIONS[page.view] && data[ENTITY_COLLECTIONS[page.view]]?.find(row => row.id === page.id && !val(row, 'archived_at'));
  if (entity) {
    items.push({ label, view: page.view, id: null, options: project && page.view !== 'projects' ? { projectId: project.id } : undefined });
    const section = page.view === 'teams' && page.section && page.section !== 'overview' ? page.section : null;
    items.push({ label: entity.name || entity.title || label, ...(section ? { view: page.view, id: entity.id } : { current: true }) });
    if (section) items.push({ label: section[0].toUpperCase() + section.slice(1), current: true });
  } else items.push({ label, current: true });
  return items;
}

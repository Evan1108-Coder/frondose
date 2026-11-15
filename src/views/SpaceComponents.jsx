import {beginContextDrag,endWorkspaceContextDrag} from '../lib/workspace-context-drop.js';
import { useEffect, useRef, useState } from "react";
import { Archive, RotateCcw, ArrowRight, CircleCheck, Circle, CircleDot, Download, FileText, Pencil, Plus } from "../components/icons.jsx";
import { Button, Dialog, Empty, IconButton, SearchField, Select, useApp } from "../ui.jsx";
import { frondoseActions } from "../data/useFrondose.js";
import { dateLabel, download, relative, val } from "../lib/model.js";
import { documentFilename, MILESTONE_STATUSES, ownerDocuments } from "../lib/workspace-spaces.js";
import { DocumentContent } from "../components/DocumentContent.jsx";
import { SpaceArchiveDialog, WorkspaceEditor } from "../components/WorkspaceEditor.jsx";
import { useIconColors } from '../components/IconColors.jsx';
import { pageTeam } from '../lib/icon-colors.js';
import { House, Route, FolderKanban, LibraryBig, NotebookPen, Users, Target, Calendar, MessageSquareText, Activity, Flag, GitBranch } from '../components/icons.jsx';
const TAB_ICONS = { overview: House, routes: Route, projects: FolderKanban, resources: LibraryBig, documents: NotebookPen, people: Users, strategy: Target, timeline: Calendar, chats: MessageSquareText, updates: MessageSquareText, activity: Activity, changes: GitBranch, milestones: Flag };

export function SpaceTabs({ tabs, value, onChange, label }) {
  const { page, data, workspace } = useApp();
  const { colorsFor } = useIconColors();
  const team = pageTeam(page, data);
  const ref = useRef(null);
  useEffect(() => {
    const container = ref.current, selected = container?.querySelector('[aria-selected="true"]');
    if (!container || !selected) return;
    const reveal = () => {
      const bounds = container.getBoundingClientRect(), item = selected.getBoundingClientRect();
      if (item.left < bounds.left) container.scrollLeft -= bounds.left - item.left;
      else if (item.right > bounds.right) container.scrollLeft += item.right - bounds.right;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(container);
    observer.observe(selected);
    return () => observer.disconnect();
  }, [value]);
  return <div className="tabs space-tabs" role="tablist" aria-label={label} ref={ref} onKeyDown={(event) => {
    const current = tabs.findIndex((tab) => tab.id === value);
    const next = event.key === "ArrowRight" ? (current + 1) % tabs.length : event.key === "ArrowLeft" ? (current + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (next !== null) { event.preventDefault(); onChange(tabs[next].id); ref.current?.querySelectorAll('[role="tab"]')[next]?.focus(); }
  }}>{tabs.map((tab) => {
    const Icon = TAB_ICONS[tab.id];
    const section = page.view === 'projects' ? ({ overview: 'projects', routes: 'tasks' }[tab.id] || tab.id) : tab.id;
    const id = `${page.view === 'teams' ? 'team' : 'project'}:${page.id}:${section}`;
    const colors = colorsFor(id, team);
    return <button key={tab.id} type="button" role="tab" draggable={['overview','routes','projects','todos','resources','documents','updates'].includes(tab.id)} onDragStart={event=>{const source=page.view==='teams'?{kind:'page',view:'teams',id:page.id,section:tab.id}:tab.id==='routes'?{kind:'page',view:'tasks',projectId:page.id}:tab.id==='documents'?{kind:'page',view:'documents',projectId:page.id}:tab.id==='updates'?{kind:'page',view:'updates',projectId:page.id}:{kind:'page',view:'projects',id:page.id};if(!beginContextDrag(event.dataTransfer,workspace.id,source))event.preventDefault();}} onDragEnd={endWorkspaceContextDrag} aria-selected={value === tab.id} tabIndex={value === tab.id ? 0 : -1} className={value === tab.id ? 'active' : ''} onClick={() => onChange(tab.id)}>{Icon ? <span className="space-tab-color-icon" style={{ color: colors.icon || undefined }}><Icon size={16} aria-hidden="true" /></span> : null}<span className="space-tab-color-label" style={{ color: colors.label || undefined }}>{tab.label}</span>{tab.count ? <span>{tab.count}</span> : null}</button>;
  })}</div>;
}

export function DocumentsPanel({ projectId, teamId }) {
  const { data, perform, notify } = useApp();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [editor, setEditor] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [archiving, setArchiving] = useState(null);
  const documents = ownerDocuments(data, { projectId, teamId }, filter === "archived").filter((document) => `${document.title} ${document.content}`.toLowerCase().includes(query.toLowerCase()));
  const selected = (data.documents ?? []).find((document) => document.id === selectedId);
  const defaults = projectId ? { project_id: projectId } : { team_id: teamId };
  function restore(document) { perform(async () => { await frondoseActions.updateDocument(document.id, { archived_at: null }); notify("Document restored"); }); }
  return <section className="space-document-panel" aria-label="Documents">
    <div className="space-section-toolbar"><SearchField value={query} onChange={setQuery} placeholder="Search documents…" /><Select aria-label="Document visibility" value={filter} onChange={setFilter}><option value="active">Active documents</option><option value="archived">Archived documents</option></Select><Button icon={Plus} onClick={() => setEditor({})}>New document</Button></div>
    {documents.length ? <div className="space-document-list">{documents.map((document) => <div className="space-document-row" key={document.id}><button className="space-row-main" onClick={() => setSelectedId(document.id)}><FileText /><span><strong>{document.title}</strong><small>{document.content?.replace(/[#*`>\n]/g, " ").trim().slice(0, 130) || "No content yet"}</small></span></button><time>Updated {relative(val(document, "updated_at"))}</time>{document.archived_at ? <IconButton label={`Restore ${document.title}`} onClick={() => restore(document)}><RotateCcw /></IconButton> : <IconButton label={`Edit ${document.title}`} onClick={() => setEditor(document)}><Pencil /></IconButton>}</div>)}</div> : <Empty compact kind={query ? "search" : "documents"} title={query ? "No matching documents" : filter === "archived" ? "No archived documents" : "Give your work shared context"} description={query ? "Try another title or a word from the document." : filter === "archived" ? "Archived documents stay here until you restore them." : "Write project plans, decisions, and guidelines that stay close to the work."} action={query ? "Clear search" : filter === "active" ? "Create document" : undefined} onAction={() => query ? setQuery("") : setEditor({})} />}
    {selected && !editor ? <Dialog wide className="space-document-reader" title={selected.title} subtitle={`Updated ${relative(val(selected, "updated_at"))}`} onClose={() => setSelectedId(null)}><div className="space-document-reader-body">{selected.content ? <DocumentContent content={selected.content} /> : <p className="muted">This document is empty. Add context when you are ready.</p>}</div><footer className="dialog-footer"><Button icon={Download} onClick={() => download(documentFilename(selected.title), `# ${selected.title}\n\n${selected.content ?? ""}`, "text/markdown")}>Export</Button>{selected.archived_at ? <Button variant="primary" icon={RotateCcw} onClick={() => { restore(selected); setSelectedId(null); }}>Restore document</Button> : <><Button icon={Archive} onClick={() => { setSelectedId(null); setArchiving(selected); }}>Archive</Button><Button variant="primary" icon={Pencil} onClick={() => setEditor(selected)}>Edit document</Button></>}</footer></Dialog> : null}
    {editor ? <WorkspaceEditor kind="document" item={editor.id ? editor : null} defaults={defaults} onClose={() => setEditor(null)} /> : null}
    {archiving ? <SpaceArchiveDialog kind="document" item={archiving} onClose={() => setArchiving(null)} /> : null}
  </section>;
}

export function MilestonesPanel({ projectId }) {
  const { data, perform, notify } = useApp();
  const [editor, setEditor] = useState(null);
  const [archiving, setArchiving] = useState(null);
  const [archived, setArchived] = useState(false);
  const milestones = (data.milestones ?? []).filter((item) => item.project_id === projectId && Boolean(item.archived_at) === archived).toSorted((a, b) => (a.target_date || "9999").localeCompare(b.target_date || "9999") || a.title.localeCompare(b.title));
  return <section className="space-milestones"><div className="section-heading"><h2>Milestones</h2><div className="space-inline-actions"><button className="text-button" onClick={() => setArchived((value) => !value)}>{archived ? "Show active" : "Archived"}</button><button className="text-button" onClick={() => setEditor({})}><Plus />Add milestone</button></div></div>
    {milestones.length ? <div className="milestone-list">{milestones.map((item) => <div className="milestone-row" key={item.id}>{archived ? <IconButton label={`Restore ${item.title}`} onClick={() => perform(async () => { await frondoseActions.updateMilestone(item.id, { archived_at: null }); notify("Milestone restored"); })}><RotateCcw /></IconButton> : <button className="milestone-check" role="checkbox" aria-checked={item.status === "completed"} aria-label={`${item.status === "completed" ? "Reopen" : "Complete"} ${item.title}`} onClick={() => perform(() => frondoseActions.updateMilestone(item.id, { status: item.status === "completed" ? "planned" : "completed" }))}><Circle morphTo={item.status === "completed" ? CircleCheck : item.status === "in_progress" ? CircleDot : Circle} /></button>}<button className={`milestone-title ${item.status === "completed" ? "is-complete" : ""}`} onClick={() => setEditor(item)}><strong>{item.title}</strong>{item.description ? <small>{item.description}</small> : null}</button><span className="milestone-status">{MILESTONE_STATUSES[item.status]}</span><time>{item.target_date ? dateLabel(`${item.target_date}T12:00:00`) : "No date"}</time>{!archived ? <IconButton label={`Archive ${item.title}`} onClick={() => setArchiving(item)}><Archive /></IconButton> : null}</div>)}</div> : <div className="space-inline-empty"><p>{archived ? "No archived milestones." : "Mark the checkpoints that move this project forward."}</p>{!archived ? <button className="text-button" onClick={() => setEditor({})}>Create first milestone <ArrowRight /></button> : null}</div>}
    {editor ? <WorkspaceEditor kind="milestone" item={editor.id ? editor : null} defaults={{ project_id: projectId }} onClose={() => setEditor(null)} /> : null}
    {archiving ? <SpaceArchiveDialog kind="milestone" item={archiving} onClose={() => setArchiving(null)} /> : null}
  </section>;
}

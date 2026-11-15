import { FileTypeIcon } from '../components/ChangeReview.jsx';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, Code, ExternalLink, FileText, Folder, FolderOpen, GitBranch, MessageCircle, PanelLeft, Pin, Play, Plus, RotateCw, Search, Settings, Square, Terminal, X } from '../components/icons.jsx';
import { Button, Dialog, Empty, ErrorMessage, Field, IconButton, PageHeader, SearchField, Select, useApp, useAsync } from '../ui.jsx';
import { Form } from '../components/Form.jsx';
import { DocumentContent } from '../components/DocumentContent.jsx';
import { CodeViewer } from '../components/CodeViewer.jsx';
import { ReviewPanel } from '../components/ReviewPanel.jsx';
import { SlashCommandMenu } from '../components/SlashCommandMenu.jsx';
import { readWorkbenchLayout, saveWorkbenchLayout, workbenchRequest } from '../lib/workbench.js';
import { TerminalPane } from '../components/workspace/TerminalPane.jsx';
export { TerminalPane } from '../components/workspace/TerminalPane.jsx';
import { LinkHoverPreview } from '../components/LinkHoverPreview.jsx';
import { visible } from '../lib/model.js';
import { parseSlashCommand, searchCommands } from '../lib/commands.js';
import { FrondoseAgentEntryButton, FrondoseAgentEntryDialog } from '../components/FrondoseAgentEntry.jsx';
import './workbench.css';

const WorkbenchCheckpoints = lazy(() => import('../components/WorkbenchCheckpoints.jsx').then(module => ({ default: module.WorkbenchCheckpoints })));

const TABS = [{ id: 'overview', label: 'Overview', icon: BookOpen }, { id: 'files', label: 'Files', icon: Folder }, { id: 'changes', label: 'Changes', icon: GitBranch }, { id: 'commands', label: 'Commands', icon: Code }, { id: 'terminal', label: 'Terminals', icon: Terminal }];
const TERMINAL_COMMANDS = Object.freeze(['rumbo', 'terminal.new', 'command', 'files', 'git.status', 'git.diff', 'git.branch', 'git.fetch', 'git.pull', 'git.commit', 'git.push', 'git.worktree', 'git.history']);

export function Workbench({ projectId }) {
  const { data, workspace, navigate, edit } = useApp();
  const projects = visible(data.projects).filter(item => item.workspace_id === workspace.id);
  const project = projects.find(item => item.id === projectId);
  if (!project) return <main className="page workbench-picker"><PageHeader title="Workbench" description="Your project’s conversations, files, commands, and results. Switch projects without losing your place."><Button icon={Plus} onClick={() => edit('project')}>New project</Button></PageHeader>{projects.length ? <div className="wb-project-list">{projects.map(item => <button className="wb-project-row" key={item.id} onClick={() => navigate('workbench', item.id, { projectId: item.id })}><Folder /><span><strong>{item.name}</strong><small>{item.local_path || 'Research & discussion · no folder needed'}</small></span><ArrowRight /></button>)}</div> : <Empty kind="workbench" title="A home for the work itself" description="Create a project to bring conversations, context, and outputs together. A working folder is optional until you need files or coding tools." action="Create project" onAction={() => edit('project')} />}</main>;
  return <ProjectWorkbench key={`${workspace.id}:${project.id}`} project={project} />;
}

function ProjectWorkbench({ project }) {
  const { data, page, workspace, navigate, edit, notify } = useApp();
  const [layout, setLayout] = useState(() => readWorkbenchLayout(workspace.id, project.id));
  const [summary, setSummary] = useState(null);
  const [git, setGit] = useState(null);
  const [scripts, setScripts] = useState([]);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [checkpointsOpen, setCheckpointsOpen] = useState(false), [checkpointRevision, setCheckpointRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [terminalSlash, setTerminalSlash] = useState(''), [terminalSlashIndex, setTerminalSlashIndex] = useState(0);
  const [frondoseRequest, setFrondoseRequest] = useState(null);
  const settingsQueue = useRef(Promise.resolve()), settingsWrite = useRef(0);
  const scope = useMemo(() => ({ workspaceId: workspace.id, projectId: project.id, environmentId: layout.environmentId }), [workspace.id, project.id, layout.environmentId]);
  const patchLayout = patch => setLayout(current => ({ ...current, ...patch }));
  useEffect(() => { if (page.reviewId) patchLayout({tab:'changes'}); },[page.reviewId]);
  const refresh = async () => { const next = await workbenchRequest(scope); setSummary(next); return next; };
  useEffect(() => { saveWorkbenchLayout(workspace.id, project.id, layout); }, [workspace.id, project.id, layout]);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    workbenchRequest(scope, '', { signal: controller.signal }).then(next => {
      setSummary(next);
      if (scope.environmentId && !next.environments.some(item => item.id === scope.environmentId)) patchLayout({ environmentId: '', directory: '', file: '' });
    }).catch(cause => { if (!controller.signal.aborted) setError(cause); });
    return () => controller.abort();
  }, [scope, project.local_path]);
  useEffect(() => {
    if (!summary?.root) { setGit(null); setScripts([]); return; }
    const controller = new AbortController();
    setGit(null);
    Promise.all([workbenchRequest(scope, 'git', { signal: controller.signal }), workbenchRequest(scope, 'scripts', { signal: controller.signal })]).then(([repository, discovered]) => { setGit(repository); setScripts(discovered.scripts); }).catch(cause => { if (!controller.signal.aborted) setError(cause); });
    return () => controller.abort();
  }, [scope, summary?.root, layout.tab]);
  useEffect(() => {
    let timer, cancelled = false;
    const poll = async () => {
      try { const next = await workbenchRequest(scope); if (!cancelled) setSummary(next); } catch { /* Foreground actions still show errors; no repeated toast storm. */ }
      if (!cancelled) timer = setTimeout(poll, 3000);
    };
    if (summary?.terminals.some(item => ['running', 'stopping'].includes(item.status))) timer = setTimeout(poll, 3000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [scope, Boolean(summary?.terminals.some(item => ['running', 'stopping'].includes(item.status)))]);
  const settings = summary?.settings ?? { showFiles: true, terminalFontSize: 14 };
  const environment = summary?.environments.find(item => item.id === layout.environmentId);
  const root = environment?.path || summary?.root;
  const terminals = (summary?.terminals || []).filter(item => (item.environment_id || '') === layout.environmentId);
  const terminal = terminals.find(item => item.id === layout.terminalId) || terminals[0];
  const chats = visible(data.chats).filter(item => item.project_id === project.id);
  const docs = visible(data.documents || []).filter(item => item.project_id === project.id);
  const routes = visible(data.tasks).filter(item => item.project_id === project.id);
  async function saveSettings(patch) {
    const previous = summary.settings, write = ++settingsWrite.current;
    setSummary(current => ({ ...current, settings: { ...current.settings, ...patch } }));
    const request = settingsQueue.current.catch(() => {}).then(() => workbenchRequest(scope, 'settings', { method: 'PATCH', body: patch }));
    settingsQueue.current = request;
    try { const next = await request; if (write === settingsWrite.current) setSummary(current => ({ ...current, settings: next.settings })); }
    catch (cause) { if (write === settingsWrite.current) setSummary(current => ({ ...current, settings: previous })); setError(cause); notify(cause.message, 'error'); }
  }
  async function refreshAll() {
    setBusy(true); setError(null);
    try { const next = await refresh(); if (next.root) setGit(await workbenchRequest(scope, 'git')); }
    catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }
  function switchEnvironment(value) { patchLayout({ environmentId: value, directory: '', file: '', terminalId: '' }); setPreview(null); }
  const favorite = path => patchLayout({ favorites: layout.favorites.includes(path) ? layout.favorites.filter(item => item !== path) : [...layout.favorites, path].slice(-30) });
  const terminalSlashResults = terminalSlash.startsWith('/') ? searchCommands(terminalSlash.slice(1), { context: 'workbench' }).slice(0, 10) : [];
  function executeTerminalSlash(command, argv = []) {
    const args = argv.join(' ').trim();
    setTerminalSlash(''); setTerminalSlashIndex(0); setError(null);
    if (command.id === 'rumbo') { setFrondoseRequest(args || 'Help me plan the next step for this project. Explain before proposing changes.'); return; }
    if (command.id === 'terminal.new') { setDialog({ type: 'terminal' }); return; }
    if (command.id === 'files') { patchLayout({ tab: 'files', ...(args ? { file: args } : {}) }); return; }
    if (command.id === 'git.diff') { patchLayout({ tab: 'changes' }); return; }
    if (command.id === 'git.worktree') { setDialog({ type: 'worktree' }); return; }
    const shell = {
      'git.status': 'git status --short --branch',
      'git.history': 'git log --oneline --decorate -30',
      'git.fetch': 'git fetch',
      'git.pull': 'git pull --ff-only',
      'git.push': 'git push',
      'git.branch': args ? `git branch ${args}` : 'git branch --all --verbose',
      'git.commit': args ? `git commit -m ${JSON.stringify(args)}` : 'git diff --cached',
      command: args,
    }[command.id];
    if (!shell) { setError(new Error(`${command.command} needs additional details or is not available in Workbench.`)); return; }
    setDialog({ type: 'terminal', command: shell, name: command.name.replace(/^git /, 'Git ') });
  }
  function selectTerminalSlash(command) {
    const parsed = parseSlashCommand(terminalSlash);
    const exact = parsed?.type === 'command' && parsed.command.id === command.id;
    if (!exact && command.usage.includes('[')) { setTerminalSlash(`${command.command} `); return; }
    executeTerminalSlash(command, exact ? parsed.argv : []);
  }
  return <main className="workbench-page">
    {frondoseRequest !== null ? <FrondoseAgentEntryDialog source={{ type: 'project', id: project.id }} initialInstruction={frondoseRequest} onClose={() => setFrondoseRequest(null)} /> : null}
    <div className="wb-header"><div className="wb-identity"><button className="back-link" onClick={() => navigate('projects', project.id)}><ArrowLeft />{project.name}</button><h1>Workbench</h1></div><div className="wb-header-actions"><IconButton label="Refresh workbench" onClick={refreshAll} disabled={busy}><RotateCw /></IconButton><IconButton label="Workbench settings" onClick={() => setDialog({ type: 'settings' })}><Settings /></IconButton><FrondoseAgentEntryButton source={{ type: 'project', id: project.id }} /><Button onClick={() => setCheckpointsOpen(true)}>Checkpoints</Button>{root ? <Button icon={Plus} variant="primary" onClick={() => setDialog({ type: 'terminal' })}>New terminal</Button> : <Button icon={MessageCircle} variant="primary" onClick={() => edit('chat', null, { project_id: project.id })}>New conversation</Button>}</div></div>
    <div className="wb-context-bar"><span className="wb-context-mode"><span className={`wb-state-dot ${root ? 'ready' : ''}`} />{root ? 'Read project · explicit coding execution' : 'Research & discussion'}</span>{root ? <><Select aria-label="Working environment" value={layout.environmentId} onChange={switchEnvironment}><option value="">Project folder</option>{summary?.environments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select><span className="wb-branch"><GitBranch />{git === null ? 'Checking repository…' : git.branch || 'No Git repository'}</span><code title={root}>{root}</code></> : <button className="text-button" onClick={() => edit('project', project)}><Folder />Link folder for coding</button>}</div>
    <ErrorMessage error={error || summary?.folderError} />
    <div className="wb-tabs" role="tablist" aria-label="Workbench views">{TABS.filter(item => root || item.id === 'overview').map(item => <button key={item.id} role="tab" aria-selected={layout.tab === item.id} onClick={() => patchLayout({ tab: item.id })}><item.icon />{item.label}{item.id === 'terminal' && terminals.length ? <span>{terminals.filter(row => row.status === 'running').length} live</span> : null}{item.id === 'changes' && git?.files.length ? <span>{git.files.length}</span> : null}</button>)}<div className="wb-tab-spacer" />{root && layout.tab === 'files' ? <IconButton label={settings.showFiles ? 'Hide file browser' : 'Show file browser'} onClick={() => saveSettings({ showFiles: !settings.showFiles })}><PanelLeft /></IconButton> : null}</div>
    {!summary && !error ? <div className="wb-loading" role="status">Opening your workbench…</div> : null}
    {summary && (layout.tab === 'overview' || !root) ? <div className="wb-overview">
      <section className="wb-brief"><div className="section-heading"><h2>Keep the purpose close</h2><button className="text-button" onClick={() => edit('project', project)}>Edit brief</button></div>{project.goal ? <DocumentContent content={project.goal} /> : <p className="muted">Add the project’s goals and constraints, then keep them beside the work.</p>}<div className="wb-overview-links"><button onClick={() => navigate('projects', project.id)}><GitBranch /><strong>{routes.length}</strong> routes<ArrowRight /></button><button onClick={() => navigate('chats', chats[0]?.id, { projectId: project.id })}><MessageCircle /><strong>{chats.length}</strong> conversations<ArrowRight /></button><button onClick={() => navigate('work', null, { projectId: project.id })}><Play />Agent work<ArrowRight /></button></div></section>
      <section className="wb-context-section"><div className="section-heading"><h2>Project documents</h2><button className="text-button" onClick={() => edit('document', null, { project_id: project.id })}><Plus />New document</button></div>{docs.length ? docs.slice(0, 6).map(doc => <button className="wb-document" key={doc.id} onClick={() => setDialog({ type: 'document', item: doc })}><FileText /><span><strong>{doc.title}</strong><small>{doc.content?.slice(0, 140) || 'Empty document'}</small></span><ArrowRight /></button>) : <p className="muted">Briefs, research, and decisions stay linked to this project. No working folder is required.</p>}</section>
      <section className="wb-overview-environment"><h2>{root ? 'Your working environment' : 'Add tools when you need them'}</h2><p>{root ? 'Read files and changes freely. Terminals and commands run only after your explicit confirmation. They can change your computer and are not sandboxed.' : 'Start with conversations and documents. Link a specific folder whenever you need files, commands, or an application preview.'}</p>{root ? <div className="wb-action-wrap"><Button icon={FolderOpen} onClick={() => patchLayout({ tab: 'files' })}>Read project files</Button><Button icon={Code} onClick={() => patchLayout({ tab: 'commands' })}>Project commands</Button>{git?.repository ? <Button icon={GitBranch} onClick={() => setDialog({ type: 'worktree' })}>Create worktree</Button> : null}</div> : <Button icon={Folder} onClick={() => edit('project', project)}>Link a folder</Button>}</section>
    </div> : null}
    {root && layout.tab === 'files' ? <FilesPanel key={checkpointRevision} scope={scope} layout={layout} patchLayout={patchLayout} settings={settings} favorite={favorite} /> : null}
    {root && layout.tab === 'changes' ? <ReviewPanel targetType="project" targetId={project.id} projectId={project.id} environmentId={scope.environmentId} defaultOpen /> : null}
    {root && layout.tab === 'commands' ? <div className="wb-commands"><div className="wb-command-main"><div className="section-heading"><div><h2>Project commands</h2><p className="muted">Saved actions are suggestions until you choose to run them.</p></div><Button icon={Plus} onClick={() => setDialog({ type: 'command' })}>Save command</Button></div>{summary.commands.map(command => <CommandRow key={command.id} item={command} onRun={() => setDialog({ type: 'terminal', command: command.command, name: command.name })} onRemove={async () => { try { await workbenchRequest(scope, `commands/${command.id}`, { method: 'DELETE' }); await refresh(); notify('Saved command removed. Terminal history is unchanged.'); } catch (cause) { setError(cause); } }} />)}{!summary.commands.length ? <p className="wb-inline-empty">Save the commands you use often, such as tests or your development server.</p> : null}<h3>Discovered package scripts</h3>{scripts.map(script => <CommandRow key={script.name} item={script} onRun={() => setDialog({ type: 'terminal', command: script.command, name: script.name })} />)}{!scripts.length ? <p className="muted">No package.json scripts found in this environment.</p> : null}</div><aside className="wb-preview-panel"><ExternalLink /><h2>Open a development preview</h2><p>Start a development server, then verify its port. Preview opens in a separate browser tab; Frondose does not proxy it or assume it belongs to this project.</p><Field label="Preview port"><input inputMode="numeric" value={layout.previewPort} onChange={event => { patchLayout({ previewPort: event.target.value }); setPreview(null); }} /></Field><Button busy={busy} onClick={async () => { setBusy(true); setError(null); try { setPreview(await workbenchRequest(scope, 'preview', { method: 'POST', body: { port: layout.previewPort } })); } catch (cause) { setError(cause); } finally { setBusy(false); } }}>Verify port</Button>{preview ? <LinkHoverPreview href={preview.url} title={`Development server · port ${preview.port}`} description="Port was verified by Frondose. The page itself has not been captured or inspected." className="button secondary">Open {preview.port}<ExternalLink /></LinkHoverPreview> : null}</aside></div> : null}
    {root && layout.tab === 'terminal' ? <section className="wb-terminal-panel"><div className="wb-terminal-tabs">{terminals.map(item => <button className={terminal?.id === item.id ? 'active' : ''} key={item.id} onClick={() => patchLayout({ terminalId: item.id })}><Terminal /><span>{item.name}</span><small>{item.status}</small></button>)}{!terminals.length ? <span className="muted">No terminals in this environment</span> : null}</div><div className="wb-slash-launcher"><Terminal /><input aria-label="Frondose terminal command" value={terminalSlash} placeholder="Type / for Frondose commands; shell paths stay in the terminal" onChange={event => { setTerminalSlash(event.target.value); setTerminalSlashIndex(0); }} onKeyDown={event => {
      if (terminalSlashResults.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setTerminalSlashIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + terminalSlashResults.length) % terminalSlashResults.length); }
      else if (event.key === 'Escape') { event.preventDefault(); setTerminalSlash(''); }
      else if (terminalSlashResults.length && ['Enter', 'Tab'].includes(event.key)) { event.preventDefault(); selectTerminalSlash(terminalSlashResults[Math.min(terminalSlashIndex, terminalSlashResults.length - 1)]); }
    }} /><SlashCommandMenu text={terminalSlash} context="workbench" activeIndex={terminalSlashIndex} onActiveIndexChange={setTerminalSlashIndex} onSelect={selectTerminalSlash} executableCommandIds={TERMINAL_COMMANDS} /></div>{terminal ? <><div className="wb-terminal-info"><span><code>{terminal.cwd}</code>{terminal.command ? <code>{terminal.command}</code> : null}</span><div><Button onClick={() => setDialog({ type: 'rename', terminal })}>Rename</Button>{terminal.status === 'running' ? <Button icon={Square} onClick={() => setDialog({ type: 'stop', terminal })}>Stop</Button> : <span className="muted">{terminal.status}{terminal.exit_code != null ? ` · exit ${terminal.exit_code}` : ''}</span>}</div></div><TerminalPane key={terminal.id} scope={scope} terminal={terminal} fontSize={settings.terminalFontSize} onEnded={refresh} /><p className="wb-terminal-footnote">Tabs can be closed or switched without stopping work. A Frondose server restart ends these terminals; history remains available. Shell startup files are not loaded automatically.</p></> : <Empty compact kind="workbench" title="An actual terminal, in the right folder" description="Interactive coding tools stay attached to this project. Launch requires your confirmation; nothing runs automatically." action="New terminal" onAction={() => setDialog({ type: 'terminal' })} />}</section> : null}
    {dialog ? <WorkbenchDialog dialog={dialog} scope={scope} root={root} settings={settings} branches={git?.branches || []} onClose={() => setDialog(null)} onSaved={async (result) => { await refresh(); if (result?.terminal) patchLayout({ tab: 'terminal', terminalId: result.terminal.id }); if (result?.environment) switchEnvironment(result.environment.id); }} onSettings={saveSettings} /> : null}
    {checkpointsOpen ? <Suspense fallback={<p role="status">Opening project checkpoints…</p>}><WorkbenchCheckpoints key={`${workspace.id}:${project.id}:${scope.environmentId || ''}`} scope={scope} projectName={project.name} environments={summary?.environments || []} captureReady={Boolean(root && git?.repository)} onClose={() => setCheckpointsOpen(false)} onRestored={() => { setCheckpointRevision(value => value + 1); void refreshAll(); }} /></Suspense> : null}
  </main>;
}

function FilesPanel({ scope, layout, patchLayout, settings, favorite }) {
  const [tree, setTree] = useState([]), [query, setQuery] = useState(''), [file, setFile] = useState(null), [error, setError] = useState(null), [limited, setLimited] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => workbenchRequest(scope, query.trim() ? 'search' : 'tree', { signal: controller.signal, body: query.trim() ? { q: query.trim() } : { path: layout.directory } }).then(result => { setTree(result.entries); setLimited(result.limited); setError(null); }).catch(cause => { if (!controller.signal.aborted) setError(cause); }), query ? 220 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [scope, layout.directory, query, settings.showHiddenFiles]);
  useEffect(() => {
    if (!layout.file) { setFile(null); return; }
    const controller = new AbortController(); setError(null); setFile(null);
    workbenchRequest(scope, 'file', { signal: controller.signal, body: { path: layout.file } }).then(setFile).catch(cause => { if (!controller.signal.aborted) setError(cause); });
    return () => controller.abort();
  }, [scope, layout.file]);
  return <div className={`wb-files ${settings.showFiles ? '' : 'browser-hidden'}`}>{settings.showFiles ? <aside className="wb-file-browser"><SearchField value={query} onChange={setQuery} placeholder="Find a file by name…" />{!query ? <div className="wb-directory"><button disabled={!layout.directory} onClick={() => patchLayout({ directory: layout.directory.split('/').slice(0, -1).join('/') })}><ArrowLeft /></button><span title={layout.directory}>/{layout.directory}</span></div> : null}{layout.favorites.length && !query ? <section className="wb-file-favorites"><h3>Pinned files</h3>{layout.favorites.map(path => <button key={path} onClick={() => patchLayout({ file: path })}><Pin /><span>{path}</span></button>)}</section> : null}<div className="wb-file-tree">{tree.map(item => <button key={item.path} className={layout.file === item.path ? 'active' : ''} onClick={() => item.type === 'directory' ? (patchLayout({ directory: item.path }), setQuery('')) : patchLayout({ file: item.path })}>{item.type === 'directory' ? <Folder /> : <FileTypeIcon path={item.path} />}<span>{query ? item.path : item.name}</span>{item.type === 'link' ? <small>link</small> : null}</button>)}{!tree.length ? <p className="muted">{query ? 'No matching filenames.' : 'No visible files.'}</p> : null}</div>{limited ? <p className="wb-file-note">Showing up to 100 matches across 2,500 entries. Narrow your search if needed.</p> : null}<p className="wb-file-note">Read-only browser. Credentials, dependency folders, and links outside this project are excluded.</p></aside> : null}<section className="wb-file-content"><ErrorMessage error={error} />{file ? <><div className="wb-file-heading"><span><FileTypeIcon path={file.path} /><strong>{file.path}</strong><small>{Math.ceil(file.size / 1024)} KB</small></span><IconButton label={layout.favorites.includes(file.path) ? 'Unpin file' : 'Pin file'} onClick={() => favorite(file.path)}><Pin /></IconButton></div><CodeViewer content={file.content} label={file.path} /></> : !error ? <Empty compact kind="documents" title="Read beside the work" description="Select a file to inspect it. Pin useful files so you can return to them quickly." /> : null}</section></div>;
}


function CommandRow({ item, onRun, onRemove }) {
  return <div className="wb-command-row"><span><strong>{item.name}</strong><code>{item.command}</code>{item.script ? <small>{item.script}</small> : null}</span><IconButton label={`Review and run ${item.name}`} onClick={onRun}><Play /></IconButton>{onRemove ? <IconButton label={`Remove saved command ${item.name}`} onClick={onRemove}><X /></IconButton> : null}</div>;
}


function WorkbenchDialog({ dialog, scope, root, settings, branches, onClose, onSaved, onSettings }) {
  const { busy, error, execute } = useAsync();
  const [name, setName] = useState(dialog.name || dialog.terminal?.name || ''), [command, setCommand] = useState(dialog.command || ''), [confirm, setConfirm] = useState(false);
  const [branch, setBranch] = useState('frondose/'), [base, setBase] = useState('HEAD');
  if (dialog.type === 'document') return <Dialog title={dialog.item.title} subtitle="Project context" wide onClose={onClose}><div className="wb-doc-dialog"><DocumentContent content={dialog.item.content} /></div></Dialog>;
  if (dialog.type === 'settings') return <Dialog title="Workbench settings" subtitle="Preferences for this project’s working environment." onClose={onClose}><div className="wb-settings-dialog">{[['showFiles', 'Show file browser'], ['wrapFiles', 'Wrap long file lines'], ['showHiddenFiles', 'Show dotfiles (private files stay excluded)']].map(([key, label]) => <label className="wb-check-row" key={key}><span>{label}</span><input type="checkbox" checked={Boolean(settings[key])} onChange={event => onSettings({ [key]: event.target.checked })} /></label>)}<Select label="Terminal font size" value={settings.terminalFontSize} onChange={value => onSettings({ terminalFontSize: Number(value) })}>{[12, 14, 16, 18, 20, 22].map(value => <option key={value} value={value}>{value}px</option>)}</Select><Select label="Maximum active terminals in this project" value={settings.maxTerminals} onChange={value => onSettings({ maxTerminals: Number(value) })}>{[1, 2, 3, 4, 6, 8].map(value => <option key={value} value={value}>{value}</option>)}</Select><p className="muted">Lowering the limit never stops existing work. Tabs, file pins, selected environment, and preview port are remembered in this browser. Terminal history is saved; execution ends when the Frondose server stops.</p><Button onClick={onClose}>Done</Button></div></Dialog>;
  const title = { terminal: command ? 'Review command before running' : 'Open a coding terminal', command: 'Save a project command', worktree: 'Create an isolated worktree', stop: 'Stop this terminal?', rename: 'Rename terminal' }[dialog.type];
  async function submit(event) {
    event.preventDefault();
    execute(async () => {
      let result;
      if (dialog.type === 'terminal') result = { terminal: await workbenchRequest(scope, 'terminals', { method: 'POST', body: { name: name || 'Terminal', command: command || null, confirm_execution: confirm } }) };
      else if (dialog.type === 'command') await workbenchRequest(scope, 'commands', { method: 'POST', body: { name, command } });
      else if (dialog.type === 'worktree') result = { environment: await workbenchRequest(scope, 'worktrees', { method: 'POST', body: { name: name || branch, branch, base, confirm_create: confirm } }) };
      else if (dialog.type === 'stop') await workbenchRequest(scope, `terminals/${dialog.terminal.id}/stop`, { method: 'POST' });
      else if (dialog.type === 'rename') await workbenchRequest(scope, `terminals/${dialog.terminal.id}`, { method: 'PATCH', body: { name } });
      await onSaved(result); onClose();
    });
  }
  return <Dialog title={title} onClose={onClose} subtitle={['terminal', 'worktree'].includes(dialog.type) ? root : undefined}><Form onSubmit={submit}><div className="form-fields"><ErrorMessage error={error} />{dialog.type !== 'stop' ? <Field label={dialog.type === 'worktree' ? 'Environment name (optional)' : 'Name'}><input autoFocus value={name} maxLength={80} required={['command', 'rename'].includes(dialog.type)} placeholder={dialog.type === 'terminal' ? 'Terminal' : 'A useful name'} onChange={event => setName(event.target.value)} /></Field> : <p>This ends “{dialog.terminal.name}” and may interrupt a command or server. Its output remains available. It does not delete files or stop other terminals.</p>}{['terminal', 'command'].includes(dialog.type) ? <Field label={dialog.type === 'terminal' ? 'Command (optional—leave empty for an interactive shell)' : 'Command'}><textarea rows={3} value={command} maxLength={4000} required={dialog.type === 'command'} placeholder="npm run dev" onChange={event => setCommand(event.target.value)} /></Field> : null}{dialog.type === 'worktree' ? <><Field label="New branch"><input value={branch} onChange={event => setBranch(event.target.value)} required /></Field><Select label="Start from" value={base} onChange={setBase}><option value="HEAD">Current commit (HEAD)</option>{branches.map(item => <option key={item} value={item}>{item}</option>)}</Select><p className="muted">Creates a separate checkout under Frondose’s managed worktrees. Uncommitted changes, dependencies, and private configuration are not copied. No files or branches are automatically deleted.</p></> : null}{['terminal', 'worktree'].includes(dialog.type) ? <label className="wb-execution-confirm"><input type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)} /><span>{dialog.type === 'terminal' ? 'I understand this runs on my computer, can edit files and use the network, and is not sandboxed.' : 'Create this branch and working folder. A worktree isolates files, not permissions.'}</span></label> : null}{dialog.type === 'command' ? <p className="muted">Saving does not run the command. You will review it again before execution.</p> : null}</div><div className="dialog-actions"><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" busy={busy} disabled={['terminal', 'worktree'].includes(dialog.type) && !confirm}>{dialog.type === 'terminal' ? command ? 'Run command' : 'Open terminal' : dialog.type === 'worktree' ? 'Create worktree' : dialog.type === 'stop' ? 'Stop terminal' : 'Save'}</Button></div></Form></Dialog>;
}

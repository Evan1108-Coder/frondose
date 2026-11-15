import { lazy, Suspense } from 'react';
import { Button } from '../../ui.jsx';
const DirectoryExplorer = lazy(() => import('./DirectoryFiles.jsx').then(m => ({ default: m.DirectoryExplorer })));
export function EditorHome({ workspaceId, binding, onOpenFile, onDirectory, onMarkdown }) {
  return <section className="editor-home"><header><h1>Text editor</h1><Button disabled={!binding} onClick={onMarkdown}>New Markdown file</Button></header><Suspense fallback={<p role="status">Opening files…</p>}><DirectoryExplorer workspaceId={workspaceId} binding={binding} onOpenFile={onOpenFile} onBind={onDirectory}/></Suspense></section>;
}

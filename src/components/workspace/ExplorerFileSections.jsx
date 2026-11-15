import { useMemo } from 'react';
import { directoryDraftDirty } from '../../lib/directory-drafts.js';
import { markdownOutline } from '../../lib/markdown-editing.js';
import {useInterfaceLanguage} from '../InterfaceLanguage.jsx';
import {formatInterfaceText} from '../../lib/interface-language.js';
import {FileIcon} from '../FileIcon.jsx';

export function ExplorerFileSections({ editors = [], currentFile, onOpenEditor, onJumpToLine }) {
  const language=useInterfaceLanguage();
  const outline = useMemo(() => currentFile?.loaded && /\.md(?:own|arkdown)?$/i.test(currentFile.path) ? markdownOutline(currentFile.content) : [], [currentFile?.loaded, currentFile?.path, currentFile?.content]);
  const unsaved = editors.filter(item => directoryDraftDirty(item.draft));
  return <div className="directory-file-sections">
    <details open><summary>Unsaved <span>{unsaved.length || ''}</span></summary>{unsaved.length ? <ul>{unsaved.map(item => <li key={item.entityId}><button type="button" onClick={() => onOpenEditor?.(item.entityId)}><FileIcon path={item.draft.path}/><span>{item.draft.path}</span><i aria-label="Unsaved changes"/></button></li>)}</ul> : <p>No unsaved files</p>}</details>
    <details open><summary>Outline</summary>{outline.length ? <ul>{outline.map(item => <li key={item.line}><button type="button" title={formatInterfaceText('Line {{line}}',{line:new Intl.NumberFormat(language).format(item.line)},language)} style={{ paddingLeft: 10 + (item.level - 1) * 9 }} onClick={() => onJumpToLine?.(item.line)}><span>{item.title}</span><small>{item.line}</small></button></li>)}</ul> : <p>{currentFile ? 'No Markdown headings in this file' : 'Select an open file'}</p>}</details>
    <details><summary>Timeline</summary>{currentFile?.timeline?.length ? <><p>Disk versions observed in this app session</p><ul>{currentFile.timeline.slice().reverse().map(item => <li key={item.version}><div className="directory-file-version"><time dateTime={item.modified_at}>{new Date(item.modified_at).toLocaleString(language)}</time><small title={item.version}>{item.version.slice(0, 8)}</small></div></li>)}</ul></> : <p>No saved version observed</p>}</details>
  </div>;
}

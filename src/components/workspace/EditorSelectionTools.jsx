import { useLayoutEffect, useRef, useState } from 'react';
import {Bold,Italic,Heading,Code,List,ListOrdered,Quote,Link,MessageSquare,GripVertical} from '../icons.jsx';
import { beginContextDrag, endWorkspaceContextDrag, selectedFileContext } from '../../lib/workspace-context-drop.js';

// A textarea mirror measures the real wrapped caret without changing its value,
// selection, scroll position or the browser's native editing/IME behavior.
function caretPosition(element, owner) {
  if (typeof element.caretPosition === 'function') return element.caretPosition(owner);
  const style = getComputedStyle(element), bounds = element.getBoundingClientRect(), container = owner.getBoundingClientRect();
  const mirror = document.createElement('div');
  for (const name of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth', 'boxSizing']) mirror.style[name] = style[name];
  Object.assign(mirror.style, { position: 'fixed', left: '-100000px', top: '0', visibility: 'hidden', whiteSpace: 'pre', width: `${element.clientWidth}px` });
  mirror.textContent = element.value.slice(0, element.selectionStart);
  const marker = document.createElement('span'); marker.textContent = '\u200b'; mirror.append(marker); document.body.append(mirror);
  const x = marker.offsetLeft - element.scrollLeft, y = marker.offsetTop - element.scrollTop;
  mirror.remove();
  if (y < 0 || y > element.clientHeight - 10 || x < 0 || x > element.clientWidth) return null;
  return { left: bounds.left - container.left + x, top: bounds.top - container.top + y };
}
const actions = [['bold', Bold, 'Bold'], ['italic', Italic, 'Italic'], ['heading', Heading, 'Heading'], ['code', Code, 'Inline code'], ['bullet', List, 'Bulleted list'], ['numbered', ListOrdered, 'Numbered list'], ['quote', Quote, 'Quote'], ['link', Link, 'Link']];
export function EditorSelectionTools({ editor, owner, draft, rootVersion, workspaceId, selectionEpoch, markdown, onFormat, onComment }) {
  const toolbar = useRef(null), dragging = useRef(false), [position, setPosition] = useState(null), [selection, setSelection] = useState(null);
  useLayoutEffect(() => {
    const update = () => {
      const input = editor.current, container = owner.current;
      if (dragging.current) return;
      if (!input || !container || draft.pending || !(input.hasFocus ?? document.activeElement === input)) { setPosition(null); return; }
      const caret = caretPosition(input, container);
      if (!caret) { setPosition(null); return; }
      setSelection(current => current?.start === input.selectionStart && current?.end === input.selectionEnd ? current : { start: input.selectionStart, end: input.selectionEnd });
      const height = toolbar.current?.offsetHeight || 64, header = container.querySelector('.directory-editor-toolbar')?.offsetHeight || 46;
      const above = caret.top - height - 8;
      const next = { left: Math.max(8, Math.min(container.clientWidth - Math.min(420, container.clientWidth - 16) - 8, caret.left - 12)), top: Math.min(container.clientHeight - height - 30, above >= header ? above : caret.top + 28) };
      setPosition(current => current?.left === next.left && current?.top === next.top ? current : next);
    };
    update(); const resize = new ResizeObserver(update); if (owner.current) resize.observe(owner.current);
    window.addEventListener('resize', update);
    document.addEventListener('selectionchange', update);
    return () => { resize.disconnect(); window.removeEventListener('resize', update); document.removeEventListener('selectionchange', update); };
  }, [selectionEpoch, draft.pending, draft.content, editor, owner, Boolean(position), selection?.start, selection?.end]);
  const source = selectedFileContext(draft, rootVersion, selection?.start, selection?.end);
  if (!position || !markdown && !source) return null;
  return <div ref={toolbar} className="directory-selection-tools" role="toolbar" aria-label="Editor tools" style={position} onMouseDown={event => { if (event.target.closest('[draggable="true"]')) dragging.current = true; else event.preventDefault(); }} onMouseUp={() => { dragging.current = false; }} data-field-defaults-exclude="true">
    {markdown ? actions.map(([id, Icon, title]) => <button key={id} type="button" title={title} aria-label={title} onClick={() => onFormat(id)}><Icon interactive={false}/></button>) : null}
    {source && onComment ? <button type="button" disabled={source.dirty || source.text.length > 4000} title={source.dirty ? 'Save this file before adding an anchored comment' : source.text.length > 4000 ? 'Select up to 4,000 characters for a comment' : 'Comment on the selected text'} onClick={() => onComment({ start: selection.start, end: selection.end })}><MessageSquare interactive={false}/>Comment</button> : null}
    {source ? <button type="button" className="directory-selection-drag" draggable title={`Drag selected lines ${source.startLine}–${source.endLine} to an AI CLI`} aria-label="Drag selected lines to AI CLI" onDragStart={event => { dragging.current = true; if (!beginContextDrag(event.dataTransfer, workspaceId, source)) { dragging.current = false; event.preventDefault(); } }} onDragEnd={() => { dragging.current = false; endWorkspaceContextDrag(); setPosition(null); }}><GripVertical interactive={false}/>Lines {source.startLine}–{source.endLine}</button> : null}
  </div>;
}

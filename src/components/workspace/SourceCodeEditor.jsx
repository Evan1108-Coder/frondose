import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import {createPortal} from 'react-dom';
import { Compartment, EditorState, StateField } from '@codemirror/state';
import { EditorView, dropCursor, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, Decoration, WidgetType } from '@codemirror/view';
import { bracketMatching, foldGutter, foldKeymap, foldEffect, unfoldEffect, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { codeLanguage, loadCodeLanguage, sourceReplacement } from '../../lib/code-editor.js';
import { useCodeAppearance } from '../../lib/code-appearance.js';
import { codeFontFamily } from '../../lib/code-fonts.js';
import { codeThemeStyle } from '../../lib/code-themes.js';
import { EditorScrollIndicator } from './EditorScrollIndicator.jsx';
import {currentMotionPreference} from '../../lib/motion.js';
import '../code-fonts.css';
function foldMarker(open){const span=document.createElement('span');span.className='source-fold-chevron';span.dataset.open=String(open);span.setAttribute('aria-label',open?'Fold code':'Unfold code');return span;}
import '../code-viewer.css';
import './source-code-editor.css';

class ReviewWidget extends WidgetType {
 constructor(node){super();this.node=node;}
 eq(other){return this.node===other.node;}
 toDOM(){return this.node;}
 ignoreEvent(){return true;}
}
const NO_NOTES=Object.freeze([]);
const palette = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: 'var(--cv-keyword)' },
  { tag: [tags.string, tags.regexp, tags.special(tags.string)], color: 'var(--cv-string)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--cv-number)' },
  { tag: [tags.comment, tags.meta], color: 'var(--cv-comment)' },
  { tag: [tags.tagName, tags.attributeName, tags.typeName], color: 'var(--cv-keyword)' },
  { tag: [tags.heading, tags.strong], fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: [tags.link, tags.url], color: 'var(--cv-string)', textDecoration: 'underline' },
]);
function appearanceExtensions(settings, readOnly) {
  return [EditorState.tabSize.of(settings.tabSize), indentUnit.of(' '.repeat(settings.tabSize)),
    settings.lineNumbers ? [lineNumbers(), highlightActiveLineGutter(), foldGutter({markerDOM:foldMarker})] : [],
    settings.syntax ? syntaxHighlighting(palette) : [], settings.wrap ? EditorView.lineWrapping : [],
    EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

// A single CodeMirror view owns native input, IME, history and scrolling. React
// never sets scrollTop while reconciling text, selection or toolbar updates.
export const SourceCodeEditor = forwardRef(function SourceCodeEditor({ value, path, readOnly, onChange, onSelection, onViewport, onFocus, onBlur, onKeyDown, onDragStart, onDragEnd, notes=NO_NOTES, renderNote, onCommentLine, commentsAvailable=false }, ref) {
  const mount = useRef(null), view = useRef(null), callbacks = useRef(null), initial = useRef({ value }), syncing = useRef(false);
  const compartments = useRef(null); compartments.current ||= { appearance: new Compartment(), language: new Compartment(), notes: new Compartment() };
  const [settings] = useCodeAppearance(), [scrollOwner, setScrollOwner] = useState(null);
  const ready = Boolean(scrollOwner),root=useRef(null),noteNodes=useRef(new Map()),focusNewNote=useRef(false),[hover,setHover]=useState(null);
  for(const note of notes){if(!noteNodes.current.has(note.id)){const node=document.createElement('div');node.className='source-review-note';node.dataset.inlineNote=note.id;if(note.id==='new-note')focusNewNote.current=true;noteNodes.current.set(note.id,node);}}
  for(const id of noteNodes.current.keys())if(!notes.some(note=>note.id===id))noteNodes.current.delete(id);
  const chooseLine=event=>{if(!commentsAvailable||!view.current||event.target.closest('[data-inline-note]')){setHover(null);return;}const current=view.current,at=current.posAtCoords({x:event.clientX,y:event.clientY});if(at===null)return;const line=current.state.doc.lineAt(at),selection=current.state.selection.main,from=selection.empty?line.from:selection.from,to=selection.empty?line.to:selection.to,box=current.coordsAtPos(from),bounds=root.current.getBoundingClientRect();if(box&&to>from)setHover(old=>old?.from===from&&old?.to===to&&Math.abs(old.top-(box.top-bounds.top))<1?old:{from,to,top:box.top-bounds.top});};
  callbacks.current = { onChange, onSelection, onViewport, onFocus, onBlur, onKeyDown, onDragStart, onDragEnd };
  const handle = useRef(null);
  handle.current ||= {
    focus() { view.current?.focus(); },
    get hasFocus() { return Boolean(view.current?.hasFocus); },
    get selectionStart() { return view.current?.state.selection.main.from || 0; },
    get selectionEnd() { return view.current?.state.selection.main.to || 0; },
    get value() { return view.current?.state.doc.toString() || ''; },
    get scrollTop() { return view.current?.scrollDOM.scrollTop || 0; },
    set scrollTop(value) { if (view.current) view.current.scrollDOM.scrollTop = value; },
    get scrollLeft() { return view.current?.scrollDOM.scrollLeft || 0; },
    set scrollLeft(value) { if (view.current) view.current.scrollDOM.scrollLeft = value; },
    setSelectionRange(start, end = start) {
      const current = view.current; if (!current) return;
      const clamp = number => Math.max(0, Math.min(current.state.doc.length, number || 0));
      current.dispatch({ selection: { anchor: clamp(start), head: clamp(end) } });
    },
    jumpToLine(number) {
      const current = view.current; if (!current) return;
      const line = current.state.doc.line(Math.max(1, Math.min(current.state.doc.lines, number)));
      current.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 30 }) }); current.focus();
    },
    caretPosition(owner) {
      const current = view.current; if (!current) return null;
      const position = current.coordsAtPos(current.state.selection.main.head), viewport = current.scrollDOM.getBoundingClientRect(), container = owner.getBoundingClientRect();
      if (!position || position.bottom < viewport.top || position.top > viewport.bottom || position.left < viewport.left || position.left > viewport.right) return null;
      return { left: position.left - container.left, top: position.top - container.top };
    },
  };
  useLayoutEffect(() => {
    const current = new EditorView({ parent: mount.current, state: EditorState.create({ doc: initial.current.value, extensions: [
      // Native selection can invert both the glyphs and background.
      history(), dropCursor(), highlightSpecialChars(), highlightActiveLine(), indentOnInput(), bracketMatching(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
      compartments.current.language.of([]), compartments.current.notes.of([]), compartments.current.appearance.of(appearanceExtensions(settings, readOnly)),
      EditorView.contentAttributes.of({ 'aria-label': `Source of ${path}`, spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', 'data-field-defaults-exclude': 'true' }),
      EditorView.updateListener.of(update => {
        if(update.transactions.some(transaction=>transaction.effects.some(effect=>effect.is(foldEffect)||effect.is(unfoldEffect)))&&currentMotionPreference().movement){update.view.contentDOM.getAnimations().forEach(animation=>animation.cancel());update.view.contentDOM.animate([{opacity:.55},{opacity:1}],{duration:180,easing:'ease-out'});}
        if (update.docChanged && !syncing.current) callbacks.current.onChange?.(update.state.doc.toString(), handle.current);
        if (update.selectionSet || update.focusChanged) callbacks.current.onSelection?.(handle.current);
      }),
      EditorView.domEventHandlers({
        scroll() { setHover(null); callbacks.current.onViewport?.(handle.current); },
        focus() { callbacks.current.onFocus?.(handle.current); },
        blur() { callbacks.current.onBlur?.(); },
        keydown(event) { return Boolean(callbacks.current.onKeyDown?.(event, handle.current)); },
        dragend(event) { callbacks.current.onDragEnd?.(event); },
      }),
    ] }) });
    // Stop CodeMirror's internal move/text payload for this scoped Frondose
    // gesture, without preventDefault (which would cancel the native drag).
    const contextDrag = event => { if(event.target.closest?.('.source-review-card,.file-comment-thread,.file-comment-handoff'))return; if (callbacks.current.onDragStart) { event.stopImmediatePropagation(); callbacks.current.onDragStart(event, handle.current); } };
    current.contentDOM.addEventListener('dragstart', contextDrag, true);
    const insertDrop=event=>{if(current.state.readOnly||typeof event.detail?.text!=='string')return;event.stopPropagation();const selection=current.state.selection.main;current.dispatch({changes:{from:selection.from,to:selection.to,insert:event.detail.text},selection:{anchor:selection.from+event.detail.text.length},userEvent:'input.drop'});current.focus();};
    current.contentDOM.addEventListener('frondose:insert-dropped-context',insertDrop);
    view.current = current; setScrollOwner(current.scrollDOM);
    return () => { current.contentDOM.removeEventListener('dragstart', contextDrag, true); current.contentDOM.removeEventListener('frondose:insert-dropped-context',insertDrop); view.current = null; current.destroy(); };
    // Creation and cleanup only. Settings/language/text use transactions below.
  }, []);
  useLayoutEffect(() => {
    const current = view.current; if (!current) return;
    const previous = current.state.doc.toString();
    if (previous !== value) { syncing.current = true; try { current.dispatch({ changes: sourceReplacement(previous, value) }); } finally { syncing.current = false; } }
  }, [value]);

  useLayoutEffect(()=>{const current=view.current;if(!current)return;const ranges=notes.filter(note=>Number.isSafeInteger(note.from)&&note.from>=0&&note.from<=current.state.doc.length).map(note=>Decoration.widget({widget:new ReviewWidget(noteNodes.current.get(note.id)),block:true,side:1}).range(current.state.doc.lineAt(note.from).to));current.dispatch({effects:compartments.current.notes.reconfigure(StateField.define({create:()=>Decoration.set(ranges,true),update:(value,transaction)=>value.map(transaction.changes),provide:field=>EditorView.decorations.from(field)}))});},[notes]);
  useLayoutEffect(()=>{const observer=new ResizeObserver(()=>view.current?.requestMeasure());for(const note of notes)observer.observe(noteNodes.current.get(note.id));let frame;if(focusNewNote.current){focusNewNote.current=false;frame=requestAnimationFrame(()=>noteNodes.current.get('new-note')?.querySelector('textarea')?.focus());}return()=>{observer.disconnect();if(frame)cancelAnimationFrame(frame);};},[notes]);
  useImperativeHandle(ref, () => handle.current, []);
  useEffect(() => { view.current?.dispatch({ effects: compartments.current.appearance.reconfigure(appearanceExtensions(settings, readOnly)) }); }, [settings, readOnly]);
 useEffect(() => {
    let cancelled = false;
    loadCodeLanguage(codeLanguage(path)).then(language => { if (!cancelled && view.current) view.current.dispatch({ effects: compartments.current.language.reconfigure(language) }); }).catch(() => { /* Plain text remains usable if an optional language chunk cannot load. */ });
    return () => { cancelled = true; };
  }, [path]);
  return <div ref={root} onMouseMove={chooseLine} onMouseLeave={()=>setHover(null)} className="directory-source-editor code-viewer directory-code-editor" data-note-rail={Boolean(onCommentLine)} data-field-defaults-exclude="true" data-code-theme={settings.theme} data-code-font={settings.font} style={{ ...codeThemeStyle(settings.theme), '--code-size': `${settings.fontSize}px`, '--code-height': settings.lineHeight, '--code-font': codeFontFamily(settings.font) }}><div ref={mount} className="directory-code-mount"/><EditorScrollIndicator scroller={scrollOwner}/>{commentsAvailable&&hover?<button type="button" className="source-note-gutter" aria-label={`Add note at line ${view.current?.state.doc.lineAt(hover.from).number}`} style={{top:hover.top}} onMouseDown={event=>event.preventDefault()} onClick={()=>{onCommentLine?.({start:hover.from,end:hover.to});setHover(null);}}>+</button>:null}{notes.map(note=>createPortal(renderNote?.(note),noteNodes.current.get(note.id),note.id))}{!ready ? <pre className="directory-code-fallback">{initial.current.value}</pre> : null}</div>;
});

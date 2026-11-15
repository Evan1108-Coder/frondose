import {ContextMenu} from '../ContextMenu.jsx';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { normalizeViewLayout, resizeViewLayout } from '../../lib/workspace-view-layout.js';
import { workspaceDividerRatio, workspaceViewGeometry, workspaceNeedsFocusMode } from '../../lib/workspace-view-geometry.js';
import { X, PanelRight, RotateCcw, Pencil, LayoutGrid, PanelLeft } from '../icons.jsx';

const NO_PREVIEWS = new Set();

export function workspaceViewSwitchIndex(key, index, count) {
  if (!Number.isInteger(count) || count < 1) return -1;
  return key === 'Home' ? 0 : key === 'End' ? count - 1 : key === 'ArrowLeft' ? (index - 1 + count) % count : key === 'ArrowRight' ? (index + 1) % count : -1;
}

// This component always has the same parent/key, regardless of the binary
// geometry tree. Header visibility also changes in place instead of moving the
// live body to a different sibling index during one-pane ↔ split transitions.
function WorkspaceViewLeaf({ view, rect, focused, preview, hideHeaders, compact, renderView, onFocus, onHover, onResetHover, onDragOverView, onDropView, onDetach, canDragViews, onDragStartView, onDragEndView, onPointerDownView }) {
  const materialized = useRef(false);
  useLayoutEffect(() => { if (!preview) materialized.current = true; }, [preview]);
  // A committed real leaf can never become a disposable hover placeholder.
  const placeholder = preview && !materialized.current;
  return <section className={`workspace-view ${focused ? 'focused' : ''} ${placeholder ? 'drop-preview' : ''}`} style={rect} id={`workspace-pane-${view.id}`} role={compact ? 'tabpanel' : undefined} aria-labelledby={compact ? `workspace-view-option-${view.id}` : undefined} data-workspace-view-id={view.id} data-workspace-entity-id={view.entityId} data-workspace-live-view={String(!placeholder)} data-workspace-view-focused={String(focused)} aria-label={`${view.label} view`} onPointerEnter={event=>{if(!placeholder&&!compact&&event.pointerType!=='touch')onHover?.(view.id);}} onPointerDownCapture={() => {if(!placeholder){onResetHover?.();onFocus?.(view.id);}}} onFocusCapture={() => {if(!placeholder){onResetHover?.();onFocus?.(view.id);}}} onDragOver={event => onDragOverView?.(event, view.id)} onDrop={event => onDropView?.(event, view.id)}>
    <header className="workspace-view-heading" hidden={hideHeaders} draggable={false} data-workspace-view-drag-handle={String(canDragViews && !placeholder && !hideHeaders)} title={canDragViews && !placeholder ? 'Drag to move this view to another edge' : undefined} onPointerDown={event => { if (canDragViews && !placeholder && !hideHeaders) onPointerDownView?.(event, view.id); }} onDragStart={event => onDragStartView?.(event, view.id)} onDragEnd={onDragEndView}><button type="button" onClick={() => !placeholder && onFocus?.(view.id)} disabled={placeholder}>{view.label}</button>{!placeholder ? <button type="button" draggable={false} data-workspace-view-action="detach" aria-label={`Move ${view.label} to its own tab`} onClick={() => onDetach?.(view.id)}><PanelRight /></button> : <span>Release to add</span>}</header>
    <div className="workspace-view-body">{placeholder ? <div className="workspace-view-drop-placeholder">{view.label}</div> : renderView(view)}</div>
  </section>;
}

export function WorkspaceViewGrid({ layout, views, focusedId, renderView, onFocus, onHover, onResetHover, onLayout, onDragOverView, onDropView, onDetach, onDragStartView, onDragEndView, onPointerDownView, canDragViews = false, previewIds = NO_PREVIEWS, hideHeaders = false }) {
  const canvas = useRef(null), pointerCleanup = useRef(null), switchButtons = useRef(new Map());
  const [phone, setPhone] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 600px)').matches);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const selectedId = views.some(view => view.id === focusedId) ? focusedId : views[0]?.id;
  useEffect(() => { if (typeof matchMedia !== 'function') return; const media = matchMedia('(max-width: 600px)'), change = () => setPhone(media.matches); change(); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  const membership = views.map(view => view.id).join('\0');
  const normalized = useMemo(() => normalizeViewLayout(layout, membership ? membership.split('\0') : []), [layout, membership]);
  const geometry = useMemo(() => workspaceViewGeometry(normalized, bounds.width, bounds.height), [normalized, bounds.width, bounds.height]);
  const compact = views.length > 1 && (phone || workspaceNeedsFocusMode(geometry.leaves, bounds.width, bounds.height));
  const rectangles = useMemo(() => new Map(geometry.leaves.map(({ id, ...rect }) => [id, rect])), [geometry]);
  const geometryRef = useRef(geometry), layoutRef = useRef(normalized), callback = useRef(onLayout);
  geometryRef.current = geometry; layoutRef.current = normalized; callback.current = onLayout;
  useLayoutEffect(() => {
    const element = canvas.current;
    const measure = () => {
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const next = { width: Math.max(0, Math.round(rect.width * 100) / 100), height: Math.max(0, Math.round(rect.height * 100) / 100) };
      setBounds(current => current.width === next.width && current.height === next.height ? current : next);
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(element); window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  // Native browser guests are not DOM-positioned: a left/top-only move does
  // not trigger ResizeObserver, so the host must remeasure after this commit.
  useLayoutEffect(() => { window.dispatchEvent(new CustomEvent('frondose:workspace-view-geometry')); }, [geometry, hideHeaders, selectedId, compact]);
  useEffect(() => () => pointerCleanup.current?.(), []);
  const resize = useCallback((event, id) => {
    if (!callback.current || event.button !== undefined && event.button !== 0) return;
    event.preventDefault(); pointerCleanup.current?.();
    const divider = event.currentTarget; let frame = null, latest = null;
    divider.focus({ preventScroll: true });
    divider.setPointerCapture(event.pointerId);
    canvas.current.dataset.resizing = 'true';
    const apply = point => {
      const node = geometryRef.current.dividers.find(item => item.id === id), element = canvas.current;
      if (!node || !element) return;
      const current = element.getBoundingClientRect();
      callback.current?.(resizeViewLayout(layoutRef.current, id, workspaceDividerRatio(node, { x: point.clientX - current.left, y: point.clientY - current.top })));
    };
    const cleanup = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      divider.removeEventListener('pointermove', move); divider.removeEventListener('pointerup', end); divider.removeEventListener('pointercancel', cancel);
      divider.removeEventListener('lostpointercapture', cancel); document.removeEventListener('keydown', escape);
      if (divider.hasPointerCapture?.(event.pointerId)) divider.releasePointerCapture(event.pointerId);
      if (canvas.current) delete canvas.current.dataset.resizing;
      if (pointerCleanup.current === cleanup) pointerCleanup.current = null;
    };
    const move = point => { latest = { clientX: point.clientX, clientY: point.clientY }; if (frame === null) frame = requestAnimationFrame(() => { frame = null; if (latest) apply(latest); }); };
    const end = point => { if (Number.isFinite(point.clientX) && Number.isFinite(point.clientY)) apply(point); cleanup(); };
    const cancel = () => cleanup();
    const escape = key => { if (key.key === 'Escape') { key.preventDefault(); cleanup(); } };
    pointerCleanup.current = cleanup;
    divider.addEventListener('pointermove', move); divider.addEventListener('pointerup', end); divider.addEventListener('pointercancel', cancel); divider.addEventListener('lostpointercapture', cancel); document.addEventListener('keydown', escape);
  }, []);
  const keyResize = (event, node) => {
    if (!onLayout) return;
    const negative = node.axis === 'row' ? 'ArrowLeft' : 'ArrowUp', positive = node.axis === 'row' ? 'ArrowRight' : 'ArrowDown';
    if (![negative, positive, 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? .1 : .04;
    const ratio = event.key === 'Home' ? .12 : event.key === 'End' ? .88 : node.ratio + (event.key === positive ? step : -step);
    onLayout(resizeViewLayout(layoutRef.current, node.id, ratio));
  };
  return <div className="workspace-view-grid" ref={canvas} data-view-measured={String(bounds.width > 0 && bounds.height > 0)} data-multiple-views={String(views.length > 1)} data-compact-views={String(compact)}>
    <div className="workspace-view-switcher" role="tablist" aria-label="Views in this tab" aria-orientation="horizontal">
      {views.map((view, index) => <button key={view.entityId} type="button" role="tab" id={`workspace-view-option-${view.id}`} aria-controls={`workspace-pane-${view.id}`} aria-selected={selectedId === view.id} tabIndex={selectedId === view.id ? 0 : -1} disabled={previewIds.has(view.id)} ref={element => { if (element) switchButtons.current.set(view.id, element); else switchButtons.current.delete(view.id); }} onClick={() => onFocus?.(view.id)} onKeyDown={event => { const next = workspaceViewSwitchIndex(event.key, index, views.length); if (next < 0) return; event.preventDefault(); const target = views[next]; if (!previewIds.has(target.id)) { onFocus?.(target.id); switchButtons.current.get(target.id)?.focus(); } }}>{view.label}</button>)}
    </div>
    <div className="workspace-view-leaves">
      {views.map(view => <WorkspaceViewLeaf key={view.entityId} view={view} rect={rectangles.get(view.id)} focused={selectedId === view.id} preview={previewIds.has(view.id)} hideHeaders={hideHeaders || compact} compact={compact} renderView={renderView} onFocus={onFocus} onHover={views.length>1&&canDragViews?onHover:undefined} onResetHover={onResetHover} onDragOverView={onDragOverView} onDropView={onDropView} onDetach={onDetach} canDragViews={canDragViews && !compact} onDragStartView={onDragStartView} onDragEndView={onDragEndView} onPointerDownView={onPointerDownView} />)}
    </div>
    <div className="workspace-view-dividers">
      {geometry.dividers.map(node => <div key={node.id} className={`workspace-view-divider workspace-view-divider-${node.axis}`} style={{ left: node.left, top: node.top, width: node.width, height: node.height }} data-workspace-split-id={node.id} role="separator" aria-label={`Resize ${node.axis === 'row' ? 'side-by-side' : 'stacked'} views`} aria-orientation={node.axis === 'row' ? 'vertical' : 'horizontal'} aria-valuemin={12} aria-valuemax={88} aria-valuenow={Math.round(node.ratio * 100)} aria-valuetext={`${Math.round(node.ratio * 100)}% ${node.axis === 'row' ? 'left' : 'top'}`} tabIndex={onLayout ? 0 : -1} onPointerDown={event => resize(event, node.id)} onKeyDown={event => keyResize(event, node)} onDoubleClick={() => onLayout?.(resizeViewLayout(layoutRef.current, node.id, .5))} />)}
    </div>
  </div>;
}

export function WorkspaceTabMenu({menu,orientation,canSplit,onClose,onRename,onRefresh,onSplit,onOrientation,onArrange,onCloseTab,extraItems=[]}) {
 return <ContextMenu x={menu.x} y={menu.y} label={'Options for '+menu.label} onClose={onClose} items={[...extraItems,{separator:true},{label:'Rename tab',icon:Pencil,run:onRename},{label:'Refresh view',icon:RotateCcw,run:onRefresh},{label:'New split view with current tab',icon:PanelLeft,disabled:!canSplit,run:onSplit},{label:orientation==='vertical'?'Show tabs horizontally':'Show tabs vertically',icon:PanelRight,run:onOrientation},{label:'Arrange views automatically',icon:LayoutGrid,run:onArrange},{label:'Close tab',icon:X,run:onCloseTab}]}/>;
}

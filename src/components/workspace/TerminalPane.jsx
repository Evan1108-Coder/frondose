import {ContextMenu} from '../ContextMenu.jsx';
import {copyUserText} from '../../lib/clipboard.js';
import { useEffect, useRef, useState } from 'react';
import { ErrorMessage } from '../../ui.jsx';
import { workbenchRequest } from '../../lib/workbench.js';
import { createTerminalInputQueue } from '../../lib/terminal-input-queue.js';
import { useTerminalPreferences } from '../../lib/use-terminal-preferences.js';
import { terminalOptions } from '../../lib/terminal-preferences.js';
import { consumeContextDrag, isWorkspaceContextDrag, isContextDropCenter, terminalAiProvider } from '../../lib/workspace-context-drop.js';
import {apiRequest} from '../../data/api.js';
import {loadTerminalDropInput,validateDropPaste} from '../../lib/terminal-drop-input.js';
import './terminal-pane.css';

// Display only: restoration/unmount never launches or stops the underlying PTY.
export function TerminalPane({ reviewRequest,onReviewConsumed,scope, terminal, fontSize = 13, active = true, focusRequested = false, onReviewActivation=()=>{}, onEnded = () => {} }) {
  const host = useRef(null), instance = useRef(null), cursor = useRef(0), ended = useRef(false), fitView = useRef(null);
  const reviewActivation=useRef(onReviewActivation);reviewActivation.current=onReviewActivation;
  const dropRequest=useRef(null),inputEpoch=useRef(0),terminalRef=useRef(terminal);terminalRef.current=terminal;
  const activeRef = useRef(active), endedRef = useRef(onEnded);
  activeRef.current = active; endedRef.current = onEnded;
  const [error, setError] = useState(null), [behind, setBehind] = useState(false);
  const [contextMenu,setContextMenu]=useState(null);
  const [dropActive,setDropActive]=useState(false),[dropPending,setDropPending]=useState(false);
  useEffect(()=>()=>{dropRequest.current?.abort();},[scope.workspaceId,scope.projectId,scope.host,terminal.id]);
  const acceptsContext = Boolean(terminal.status === 'running');
  function contextDrag(event) { if (!isWorkspaceContextDrag(event.dataTransfer)) return; if (!isContextDropCenter(event.dataTransfer, event, event.currentTarget.getBoundingClientRect())) { setDropActive(false); return; } event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = acceptsContext ? 'copy' : 'none'; setDropActive(acceptsContext); window.dispatchEvent(new Event('frondose:workspace-context-hover')); }
  async function pasteReference(source){
    dropRequest.current?.abort();const controller=new AbortController();dropRequest.current=controller;
    const captured={terminalId:terminal.id,epoch:inputEpoch.current,xterm:instance.current};
    reviewActivation.current();setDropPending(true);setError(null);
    try{
      const text=await loadTerminalDropInput(apiRequest,scope.workspaceId,source,{signal:controller.signal,plainShell:!terminalAiProvider(terminal)});
      if(controller.signal.aborted)return;
      const current=terminalRef.current,xterm=instance.current;
      if(!captured.xterm||xterm!==captured.xterm||current.id!==captured.terminalId||current.status!=='running'||xterm.options.disableStdin||!activeRef.current||inputEpoch.current!==captured.epoch)throw Error('The target or its input changed while reading the reference. Nothing was inserted; drop it again.');
      xterm.paste(validateDropPaste(text,{bracketed:xterm.modes.bracketedPasteMode}));xterm.focus();
    }catch(cause){if(!controller.signal.aborted)setError(cause);}finally{if(dropRequest.current===controller){dropRequest.current=null;setDropPending(false);}}
  }
  function contextDrop(event){if(!isWorkspaceContextDrag(event.dataTransfer)||!isContextDropCenter(event.dataTransfer,event,event.currentTarget.getBoundingClientRect()))return;event.preventDefault();event.stopPropagation();setDropActive(false);const source=consumeContextDrag(event.dataTransfer,scope.workspaceId);if(!source){setError(Error('Drag this reference again from this workspace. No text was inserted.'));return;}if(!acceptsContext){setError(Error('This terminal is not running. Nothing was inserted.'));return;}void pasteReference(source);}
  const consumedReview=useRef(null);
  useEffect(()=>{if(!reviewRequest||reviewRequest.requestId===consumedReview.current||reviewRequest.terminalId!==terminal.id)return;consumedReview.current=reviewRequest.requestId;void pasteReference(reviewRequest.source);onReviewConsumed?.();},[reviewRequest,terminal.id,onReviewConsumed]);
  const [preferences] = useTerminalPreferences(), preferencesRef = useRef(preferences), [ready, setReady] = useState(0);
  preferencesRef.current = preferences;
  useEffect(() => {
    let cancelled = false, pollTimer, resizeTimer, frame, observer, disposeInput, disposeScroll, polling = false, readAgain = false, lastSize = '', observedRunning = ['running', 'stopping'].includes(terminal.status);
    const controller = new AbortController(), pendingScope = scope;
    const requestRead = () => { clearTimeout(pollTimer); if (polling) readAgain = true; else void poll(); };
    const input = createTerminalInputQueue({ send: data => workbenchRequest(pendingScope, `terminals/${terminal.id}/input`, { method: 'POST', body: { data }, signal: controller.signal }), onWritten: requestRead, onError: cause => { if (!cancelled) setError(cause); } });
    async function poll() {
      if (cancelled || !instance.current || polling) return;
      polling = true; readAgain = false;
      try {
        const result = await workbenchRequest(pendingScope, `terminals/${terminal.id}`, { body: { cursor: cursor.current, wait_ms: activeRef.current ? 40 : 0 }, signal: controller.signal });
        if (cancelled) return;
        const xterm = instance.current;
        if (result.reset) xterm.reset();
        if (result.output) xterm.write(result.output, () => { if (!cancelled) setBehind(xterm.buffer.active.viewportY < xterm.buffer.active.baseY); });
        if (result.output_warning) setError(new Error(result.output_warning));
        cursor.current = result.cursor;
        const running = ['running', 'stopping'].includes(result.status);
        xterm.options.disableStdin = !running;
        if (!running) { if (!ended.current) { ended.current = true; endedRef.current(observedRunning ? result : null); } return; }
        observedRunning = true;
        pollTimer = setTimeout(poll, readAgain ? 0 : activeRef.current ? result.output ? 0 : 60 : 750);
      } catch (cause) { if (!cancelled) { setError(cause); pollTimer = setTimeout(poll, 1000); } }
      finally { polling = false; }
    }
    async function setup() {
      try {
        const [{ Terminal: XTerminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/xterm/css/xterm.css')]);
        if (cancelled) return;
        const xterm = new XTerminal({ ...terminalOptions(preferencesRef.current, { light: document.documentElement.dataset.theme === 'light', platform: navigator.platform, fallbackSize: fontSize }), scrollOnUserInput: false, smoothScrollDuration: 0, allowProposedApi: false });
        const fit = new FitAddon(); xterm.loadAddon(fit); xterm.open(host.current); instance.current = xterm; cursor.current = 0; ended.current = false;
        setReady(value => value + 1);
        let optionSide = null;
        xterm.attachCustomKeyEventHandler(event => {
          const pref = preferencesRef.current;
          if (event.code === 'AltLeft' || event.code === 'AltRight') optionSide = event.type === 'keydown' ? event.code : null;
          xterm.options.macOptionIsMeta = /Mac/.test(navigator.platform) && (['auto', 'both'].includes(pref.optionAsAlt) || pref.optionAsAlt === 'left' && optionSide === 'AltLeft' || pref.optionAsAlt === 'right' && optionSide === 'AltRight');
          if (pref.jisYen && event.type === 'keydown' && event.code === 'IntlYen' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); input.enqueue('\\'); return false; }
          return true;
        });
        xterm.attachCustomWheelEventHandler(() => { xterm.options.scrollSensitivity = xterm.buffer.active.type === 'alternate' ? preferencesRef.current.tuiScroll : preferencesRef.current.scroll; return true; });
        const resize = () => {
          if (cancelled || !host.current?.clientWidth || frame) return;
          frame = requestAnimationFrame(() => {
            frame = null; if (cancelled || !host.current?.clientWidth) return; fit.fit();
            const size = `${xterm.cols}:${xterm.rows}`; if (size === lastSize) return; lastSize = size;
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => workbenchRequest(pendingScope, `terminals/${terminal.id}/resize`, { method: 'POST', body: { cols: xterm.cols, rows: xterm.rows }, signal: controller.signal }).catch(() => {}), 40);
          });
        };
        fitView.current = resize; resize(); observer = new ResizeObserver(resize); observer.observe(host.current);
        disposeInput = xterm.onData(value => {inputEpoch.current++;input.enqueue(value);});
        disposeScroll = xterm.onScroll(() => setBehind(xterm.buffer.active.viewportY < xterm.buffer.active.baseY));
        // Focus is requested only by a newly consumed explicit launch, never restore.
        if (focusRequested && activeRef.current) xterm.focus();
        void poll();
      } catch (cause) { if (!cancelled) setError(cause); }
    }
    void setup();
    return () => { cancelled = true; controller.abort(); input.dispose(); fitView.current = null; clearTimeout(pollTimer); clearTimeout(resizeTimer); if (frame) cancelAnimationFrame(frame); observer?.disconnect(); disposeInput?.dispose(); disposeScroll?.dispose(); instance.current?.dispose(); instance.current = null; };
  }, [terminal.id]);
  useEffect(() => {
    const apply = () => { if (!instance.current) return; Object.assign(instance.current.options, terminalOptions(preferences, { light: document.documentElement.dataset.theme === 'light', platform: navigator.platform, fallbackSize: fontSize })); fitView.current?.(); };
    apply(); const observer = new MutationObserver(apply); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [ready, preferences, fontSize]);
  useEffect(() => {
    const xterm = instance.current; if (!xterm) return;
    let cancelled = false, renderer, images, loss;
    host.current.dataset.renderer = 'dom';
    if (preferences.gpu !== 'off') import('@xterm/addon-webgl').then(({ WebglAddon }) => { if (cancelled) return; try { renderer = new WebglAddon(); xterm.loadAddon(renderer); host.current.dataset.renderer = 'webgl'; loss = renderer.onContextLoss(() => { renderer?.dispose(); renderer = null; if (host.current) host.current.dataset.renderer = 'dom'; }); } catch { renderer?.dispose(); renderer = null; } }).catch(() => {});
    if (preferences.inlineImages) import('@xterm/addon-image').then(({ ImageAddon }) => { if (cancelled) return; try { images = new ImageAddon({ enableSizeReports: false, pixelLimit: 1048576, storageLimit: 16, sixelSizeLimit: 2097152, iipSizeLimit: 2097152, sixelPaletteLimit: 256, sixelSupport: true, iipSupport: true }); xterm.loadAddon(images); } catch (cause) { images?.dispose(); images = null; setError(cause); } }).catch(setError);
    return () => { cancelled = true; loss?.dispose(); renderer?.dispose(); images?.dispose(); };
  }, [ready, preferences.gpu, preferences.inlineImages]);
  function terminalAction(action){host.current?.dispatchEvent(new CustomEvent('frondose:terminal-action',{bubbles:true,detail:{terminalId:terminal.id,action}}));}
  async function pasteClipboard(){try{const text=await navigator.clipboard.readText();if(text.length>65536)throw Error('Paste is limited to 64 KiB.');if(!acceptsContext)throw Error('This terminal is no longer running.');instance.current?.paste(text);}catch(error){setError(error);}}
  const contextItems=[{label:'Copy selection',disabled:!instance.current?.hasSelection(),run:()=>void copyUserText(instance.current.getSelection()).then(ok=>{if(!ok)setError(Error('Clipboard access is unavailable.'));}).catch(setError)},{label:'Paste',disabled:!acceptsContext,run:pasteClipboard},{label:'Select all',run:()=>instance.current?.selectAll()},{label:'Clear selection',run:()=>instance.current?.clearSelection()},{separator:true},...['top','bottom','left','right'].map(side=>({label:'Split terminal '+(side==='top'?'above':side==='bottom'?'below':side),disabled:!acceptsContext,run:()=>terminalAction('split-'+side)})),{separator:true},{label:'Quick Commands',run:()=>terminalAction('quick-commands')},{label:'Clear visible output',run:()=>instance.current?.clear()},{label:'Scroll to latest',run:()=>instance.current?.scrollToBottom()},{label:'Hide pane without stopping',run:()=>terminalAction('hide')},{label:'Stop session…',disabled:!acceptsContext,run:()=>terminalAction('stop')}];
  return <><ErrorMessage error={error} /><div className="wb-terminal-canvas" data-context-drop={dropActive || undefined} data-field-defaults-exclude="true" onDragOverCapture={contextDrag} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDropActive(false); }} onDropCapture={contextDrop}><div ref={host} className="wb-xterm" aria-label={`Interactive terminal ${terminal.name}`} onMouseEnter={() => { if (activeRef.current && preferencesRef.current.focusFollowsMouse) instance.current?.focus(); }} onContextMenu={event=>{event.preventDefault();if(event.shiftKey&&preferencesRef.current.rightClickPaste){void pasteClipboard();return;}setContextMenu({x:event.clientX,y:event.clientY});}} />{dropActive ? <div className="workspace-context-drop-hint">Release to insert reference</div> : null}{behind ? <button type="button" className="wb-terminal-latest" onClick={() => { instance.current?.scrollToBottom(); instance.current?.focus(); }} aria-label="Scroll terminal to latest">Scroll to latest ↓</button> : null}</div>{contextMenu?<ContextMenu {...contextMenu} label="Terminal actions" items={contextItems} onClose={()=>setContextMenu(null)}/>:null}{dropPending?<span className="terminal-drop-status" role="status">Reading reference…</span>:null}</>;
}

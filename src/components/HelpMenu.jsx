import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Keyboard, PanelLeft, Settings, MessageCircle, ChevronDown, RotateCw } from './icons.jsx';
import { Dialog, useApp } from '../ui.jsx';
import { usePopupMotion } from './usePopupMotion.js';
import { popupTriggerNextOpen } from '../lib/popup-motion.js';
import './help-menu.css';
import {requestWorkspaceTool} from '../lib/workspace-tool-intent.js';
import {desktopUpdateCommand} from '../lib/desktop-updates.js';
import {requestUpdateNavigation} from './UnsavedUpdates.jsx';
import { PRODUCT_UPDATES, recentProductUpdates } from '../lib/product-updates.js';
import { DOC_ARTICLES } from '../lib/docs-content.js';
import { productUpdateScope, readProductUpdateReads, recordProductUpdateRead, unreadProductUpdate } from '../lib/product-update-state.js';
import { ReleaseReader } from './ReleaseReader.jsx';
import { isLocalProduct } from '../lib/local-product.js';
import { installedReleaseFor, installedReleaseScope, readInstalledReleaseVersion, recordInstalledReleaseVersion } from '../lib/installed-release-state.js';

export function HelpMenu({ onNavigate, onAction, overlayOpen }) {
  const language=useInterfaceLanguage(),t=text=>interfaceText(text,language);
  const { navigate, customizeSidebar, showShortcuts, showFeedback, data, workspace } = useApp();
  const [open, setOpen] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [release, setRelease] = useState(null);
  const [desktopInfo, setDesktopInfo] = useState(null);
  const readKey = productUpdateScope(data.profile?.id ?? 'local-owner', workspace?.id);
  const readReceipts = () => { try { return readProductUpdateReads(window.localStorage, readKey); } catch { return readProductUpdateReads(null, readKey); } };
  const [receipts, setReceipts] = useState(() => ({ key: readKey, value: readReceipts() }));
  const updates = recentProductUpdates().filter(update => DOC_ARTICLES.some(article => article.id === update.articleId && article.group === 'updates'));
  const announcement = unreadProductUpdate(updates, receipts.key === readKey ? receipts.value : readReceipts(), DOC_ARTICLES);
  const [position, setPosition] = useState({ left: 8, bottom: 64 });
  const trigger = useRef(null), menu = useRef(null);
  const popup = usePopupMotion(open, menu);
  const initialItem = useRef('first');
  const pointerDownOpen = useRef(null);
  const id = useId();
  const installedKey = installedReleaseScope(readKey);
  useEffect(() => {
    let cancelled = false;
    globalThis.frondoseDesktop?.appInfo?.().then(info => { if (!cancelled) setDesktopInfo(info); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    setReceipts({ key: readKey, value: readReceipts() });
    setRelease(null);
    const refresh = event => { if (!event.key || event.key === readKey) setReceipts({ key: readKey, value: readReceipts() }); };
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener('storage', refresh); };
  }, [readKey]);
  useEffect(() => {
    if (!installedKey || desktopInfo?.packaged !== true || overlayOpen) return;
    let storage; try { storage = window.localStorage; } catch { return; }
    const previous = readInstalledReleaseVersion(storage, installedKey);
    if (!previous) { recordInstalledReleaseVersion(storage, installedKey, desktopInfo.version); return; }
    const update = installedReleaseFor(desktopInfo, previous, PRODUCT_UPDATES, DOC_ARTICLES);
    if(update){if(isLocalProduct(data)){recordInstalledReleaseVersion(storage,installedKey,desktopInfo.version);openRelease(update);}else setRelease({update,key:readKey,installedKey});}
  }, [desktopInfo, installedKey, readKey, overlayOpen]);
  useEffect(() => { if (overlayOpen) setOpen(false); }, [overlayOpen]);
  const close = callback => {
    if (!open) return;
    setOpen(false);
    callback?.();
  };
  useEffect(() => {
    if (!open) return;
    const positionMenu = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (rect) setPosition({ left: Math.max(8, Math.min(rect.right - 252, window.innerWidth - 260)), bottom: Math.max(8, window.innerHeight - rect.top + 8) });
    };
    positionMenu();
    const frame = requestAnimationFrame(() => {
      const buttons = menu.current?.querySelectorAll('[role="menuitem"]');
      buttons?.[initialItem.current === 'last' ? buttons.length - 1 : 0]?.focus();
    });
    const outside = event => {
      if (!menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) close();
    };
    const escape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      close(); trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', positionMenu);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', positionMenu);
    };
  }, [open]);
  const run = action => {
    trigger.current?.focus();
    close(() => { onAction?.(); action(); });
  };
  const go = onNavigate ?? navigate;
  const openRelease=update=>{if(!isLocalProduct(data)){setRelease({update,key:readKey});return;}requestUpdateNavigation(()=>{requestWorkspaceTool(workspace.id,'release-notes',{releaseId:update.id,label:update.title||'What’s New'},()=>go('workspace'));});};
  const dismissRelease = () => {
    if (release?.key === readKey && release.installedKey && release.update.installedVersion) {
      try { recordInstalledReleaseVersion(window.localStorage, release.installedKey, release.update.installedVersion); } catch { /* Blocked storage never blocks dismissal. */ }
    }
    if (release?.key === readKey && DOC_ARTICLES.some(article => article.id === release.update.articleId)) {
      let next;
      try { next = recordProductUpdateRead(window.localStorage, readKey, release.update.id); }
      catch { next = recordProductUpdateRead(null, readKey, release.update.id); }
      setReceipts({ key: readKey, value: next });
    }
    setRelease(null);
    // The unread title disappears on dismiss; return focus to its surviving Help control.
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const items = [
    ['Docs', BookOpen, () => go('docs')],
    ['Check for updates',RotateCw,async()=>{const result=await desktopUpdateCommand({operation:'check'}).catch(()=>null);if(result?.release&& !['unsupported','unconfigured'].includes(result.phase))window.dispatchEvent(new Event('frondose:show-app-update'));else go('settings','app-updates');}],
    ['Contact us', MessageCircle, showFeedback],
    ['What the tools mean', BookOpen, () => setTermsOpen(true)],
    ['Sidebar customization', PanelLeft, customizeSidebar],
    ['Keyboard shortcuts', Keyboard, showShortcuts],
    ['Tip preferences', Settings, () => window.dispatchEvent(new CustomEvent('frondose-workspace-tip-settings', {detail:{workspaceId:workspace.id}}))],
    ['Full changelog', BookOpen, () => go('docs', 'group-updates')],
    ...(!isLocalProduct(data) ? [['Historical conversations', MessageCircle, () => go('chats')]] : []),
  ];
  return <>
    <div className={`rumbo-help-controls${announcement ? ' has-announcement' : ''}`}>
    {announcement ? <button type="button" className="rumbo-release-trigger" title={t(announcement.title)} aria-label={formatInterfaceText('What’s new: {{name}}',{name:t(announcement.title)},language)} onClick={() => openRelease(announcement)}><span className="rumbo-release-unread" aria-hidden="true" /><span>{t(announcement.title)}</span></button> : null}
    <button type="button" ref={trigger} className="rumbo-help-trigger" aria-label="Help and resources" aria-haspopup="menu" aria-controls={open ? id : undefined} aria-expanded={open} onPointerDown={event => { if (event.button === 0) pointerDownOpen.current = open; }} onPointerCancel={() => { pointerDownOpen.current = null; }} onClick={() => { initialItem.current = 'first'; setOpen(popupTriggerNextOpen(open, pointerDownOpen.current)); pointerDownOpen.current = null; }} onKeyDown={event => {
      pointerDownOpen.current = null;
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault(); initialItem.current = event.key === 'ArrowUp' ? 'last' : 'first'; setOpen(true);
    }}>{announcement ? <ChevronDown aria-hidden="true" /> : <span aria-hidden="true">?</span>}</button>
    </div>
    {popup.present ? createPortal(<div {...popup.motionProps} id={id} ref={menu} className="rumbo-help-menu" role="menu" aria-label="Help and resources" data-rumbo-popup={open || undefined} style={position} onBlur={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) close();
    }} onKeyDown={event => {
      const buttons = [...event.currentTarget.querySelectorAll('[role="menuitem"]')];
      const index = buttons.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
      if (event.key === 'Tab') close();
      if (event.key.length === 1 && /[a-z]/i.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const ordered = [...buttons.slice(index + 1), ...buttons.slice(0, index + 1)];
        const match = ordered.find(button => button.textContent.toLowerCase().startsWith(event.key.toLowerCase()));
        if (match) { event.preventDefault(); match.focus(); }
      }
    }}>
      <div className="rumbo-help-menu-label">Frondose Resources</div>
      {items.map(([label, Icon, action]) => <button type="button" role="menuitem" key={label} onClick={() => run(action)}><Icon /><span>{label}</span></button>)}
      <div className="rumbo-help-menu-label">What’s New</div>
      <div className="rumbo-update-timeline">
      {updates.map(update => <button type="button" role="menuitem" key={update.id} onClick={() => run(() => openRelease(update))}><span className="rumbo-update-dot" aria-hidden="true" /><span>{t(update.title)}</span></button>)}
      </div>
      <div role="separator" className="menu-divider" />
      <button type="button" role="menuitem" onClick={() => run(() => go('settings'))}><Settings /><span>Settings</span></button>
    </div>, document.body) : null}
    {release?.key === readKey ? <ReleaseReader update={release.update} article={localizeBuiltInDoc(DOC_ARTICLES.find(article => article.id === release.update.articleId),language)} onClose={dismissRelease} onOpenDocs={() => { const articleId = release.update.articleId || 'group-updates'; dismissRelease(); onAction?.(); go('docs', articleId); }} /> : null}
    {termsOpen ? <Dialog title="What the tools mean" subtitle="A short map of Frondose’s work surfaces." onClose={() => setTermsOpen(false)}><dl className="rumbo-terms">
      <div><dt>Workspace</dt><dd>One project directory, with planning pages, files and local session tabs.</dd></div>
      <div><dt>AI CLI</dt><dd>An installed command-line AI tool running as your computer’s user. Detection is not sign-in; launching a session requires your explicit choice.</dd></div>
      <div><dt>Terminal</dt><dd>Your local shell, including split panes. Replacing its view does not stop a running process.</dd></div>
      <div><dt>Browser</dt><dd>Frondose desktop’s isolated Chromium session, separate from your normal browser profile.</dd></div>
      <div><dt>Knowledge and Memory</dt><dd>Knowledge holds reviewed sources and outputs; Memory keeps explicit notes for future context. Neither grants an agent new access by itself.</dd></div>
    </dl></Dialog> : null}
  </>;
}
import {useInterfaceLanguage} from './InterfaceLanguage.jsx';
import {interfaceText,formatInterfaceText} from '../lib/interface-language.js';
import {localizeBuiltInDoc} from '../lib/built-in-copy.js';

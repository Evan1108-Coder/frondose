import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {IconButton} from '../../ui.jsx';
import {Plus,Terminal,Globe,FileText,Code,RotateCcw,Search} from '../icons.jsx';
import {usePopupPosition} from '../usePopupPosition.js';
import {usePopupMotion} from '../usePopupMotion.js';
import {useInterfaceLanguage} from '../InterfaceLanguage.jsx';
import {interfaceText} from '../../lib/interface-language.js';
import {workspaceTabDisplayLabel} from '../../lib/built-in-copy.js';
import './new-tab-menu.css';
export function NewTabButton({onCreate,onChoose,rootReady,onBrowseCodex,tabs,onSelectTab,onHistory}){
 const language=useInterfaceLanguage(),t=copy=>interfaceText(copy,language),tabLabel=tab=>workspaceTabDisplayLabel(tab,language);
 const trigger=useRef(null),panel=useRef(null),search=useRef(null),[open,setOpen]=useState(false),[query,setQuery]=useState('');
 const position=usePopupPosition(open,trigger,{width:360,height:500,portal:true}),popup=usePopupMotion(open,panel,{ready:Boolean(position)});
 const close=(restore=false)=>{setOpen(false);if(restore)trigger.current?.focus();};
 const show=event=>{event.preventDefault();setQuery('');setOpen(true);};
 useEffect(()=>{if(!open)return;search.current?.focus();const outside=e=>{if(!panel.current?.contains(e.target)&&!trigger.current?.contains(e.target))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open,Boolean(position)]);
 const action=fn=>{close();fn();};
 const choices=[{id:'terminal',label:'New Terminal',icon:Terminal,run:()=>onChoose('terminal',{label:'Terminal'})},{id:'browser',label:'New Browser Tab',icon:Globe,disabled:!globalThis.frondoseDesktop?.browser?.available,run:()=>onChoose('browser',{label:'Browser'})},{id:'markdown',label:'New Markdown file',icon:FileText,disabled:!rootReady,run:()=>onChoose('editor',{label:'Untitled.md',path:'Untitled.md',draft:true})},{id:'editor',label:'Text editor',icon:Code,disabled:!rootReady,run:()=>onChoose('editor-home',{label:'Text editor'})},{id:'history',label:'Session history',icon:RotateCcw,run:onHistory}];
 if(onBrowseCodex)choices.push({id:'codex-history',label:'Browse all Codex chats',icon:Terminal,run:onBrowseCodex});
 const match=label=>label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),shown=choices.filter(item=>match(t(item.label))||match(item.label)),openTabs=query.trim()?tabs.filter(tab=>match(tabLabel(tab))||match(tab.label)):[];
 const key=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)||event.target===search.current&&['Home','End'].includes(event.key))return;event.preventDefault();const items=[search.current,...panel.current.querySelectorAll('[role="menuitem"]:not(:disabled)')],index=items.indexOf(document.activeElement);items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowUp'?-1:1)+items.length)%items.length]?.focus();};
 return <><IconButton ref={trigger} label="New tab" data-workspace-new-tab="true" aria-haspopup="menu" aria-expanded={open} onClick={()=>{close();onCreate();}} onContextMenu={show} onKeyDown={event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'||event.altKey&&event.key==='ArrowDown')show(event);}}><Plus/></IconButton>{popup.present?createPortal(<div {...popup.motionProps} ref={panel} className="new-tab-quick-menu" role="menu" aria-label="New tab quick actions" style={position||{visibility:'hidden'}} onKeyDown={key}><div className="new-tab-quick-search"><Search interactive={false}/><input ref={search} type="search" aria-label="Search actions and open tabs" placeholder="Search actions and open tabs…" value={query} onChange={e=>setQuery(e.target.value)} data-field-default-page="Workspace · Quick create" data-field-default-label="Search actions and open tabs"/></div><div className="new-tab-quick-items">{shown.map(({id,label,icon:Icon,disabled,run})=><button type="button" role="menuitem" key={id} disabled={disabled} title={disabled?(id==='browser'?'Available in Frondose desktop':'Choose a workspace directory first'):undefined} onClick={()=>action(run)}><Icon interactive={false}/><span>{t(label)}</span></button>)}{openTabs.length?<><hr/><small>Open tabs</small>{openTabs.map(tab=><button role="menuitem" type="button" key={tab.id} onClick={()=>action(()=>onSelectTab(tab))}><span>{tabLabel(tab)}</span></button>)}</>:null}{!shown.length&&!openTabs.length?<p>No matching actions or open tabs.</p>:null}</div></div>,document.body):null}</>;
}

import {useEffect,useEffectEvent,useState} from 'react';import {createPortal} from 'react-dom';import {Sparkles,X} from './icons.jsx';
import {pageHash} from '../lib/navigation.js';
import '../views/settings/workspace-setup-settings.css';
export function ChecklistCelebration({workspaceId,active,onReview}){
 const [show,setShow]=useState(false);
 const changed=useEffectEvent(event=>{if(event.detail?.workspaceId===workspaceId&&event.detail.completedNow&&!active)setShow(true);});
 useEffect(()=>{setShow(false);const listen=event=>changed(event);window.addEventListener('frondose:checklist-changed',listen);return()=>window.removeEventListener('frondose:checklist-changed',listen);},[workspaceId]);
 return show&&!active?createPortal(<section className="setup-celebration"><Sparkles/><div><div role="status"><strong>Well done!</strong><p>You finished your onboarding checklist.</p></div><a className="setup-review-link" href={pageHash('settings','onboarding-checklist')} onClick={event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();setShow(false);onReview();}}>View completed checklist</a></div><button type="button" aria-label="Dismiss setup celebration" onClick={()=>setShow(false)}><X/></button><span className="setup-sparkles" aria-hidden="true">✦ · ✧ · ✦</span></section>,document.body):null;
}

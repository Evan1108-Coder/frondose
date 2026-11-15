import {useEffect,useState} from 'react';import {createPortal} from 'react-dom';import {Sparkles,X} from './icons.jsx';
import '../views/settings/workspace-setup-settings.css';
export function ChecklistCelebration({workspaceId}){
 const [show,setShow]=useState(false);
 useEffect(()=>{setShow(false);const changed=event=>{if(event.detail?.workspaceId===workspaceId&&event.detail.completedNow)setShow(true);};window.addEventListener('frondose:checklist-changed',changed);return()=>window.removeEventListener('frondose:checklist-changed',changed);},[workspaceId]);
 useEffect(()=>{if(!show)return;const timer=setTimeout(()=>setShow(false),8000);return()=>clearTimeout(timer);},[show]);
 return show?createPortal(<section className="setup-celebration" role="status"><Sparkles/><div><strong>Workspace ready</strong><p>You finished your onboarding checklist.</p></div><button type="button" aria-label="Dismiss setup celebration" onClick={()=>setShow(false)}><X/></button><span className="setup-sparkles" aria-hidden="true">✦ · ✧ · ✦</span></section>,document.body):null;
}

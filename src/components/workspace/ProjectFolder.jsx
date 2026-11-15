import {useEffect,useMemo,useState} from 'react';
import {Dialog,ErrorMessage,useApp} from '../../ui.jsx';
import {Folder,ChevronDown,ChevronRight,Plus,Ellipsis} from '../icons.jsx';
import {readProjectFolderPreferences,saveProjectFolderPreferences,projectFolderRows} from '../../lib/project-folder.js';
import {readBranchTabsPreference,saveBranchTabsPreference} from '../../lib/branch-workspace-tabs.js';
import {Collapse} from '../Collapse.jsx';
import './project-folder.css';

export function ProjectFolder({compact,onCreate,onSelect}){
 const app=useApp();
 const [open,setOpen]=useState(true),[options,setOptions]=useState(false);
 const [prefs,setPrefs]=useState(()=>readProjectFolderPreferences(localStorage));
 const [error,setError]=useState(null);
 const [branchTabs,setBranchTabs]=useState(()=>readBranchTabsPreference(localStorage,app.workspace.id));
 const projects=useMemo(()=>projectFolderRows(app.rawData.projects||[],app.rawData.workspaces||[],prefs,app.workspace.id),[app.rawData.projects,app.rawData.workspaces,prefs,app.workspace.id]);
 useEffect(()=>setBranchTabs(readBranchTabsPreference(localStorage,app.workspace.id)),[app.workspace.id,options]);
 function save(patch){const next={...prefs,...patch};try{saveProjectFolderPreferences(localStorage,next);setPrefs(next);setError(null);}catch(cause){setError(cause);}}
 return <section className={'local-project-folder '+(compact?'compact':'')} data-workspace-projects="true" aria-label="Workspace projects">
  <header><button className="local-project-heading" aria-expanded={open} onClick={()=>setOpen(!open)}><Folder/><span>Projects</span><ChevronRight morphTo={open?ChevronDown:ChevronRight} interactive={false}/></button>{!compact?<><button aria-label="Project quick access" onClick={()=>setOptions(true)}><Ellipsis/></button><button aria-label="New project" onClick={onCreate}><Plus/></button></>:null}</header>
  <Collapse open={open&&!compact}>
   <ul className="local-project-list" aria-label="Projects">{projects.map(project=><li key={project.id}><button className="local-project-row" onClick={()=>onSelect(project)} title={project.name}><Folder/><span>{project.name}</span></button></li>)}</ul>
   {!projects.length?<button className="sidebar-empty-action" onClick={onCreate}>Create your first project</button>:null}
  </Collapse>
  {options?<Dialog title="Project quick access" onClose={()=>setOptions(false)}><div className="project-folder-options" data-field-defaults-exclude="true">
   <ErrorMessage error={error}/>
   <label>Sort by<select value={prefs.sort} onChange={e=>save({sort:e.target.value})}><option value="manual">Saved order</option><option value="name">Name</option><option value="updated">Recently updated</option></select></label>
   <hr/>
   <label><input type="checkbox" checked={branchTabs} onChange={e=>{if(saveBranchTabsPreference(localStorage,app.workspace.id,e.target.checked))setBranchTabs(e.target.checked);else setError(Error('Could not save this preference.'));}}/>Remember file/planning tabs per branch</label>
   <small>Off by default. Running terminal and browser tabs are always retained.</small>
  </div></Dialog>:null}
 </section>;
}

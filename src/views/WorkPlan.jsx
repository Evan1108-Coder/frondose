import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { ArrowDown, ArrowUp, GripVertical, RotateCw } from '../components/icons.jsx';
import { Button, ErrorMessage, IconButton, Select, useApp } from '../ui.jsx';
import { useTodos } from '../lib/local-todos.js';
import { todoStatus } from '../lib/todo-model.js';
import { teamRoutes } from '../lib/workspace-spaces.js';
import { groupWorkPlan, tomorrowPlanDate, WORK_PLAN_LANES } from '../lib/work-plan.js';
import './work-plan.css';

export function WorkPlan({ teamId = null }) {
  const { workspace, data, navigate } = useApp();
  const todos = useTodos(workspace.id, teamId);
  const endpoint = '/api/work-plan?' + new URLSearchParams({ workspace_id:workspace.id, ...(teamId ? {team_id:teamId} : {}) });
  const [plan, setPlan] = useState(null);
  const [version, reload] = useState(0);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [over, setOver] = useState(null);
  const drag = useRef(null), write = useRef(false), mounted = useRef(false);
  const origin = useRef(Symbol('work-plan'));
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    const controller = new AbortController();
    apiRequest(endpoint,{signal:controller.signal}).then(({result})=>{
      if (!controller.signal.aborted) setPlan(previous=>!previous||previous.revision<=result.revision?result:previous);
    }).catch(cause=>{if(!controller.signal.aborted)setError(cause);});
    return ()=>controller.abort();
  },[endpoint,version]);
  useEffect(()=>{
    const refresh = event => { if(event.detail?.endpoint===endpoint && event.detail.origin!==origin.current) reload(n=>n+1); };
    window.addEventListener('frondose:work-plan-changed',refresh);
    return ()=>window.removeEventListener('frondose:work-plan-changed',refresh);
  },[endpoint]);
  const columns = useMemo(()=>{
    if(!plan)return null;
    const todoCards=todos.items.filter(row=>!row.archived_at&&todoStatus(row.status)!=='finished')
      .map(row=>({key:'todo:'+row.id,id:row.id,label:row.title,view:'todos',kind:'To-do'}));
    const routes=plan.includeRoutes ? (teamId ? teamRoutes(data,teamId) : data.tasks ?? []) : [];
    const routeCards=routes.filter(row=>row.workspace_id===workspace.id&&!row.archived_at&&!['done','cancelled'].includes(row.status))
      .map(row=>({key:'route:'+row.id,id:row.id,label:row.title,view:'tasks',kind:'Route'}));
    return groupWorkPlan(plan,[...todoCards,...routeCards]);
  },[plan,todos.items,teamId,data,workspace.id]);
  async function save(change){
    if(!plan||write.current)return;
    write.current=true;setSaving(true);setError(null);
    try{
      const {result}=await apiRequest(endpoint,{method:'PATCH',body:{revision:plan.revision,...change}});
      if(mounted.current)setPlan(result);
      window.dispatchEvent(new CustomEvent('frondose:work-plan-changed',{detail:{endpoint,origin:origin.current}}));
    }catch(cause){if(mounted.current){setError(cause);if(cause.status===409)reload(n=>n+1);}}
    finally{write.current=false;if(mounted.current)setSaving(false);}
  }
  function move(item,lane,before=null){
    if(item.key===before)return;
    const existing=columns.tomorrow.find(row=>row.key===item.key);
    void save({key:item.key,lane,before:lane==='unplanned'?null:before,...(lane==='tomorrow'?{date:existing?.date||tomorrowPlanDate()}: {})});
  }
  function drop(event,lane,before=null){
    if(!drag.current)return;
    event.preventDefault();event.stopPropagation();
    const item=drag.current;drag.current=null;setOver(null);move(item,lane,before);
  }
  function allowDrop(event,target){
    if(!drag.current||saving)return;
    event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';setOver(target);
  }
  return <section className="work-plan" aria-label="Work Plan">
    <header><div><h1>Work Plan</h1><p>Put active work in the order you want to do it. Moving a card doesn’t change the original task or start an agent.</p></div>
      <div className="work-plan-controls"><label><input type="checkbox" checked={plan?.includeRoutes??false} disabled={!plan||saving} onChange={event=>save({includeRoutes:event.target.checked})}/> Include open Routes</label>
      <Button icon={RotateCw} disabled={saving} onClick={()=>{setError(null);todos.refresh();reload(n=>n+1);}}>Refresh</Button></div></header>
    <ErrorMessage error={error||todos.error}/>
    {!columns ? <p role="status">{error?'Work Plan could not be loaded.':'Loading Work Plan…'}</p> : <div className="work-plan-lanes">
      {WORK_PLAN_LANES.map(([lane,title,hint])=><section key={lane} className="work-plan-lane" aria-label={title} data-over={over===lane||undefined} onDragOver={event=>allowDrop(event,lane)} onDrop={event=>drop(event,lane)}>
        <h2>{title} <small>{columns[lane].length}</small></h2><p>{hint}</p>
        {columns[lane].length ? <ol>{columns[lane].map((item,index)=><li key={item.key} draggable={!saving} data-over={over===item.key||undefined}
          onDragStart={event=>{if(event.target.closest('button,input,select,a')){event.preventDefault();return;}drag.current=item;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-frondose-plan-card',item.key);}}
          onDragEnd={()=>{drag.current=null;setOver(null);}} onDragOver={event=>allowDrop(event,item.key)} onDrop={event=>drop(event,lane,item.key)}>
          <div className="work-plan-card-title"><GripVertical aria-hidden="true"/><button type="button" onClick={()=>navigate(item.view,item.id)}>{item.label}</button></div>
          <small>{item.kind}{item.date ? ' · '+item.date : ''}</small>
          <div className="work-plan-card-actions"><Select aria-label={'Move '+item.label} value={lane} disabled={saving} onChange={value=>move(item,value)}>
            {WORK_PLAN_LANES.map(([id,label])=><option key={id} value={id}>{label}</option>)}
          </Select>{lane!=='unplanned'?<>
            <IconButton label={'Move '+item.label+' up'} disabled={saving||index===0} onClick={()=>move(item,lane,columns[lane][index-1]?.key)}><ArrowUp/></IconButton>
            <IconButton label={'Move '+item.label+' down'} disabled={saving||index===columns[lane].length-1} onClick={()=>move(item,lane,columns[lane][index+2]?.key)}><ArrowDown/></IconButton>
          </>:null}</div>
        </li>)}</ol> : <p className="work-plan-drop-hint">{lane==='unplanned'?'No unplanned tasks.':'Drop work here'}</p>}
      </section>)}
    </div>}
  </section>;
}

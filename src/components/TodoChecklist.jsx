import {Plus,X} from './icons.jsx';
import {Button} from '../ui.jsx';
export function TodoChecklist({value=[],onChange,disabled}) {
 const completed=value.filter(item=>item.done).length;
 const update=(id,patch)=>onChange(value.map(item=>item.id===id?{...item,...patch}:item));
 return <section className="todo-checklist" aria-label="To-do checklist"><header><h3>Checklist</h3><span>{completed}/{value.length}</span></header>
 {value.map((item,index)=><div className="todo-checklist-row" key={item.id}><input type="checkbox" aria-label={'Complete checklist item '+(index+1)} checked={item.done} disabled={disabled} onChange={event=>update(item.id,{done:event.target.checked})}/><input type="text" required maxLength={500} aria-label={'Checklist item '+(index+1)} placeholder="What needs to be done?" value={item.text} disabled={disabled} onChange={event=>update(item.id,{text:event.target.value})}/><button type="button" aria-label={'Remove checklist item '+(index+1)} disabled={disabled} onClick={()=>onChange(value.filter(row=>row.id!==item.id))}><X/></button></div>)}
 <Button icon={Plus} disabled={disabled||value.length>=100} onClick={()=>onChange([...value,{id:crypto.randomUUID(),text:'',done:false}])}>Add checklist item</Button></section>;
}

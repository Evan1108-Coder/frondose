const prefix='frondose.workspace-checklist.v1:';
export const CHECKLIST_STEPS=Object.freeze([
 {id:'directory',title:'Choose a project directory',detail:'Keep planning, files and tools in one local workspace.',view:'workspace'},
 {id:'cli',title:'Choose your default CLI',detail:'Detect your installed tools and pick the one you reach for first.',setting:'cli-agents'},
 {id:'route',title:'Plan your first Route',detail:'Write a concrete outcome before starting work.',view:'tasks'},
 {id:'browser',title:'Try a Browser tab',detail:'Preview a website or local development server beside your work.',view:'workspace'},
]);
export function readChecklist(id,storage=globalThis.localStorage){try{const v=JSON.parse(storage.getItem(prefix+id)||'{}');return {observed:v.observed||{},skipped:v.skipped||{},retiredAt:typeof v.retiredAt==='string'?v.retiredAt:null,completedAt:typeof v.completedAt==='string'?v.completedAt:null};}catch{return {observed:{},skipped:{},retiredAt:null,completedAt:null};}}
export function retireChecklist(id,storage=globalThis.localStorage){const current=readChecklist(id,storage);if(!current.completedAt||current.retiredAt)return current;const next={...current,retiredAt:new Date().toISOString()};storage.setItem(prefix+id,JSON.stringify(next));return next;}
export function checklistComplete(value){return CHECKLIST_STEPS.every(step=>value.observed?.[step.id]===true||value.skipped?.[step.id]===true);}
export function updateChecklist(id,{observed={},skip}={},storage=globalThis.localStorage){
 const current=readChecklist(id,storage),next={...current,observed:{...current.observed,...Object.fromEntries(CHECKLIST_STEPS.filter(s=>observed[s.id]===true).map(s=>[s.id,true]))},skipped:{...current.skipped}};
 if(CHECKLIST_STEPS.some(s=>s.id===skip))next.skipped[skip]=true;
 if(!next.completedAt&&checklistComplete(next))next.completedAt=new Date().toISOString();
 if(JSON.stringify(current)===JSON.stringify(next))return current;
 storage.setItem(prefix+id,JSON.stringify(next));globalThis.window?.dispatchEvent(new CustomEvent('frondose:checklist-changed',{detail:{workspaceId:id,completedNow:!current.completedAt&&Boolean(next.completedAt)}}));return next;
}

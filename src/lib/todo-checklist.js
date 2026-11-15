export function validateTodoChecklist(value=[]) {
 if(!Array.isArray(value)||value.length>100)throw Error('Use at most 100 checklist items.');
 const ids=new Set();return value.map(item=>{if(!item||typeof item.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(item.id)||ids.has(item.id)||typeof item.text!=='string'||!item.text.trim()||item.text.length>500||/[\x00-\x08\x0b-\x1f\x7f]/.test(item.text)||typeof item.done!=='boolean')throw Error('Each checklist item needs a unique ID, valid text and a completion state.');ids.add(item.id);return{id:item.id,text:item.text.trim(),done:item.done};});
}
export const checklistProgress=items=>({done:(items||[]).filter(item=>item.done).length,total:(items||[]).length});

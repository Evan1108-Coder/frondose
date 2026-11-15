'use strict';
// Native guest-only edit/navigation actions; never expose the trusted preload.
function browserContextMenu({contents,params,clipboard,navigate}) {
 const items=[{label:'Back',enabled:contents.navigationHistory.canGoBack(),click:()=>contents.navigationHistory.goBack()},{label:'Forward',enabled:contents.navigationHistory.canGoForward(),click:()=>contents.navigationHistory.goForward()},{label:'Reload',click:()=>contents.reload()},{type:'separator'}];
 if(params.isEditable)items.push({label:'Cut',enabled:Boolean(params.editFlags?.canCut),click:()=>contents.cut()},{label:'Copy',enabled:Boolean(params.editFlags?.canCopy),click:()=>contents.copy()},{label:'Paste',enabled:Boolean(params.editFlags?.canPaste),click:()=>contents.paste()},{label:'Select all',click:()=>contents.selectAll()});
 else if(params.selectionText)items.push({label:'Copy selected text',click:()=>contents.copy()},{label:'Search selected text',click:()=>navigate('https://www.google.com/search?'+new URLSearchParams({q:params.selectionText.slice(0,2000)}))});
 if(params.linkURL){try{const url=new URL(params.linkURL);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)items.push({type:'separator'},{label:'Open link',click:()=>navigate(url.href)},{label:'Copy link address',click:()=>clipboard?.writeText(url.href)});}catch{}}
 if(params.srcURL){try{const url=new URL(params.srcURL);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)items.push({label:'Copy image address',click:()=>clipboard?.writeText(url.href)});}catch{}}
 return items;
}
module.exports={browserContextMenu};

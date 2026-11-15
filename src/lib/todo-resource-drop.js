import {isWorkspaceContextDrag,consumeContextDrag} from './workspace-context-drop.js';
export const isTodoResourceDrop=transfer=>isWorkspaceContextDrag(transfer)||Array.from(transfer?.types||[]).some(type=>['Files','text/uri-list','text/plain'].includes(type));
export function todoDropSource(transfer,workspaceId){
 if(isWorkspaceContextDrag(transfer)){const source=consumeContextDrag(transfer,workspaceId);if(!source)throw Error('Drag this saved resource again from this workspace.');if(source.kind==='workspace')return [{kind:'page',view:'workspace',id:null,label:'Workspace'}];if(source.kind==='selection')return [{kind:'file',path:source.path,rootVersion:source.rootVersion,label:source.path.slice(0,200)}];if(!['area-resource','file','comment','page','todo','tool','url'].includes(source.kind))throw Error('Drop an individual saved item, not an entire workspace.');return [{...source,label:(source.path||source.view||source.id||'Comment').slice(0,200)}];}
 const files=Array.from(transfer.files||[]);if(files.length)return files.map(file=>({kind:'pending-upload',file}));
 const text=(transfer.getData('text/uri-list')||transfer.getData('text/plain')||'').trim();if(!text||text.length>4000)throw Error('Drop a file, a safe link or up to 4,000 characters of text.');
 const lines=text.split(/\r?\n/).filter(line=>line&&!line.startsWith('#'));
 if(lines.length&&lines.every(line=>/^https?:\/\//i.test(line))){return lines.map(line=>{const url=new URL(line);if(url.username||url.password||url.href.length>2048)throw Error('Use HTTP(S) links without credentials.');return {kind:'url',url:url.href,label:url.hostname};});}
 if(/^(?:javascript|vbscript|data|file|shell):|^[a-z][a-z0-9+.-]*:\/\//i.test(text))throw Error('Drop an HTTP(S) link, not an executable or local-file URL.');
 return [{kind:'note',text,label:text.split('\n')[0].slice(0,100)||'Text reference'}];
}
export function encodeDroppedFile(file){return new Promise((resolve,reject)=>{if(!file.size||file.size>25*1024*1024){reject(Error('Drop a non-empty file of at most 25 MB.'));return;}const reader=new FileReader();reader.onerror=()=>reject(Error('This file could not be read.'));reader.onload=()=>resolve({name:file.name,data_base64:String(reader.result).split(',')[1]});reader.readAsDataURL(file);});}

// Orca-inspired captured-destination/path paste; Frondose authority stays server-side.
import {loadContextPreview} from './context-preview.js';
import {directoryApiPath} from './directory-drafts.js';
export function quoteDroppedPath(path){
 if(typeof path!=='string'||!path||path.length>4096||/[\x00-\x1f\x7f]/.test(path))throw Error('This file path cannot be pasted safely.');
 return "'"+path.replaceAll("'","'\\''")+"' ";
}
export async function loadTerminalDropInput(request,workspaceId,source,{signal,plainShell=false}={}){
 if(source.kind==='file'){
  const [{result:directory},{result:file}]=await Promise.all([request(directoryApiPath(workspaceId),{signal}),request(directoryApiPath(workspaceId,'file',{path:source.path,expected_binding_version:source.rootVersion}),{signal})]);
  if(!directory?.binding?.path||directory.binding.version!==source.rootVersion||file.path!==source.path)throw Error('The directory changed. Drag the file again.');
  return quoteDroppedPath(directory.binding.path.replace(/[\\/]$/,'')+'/'+file.path);
 }
 const text=await loadContextPreview(request,workspaceId,source,{signal});
 return plainShell?text.split('\n').map(line=>'# '+line).join('\n'):text;
}
export function validateDropPaste(text,{bracketed=false}={}){
 if(typeof text!=='string'||!text||text.length>24000||/[\x00-\x08\x0b-\x1f\x7f]/.test(text))throw Error('The reference cannot be pasted safely.');
 if(/[\r\n]/.test(text)&&!bracketed)throw Error('This terminal is not accepting safe multiline paste. Nothing was inserted.');
 return text;
}

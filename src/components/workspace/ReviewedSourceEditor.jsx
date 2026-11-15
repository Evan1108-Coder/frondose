import {forwardRef,useEffect,useMemo,useState} from 'react';
import {useApp} from '../../ui.jsx';
import {SourceCodeEditor} from './SourceCodeEditor.jsx';
import {FileCommentComposer,FileCommentThread,FileCommentHandoff} from './FileComments.jsx';
import {apiRequest} from '../../data/api.js';
import {fileCommentsApiPath,commentDragProps} from '../../lib/file-comments.js';
import {requestUpdateNavigation} from '../UnsavedUpdates.jsx';
import './review-notes.css';
/** Portal containers outlive CodeMirror viewport widgets: scrolling a note off
 * screen does not discard its reply or pending save. One editor owns scrolling. */
export const ReviewedSourceEditor=forwardRef(function ReviewedSourceEditor({workspaceId,bindingVersion,fileVersion,dirty,noteDraft,onNote,onCloseNote,onCreated,...props},ref){
 const {navigate}=useApp();
 const [threads,setThreads]=useState([]),[revision,setRevision]=useState(0),[error,setError]=useState(null),[expanded,setExpanded]=useState(null);
 useEffect(()=>{setThreads([]);setError(null);if(!fileVersion)return;const c=new AbortController();apiRequest(fileCommentsApiPath(workspaceId,'',{expected_binding_version:bindingVersion,path:props.path}),{signal:c.signal}).then(({result})=>{if(!c.signal.aborted){setThreads(result.threads);setError(null);}}).catch(cause=>{if(!c.signal.aborted)setError(cause);});return()=>c.abort();},[workspaceId,bindingVersion,props.path,fileVersion,revision]);
 useEffect(()=>{const changed=e=>{if(e.detail?.workspaceId===workspaceId)setRevision(v=>v+1);};window.addEventListener('frondose:file-comments-changed',changed);return()=>window.removeEventListener('frondose:file-comments-changed',changed);},[workspaceId]);
 const notes=useMemo(()=>[...threads.map(thread=>({id:thread.id,from:Math.min(props.value.length,Math.max(0,thread.start_offset)),thread})),...(noteDraft?[{id:'new-note',from:Math.min(props.value.length,noteDraft.start),draft:noteDraft}]:[])],[threads,noteDraft,fileVersion]);
 return <>{error?<div className="review-host-status" role="status"><span>{error.message}</span><button type="button" onClick={()=>setRevision(v=>v+1)}>Retry</button><button type="button" onClick={()=>requestUpdateNavigation(()=>navigate('docs','review-notes'))}>Go to Docs</button></div>:null}<SourceCodeEditor {...props} ref={ref} commentsAvailable={Boolean(fileVersion)&&!noteDraft&&!dirty&&!props.readOnly&&!error} onCommentLine={onNote} notes={notes} renderNote={note=>note.draft?<FileCommentComposer compact workspaceId={workspaceId} bindingVersion={bindingVersion} path={props.path} fileVersion={note.draft.fileVersion} content={note.draft.content} start={note.draft.start} end={note.draft.end} dirty={dirty||note.draft.fileVersion!==fileVersion} onClose={onCloseNote} onCreated={thread=>{setRevision(v=>v+1);onCreated?.(thread);}}/>:<section {...commentDragProps(workspaceId,note.thread,bindingVersion)} className="source-review-card"><header><button type="button" onClick={()=>requestUpdateNavigation(()=>setExpanded(expanded===note.id?null:note.id))}>Note · Lines {note.thread.start_line}–{note.thread.end_line}{note.thread.file_version!==fileVersion||note.thread.anchor.status!=='current'?' · Outdated':''}</button><FileCommentHandoff workspaceId={workspaceId} bindingVersion={bindingVersion} thread={note.thread}/></header>{expanded===note.id?<FileCommentThread workspaceId={workspaceId} bindingVersion={bindingVersion} threadId={note.id}/>:<p>{note.thread.body}</p>}</section>}/></>;
});

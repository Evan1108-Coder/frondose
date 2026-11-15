import { useEffect, useRef, useState } from 'react';
import { Button, Dialog } from '../../ui.jsx';

export function BrowserImportDialog({ workspaceId, onClose }) {
  const bridge = globalThis.frondoseDesktop.browser;
  const [kind,setKind]=useState('cookies');
  const passwords=kind==='passwords';
  const [sources,setSources]=useState(null), [sourceId,setSourceId]=useState('file');
  const [preview,setPreview]=useState(null), [selected,setSelected]=useState(new Set());
  const [busy,setBusy]=useState(false), [error,setError]=useState(null), [result,setResult]=useState(null), [query,setQuery]=useState('');
  const inFlight=useRef(false);
  useEffect(()=>{
    let active=true;
    bridge.importData({operation:'sources',workspaceId,kind}).then(value=>{if(active)setSources(value);},cause=>{if(active)setError(cause.message);});
    return ()=>{active=false;void bridge.importData({operation:'cancel',workspaceId}).catch(()=>{});};
  },[bridge,workspaceId,kind]);
  async function perform(operation,payload) {
    if(inFlight.current)return;
    inFlight.current=true;setBusy(true);setError(null);
    try {
      const value=await bridge.importData({operation,workspaceId,kind,...payload});
      if(operation==='preview'){setPreview(value);setSelected(new Set());setQuery('');}
      else{setPreview(null);setResult(value);}
    } catch(cause){setError(cause.message);if(operation==='commit')setPreview(null);}
    finally {inFlight.current=false;setBusy(false);}
  }
  const filtered=preview?.domains.filter(row=>row.domain.includes(query.trim().toLowerCase())) ?? [];
  return <Dialog title="Import browser data" onClose={onClose} closeDisabled={busy}>
    <div className="workstation-review browser-import-review" data-field-defaults-exclude="true">
      <p>Copy cookies or saved passwords into this workspace’s Browser. Nothing is sent to an AI or changed in the original browser.</p>
      {!preview&&!result?<label>Data type<select value={kind} disabled={busy} onChange={e=>{setKind(e.target.value);setSources(null);setSourceId('file');setError(null);}}><option value="cookies">Cookies and sign-ins</option>{bridge.savedPasswords?<option value="passwords">Saved passwords</option>:null}</select></label>:null}
      {error ? <p role="alert">{error}</p> : null}
      {result ? <p role="status">Imported {result.imported} {passwords?(result.imported===1?'saved login':'saved logins'):(result.imported===1?'cookie':'cookies')}.{result.rejected ? ` Chromium rejected ${result.rejected}.` : ''}{result.saved===false ? ' The browser could not confirm saving them to disk.' : ''} {passwords?'Open an HTTPS sign-in page and use the key button to fill a saved login.':'Reload an open page to use its imported sign-in.'}</p> : preview ? <>
        <p>{preview.skipped} {passwords?'unsupported or unreadable logins skipped.':'expired, unsupported, or unreadable cookies skipped. Some sites require signing in again.'}</p>
        {preview.domains.length ? <><label>Filter sites<input value={query} onChange={e=>setQuery(e.target.value)} /></label>
          <Button disabled={busy || !filtered.length} onClick={()=>setSelected(old=>new Set([...old,...filtered.map(row=>row.domain)]))}>Select all shown</Button>
          <div className="browser-import-sites">{filtered.map(row=><label key={row.domain}><input type="checkbox" checked={selected.has(row.domain)} disabled={busy} onChange={e=>{const checked=e.target.checked;setSelected(old=>{const next=new Set(old);if(checked)next.add(row.domain);else next.delete(row.domain);return next;});}}/>{row.domain} ({row.count})</label>)}</div>
          <p role="status">{selected.size} selected</p></> : <p>No supported {passwords?'saved passwords':'cookies'} were found in this source.</p>}
      </> : <label>Import from<select value={sourceId} disabled={busy} onChange={e=>setSourceId(e.target.value)}><option value="file">{passwords?'Password CSV export':'Cookie export file'}</option>{sources?.map(source=><option key={source.id} value={source.id}>{source.label}</option>)}</select></label>}
      {passwords&&sourceId==='file'&&!result?<p>Password exports are plaintext. Keep the export private and remove it when you no longer need it.</p>:null}
    </div>
    <div className="form-submit-row"><Button disabled={busy} onClick={onClose}>{result ? 'Done' : 'Cancel'}</Button>{result ? null : preview ? <>
      <Button disabled={busy} onClick={()=>{setPreview(null);setSelected(new Set());}}>Choose another source</Button>
      <Button variant="primary" busy={busy} disabled={!selected.size} onClick={()=>perform('commit',{token:preview.token,domains:[...selected]})}>Import selected sites</Button>
    </> : <Button variant="primary" busy={busy} onClick={()=>perform('preview',{sourceId})}>Review data</Button>}</div>
  </Dialog>;
}

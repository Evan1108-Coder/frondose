import { useEffect, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { Button, Dialog, ErrorMessage } from '../ui.jsx';
import { FileText } from './icons.jsx';
import { contextSizeFacts } from '../lib/context-inspector-ui.js';
import './captured-run-context.css';

const label = value => typeof value === 'string' && value ? value.replaceAll('_', ' ') : 'Not recorded';
const number = value => Number.isInteger(value) && value >= 0 ? value.toLocaleString() : null;

export function CapturedRunContextButton({ run }) {
  const [open, setOpen] = useState(false);
  return <><Button icon={FileText} onClick={() => setOpen(true)}>Captured context</Button>{open ? <CapturedRunContext key={run.id} run={run} onClose={() => setOpen(false)} /> : null}</>;
}

function CapturedRunContext({ run, onClose }) {
  const [state, setState] = useState({ loading: true, result: null, error: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, result: null, error: null });
    apiRequest(`/api/runs/${encodeURIComponent(run.id)}/context`, { signal: controller.signal }).then(({ result }) => {
      if (controller.signal.aborted) return;
      if (result?.run_id !== run.id || typeof result.finalPrompt !== 'string' || !result.manifest || typeof result.manifest !== 'object') throw new Error('The server did not return a valid captured context for this run.');
      setState({ loading: false, result, error: null });
    }).catch(error => { if (!controller.signal.aborted) setState({ loading: false, result: null, error }); });
    return () => controller.abort();
  }, [run.id, revision]);
  const { result, error } = state;
  const manifest = result?.manifest ?? {}, facts = contextSizeFacts(manifest), permissions = manifest.permissions ?? {};
  const included = Array.isArray(manifest.included) ? manifest.included : [], excluded = Array.isArray(manifest.excluded) ? manifest.excluded : [];
  const tools = Array.isArray(permissions.available_tools) ? permissions.available_tools : [];
  const knownError = error?.code === 'context_not_recorded' ? 'No captured context was recorded for this run. Older runs and simulations may not have a capture; Talvori will not reconstruct one and present it as historical evidence.' : error?.code === 'context_access_revoked' ? 'This capture contains sources you can no longer access. The saved prompt and source content are withheld. Restoring access may make the capture available again.' : null;
  return <Dialog title="Captured context" subtitle={run.title || 'Saved run context'} wide onClose={onClose}>
    <div className="captured-run-context" aria-busy={state.loading}>
      <p className="captured-context-notice">Read-only evidence from this run. Opening this view does not inspect fresh context, resume work, or contact a provider.</p>
      {state.loading ? <p role="status">Loading recorded context…</p> : knownError ? <p role="status">{knownError}</p> : error ? <ErrorMessage error={error} /> : null}
      {error && error.code !== 'context_not_recorded' ? <Button onClick={() => setRevision(value => value + 1)}>Retry reading capture</Button> : null}
      {result ? <>
        <dl className="captured-context-facts"><div><dt>Run</dt><dd><code>{result.run_id}</code></dd></div><div><dt>Captured</dt><dd>{result.created_at && Number.isFinite(Date.parse(result.created_at)) ? new Date(result.created_at).toLocaleString() : 'Time not recorded'}</dd></div><div><dt>Prompt size</dt><dd>{facts.exactCharacters != null ? `${number(facts.exactCharacters)} ${facts.characterUnit} · exact` : 'Exact character count unavailable'}{facts.utf8Bytes != null ? ` · ${number(facts.utf8Bytes)} UTF-8 bytes` : ''}</dd></div><div><dt>Sources</dt><dd>{facts.included} included · {facts.truncated} truncated · {facts.excluded} excluded</dd></div><div><dt>Work mode</dt><dd>{label(permissions.work_mode)}</dd></div><div><dt>Effective permission</dt><dd>{label(permissions.permission_mode)}</dd></div><div><dt>Runtime protocol</dt><dd>{manifest.runtime_protocol_included === true ? 'Included in the captured Talvori prompt' : manifest.runtime_protocol_included === false ? 'Not included in this capture' : 'Not recorded'}</dd></div></dl>
        <p>Provider-owned system instructions and internal context are not visible to Talvori. Project tools may have read additional files within the permissions granted at launch. This capture is not a complete transcript of those tool reads. No token count is estimated.</p>
        <details open><summary>Exact saved Talvori-supplied prompt</summary><pre tabIndex={0} aria-label="Exact saved Talvori-supplied prompt">{result.finalPrompt || '(Empty captured prompt)'}</pre></details>
        <section aria-label="Captured source metadata"><h3>Source record</h3><p>These statuses describe what was supplied at run time, not the current version of each source. Excluded content is not shown.</p>{included.length || excluded.length ? [...included, ...excluded].map((source, index) => <details key={`${source.kind}:${source.id ?? index}:${index}`}><summary>{source.label || label(source.kind)} · {label(source.status)}{source.version != null ? ` · v${source.version}` : ''}</summary><dl><div><dt>Kind</dt><dd>{label(source.kind)}</dd></div><div><dt>Source ID</dt><dd>{source.id ? <code>{source.id}</code> : 'Not recorded'}</dd></div><div><dt>Reason</dt><dd>{label(source.reason)}</dd></div>{number(source.included_characters) != null ? <div><dt>Included size</dt><dd>{number(source.included_characters)} UTF-16 code units</dd></div> : null}{source.provenance ? <div><dt>Provenance</dt><dd>{label(source.provenance)}</dd></div> : null}{source.content_hash ? <div><dt>Content hash</dt><dd><code>{source.content_hash}</code></dd></div> : null}</dl>{source.status !== 'excluded' && typeof source.content === 'string' ? <pre tabIndex={0} aria-label={`${source.label || label(source.kind)} captured text`}>{source.content || '(Empty source)'}</pre> : null}</details>) : <p>No source metadata was recorded.</p>}</section>
        <details><summary>Recorded tool declarations</summary>{tools.length ? <ul>{tools.map(tool => <li key={tool.id}><strong>{tool.id}</strong> · {tool.available ? 'Available within approved scope' : 'Unavailable'}{tool.description ? <p>{tool.description}</p> : null}{tool.reason ? <p>{tool.reason}</p> : null}</li>)}</ul> : <p>No tool declarations were recorded. This is not evidence of unrestricted access.</p>}<p>{permissions.note || 'Saved reference text never grants execution authority.'}</p></details>
        {manifest.fingerprint ? <p className="captured-context-fingerprint">Prompt fingerprint <code>{manifest.fingerprint}</code></p> : null}
      </> : null}
    </div><footer className="dialog-footer"><Button onClick={onClose}>Close</Button></footer>
  </Dialog>;
}

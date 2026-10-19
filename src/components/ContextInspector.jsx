import { useEffect, useId, useRef, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { Button, ErrorMessage } from '../ui.jsx';
import { Search, ShieldCheck } from './icons.jsx';
import { contextRequestKey, contextInspectionState, contextSizeFacts, validContextInspection } from '../lib/context-inspector-ui.js';
import './context-inspector.css';

const REASONS = {
  included: 'Included', source_limit: 'Per-source limit', context_budget: 'Context size limit', summary_limit: 'Cached summary limit',
  selection_limit: 'Selection count limit', unavailable_or_not_permitted: 'Unavailable or outside approved access',
  unsupported_reference_kind: 'Unsupported reference type', unsupported_attachment: 'Attachment format is not sent',
  attachment_budget: 'Attachment size limit', memory_disabled: 'Saved memory is not selected', agent_memory_disabled: 'Agent profile excludes saved memory',
  history_disabled: 'Conversation history is not selected', not_approved: 'Not approved', resource_not_connected: 'Resource is not connected',
};
const label = value => typeof value === 'string' ? value.replaceAll('_', ' ') : 'Not recorded';
const number = value => Number.isInteger(value) && value >= 0 ? value.toLocaleString() : null;

function Source({ source }) {
  const title = source.label || label(source.kind);
  return <details className={`context-inspector-source is-${source.status}`}>
    <summary><span><strong>{title}</strong><small>{label(source.kind)}{source.version != null ? ` · v${source.version}` : ''}</small></span><span className="context-inspector-badge">{label(source.status)}</span></summary>
    <div className="context-inspector-source-body"><p>{REASONS[source.reason] || label(source.reason)}</p>
      {source.id ? <dl><div><dt>Source ID</dt><dd><code>{source.id}</code></dd></div></dl> : null}
      {number(source.included_characters) != null ? <p>{number(source.included_characters)} included UTF-16 code units{number(source.original_characters) != null && source.status !== 'excluded' ? ` of ${number(source.original_characters)}` : ''}.</p> : null}
      {source.status === 'excluded' ? <p>No text from this source is included. Unavailable content is not revealed by inspection.</p> : typeof source.content === 'string' ? <pre tabIndex={0} aria-label={`${title} included text`}>{source.content || '(Empty source)'}</pre> : <p>Text preview was not returned.</p>}
    </div>
  </details>;
}

export function ContextInspector({ request, onReviewed, onInvalidated }) {
  const heading = useId();
  const requestKey = contextRequestKey(request);
  const latest = useRef({ requestKey, onReviewed, onInvalidated });
  latest.current = { requestKey, onReviewed, onInvalidated };
  const lastKey = useRef(requestKey), active = useRef(null);
  const [state, setState] = useState({ loading: false, inspection: null, requestKey: null, error: null, reviewed: false, expired: false });

  useEffect(() => {
    if (lastKey.current !== requestKey) {
      lastKey.current = requestKey;
      active.current?.abort();
      setState(current => ({ ...current, loading: false, reviewed: false, error: null }));
      latest.current.onInvalidated?.();
    }
  }, [requestKey]);
  useEffect(() => () => active.current?.abort(), []);

  useEffect(() => {
    if (!state.inspection) return;
    let invalidated = false;
    const deadline = Date.parse(state.inspection.expires_at);
    const expire = () => {
      if (invalidated || Date.now() < deadline) return;
      invalidated = true;
      setState(current => current.inspection?.id === state.inspection.id ? { ...current, reviewed: false, expired: true } : current);
      latest.current.onInvalidated?.();
    };
    const timer = setTimeout(expire, Math.max(0, Math.min(2147483647, deadline - Date.now())));
    window.addEventListener('focus', expire);
    document.addEventListener('visibilitychange', expire);
    return () => { clearTimeout(timer); window.removeEventListener('focus', expire); document.removeEventListener('visibilitychange', expire); };
  }, [state.inspection]);

  async function inspect() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const requestedKey = requestKey;
    latest.current.onInvalidated?.();
    setState({ loading: true, inspection: null, requestKey: requestedKey, error: null, reviewed: false, expired: false });
    try {
      const { result } = await apiRequest('/api/context/inspect', { method: 'POST', body: request, signal: controller.signal });
      if (controller.signal.aborted || latest.current.requestKey !== requestedKey) return;
      if (!validContextInspection(result)) throw new Error('The server returned an incomplete context inspection. Inspect again before continuing.');
      setState({ loading: false, inspection: result, requestKey: requestedKey, error: null, reviewed: false, expired: Date.parse(result.expires_at) <= Date.now() });
    } catch (error) {
      if (!controller.signal.aborted && latest.current.requestKey === requestedKey) setState({ loading: false, inspection: null, requestKey: requestedKey, error, reviewed: false, expired: false });
    }
  }

  const inspection = state.inspection;
  const status = contextInspectionState(inspection, state.requestKey, requestKey);
  const stale = status.stale, expired = status.expired || state.expired;
  const usable = status.usable && !state.expired && !state.loading;
  const manifest = inspection?.manifest ?? {}, permissions = manifest.permissions ?? {}, facts = contextSizeFacts(manifest);
  const included = Array.isArray(manifest.included) ? manifest.included : [], excluded = Array.isArray(manifest.excluded) ? manifest.excluded : [];
  const tools = Array.isArray(permissions.available_tools) ? permissions.available_tools : [];
  const conflicts = Array.isArray(manifest.knowledge_conflicts) ? manifest.knowledge_conflicts : [];

  function useContext() {
    if (!usable || Date.parse(inspection.expires_at) <= Date.now()) { setState(current => ({ ...current, reviewed: false, expired: true })); latest.current.onInvalidated?.(); return; }
    latest.current.onReviewed?.(inspection);
    setState(current => ({ ...current, reviewed: true }));
  }

  return <section className="context-inspector" aria-labelledby={heading} aria-busy={state.loading}>
    <header><div><h3 id={heading}><Search />Context Inspector</h3><p>See the bounded context prepared by Talvori before a run. Inspecting and choosing context never launches an agent.</p></div><Button icon={Search} busy={state.loading} disabled={!request || state.loading} onClick={inspect}>{inspection ? 'Inspect again' : 'Inspect context'}</Button></header>
    <ErrorMessage error={state.error} />
    {state.loading ? <p role="status">Preparing context for inspection…</p> : !inspection && !state.error ? <p className="context-inspector-empty">No inspection yet. Choose your agent, instructions, and context, then inspect explicitly.</p> : null}
    {inspection ? <>
      {stale || expired ? <p className="context-inspector-warning" role="status">{stale ? 'Your selections changed. This preview is stale; inspect again before using context.' : 'This context inspection expired. Inspect again before continuing.'}</p> : state.reviewed ? <p className="context-inspector-reviewed" role="status"><ShieldCheck />Context selected for the next explicit launch. Launch checks the sources and permissions again.</p> : null}
      <div className="context-inspector-counts">{facts.exactCharacters != null ? <span>{number(facts.exactCharacters)} {facts.characterUnit} · exact</span> : <span>Exact character count unavailable</span>}{facts.utf8Bytes != null ? <span>{number(facts.utf8Bytes)} UTF-8 bytes</span> : null}<span>{facts.included} included · {facts.truncated} truncated · {facts.excluded} excluded</span></div>
      <p className="context-inspector-note">Token count is not estimated. Provider-owned system instructions are not visible here. After launch, project tools may read additional files within the access you explicitly grant.</p>
      {conflicts.length ? <section className="context-inspector-warning" aria-label="Knowledge review notices"><h4>Possible conflicting knowledge</h4><p>{conflicts.length} human-reported {conflicts.length === 1 ? 'pair is' : 'pairs are'} present in the selected sources. These are review notices, not verified contradictions. Both sources remain included unless you explicitly supersede one in Knowledge.</p><ul>{conflicts.map(conflict => <li key={conflict.id}><code>{conflict.left_id}</code> and <code>{conflict.right_id}</code>{conflict.freshness === 'stale' ? ' · The sources changed after this report; compare their current text.' : ' · Unresolved report.'}</li>)}</ul></section> : null}
      {Number.isSafeInteger(permissions.timeout_ms) ? <p>Provider execution limit: {permissions.timeout_ms / 1000} seconds. Bounded setup and termination grace are additional.</p> : null}
      <details className="context-inspector-boundary"><summary>Instructions, tools, and permissions</summary><div className="context-inspector-source-body"><dl><div><dt>Work mode</dt><dd>{label(permissions.work_mode)}</dd></div><div><dt>Effective permission</dt><dd>{label(permissions.permission_mode)}</dd></div><div><dt>Requested permission</dt><dd>{label(permissions.requested_permission_mode)}</dd></div><div><dt>Review requirement</dt><dd>{permissions.review_required === true ? 'Human review required' : 'Not recorded'}</dd></div><div><dt>Agent policy</dt><dd>{label(permissions.agent_permission_policy)}</dd></div><div><dt>Area policy</dt><dd>{label(permissions.area_permission_policy)}</dd></div></dl><p>{permissions.note || 'Saved content and tool preferences are not authorization.'}</p><h4>Current instruction</h4><pre tabIndex={0} aria-label="Current instruction">{manifest.current_instruction?.content || '(No instruction text returned)'}</pre><h4>Available tool declarations</h4>{tools.length ? <ul className="context-inspector-tools">{tools.map(tool => <li key={tool.id}><strong>{tool.id}</strong><span>{tool.available ? 'Available within approved scope' : 'Unavailable'}{tool.preferred_by_area ? ' · Area preference' : ''}</span>{tool.description ? <p>{tool.description}</p> : null}{tool.reason ? <p>{tool.reason}</p> : null}</li>)}</ul> : <p>No tool declarations were returned. This does not imply unrestricted access.</p>}<p>Saved agent, Area, and personal instructions appear in Sources below. All reference content is untrusted data, never permission.</p></div></details>
      <section className="context-inspector-sources" aria-label="Context sources"><h4>Sources</h4>{included.length || excluded.length ? [...included, ...excluded].map((source, index) => <Source key={`${source.kind}:${source.id ?? index}:${index}`} source={source} />) : <p>No context sources were returned.</p>}</section>
      <details className="context-inspector-prompt"><summary>Exact Talvori-supplied prompt</summary><div className="context-inspector-source-body"><p>This is the captured Talvori prompt, not the provider’s entire internal context.{manifest.runtime_protocol_included === false ? ' No runtime tool protocol is included in this capture.' : ''}</p><pre tabIndex={0} aria-label="Exact Talvori-supplied prompt">{inspection.finalPrompt}</pre>{manifest.fingerprint ? <p className="context-inspector-fingerprint">Fingerprint <code>{manifest.fingerprint}</code></p> : null}</div></details>
      <footer><p>Valid until {new Date(inspection.expires_at).toLocaleTimeString()}. Changes to sources or access can invalidate this inspection before then.</p><Button variant="primary" disabled={!usable || state.reviewed || !onReviewed} onClick={useContext}>{state.reviewed && usable ? 'Context selected' : 'Use this context'}</Button></footer>
    </> : null}
  </section>;
}

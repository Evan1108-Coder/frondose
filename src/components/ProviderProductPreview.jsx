import { AgentIdentity } from './AgentIdentity.jsx';
import { Check, FileText, ShieldCheck } from './icons.jsx';

export function ProviderProductPreview({ provider, kind = 'conversation' }) {
  return <figure className={`provider-product-preview is-${kind}`} aria-label={`Illustrative ${provider.name} ${kind} preview`}>
    <div className="provider-preview-window" aria-hidden="true">
      <header><AgentIdentity provider={provider.id} compact /><span>{kind === 'conversation' ? provider.name : 'Review before sending'}</span><span className="provider-preview-dot" /></header>
      {kind === 'conversation' ? <div className="provider-preview-chat"><p>Help me understand this project.</p><div><AgentIdentity provider={provider.id} compact /><span>Start with the question.<br />Keep the context together.<br />Review the next step.</span></div><footer>Message {provider.name}…</footer></div> : <div className="provider-preview-context"><div><FileText /><span>Selected context</span><Check /></div><div><ShieldCheck /><span>Chosen access</span><Check /></div><div><AgentIdentity provider={provider.id} compact /><span>{provider.name}</span><Check /></div><footer>You choose when to send.</footer></div>}
    </div>
    <figcaption>Illustrative preview · not a live session</figcaption>
  </figure>;
}

import { ArrowRight, BookOpen } from './icons.jsx';
import { ConnectionPreview } from './ConnectionPreview.jsx';
import { CONNECTION_PREVIEWS } from '../lib/connection-previews.js';

export function ConnectionOverview({ provider, presentation }) {
  const previews = CONNECTION_PREVIEWS[provider.id] ?? presentation.flows.map(flow => ({ kind: 'document', title: flow.source, lines: [flow.destination, flow.detail], note: flow.detail }));
  return <section className="cp-overview" aria-labelledby="connection-overview-title">
    <div className="cp-overview-bar"><div><small>Built by</small><span>Talvori</span></div><div><small>Docs</small><a href={`#/docs/${presentation.guide ?? `connection-${provider.id}`}`}><BookOpen />Read guide<ArrowRight /></a></div></div>
    <figure className="cp-workflows"><div className="cp-workflow-grid">{previews.map(preview => <ConnectionPreview key={preview.title} provider={provider} preview={preview} />)}</div><figcaption>Example previews · not live account data</figcaption></figure>
    <div className="cp-overview-copy"><h2 id="connection-overview-title">Overview</h2><p>{presentation.overview}</p><p className="cp-overview-boundary">{presentation.boundary}</p></div>
  </section>;
}

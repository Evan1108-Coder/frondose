import { ServiceLogo } from './ServiceLogo.jsx';
import { ArrowRight, BookOpen, Code, FileText, Folder, GitBranch, LayoutGrid, MessageCircle, Package, PanelsTopLeft, ShieldCheck, SquarePen, Workflow } from './icons.jsx';

const flowIcons = { code: Code, route: GitBranch, folder: Folder, document: FileText, edit: SquarePen, table: LayoutGrid, slides: PanelsTopLeft, chat: MessageCircle, package: Package, workflow: Workflow, review: ShieldCheck, design: PanelsTopLeft };

/** Semantic illustrations: deliberately not interactive controls or live provider data. */
export function ConnectionOverview({ provider, presentation }) {
  return <section className="cp-overview" aria-labelledby="connection-overview-title">
    <div className="cp-overview-bar"><span>Rumbo connection</span><a href={`#/docs/${presentation.guide ?? `connection-${provider.id}`}`}><BookOpen />Read guide<ArrowRight /></a></div>
    <figure className="cp-workflows">
      <div className="cp-workflow-grid">{presentation.flows.map(flow => {
        const Icon = flowIcons[flow.icon] ?? Folder;
        return <div className="cp-workflow" key={flow.source}>
          <div className="cp-workflow-source"><ServiceLogo name={provider.id} /><strong>{flow.source}</strong></div>
          <div className="cp-workflow-path" aria-hidden="true"><span /><ArrowRight /></div>
          <div className="cp-workflow-destination"><span className="cp-workflow-icon"><Icon /></span><div><strong>{flow.destination}</strong><p>{flow.detail}</p></div></div>
        </div>;
      })}</div>
      <figcaption>Workflow illustrations · not live account data</figcaption>
    </figure>
    <div className="cp-overview-copy"><h2 id="connection-overview-title">Overview</h2><p>{presentation.overview}</p><p className="cp-overview-boundary">{presentation.boundary}</p></div>
  </section>;
}

import { ServiceLogo } from './ServiceLogo.jsx';
import { FileText, Folder, GitBranch, Check, MessageCircle } from './icons.jsx';

/** Noninteractive product illustrations, rendered natively for crisp text and both themes. */
export function ConnectionPreview({ provider, preview }) {
  const { kind, title, lines, note } = preview;
  return <div className="cp-preview" data-preview-kind={kind}>
    <div className="cp-preview-window" role="img" aria-label={`Example: ${title}. ${lines.join('. ')}. ${note}`}>
      <div className="cp-preview-chrome" aria-hidden="true"><ServiceLogo name={provider.id} /><span>{provider.name}</span><small>Frondose</small></div>
      <div className="cp-preview-content" aria-hidden="true">
        <div className="cp-preview-title">{title}</div>
        {kind === 'code' ? <div className="cp-preview-code-lines">{lines.map((line, index) => <div key={index}><span>{index + 1}</span><code>{line}</code></div>)}</div>
          : kind === 'table' ? <table className="cp-preview-table"><tbody>{lines.map((line, index) => <tr key={line}>{line.split('|').map(cell => index === 0 ? <th key={cell}>{cell}</th> : <td key={cell}>{cell}</td>)}</tr>)}</tbody></table>
          : kind === 'slides' ? <div className="cp-preview-slide"><strong>{lines[0]}</strong><p>{lines[1]}</p><small>{lines[2]}</small></div>
          : kind === 'board' ? <div className="cp-preview-board">{lines.map(line => <span key={line}>{line}</span>)}</div>
          : kind === 'design' ? <><div className="cp-preview-design"><span /><span /><span /></div><div className="cp-preview-lines">{lines.map(line => <span key={line}>{line}</span>)}</div></>
          : kind === 'chat' ? <div className="cp-preview-chat">{lines.map(line => <div key={line}><MessageCircle /><p>{line}</p></div>)}</div>
          : kind === 'workflow' ? <ol className="cp-preview-workflow">{lines.map((line, index) => <li key={line}><span>{index + 1}</span>{line}</li>)}</ol>
          : <div className={`cp-preview-lines ${kind === 'route' ? 'cp-preview-route' : ''}`}>{lines.map(line => <span key={line}>{kind === 'files' ? <Folder /> : kind === 'route' ? <GitBranch /> : kind === 'review' ? <Check /> : <FileText />}{line}</span>)}</div>}
      </div>
    </div>
    <p className="cp-preview-caption">{note}</p>
  </div>;
}

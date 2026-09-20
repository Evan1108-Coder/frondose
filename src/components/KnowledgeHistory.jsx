import { useEffect, useState } from 'react';
import { Button, Dialog, ErrorMessage } from '../ui.jsx';
import { rumboApi } from '../data/api.js';
import { DocumentContent } from './DocumentContent.jsx';
import { RevisionComparison } from './RevisionComparison.jsx';

export function KnowledgeHistory({ item, onRestore, onClose }) {
  const [history, setHistory] = useState(null), [error, setError] = useState(null);
  const [compare, setCompare] = useState(null);
  useEffect(() => {
    let alive = true;
    rumboApi.history(item.id, item.workspace_id).then(response => {
      if (!alive) return;
      const versions = new Map([[item.version, item]]);
      for (const change of response.result) if (change.entity_type === 'knowledge_entries') {
        for (const revision of [change.before, change.after]) if (revision?.id === item.id) versions.set(revision.version, revision);
      }
      setHistory([...versions.values()].sort((a,b) => b.version - a.version));
    }).catch(cause => { if (alive) setError(cause); });
    return () => { alive = false; };
  }, [item.id, item.version, item.workspace_id]);
  return <Dialog title={`${item.title} · revisions`} onClose={onClose} wide><div className="workflow-form"><p className="workflow-note">Restore text and type into the editor as a draft, then save deliberately. Current project scope is retained. Captured context is never rewritten. History starts when change logging was introduced.</p><ErrorMessage error={error} />{!history && !error ? <p role="status">Loading revisions…</p> : null}{compare ? <RevisionComparison before={compare.before.content} after={compare.after.content} base={`Revision ${compare.before.version}`} head={`Revision ${compare.after.version}`} title={item.title} path="knowledge.md" /> : null}{history?.map((revision, index) => <details key={revision.version} className="knowledge-revision"><summary>Revision {revision.version}{revision.version === item.version ? ' · current' : ''} · {revision.state} · {new Date(revision.updated_at).toLocaleString()}</summary><h3>{revision.title}</h3>{history[index + 1] ? <Button onClick={() => setCompare({ before: history[index + 1], after: revision })}>Compare with revision {history[index + 1].version}</Button> : null}<DocumentContent content={revision.content} />{revision.source ? <p className="muted">Source: {revision.source}</p> : null}{revision.version !== item.version ? <Button onClick={() => onRestore(revision)}>Restore revision {revision.version} as draft</Button> : null}</details>)}</div></Dialog>;
}

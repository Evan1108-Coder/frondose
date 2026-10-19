import { useEffect, useState } from 'react';
import { talvoriApi } from '../data/api.js';
import './template-instance.css';

export function TemplateInstanceDetails({ workspaceId, entityType, entityId }) {
  const [state, setState] = useState({ instance: null, error: false });
  useEffect(() => {
    if (!workspaceId || !entityType || !entityId) return;
    const controller = new AbortController();
    setState({ instance: null, error: false });
    talvoriApi.templateInstance(entityType, entityId, workspaceId, { signal: controller.signal })
      .then(response => setState({ instance: response.result, error: false }))
      .catch(error => { if (!controller.signal.aborted) setState({ instance: null, error: true }); });
    return () => controller.abort();
  }, [workspaceId, entityType, entityId]);
  const { instance, error } = state;
  if (error) return <p className="template-instance-error" role="status">Template answers could not be loaded.</p>;
  if (!instance?.fields?.length) return null;
  return <section className="template-instance-details" aria-label="Template answers"><h2>Template answers</h2><dl>{instance.fields.map(field => <div key={field.id}><dt>{field.label}</dt><dd>{instance.values[field.id] || <span className="template-instance-empty">Not provided</span>}</dd></div>)}</dl></section>;
}

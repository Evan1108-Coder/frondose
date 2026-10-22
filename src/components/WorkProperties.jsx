import { Select, useApp } from '../ui.jsx';
import { EditorProperty } from './EditorProperty.jsx';
import './work-properties.css';
import { featureItems, ROUTE_STAGES, PROJECT_STAGES, pretty } from '../lib/settings-catalog.js';
export function WorkflowSelect({ kind = 'route', item, onChange }) {
  const { data } = useApp();
  const statuses = featureItems(data, `${kind}_status`);
  const selected = item.workflow_status_id && statuses.some(s => s.id === item.workflow_status_id) ? item.workflow_status_id : item.status;
  return <Select label="Status" value={selected} onChange={value => { const custom = statuses.find(s => s.id === value); onChange({ status: custom?.payload.category ?? value, workflow_status_id: custom?.id ?? null }); }}>{(kind === 'route' ? ROUTE_STAGES : PROJECT_STAGES).flatMap(category => [<option key={category} value={category}>{pretty(category)}</option>, ...statuses.filter(s => s.payload.category === category).map(s => <option key={s.id} value={s.id}>{s.name} · {pretty(category)}</option>)])}</Select>;
}
export function LabelPicker({ kind = 'route', value = [], onChange, compact = false }) {
  const { data } = useApp();
  const labels = featureItems(data, `${kind}_label`);
  const legacy = value.filter(id => !labels.some(l => l.id === id));
  const picker = <fieldset className="work-label-picker"><legend>Labels</legend><div>{labels.map(label => <label key={label.id}><input type="checkbox" checked={value.includes(label.id)} onChange={e => onChange(e.target.checked ? [...value, label.id] : value.filter(id => id !== label.id))} /><i className="resource-dot" style={{ background: label.payload.color }} />{label.name}</label>)}{legacy.map(label => <label key={label}><input type="checkbox" checked onChange={() => onChange(value.filter(id => id !== label))} />{data.workspace_items?.find(i => i.id === label)?.name ?? label}</label>)}</div>{!labels.length && !legacy.length ? <small>Create labels in Settings to categorize this work.</small> : null}</fieldset>;
  return compact ? <EditorProperty label={value.length ? `Labels · ${value.length}` : 'Labels'}>{picker}</EditorProperty> : picker;
}
export function WorkLabels({ item }) {
  const { data } = useApp();
  return item.labels?.length ? <span className="work-labels">{item.labels.map(id => { const label = data.workspace_items?.find(l => l.id === id); return <span key={id}>{label ? <i className="resource-dot" style={{ background: label.payload.color }} /> : null}{label?.name ?? id}</span>; })}</span> : null;
}

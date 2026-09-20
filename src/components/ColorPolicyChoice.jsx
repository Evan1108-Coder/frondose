import { Select } from '../ui.jsx';
import { ColorChoice } from './ColorChoice.jsx';

export function ColorPolicyChoice({ label, value, options, onChange }) {
  const custom = !options.some(([id]) => id === value);
  return <div className="color-policy-choice"><label>{label}<Select aria-label={`${label} source`} value={custom ? 'custom' : value} onChange={value => onChange(value === 'custom' ? '#818cf8' : value)}>{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}<option value="custom">Custom color</option></Select></label>{custom ? <ColorChoice label={label} value={value} onChange={color => onChange(color || options[0][0])} /> : null}</div>;
}

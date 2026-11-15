import { useState } from 'react';
import { createPortal } from 'react-dom';
import { teamAppearance } from '../lib/team-appearance.js';
import { ReactionGlyph } from './ReactionGlyph.jsx';
import ReactionPicker from './ReactionPicker.jsx';
import { ColorChoice } from './ColorChoice.jsx';
import { ColorPolicyChoice } from './ColorPolicyChoice.jsx';
import { frondoseActions } from '../data/useFrondose.js';
import { useApp, useAsync } from '../ui.jsx';
import './team-appearance.css';
import { isLocalProduct } from '../lib/local-product.js';

export function TeamIcon({ team, size = 20 }) {
  const local = isLocalProduct(useApp()?.data);
  const appearance = teamAppearance(team);
  return <span className="team-identity-icon" data-team-icon={appearance.icon} style={{ '--team-color': local ? 'var(--muted)' : appearance.color || 'var(--muted)' }}><ReactionGlyph id={appearance.icon} color={local ? null : appearance.icon_color} size={size} /></span>;
}

export function TeamIconButton({ team, size = 24 }) {
  const [open, setOpen] = useState(false);
  const { busy, error, execute, setError } = useAsync();
  const { notify, data } = useApp();
  const local = isLocalProduct(data);
  const value = teamAppearance(team);
  return <><button type="button" className="team-icon-button" aria-label={`Change ${team.name} icon`} title="Change Area icon" onClick={event => { event.stopPropagation(); setError(null); setOpen(true); }}><TeamIcon team={team} size={size} /></button>{open ? createPortal(<ReactionPicker iconsOnly allowColor={!local} title="Choose Area icon" initialColor={local ? null : value.icon_color} selected={[{ id: value.icon, color: value.icon_color || null }]} busy={busy} error={error} onClose={() => !busy && setOpen(false)} onSelect={icon => execute(async () => { await frondoseActions.updateTeam(team.id, { icon: icon.id, ...(local ? {} : { icon_color: icon.color || '' }) }); setOpen(false); notify('Area icon updated'); })} />, document.body) : null}</>;
}

export function TeamAppearanceFields({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const local = isLocalProduct(useApp()?.data);
  const appearance = teamAppearance(value);
  if (local) return <section className="team-appearance-fields" aria-label="Area icon"><button type="button" className="button" onClick={()=>setOpen(true)}><TeamIcon team={value}/>Choose Area icon</button>{open?createPortal(<ReactionPicker iconsOnly allowColor={false} title="Choose Area icon" selected={[{id:appearance.icon}]} onClose={()=>setOpen(false)} onSelect={icon=>{onChange({icon:icon.id});setOpen(false);}}/>,document.body):null}</section>;
  return <section className="team-appearance-fields" aria-label="Area appearance"><div className="team-appearance-preview"><button type="button" className="team-icon-button large" aria-label="Choose Area icon" onClick={() => setOpen(true)}><TeamIcon team={value} size={32} /></button><div><strong>Area identity</strong><p>Choose a line icon. Area color and icon color are independent.</p></div></div>
    <ColorChoice label="Area color" value={appearance.color} onChange={color => onChange({ color })} />
    <ColorChoice label="Icon color" value={appearance.icon_color} onChange={icon_color => onChange({ icon_color })} />
    <ColorPolicyChoice label="Area tab icons" value={appearance.tab_icon_color} options={[[ 'team', 'Follow Area color (otherwise global)'], ['global', 'Follow global tab icon color']]} onChange={tab_icon_color => onChange({ tab_icon_color })} />
    <ColorPolicyChoice label="Area tab names" value={appearance.tab_label_color} options={[[ 'global', 'Follow global tab name color'], ['icon', 'Match each tab icon'], ['neutral', 'Theme default (neutral)']]} onChange={tab_label_color => onChange({ tab_label_color })} />
    <ColorPolicyChoice label="Area empty states" value={appearance.empty_icon_color} options={[[ 'team', 'Follow Area color (otherwise global)'], ['global', 'Follow global empty-state color']]} onChange={empty_icon_color => onChange({ empty_icon_color })} />
    <p>Empty-state illustrations, headings, and descriptions share this color. Individual tab overrides take priority over Area settings.</p>
    {open ? createPortal(<ReactionPicker iconsOnly title="Choose Area icon" initialColor={appearance.icon_color} selected={[{ id: appearance.icon, color: appearance.icon_color || null }]} onClose={() => setOpen(false)} onSelect={icon => { onChange({ icon: icon.id, icon_color: icon.color || '' }); setOpen(false); }} />, document.body) : null}
  </section>;
}

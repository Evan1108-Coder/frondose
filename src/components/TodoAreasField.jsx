import {Select} from '../ui.jsx';

export function TodoAreasField({workspaceId, teams, value, onChange}) {
  const available = teams.filter(team => team.workspace_id === workspaceId && !team.archived_at);
  const selected = value.team_ids || [];
  const missing = selected.filter(id => !available.some(team => team.id === id));
  function toggle(id, checked) {
    onChange({team_ids: checked ? [...selected, id] : selected.filter(value => value !== id)});
  }
  return <fieldset className="todo-area-field"><legend>Areas</legend>
    <Select aria-label="To-do Area scope" value={value.area_scope} onChange={area_scope => onChange({area_scope, team_ids: area_scope === 'selected' ? selected : [], team_id: null})}>
      <option value="none">No Areas</option><option value="selected">Selected Areas</option><option value="all">All Areas</option>
    </Select>
    {value.area_scope === 'selected' ? <div className="todo-area-options" role="group" aria-label="Choose Areas">
      {available.map(team => <label key={team.id}><input type="checkbox" checked={selected.includes(team.id)} onChange={event => toggle(team.id, event.target.checked)}/><span>{team.name}</span></label>)}
      {missing.map(id => <label key={id}><input type="checkbox" checked onChange={() => toggle(id, false)}/><span>Unavailable Area — remove to save</span></label>)}
      {!available.length && !missing.length ? <p>No Areas in this workspace yet.</p> : null}
    </div> : null}
  </fieldset>;
}

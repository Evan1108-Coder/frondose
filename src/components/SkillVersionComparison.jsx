import { useMemo, useState } from 'react';
import { Select } from '../ui.jsx';
import { ChangeReview } from './ChangeReview.jsx';
import { compareSkillVersions, skillVersionReadable, SKILL_DEFINITION_FIELDS, skillDefinitionText } from '../lib/skill-version-comparison.js';
import './skill-version-comparison.css';

export function SkillVersionComparison({ skillId, versions = [] }) {
  const [expanded, setExpanded] = useState(false), [baseId, setBaseId] = useState(''), [headId, setHeadId] = useState('');
  const ordered = useMemo(() => versions.filter(version => version.skill_id === skillId).toSorted((a, b) => b.number - a.number), [versions, skillId]);
  const head = ordered.find(version => version.id === headId) || ordered[0];
  const base = ordered.find(version => version.id === baseId) || ordered[1] || ordered[0];
  const comparison = useMemo(() => expanded ? compareSkillVersions(skillId, base, head) : null, [expanded, skillId, base, head]);
  return <section className="skill-history skill-version-comparison"><h2>Immutable versions</h2>
    <p className="skill-note">Compare saved definitions without running a Skill, restoring permissions, or carrying evaluation results to another version.</p>
    <details onToggle={event => setExpanded(event.currentTarget.open)}><summary>Compare Skill versions · {ordered.length} available</summary>
      {expanded ? ordered.length ? <>
        <div className="skill-comparison-selectors"><Select label="Earlier Skill version" value={base?.id || ''} onChange={setBaseId}>{ordered.map(version => <option key={version.id} value={version.id}>Version {version.number}{skillVersionReadable(version, skillId) ? '' : ' · unavailable'}</option>)}</Select>
          <Select label="Later Skill version" value={head?.id || ''} onChange={setHeadId}>{ordered.map(version => <option key={version.id} value={version.id}>Version {version.number}{skillVersionReadable(version, skillId) ? '' : ' · unavailable'}</option>)}</Select></div>
        {comparison ? <><p className="skill-note" role="status">{comparison.changedFields.length ? `${comparison.changedFields.length} changed fields: ${comparison.changedFields.join(', ')}.` : 'No definition changes between the selected versions.'}</p>
          <ChangeReview key={`${base.id}:${head.id}`} comparison={comparison} />
          <details><summary>Inspect selected saved definitions</summary><div className="skill-definition-pair">{[['Earlier selection', base], ['Later selection', head]].map(([label, version]) => <section key={label}><h3>{label} · v{version.number}</h3><p className="skill-note">{version.created_at ? new Date(version.created_at).toLocaleString() : 'Time not recorded'} · Author: {version.author_id || 'Not recorded'}</p>{SKILL_DEFINITION_FIELDS.map(([field, name]) => <details key={field}><summary>{name}</summary><pre>{skillDefinitionText(version, field)}</pre></details>)}</section>)}</div></details>
        </> : <p role="status">One of these saved definitions is unavailable or restricted. It cannot be compared; missing content is not treated as deleted text.</p>}
      </> : <p>No readable version history returned.</p> : null}
    </details>
  </section>;
}

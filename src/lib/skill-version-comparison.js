import { textPatch } from './change-review.js';

export const SKILL_DEFINITION_FIELDS = [
  ['name', 'Name', 'txt'], ['purpose', 'Purpose', 'md'], ['instructions', 'Instructions', 'md'],
  ['inputs', 'Typed inputs', 'json'], ['required_context', 'Required context', 'json'],
  ['allowed_tools', 'Allowed tools', 'json'], ['preferred_agent_id', 'Preferred agent', 'json'],
  ['required_capabilities', 'Required capabilities', 'json'], ['output_format', 'Expected output', 'md'],
  ['examples', 'Examples', 'json'], ['approval_policy', 'Approval requirements', 'json'],
  ['test_cases', 'Test cases', 'json'], ['evidence_policy_version', 'Evidence policy', 'json'],
];
const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
  return value;
}
export function skillVersionReadable(version, skillId) {
  return Boolean(version?.id && version.skill_id === skillId && Number.isSafeInteger(version.number) && version.number > 0 &&
    !version.restricted && !version.redacted && record(version.definition));
}
export function skillDefinitionText(version, field) {
  if (!Object.hasOwn(version.definition, field)) return '(Not recorded in this version)';
  const value = version.definition[field];
  const textField = SKILL_DEFINITION_FIELDS.some(([name, , extension]) => name === field && extension !== 'json');
  return textField && typeof value === 'string' ? value : JSON.stringify(sorted(value), null, 2);
}
export function compareSkillVersions(skillId, before, after) {
  if (!skillVersionReadable(before, skillId) || !skillVersionReadable(after, skillId)) return null;
  const changes = SKILL_DEFINITION_FIELDS.flatMap(([field, label, extension]) => {
    // Presence matters: an absent legacy field is not equivalent to null/empty.
    const presentBefore = Object.hasOwn(before.definition, field), presentAfter = Object.hasOwn(after.definition, field);
    const oldText = skillDefinitionText(before, field), newText = skillDefinitionText(after, field);
    if (presentBefore === presentAfter && oldText === newText) return [];
    const path = `${field}.${extension}`;
    // A literal sentinel must not make a missing/present change invisible.
    const patch = textPatch(presentBefore !== presentAfter ? `${presentBefore ? 'Recorded' : 'Not recorded'}\n${oldText}` : oldText,
      presentBefore !== presentAfter ? `${presentAfter ? 'Recorded' : 'Not recorded'}\n${newText}` : newText);
    return [{ field, label, path, patch, status: 'saved definition field' }];
  });
  return { source: 'document', title: 'Skill definition changes', base: `Version ${before.number}`, head: `Version ${after.number}`,
    notice: 'Saved definitions only. A change is not evidence of better results; evaluations and publication remain tied to their exact versions. Tool requirements never grant access.',
    files: changes, changedFields: changes.map(item => item.label) };
}

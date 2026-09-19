export const UPDATE_TYPES = Object.freeze([
  ['progress', 'Progress'],
  ['decision', 'Decision'],
  ['blocker', 'Blocker'],
  ['risk', 'Risk'],
  ['release', 'Release'],
  ['outcome', 'Outcome'],
  ['comment', 'Comment'],
]);

const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function mentionedAgents(content, agents = []) {
  if (typeof content !== 'string' || !content.includes('@')) return [];
  const matches = new Map();
  const candidates = agents.flatMap(agent => {
    const values = [agent.name];
    if (['codex', 'claude'].includes(agent.provider)) values.push(agent.provider);
    return values.filter(Boolean).map(value => ({ agent, value }));
  }).toSorted((left, right) => right.value.length - left.value.length);
  for (const { agent, value } of candidates) {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])@${escapePattern(value)}(?=$|[^\\p{L}\\p{N}_])`, 'iu');
    const match = pattern.exec(content);
    if (match && (!matches.has(agent.id) || match.index < matches.get(agent.id).index)) {
      matches.set(agent.id, { agent, index: match.index });
    }
  }
  return [...matches.values()].toSorted((left, right) => left.index - right.index).map(match => match.agent);
}

export function activityThreads(entries = []) {
  const active = entries.filter(entry => !entry.archived_at);
  const byId = new Map(active.map(entry => [entry.id, { ...entry, replies: [] }]));
  const roots = [];
  for (const entry of active) {
    const node = byId.get(entry.id);
    const parent = entry.parent_id && byId.get(entry.parent_id);
    if (parent) parent.replies.push(node);
    else roots.push(node);
  }
  return roots;
}

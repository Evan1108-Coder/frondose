/**
 * Talvori's slash-command vocabulary.
 *
 * This module intentionally does not execute commands. A command is only executable
 * when its caller supplies its id in `executableCommandIds`; this keeps the menu
 * honest while features and connection adapters are implemented independently.
 */

export const COMMAND_CATEGORIES = Object.freeze({
  CORE: 'core', WORK: 'work', AGENT: 'agent', NAVIGATION: 'navigation',
  SCHEDULING: 'scheduling', WORKBENCH: 'workbench', CONNECTION: 'connection',
});

export const COMMAND_CONTEXTS = Object.freeze([
  'chat', 'reply', 'project', 'route', 'request', 'document', 'output',
  'code', 'workbench', 'settings',
]);

const COMPOSERS = ['chat', 'reply', 'project', 'route', 'request', 'document', 'output'];
const WORK_CONTEXTS = ['chat', 'reply', 'project', 'route', 'request'];
const EVERYWHERE = [...COMMAND_CONTEXTS];

const operationDefaults = {
  read: { read: true },
  draft: { read: true, draft: true },
  write: { read: true, write: true },
  external: { read: true, write: true, external: true },
  destructive: { read: true, write: true, external: true, destructive: true },
};

function command(path, category, description, options = {}) {
  const name = path.replace(/^\//, '').trim().replace(/\s+/g, ' ');
  const parts = name.split(' ');
  const namespace = options.namespace || (parts.length > 1 ? parts[0] : null);
  const operation = options.operation || 'read';
  const action = Object.freeze({
    read: false, draft: false, write: false, external: false, destructive: false,
    agentStart: false, paid: false,
    ...operationDefaults[operation],
    ...(options.action || {}),
  });
  const aliases = (options.aliases || []).map(alias => `/${alias.replace(/^\//, '').trim().replace(/\s+/g, ' ')}`);
  return Object.freeze({
    id: options.id || name.replace(/\s+/g, '.'),
    name,
    command: `/${name}`,
    namespace,
    usage: options.usage || `/${name}`,
    aliases: Object.freeze(aliases),
    category,
    description,
    risk: options.risk || operation,
    read: action.read,
    draft: action.draft,
    write: action.write,
    external: action.external,
    destructive: action.destructive,
    connection: options.connection || null,
    contexts: Object.freeze(options.contexts || COMPOSERS),
    startsAgent: action.agentStart,
    paid: action.paid,
    action,
    availability: Object.freeze({
      mode: 'catalog-only',
      requiresConnection: Boolean(options.connection),
      note: options.availability || 'Requires a registered command handler.',
    }),
  });
}

function fromRows(category, rows, defaults = {}) {
  return rows.map(([path, description, options = {}]) => command(path, category, description, { ...defaults, ...options, action: { ...(defaults.action || {}), ...(options.action || {}) } }));
}

const core = fromRows(COMMAND_CATEGORIES.CORE, [
  ['help', 'Search commands and explain their parameters.', { usage: '/help [query]', aliases: ['commands'] }],
  ['agent', 'Select the agent that will receive the composed message.', { usage: '/agent [agent]', operation: 'draft' }],
  ['talvori', 'Prepare a request in Talvori without sending or starting work.', { id: 'rumbo', aliases: ['rumbo'], usage: '/talvori [instruction]', operation: 'draft', contexts: [...COMPOSERS, 'workbench'] }],
  ['ask', 'Prepare a bounded question for an agent using selected context.', { usage: '/ask [agent] [instruction]', operation: 'draft', action: { agentStart: true, paid: true } }],
  ['mention', 'Insert a person, team, or agent mention.', { usage: '/mention [person|team|agent]', operation: 'draft' }],
  ['reply', 'Reply to the selected message, update, or finding.', { operation: 'draft' }],
  ['quote', 'Quote selected content in the composer.', { operation: 'draft' }],
  ['update', 'Draft a progress, decision, blocker, risk, release, or outcome update.', { usage: '/update [type]', operation: 'draft' }],
  ['status', 'Prepare a permitted status change.', { usage: '/status [status]', operation: 'write' }],
  ['assign', 'Prepare an assignment to a person, agent, or team.', { usage: '/assign [person|agent|team]', operation: 'write' }],
  ['priority', 'Prepare a priority change.', { usage: '/priority [level]', operation: 'write' }],
  ['due', 'Prepare a due-date change.', { usage: '/due [date]', operation: 'write' }],
  ['label', 'Prepare label additions or removals.', { usage: '/label [label]', operation: 'write' }],
  ['link', 'Link a Talvori or connected object.', { usage: '/link [object]', operation: 'write' }],
  ['unlink', 'Prepare removal of a relationship.', { usage: '/unlink [object]', operation: 'write', risk: 'confirmation' }],
  ['context', 'Inspect context selected for the current draft or run.', { aliases: ['context show'] }],
  ['context add', 'Add an authorized source to the selected context.', { usage: '/context add [source]', operation: 'draft' }],
  ['context remove', 'Exclude a source from the selected context.', { usage: '/context remove [source]', operation: 'draft' }],
  ['sources', 'Show sources included in the current draft or run.'],
  ['memory', 'View relevant approved memories.'],
  ['remember', 'Draft a proposal to save selected information to memory.', { operation: 'draft' }],
  ['forget', 'Draft a proposal to expire or remove a memory.', { operation: 'write', risk: 'confirmation' }],
  ['attach', 'Attach a file, image, resource, or authorized external source.', { usage: '/attach [source]', operation: 'draft' }],
  ['template', 'Apply a reply, Route, Request, document, or update template.', { usage: '/template [name]', operation: 'draft' }],
  ['summarize', 'Prepare a summary of the current conversation or object.', { operation: 'draft' }],
  ['translate', 'Translate selected or composed content.', { usage: '/translate [language]', operation: 'draft' }],
  ['format', 'Format content as a brief, checklist, report, decision, or table.', { usage: '/format [type]', operation: 'draft' }],
  ['clear', 'Clear the composer, with confirmation when it has substantial content.', { operation: 'write', risk: 'confirmation' }],
]);

const work = fromRows(COMMAND_CATEGORIES.WORK, [
  ['chat new', 'Create a new chat without starting an agent.', { operation: 'write' }],
  ['chat open', 'Open an existing chat.', { usage: '/chat open [chat]' }],
  ['chat branch', 'Create a branch chat from a selected message without starting an agent.', { usage: '/chat branch [message]', operation: 'write' }],
  ['chat export', 'Prepare an export of the current chat.', { usage: '/chat export [format]', operation: 'draft' }],
  ['route new', 'Create a draft Route from current context.', { operation: 'draft' }],
  ['route link', 'Link the conversation to an existing Route.', { operation: 'write' }],
  ['route accept', 'Accept a Route without approving its outputs.', { operation: 'write', risk: 'confirmation' }],
  ['route block', 'Mark or propose a blocker with a reason.', { operation: 'write' }],
  ['route complete', 'Prepare completion and show unmet acceptance requirements.', { operation: 'write', risk: 'confirmation' }],
  ['request new', 'Create a draft Request from current context.', { operation: 'draft' }],
  ['request accept', 'Accept a Request and optionally prepare a Route.', { operation: 'write', risk: 'confirmation' }],
  ['request decline', 'Decline a Request with a recorded reason.', { operation: 'write', risk: 'confirmation' }],
  ['project new', 'Create a draft Project.', { operation: 'draft' }],
  ['project link', 'Link to an existing Project.', { operation: 'write' }],
  ['milestone new', 'Create a draft milestone.', { operation: 'draft' }],
  ['task new', 'Create draft lightweight checklist work.', { operation: 'draft' }],
  ['document new', 'Create a project or team document from current content.', { operation: 'draft' }],
  ['output save', 'Save selected content as a versioned output.', { operation: 'write' }],
  ['review request', 'Request review from people or agents.', { operation: 'write' }],
  ['approve', 'Open the applicable approval preview; never selects an unrelated item.', { operation: 'write', risk: 'confirmation' }],
  ['reject', 'Reject the selected proposal or output with a reason.', { operation: 'write', risk: 'confirmation' }],
  ['decision', 'Record a decision, rationale, owner, and affected work.', { operation: 'write' }],
  ['handoff', 'Prepare a handoff with outcome, context, state, and next steps.', { operation: 'draft' }],
  ['follow', 'Subscribe to relevant Talvori updates.', { usage: '/follow [object]', operation: 'write' }],
  ['unfollow', 'Stop updates for a Talvori object.', { usage: '/unfollow [object]', operation: 'write' }],
], { contexts: WORK_CONTEXTS });

const agent = fromRows(COMMAND_CATEGORIES.AGENT, [
  ['run', 'Prepare a new agent run using current context.', { usage: '/run [agent]', operation: 'draft', action: { agentStart: true, paid: true } }],
  ['continue', 'Prepare continuation of a compatible run.', { usage: '/continue [run]', operation: 'draft', action: { agentStart: true, paid: true } }],
  ['stop', 'Stop a running session; this does not undo its changes.', { usage: '/stop [run]', operation: 'write', risk: 'confirmation' }],
  ['retry', 'Prepare retry of a failed run with preserved idempotency and permissions.', { usage: '/retry [run]', operation: 'draft', action: { agentStart: true, paid: true } }],
  ['branch', 'Create a branch conversation from a selected point.', { usage: '/branch [message|run]', operation: 'write' }],
  ['review', 'Prepare an agent review of selected work.', { usage: '/review [agent]', operation: 'draft', action: { agentStart: true, paid: true } }],
  ['compare', 'Compare agents or outputs while preserving separate evidence.', { usage: '/compare [agents|outputs]', operation: 'draft', action: { agentStart: true, paid: true } }],
  ['test', 'Prepare an eligible agent test run.', { usage: '/test [scope]', operation: 'draft', action: { agentStart: true, paid: true } }],
  ['explain', 'Prepare a source-grounded explanation.', { usage: '/explain [selection]', operation: 'draft', action: { agentStart: true, paid: true } }],
  ['investigate', 'Prepare an investigation using linked evidence.', { usage: '/investigate [problem]', operation: 'draft', action: { agentStart: true, paid: true } }],
  ['implement', 'Prepare an implementation run and show folder, branch, permissions, and context.', { usage: '/implement [route]', operation: 'draft', action: { agentStart: true, paid: true } }],
  ['research', 'Prepare research with explicit sources and connection access.', { usage: '/research [question]', operation: 'draft', action: { agentStart: true, paid: true } }],
  ['usage', 'Show provider usage information where supported.'],
  ['runs', 'List active and recent runs.'],
  ['permissions', 'Show what the selected agent can access and change.'],
]);

const navigation = fromRows(COMMAND_CATEGORIES.NAVIGATION, [
  ['open', 'Open a Talvori object.', { usage: '/open [object]' }],
  ['find', 'Search Talvori.', { usage: '/find [query]', aliases: ['search'] }],
  ['code', 'Open Code at a repository or path.', { usage: '/code [repository|path]' }],
  ['design', 'Open linked design context.', { usage: '/design [file|frame]' }],
  ['inbox', 'Open Inbox.'], ['focus', 'Open Focus.'], ['workbench', 'Open Workbench.'],
  ['connections', 'Open Connections.'],
  ['settings', 'Open a Settings section.', { usage: '/settings [section]' }],
  ['history', 'Show activity and version history.', { usage: '/history [object]' }],
  ['back', 'Navigate to the previous Talvori page.'],
], { contexts: EVERYWHERE });

const scheduling = fromRows(COMMAND_CATEGORIES.SCHEDULING, [
  ['remind', 'Create an in-app reminder attached to the current object.', { usage: '/remind [time]', operation: 'write' }],
  ['repeat', 'Prepare a repeating Route configuration; generation remains explicit.', { usage: '/repeat [schedule]', operation: 'draft' }],
  ['rule new', 'Open the rule builder with current context.', { operation: 'draft' }],
  ['rule preview', 'Preview matching objects and proposed effects.'],
  ['rule pause', 'Pause an existing rule after confirmation.', { operation: 'write', risk: 'confirmation' }],
  ['schedule', 'Prepare a supported Talvori action for a specified time.', { usage: '/schedule [action] [time]', operation: 'draft' }],
  ['notify', 'Prepare a notification with a preview.', { usage: '/notify [destination]', operation: 'draft' }],
  ['digest', 'Configure an update digest.', { usage: '/digest [scope] [schedule]', operation: 'write' }],
]);

const workbench = fromRows(COMMAND_CATEGORIES.WORKBENCH, [
  ['terminal new', 'Open a terminal for the selected machine and project.', { operation: 'write' }],
  ['command', 'Prepare a shell command and show its target and risk.', { usage: '/command [text]', operation: 'draft', risk: 'variable' }],
  ['files', 'Open project files at a path.', { usage: '/files [path]' }],
  ['git status', 'Show local Git status.'],
  ['git diff', 'Show local changes.'],
  ['git branch', 'Show branches or prepare branch creation or switching.', { usage: '/git branch [name]', operation: 'draft' }],
  ['git fetch', 'Prepare an update of remote-tracking information.', { operation: 'external' }],
  ['git pull', 'Preview and run a pull on the selected machine.', { operation: 'external', risk: 'confirmation' }],
  ['git commit', 'Prepare a local commit with selected changes.', { operation: 'draft' }],
  ['git push', 'Preview the remote and branch before publishing commits.', { operation: 'external', risk: 'confirmation' }],
  ['git worktree', 'Create, open, or inspect a worktree.', { usage: '/git worktree [action]', operation: 'draft' }],
  ['git history', 'Show local repository history.'],
], { contexts: ['chat', 'reply', 'project', 'route', 'code', 'workbench'] });

const connectionRows = {
  codex: [
    ['ask', 'Prepare a bounded Codex question.', 'draft', true], ['implement', 'Prepare a Codex implementation run.', 'draft', true],
    ['review', 'Prepare a Codex review.', 'draft', true], ['test', 'Prepare a Codex test run.', 'draft', true],
    ['explain', 'Prepare a Codex explanation.', 'draft', true], ['fix', 'Prepare a Codex fix run.', 'draft', true],
    ['document', 'Prepare Codex documentation work.', 'draft', true], ['continue', 'Prepare continuation of a Codex run.', 'draft', true],
    ['stop', 'Stop a Codex run without undoing its changes.', 'write', false, 'confirmation'],
  ],
  claude: [
    ['ask', 'Prepare a bounded Claude question.', 'draft', true], ['analyze', 'Prepare a Claude analysis run.', 'draft', true],
    ['implement', 'Prepare a Claude implementation run.', 'draft', true], ['review', 'Prepare a Claude review.', 'draft', true],
    ['compare', 'Prepare a Claude comparison.', 'draft', true], ['document', 'Prepare Claude documentation work.', 'draft', true],
    ['continue', 'Prepare continuation of a Claude run.', 'draft', true], ['stop', 'Stop a Claude run without undoing its changes.', 'write', false, 'confirmation'],
  ],
  github: [
    ['issue', 'Find or prepare a GitHub issue.', 'draft'], ['branch', 'Find or prepare a GitHub branch.', 'draft'],
    ['commit', 'Find or prepare a GitHub commit.', 'draft'], ['pr', 'Find or prepare a GitHub pull request.', 'draft'],
    ['review', 'Find or prepare a GitHub review.', 'draft'], ['checks', 'Read GitHub checks.', 'read'],
    ['release', 'Find or prepare a GitHub release.', 'draft'], ['sync', 'Prepare GitHub synchronization.', 'external'],
    ['open', 'Open a linked GitHub object.', 'read'],
  ],
  actions: [
    ['status', 'Read GitHub Actions status.', 'read'], ['logs', 'Read selected workflow logs.', 'read'],
    ['investigate', 'Prepare an investigation of a failed run.', 'draft', true],
    ['rerun', 'Rerun a selected workflow after approval.', 'external', false, 'confirmation'],
    ['cancel', 'Cancel a selected workflow after approval.', 'destructive', false, 'confirmation'],
    ['dispatch', 'Dispatch an approved workflow.', 'external', false, 'confirmation'],
  ],
  package: [
    ['status', 'Read package publication status.', 'read'], ['prepare', 'Prepare a package release.', 'draft'],
    ['compare', 'Compare package versions.', 'read'], ['release', 'Prepare or dispatch an approved package release.', 'external', false, 'confirmation'],
    ['history', 'Read package history.', 'read'],
  ],
  drive: [
    ['find', 'Search authorized Google Drive resources.', 'read'], ['attach', 'Attach an authorized Drive resource.', 'draft'],
    ['snapshot', 'Create a pinned source snapshot.', 'write'], ['refresh', 'Refresh an authorized source.', 'external'],
    ['save', 'Prepare saving approved content to Drive.', 'external', false, 'confirmation'], ['sources', 'List authorized Drive sources.', 'read'],
  ],
  docs: [
    ['attach', 'Attach an authorized Google Doc or section.', 'draft'], ['summarize', 'Prepare a grounded document summary.', 'draft'],
    ['extract', 'Extract draft structured work from a document.', 'draft'], ['compare', 'Compare linked document versions.', 'read'],
    ['publish', 'Publish approved content to Google Docs.', 'external', false, 'confirmation'],
    ['update', 'Apply a reviewed Google Docs edit.', 'external', false, 'confirmation'], ['sources', 'List linked document sources.', 'read'],
  ],
  sheets: [
    ['import', 'Preview an import from an authorized range.', 'draft'], ['map', 'Configure row and field mappings.', 'write'],
    ['analyze', 'Analyze an authorized range.', 'read'], ['sync', 'Preview or apply configured sheet synchronization.', 'external', false, 'confirmation'],
    ['report', 'Prepare a report for a selected range.', 'draft'], ['preview', 'Preview sheet changes.', 'read'],
    ['conflicts', 'Open spreadsheet synchronization conflicts.', 'read'],
  ],
  slides: [
    ['create', 'Prepare a presentation from approved sources.', 'draft'], ['outline', 'Prepare a presentation outline.', 'draft'],
    ['update', 'Prepare selective slide updates.', 'draft'], ['preview', 'Preview presentation changes.', 'read'],
    ['export', 'Export an approved presentation.', 'external', false, 'confirmation'], ['sources', 'List slide-to-source provenance.', 'read'],
  ],
  linear: [
    ['import', 'Preview import of selected Linear work.', 'draft'], ['create', 'Prepare creation of a Linear issue.', 'draft'],
    ['sync', 'Preview or apply configured Linear synchronization.', 'external', false, 'confirmation'],
    ['update', 'Prepare an update to a linked Linear issue.', 'draft'], ['comment', 'Prepare a Linear comment.', 'draft'],
    ['cycle', 'Read linked Linear cycle information.', 'read'], ['conflicts', 'Open Linear synchronization conflicts.', 'read'],
  ],
  jira: [
    ['import', 'Preview import of selected Jira work.', 'draft'], ['create', 'Prepare creation of a Jira issue.', 'draft'],
    ['transition', 'Prepare a validated Jira workflow transition.', 'draft'], ['comment', 'Prepare a Jira comment.', 'draft'],
    ['sync', 'Preview or apply configured Jira synchronization.', 'external', false, 'confirmation'],
    ['link', 'Link a Jira issue to Talvori work.', 'write'], ['conflicts', 'Open Jira synchronization conflicts.', 'read'],
  ],
  slack: [
    ['capture', 'Capture an authorized Slack message or thread as draft work.', 'draft'],
    ['reply', 'Prepare a reply to a linked Slack thread.', 'draft'], ['update', 'Prepare a Slack project update.', 'draft'],
    ['notify', 'Prepare a Slack notification.', 'draft'], ['digest', 'Configure a Slack digest.', 'write'],
    ['link', 'Link an authorized Slack thread.', 'write'], ['open', 'Open a linked Slack thread.', 'read'],
  ],
  figma: [
    ['attach', 'Attach an authorized Figma object.', 'draft'], ['inspect', 'Inspect a linked Figma object.', 'read'],
    ['compare', 'Compare implementation evidence with selected frames.', 'read'], ['review', 'Prepare a design review.', 'draft'],
    ['comments', 'Read or prepare supported Figma comments.', 'draft'], ['changes', 'Review changes to linked designs.', 'read'],
    ['map', 'Map design objects to code or Talvori work.', 'write'],
  ],
  figjam: [
    ['attach', 'Attach an authorized FigJam board or section.', 'draft'], ['extract', 'Extract draft work from selected board content.', 'draft'],
    ['decisions', 'Extract draft decisions with source references.', 'draft'], ['routes', 'Extract draft Routes with source references.', 'draft'],
    ['diagram', 'Prepare a supported diagram or export.', 'draft'], ['sync', 'Preview supported FigJam synchronization.', 'external', false, 'confirmation'],
  ],
};

const connections = Object.entries(connectionRows).flatMap(([connection, rows]) => rows.map(([subcommand, description, operation = 'read', startsAgent = false, risk]) => command(
  `${connection} ${subcommand}`,
  COMMAND_CATEGORIES.CONNECTION,
  description,
  {
    namespace: connection,
    connection,
    operation,
    risk: risk || operation,
    usage: `/${connection} ${subcommand}${['status', 'logs', 'sources', 'history', 'conflicts', 'open'].includes(subcommand) ? ' [target]' : ' [options]'}`,
    contexts: connection === 'figma' || connection === 'figjam' ? [...COMPOSERS, 'code'] : COMPOSERS,
    action: { agentStart: startsAgent, paid: startsAgent },
    availability: `Requires an enabled ${connection} connection and a registered handler.`,
  },
)));

export const COMMANDS = Object.freeze([...core, ...work, ...agent, ...navigation, ...scheduling, ...workbench, ...connections]);

const commandByPhrase = new Map();
for (const item of COMMANDS) {
  commandByPhrase.set(item.name.toLocaleLowerCase(), { command: item, alias: null });
  for (const alias of item.aliases) commandByPhrase.set(alias.slice(1).toLocaleLowerCase(), { command: item, alias });
}
const phrasesByLength = [...commandByPhrase.keys()].sort((a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length);

/** Tokenize command arguments, supporting quoted strings and backslash escaping. */
export function tokenizeCommand(text = '') {
  const tokens = [];
  let token = '', quote = null, escaped = false, started = false;
  for (const char of String(text)) {
    if (escaped) { token += char; escaped = false; started = true; continue; }
    if (char === '\\') { escaped = true; started = true; continue; }
    if (quote) {
      if (char === quote) quote = null;
      else token += char;
      started = true;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; started = true; continue; }
    if (/\s/.test(char)) {
      if (started) { tokens.push(token); token = ''; started = false; }
      continue;
    }
    token += char; started = true;
  }
  if (escaped) token += '\\';
  if (started) tokens.push(token);
  return { tokens, error: quote ? `Unclosed ${quote} quote.` : null };
}

/** Parse only messages whose first non-whitespace character is `/`. */
export function parseSlashCommand(text = '') {
  const raw = String(text);
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  const source = trimmed.slice(1).trim();
  const tokenized = tokenizeCommand(source);
  const lowerTokens = tokenized.tokens.map(token => token.toLocaleLowerCase());
  // A POSIX path can be pasted into a composer and is not a slash command.
  if (lowerTokens[0]?.includes('/')) return null;
  let match = null;
  for (const phrase of phrasesByLength) {
    const parts = phrase.split(' ');
    if (parts.every((part, index) => lowerTokens[index] === part)) {
      match = { ...commandByPhrase.get(phrase), length: parts.length };
      break;
    }
  }
  if (!match) return {
    type: 'unknown', raw, input: source, name: lowerTokens[0] || '', argv: tokenized.tokens.slice(1),
    args: tokenized.tokens.slice(1).join(' '), command: null, matchedAlias: null, error: tokenized.error,
  };
  const argv = tokenized.tokens.slice(match.length);
  return {
    type: 'command', raw, input: source, name: match.command.name, argv,
    args: argv.join(' '), command: match.command, matchedAlias: match.alias, error: tokenized.error,
  };
}

export function getCommand(value) {
  const parsed = parseSlashCommand(String(value || '').startsWith('/') ? value : `/${value || ''}`);
  return parsed?.command || COMMANDS.find(item => item.id === value) || null;
}

function asSet(value) {
  if (value instanceof Set) return value;
  return new Set(Array.isArray(value) ? value : []);
}

/**
 * Resolve context, connection, cost, and handler gates. No handler is assumed.
 */
export function commandAvailability(value, options = {}) {
  const item = typeof value === 'string' ? getCommand(value) : value;
  if (!item) return { available: false, reason: 'unknown-command', message: 'Unknown command.' };
  if (options.context && !item.contexts.includes(options.context)) {
    return { available: false, reason: 'unsupported-context', message: `${item.command} is not available in ${options.context}.` };
  }
  const enabledConnections = asSet(options.connections || options.enabledConnections);
  if (item.connection && !enabledConnections.has(item.connection)) {
    return { available: false, reason: 'connection-required', message: `Connect ${item.connection} to use ${item.command}.` };
  }
  if (item.startsAgent && options.allowAgentStarts === false) {
    return { available: false, reason: 'agent-start-disabled', message: 'Agent starts are disabled here.' };
  }
  if (item.paid && options.allowPaid === false) {
    return { available: false, reason: 'paid-request-disabled', message: 'Paid model requests are disabled here.' };
  }
  const executors = asSet(options.executableCommandIds || options.executors);
  if (!executors.has(item.id)) {
    return { available: false, reason: 'handler-required', message: item.availability.note };
  }
  return { available: true, reason: null, message: 'Available.', command: item };
}

/** Search names, aliases, descriptions, usage, category, and connection names. */
export function searchCommands(query = '', options = {}) {
  const needle = String(query).trim().replace(/^\//, '').toLocaleLowerCase();
  const connections = options.connections || options.enabledConnections;
  return COMMANDS.filter(item => {
    if (options.context && !item.contexts.includes(options.context)) return false;
    if (connections && item.connection && !asSet(connections).has(item.connection)) return false;
    if (options.category && item.category !== options.category) return false;
    if (!needle) return true;
    const haystack = [item.name, item.command, item.usage, item.description, item.category, item.connection, ...item.aliases].filter(Boolean).join(' ').toLocaleLowerCase();
    return needle.split(/\s+/).every(term => haystack.includes(term));
  }).sort((a, b) => {
    const aExact = a.name === needle || a.aliases.some(alias => alias.slice(1) === needle);
    const bExact = b.name === needle || b.aliases.some(alias => alias.slice(1) === needle);
    if (aExact !== bExact) return aExact ? -1 : 1;
    const aPrefix = a.name.startsWith(needle), bPrefix = b.name.startsWith(needle);
    if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

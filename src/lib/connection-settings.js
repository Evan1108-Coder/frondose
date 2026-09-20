import { CONNECTOR_CATALOG } from '../../server/connectors/catalog.mjs';

const EFFECTS = Object.freeze(['read', 'draft', 'write', 'publish', 'destroy']);
const TAB_ORDER = Object.freeze(['overview', 'resources', 'mappings', 'rules', 'agents', 'context', 'commands', 'notifications', 'security', 'activity']);
const CONNECTION_STATES = new Set(['not_connected', 'connecting', 'connected', 'probe_failed', 'error']);
const clone = (value) => JSON.parse(JSON.stringify(value));

const command = (provider, name, effect, summary, options = {}) => Object.freeze({
  id: `${provider}:${name.replace(/^\//, '').replaceAll(' ', '.')}`,
  provider,
  name,
  summary,
  effect,
  requiredConnection: options.requiredConnection ?? provider,
  requiredAccount: options.requiredAccount ?? true,
  resourceScope: options.resourceScope ?? 'selected_resources',
  confirmation: options.confirmation ?? (['write', 'publish', 'destroy'].includes(effect) ? 'always' : 'never'),
  startsAgent: Boolean(options.startsAgent),
  paidRequest: Boolean(options.paidRequest),
  target: options.target ?? 'external',
  expectedResult: options.expectedResult ?? 'A preview or provider result is returned to the current conversation.',
  undo: options.undo ?? (effect === 'draft' || effect === 'read' ? 'not_needed' : 'provider_dependent'),
  surfaces: Object.freeze(options.surfaces ?? ['chat', 'reply']),
  implementation: 'metadata_only',
  canExecute: false,
});

const commands = (provider, rows, shared = {}) => Object.freeze(rows.map(([name, effect, summary, options]) =>
  command(provider, name, effect, summary, { ...shared, ...options })));

const CODEX_COMMANDS = commands('codex', [
  ['/codex ask', 'read', 'Prepare a bounded question for Codex.'],
  ['/codex implement', 'write', 'Prepare an implementation run for reviewed project context.'],
  ['/codex review', 'read', 'Prepare a code or artifact review.'],
  ['/codex test', 'write', 'Prepare a test run in the selected project.'],
  ['/codex explain', 'read', 'Explain selected code or work using supplied context.'],
  ['/codex fix', 'write', 'Prepare a fix for a selected finding.'],
  ['/codex document', 'write', 'Prepare documentation changes.'],
  ['/codex continue', 'write', 'Prepare continuation of a compatible prior run.'],
  ['/codex stop', 'write', 'Request that a selected active run stop.', { confirmation: 'when_running', undo: 'not_available' }],
], { target: 'local_runner', startsAgent: true, paidRequest: true, requiredAccount: true, resourceScope: 'selected_context' });

const CLAUDE_COMMANDS = commands('claude', [
  ['/claude ask', 'read', 'Prepare a bounded question for Claude.'],
  ['/claude analyze', 'read', 'Prepare analysis of selected context.'],
  ['/claude implement', 'write', 'Prepare an implementation request when the runner supports it.'],
  ['/claude review', 'read', 'Prepare an independent review.'],
  ['/claude compare', 'read', 'Compare selected artifacts without merging their evidence.'],
  ['/claude document', 'write', 'Prepare documentation changes.'],
  ['/claude continue', 'write', 'Prepare continuation of a compatible prior run.'],
  ['/claude stop', 'write', 'Request that a selected active run stop.', { confirmation: 'when_running', undo: 'not_available' }],
], { target: 'local_runner', startsAgent: true, paidRequest: true, requiredAccount: true, resourceScope: 'selected_context' });

const PROVIDER_COMMANDS = Object.freeze({
  codex: CODEX_COMMANDS,
  claude: CLAUDE_COMMANDS,
  github: commands('github', [
    ['/github issue', 'write', 'Prepare creation or update of an issue.'], ['/github branch', 'write', 'Prepare a branch operation.'],
    ['/github commit', 'write', 'Prepare a commit from selected changes.'], ['/github pr', 'publish', 'Prepare a pull request or update.'],
    ['/github review', 'publish', 'Prepare a pull request review.'], ['/github checks', 'read', 'Read checks for a selected commit or pull request.'],
    ['/github release', 'publish', 'Prepare a release.'], ['/github sync', 'write', 'Prepare synchronization of linked GitHub data.'],
    ['/github open', 'read', 'Open a selected GitHub object.'],
  ], { requiredConnection: 'github', resourceScope: 'selected_repositories' }),
  'github-actions': commands('github-actions', [
    ['/actions status', 'read', 'Read selected workflow and check status.'], ['/actions logs', 'read', 'Read selected workflow logs.'],
    ['/actions investigate', 'read', 'Prepare an agent investigation from a failed run.', { startsAgent: true, paidRequest: true }],
    ['/actions rerun', 'write', 'Prepare a workflow rerun.'], ['/actions cancel', 'write', 'Prepare cancellation of a running workflow.', { undo: 'not_available' }],
    ['/actions dispatch', 'publish', 'Prepare an approved workflow dispatch.'],
  ], { requiredConnection: 'github', resourceScope: 'selected_repositories' }),
  'github-packages': commands('github-packages', [
    ['/package status', 'read', 'Read versions and release state for a selected package.'], ['/package prepare', 'draft', 'Prepare a package release manifest.'],
    ['/package compare', 'read', 'Compare selected package versions.'], ['/package release', 'publish', 'Prepare an approved publishing workflow.'],
    ['/package history', 'read', 'Read selected package release history.'],
  ], { requiredConnection: 'github', resourceScope: 'selected_packages' }),
  'google-drive': commands('google-drive', [
    ['/drive find', 'read', 'Find authorized Drive metadata.'], ['/drive attach', 'draft', 'Prepare a link to a selected Drive item.'],
    ['/drive snapshot', 'draft', 'Prepare a pinned source snapshot.'], ['/drive refresh', 'read', 'Refresh selected source metadata.'],
    ['/drive save', 'publish', 'Prepare saving an approved artifact to Drive.'], ['/drive sources', 'read', 'List Drive sources attached to the current context.'],
  ], { requiredConnection: 'google-drive', resourceScope: 'selected_files_and_folders' }),
  'google-docs': commands('google-docs', [
    ['/docs attach', 'draft', 'Prepare a link to an authorized document or section.'], ['/docs summarize', 'read', 'Summarize selected authorized document content.'],
    ['/docs extract', 'draft', 'Prepare structured work from selected document content.'], ['/docs compare', 'read', 'Compare selected document versions.'],
    ['/docs publish', 'publish', 'Prepare creation of an approved Google Doc.'], ['/docs update', 'write', 'Prepare edits to an authorized Google Doc.'],
    ['/docs sources', 'read', 'List document sources in the current context.'],
  ], { requiredConnection: 'google-drive', resourceScope: 'selected_documents' }),
  'google-sheets': commands('google-sheets', [
    ['/sheets import', 'write', 'Prepare import from an authorized range.'], ['/sheets map', 'draft', 'Prepare column-to-field mappings.'],
    ['/sheets analyze', 'read', 'Analyze an authorized range.'], ['/sheets sync', 'write', 'Prepare synchronization using reviewed field ownership.'],
    ['/sheets report', 'publish', 'Prepare a report for an authorized range.'], ['/sheets preview', 'read', 'Preview proposed spreadsheet changes.'],
    ['/sheets conflicts', 'read', 'List unresolved synchronization conflicts.'],
  ], { requiredConnection: 'google-drive', resourceScope: 'selected_spreadsheets_and_ranges' }),
  'google-slides': commands('google-slides', [
    ['/slides create', 'publish', 'Prepare a presentation from reviewed sources.'], ['/slides outline', 'draft', 'Prepare a presentation outline.'],
    ['/slides update', 'write', 'Prepare selective updates to generated slides.'], ['/slides preview', 'read', 'Preview proposed presentation changes.'],
    ['/slides export', 'publish', 'Prepare export of a selected presentation.'], ['/slides sources', 'read', 'List sources used by a generated presentation.'],
  ], { requiredConnection: 'google-drive', resourceScope: 'selected_presentations' }),
  linear: commands('linear', [
    ['/linear import', 'write', 'Prepare import of selected Linear work.'], ['/linear create', 'publish', 'Prepare creation of a Linear issue.'],
    ['/linear sync', 'write', 'Prepare controlled synchronization.'], ['/linear update', 'write', 'Prepare a field update.'],
    ['/linear comment', 'publish', 'Prepare an external issue comment.'], ['/linear cycle', 'read', 'Read selected cycle context.'],
    ['/linear conflicts', 'read', 'List unresolved synchronization conflicts.'],
  ], { resourceScope: 'selected_teams_and_projects' }),
  jira: commands('jira', [
    ['/jira import', 'write', 'Prepare import of selected Jira work.'], ['/jira create', 'publish', 'Prepare creation of a Jira issue.'],
    ['/jira transition', 'write', 'Prepare a validated workflow transition.'], ['/jira comment', 'publish', 'Prepare an external issue comment.'],
    ['/jira sync', 'write', 'Prepare controlled synchronization.'], ['/jira link', 'draft', 'Prepare a link to a Jira object.'],
    ['/jira conflicts', 'read', 'List unresolved synchronization conflicts.'],
  ], { resourceScope: 'selected_sites_and_projects' }),
  slack: commands('slack', [
    ['/slack capture', 'write', 'Prepare Rumbo work from a selected Slack message or thread.'], ['/slack reply', 'publish', 'Prepare a reply to a linked Slack thread.'],
    ['/slack update', 'publish', 'Prepare a progress update for a linked thread.'], ['/slack notify', 'publish', 'Prepare a message for an allowed channel.'],
    ['/slack digest', 'publish', 'Prepare a digest for an allowed channel.'], ['/slack link', 'draft', 'Link a selected Slack thread.'],
    ['/slack open', 'read', 'Open a linked Slack object.'],
  ], { resourceScope: 'allowed_channels' }),
  figma: commands('figma', [
    ['/figma attach', 'draft', 'Prepare a link to a selected Figma object.'], ['/figma inspect', 'read', 'Inspect selected design metadata.'],
    ['/figma compare', 'read', 'Compare implementation evidence with a selected frame.'], ['/figma review', 'draft', 'Prepare structured design findings.'],
    ['/figma comments', 'read', 'Read supported selected comments.'], ['/figma changes', 'read', 'Read supported design-version changes.'],
    ['/figma map', 'draft', 'Prepare a design-to-code mapping.'],
  ], { resourceScope: 'selected_files_pages_and_frames' }),
  figjam: commands('figjam', [
    ['/figjam attach', 'draft', 'Prepare a link to selected FigJam content.'], ['/figjam extract', 'draft', 'Prepare structured work from selected board content.'],
    ['/figjam decisions', 'draft', 'Prepare decision records from selected content.'], ['/figjam routes', 'write', 'Prepare Routes from selected board content.'],
    ['/figjam diagram', 'publish', 'Prepare a supported diagram result.'], ['/figjam sync', 'write', 'Prepare a reviewed board synchronization.'],
  ], { resourceScope: 'selected_boards_and_sections' }),
});

const provider = (id, displayName, implementation, baseConnection, options = {}) => Object.freeze({
  id, displayName, implementation, baseConnection,
  category: options.category ?? 'Tools',
  // This descriptor serves the legacy machine-account editor, not OAuth account readiness.
  boundary: CONNECTOR_CATALOG[id] ? `Workspace Connections supports ${CONNECTOR_CATALOG[id].features.map(feature => feature.label.toLowerCase()).join(', ')}. Configure OAuth and selected resources there. This machine-account editor and its command suggestions do not enable those workspace operations.` : options.boundary,
  workspaceCapabilities: Object.freeze(CONNECTOR_CATALOG[id]?.features.map(feature => feature.id) || []),
  implementedCapabilities: Object.freeze(options.implementedCapabilities ?? []),
  unavailableCapabilities: Object.freeze(options.unavailableCapabilities ?? []),
  settingsSections: Object.freeze(options.settingsSections ?? TAB_ORDER.slice(1)),
  commands: PROVIDER_COMMANDS[id],
});

export const CONNECTION_PROVIDERS = Object.freeze({
  codex: provider('codex', 'Codex', 'partial', 'codex', { category: 'AI', boundary: 'Existing CLI authentication and explicit agent runs are implemented. Slash commands and rich provider preferences are metadata only.', implementedCapabilities: ['cli_auth', 'explicit_agent_runs'], unavailableCapabilities: ['slash_command_dispatch', 'usage_reporting'] }),
  claude: provider('claude', 'Claude Code', 'partial', 'claude', { category: 'AI', boundary: 'Existing CLI authentication and restricted explicit analysis runs are implemented. Slash commands and broader write tools are not.', implementedCapabilities: ['cli_auth', 'explicit_restricted_runs'], unavailableCapabilities: ['slash_command_dispatch', 'write_runs', 'usage_reporting'] }),
  github: provider('github', 'GitHub', 'partial', 'github', { category: 'Code', boundary: 'Authentication and repository metadata discovery are implemented. Issues, pull requests, reviews, synchronization, and publishing are not.', implementedCapabilities: ['cli_or_token_auth', 'repository_metadata'], unavailableCapabilities: ['slash_command_dispatch', 'issues', 'pull_requests', 'reviews', 'writes', 'webhooks'] }),
  'github-actions': provider('github-actions', 'GitHub Actions', 'metadata_only', 'github', { category: 'Code', boundary: 'No workflow, log, artifact, rerun, cancellation, or dispatch API is implemented.', unavailableCapabilities: ['all_external_operations'] }),
  'github-packages': provider('github-packages', 'GitHub Packages', 'metadata_only', 'github', { category: 'Code', boundary: 'No package registry or publishing API is implemented.', unavailableCapabilities: ['all_external_operations'] }),
  'google-drive': provider('google-drive', 'Google Drive', 'partial', 'google-drive', { category: 'Knowledge', boundary: 'OAuth and read-only file metadata discovery are implemented. File bodies, folder watching, snapshots, and writes are not.', implementedCapabilities: ['oauth', 'file_metadata'], unavailableCapabilities: ['slash_command_dispatch', 'file_content', 'folder_watch', 'writes'] }),
  'google-docs': provider('google-docs', 'Google Docs', 'metadata_only', 'google-drive', { category: 'Knowledge', boundary: 'No Docs content, section, comment, comparison, creation, or editing API is implemented.', unavailableCapabilities: ['all_external_operations'] }),
  'google-sheets': provider('google-sheets', 'Google Sheets', 'metadata_only', 'google-drive', { category: 'Knowledge', boundary: 'No range read/write, mapping, report, or synchronization API is implemented.', unavailableCapabilities: ['all_external_operations'] }),
  'google-slides': provider('google-slides', 'Google Slides', 'metadata_only', 'google-drive', { category: 'Knowledge', boundary: 'No presentation read, creation, editing, or export API is implemented.', unavailableCapabilities: ['all_external_operations'] }),
  linear: provider('linear', 'Linear', 'metadata_only', 'linear', { category: 'Work', boundary: 'No Linear authentication, read, write, or synchronization service is implemented.', unavailableCapabilities: ['authentication', 'all_external_operations'] }),
  jira: provider('jira', 'Jira', 'metadata_only', 'jira', { category: 'Work', boundary: 'No Jira authentication, read, write, or synchronization service is implemented.', unavailableCapabilities: ['authentication', 'all_external_operations'] }),
  slack: provider('slack', 'Slack', 'metadata_only', 'slack', { category: 'Communication', boundary: 'No Slack installation, events, message read, or message write service is implemented.', unavailableCapabilities: ['authentication', 'all_external_operations'] }),
  figma: provider('figma', 'Figma', 'metadata_only', 'figma', { category: 'Design', boundary: 'No Figma authentication, design read, comment, comparison, or write service is implemented.', unavailableCapabilities: ['authentication', 'all_external_operations'] }),
  figjam: provider('figjam', 'FigJam', 'metadata_only', 'figma', { category: 'Design', boundary: 'No FigJam board read, extraction, diagram, or synchronization service is implemented.', unavailableCapabilities: ['authentication', 'all_external_operations'] }),
});

const defaultsFor = (providerId) => ({
  version: 1,
  provider: providerId,
  resources: { allowed: [], includeArchived: false, refresh: 'manual' },
  mappings: { defaultTeamId: null, defaultProjectId: null, intakeType: 'request', syncDirection: 'import_only', fieldMappings: [], conflictPolicy: 'review' },
  rules: { enabled: false, items: [] },
  agents: { allowedAgentIds: [], readableSources: [], writableActions: [], requireApproval: true },
  context: { retrieval: 'live', requireCitations: true, maxItems: 20, includeByDefault: false },
  commands: { enabled: false, aliases: {}, overrides: Object.fromEntries(PROVIDER_COMMANDS[providerId].map(item => [item.id, { enabled: false, defaults: {} }])) },
  notifications: { inbox: true, external: false, digest: 'off', quietHours: null },
  security: { consequentialActions: 'confirm', sessionExpiryMinutes: 60, grantedScopes: [], allowDestructiveActions: false },
  activity: { retentionDays: 30, includeReads: false },
});

export function connectionProvider(providerId) {
  return CONNECTION_PROVIDERS[providerId] ?? null;
}

export function connectionCommandCatalog(providerId) {
  return clone(CONNECTION_PROVIDERS[providerId]?.commands ?? []);
}

export function defaultConnectionSettings(providerId) {
  if (!CONNECTION_PROVIDERS[providerId]) throw new TypeError(`Unknown connection provider: ${providerId}`);
  return defaultsFor(providerId);
}

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const string = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const strings = (value, maxItems = 100) => Array.isArray(value) ? [...new Set(value.map(item => string(item)).filter(Boolean))].slice(0, maxItems) : [];
const oneOf = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
const bool = (value, fallback) => typeof value === 'boolean' ? value : fallback;
const integer = (value, min, max, fallback) => Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function normalizeConnectionSettings(providerId, input = {}) {
  const descriptor = CONNECTION_PROVIDERS[providerId];
  if (!descriptor) throw new TypeError(`Unknown connection provider: ${providerId}`);
  const source = isObject(input) ? input : {}, defaults = defaultsFor(providerId);
  const resources = isObject(source.resources) ? source.resources : {};
  const mappings = isObject(source.mappings) ? source.mappings : {};
  const rules = isObject(source.rules) ? source.rules : {};
  const agents = isObject(source.agents) ? source.agents : {};
  const context = isObject(source.context) ? source.context : {};
  const commandSettings = isObject(source.commands) ? source.commands : {};
  const notifications = isObject(source.notifications) ? source.notifications : {};
  const security = isObject(source.security) ? source.security : {};
  const activity = isObject(source.activity) ? source.activity : {};
  const knownCommands = new Set(descriptor.commands.map(item => item.id));
  const incomingOverrides = isObject(commandSettings.overrides) ? commandSettings.overrides : {};
  const overrides = Object.fromEntries(descriptor.commands.map(item => {
    const incoming = isObject(incomingOverrides[item.id]) ? incomingOverrides[item.id] : {};
    return [item.id, { enabled: false, defaults: isObject(incoming.defaults) ? clone(incoming.defaults) : {} }];
  }));
  const aliases = Object.fromEntries(Object.entries(isObject(commandSettings.aliases) ? commandSettings.aliases : {})
    .filter(([id, alias]) => knownCommands.has(id) && /^\/[a-z][a-z0-9-]{1,31}$/.test(alias))
    .slice(0, 50));
  return {
    version: 1,
    provider: providerId,
    resources: { allowed: strings(resources.allowed, 500), includeArchived: bool(resources.includeArchived, defaults.resources.includeArchived), refresh: oneOf(resources.refresh, ['manual', 'hourly', 'daily'], 'manual') },
    mappings: {
      defaultTeamId: string(mappings.defaultTeamId) || null, defaultProjectId: string(mappings.defaultProjectId) || null,
      intakeType: oneOf(mappings.intakeType, ['resource', 'request', 'route', 'document', 'project_draft'], 'request'),
      syncDirection: oneOf(mappings.syncDirection, ['import_only', 'export_only', 'two_way'], 'import_only'),
      fieldMappings: Array.isArray(mappings.fieldMappings) ? mappings.fieldMappings.filter(isObject).slice(0, 100).map(item => ({ source: string(item.source), target: string(item.target), owner: oneOf(item.owner, ['rumbo', 'external', 'review'], 'review') })).filter(item => item.source && item.target) : [],
      conflictPolicy: oneOf(mappings.conflictPolicy, ['review', 'rumbo_wins', 'external_wins'], 'review'),
    },
    rules: { enabled: false, items: Array.isArray(rules.items) ? rules.items.filter(isObject).slice(0, 50).map(item => ({ id: string(item.id), trigger: string(item.trigger), conditions: isObject(item.conditions) ? clone(item.conditions) : {}, effect: string(item.effect), enabled: false })).filter(item => item.id && item.trigger && item.effect) : [] },
    agents: { allowedAgentIds: strings(agents.allowedAgentIds), readableSources: strings(agents.readableSources), writableActions: strings(agents.writableActions), requireApproval: true },
    context: { retrieval: oneOf(context.retrieval, ['live', 'snapshot'], 'live'), requireCitations: bool(context.requireCitations, true), maxItems: integer(context.maxItems, 1, 100, 20), includeByDefault: bool(context.includeByDefault, false) },
    commands: { enabled: false, aliases, overrides },
    notifications: { inbox: bool(notifications.inbox, true), external: false, digest: oneOf(notifications.digest, ['off', 'daily', 'weekly'], 'off'), quietHours: /^\d\d:\d\d-\d\d:\d\d$/.test(notifications.quietHours) ? notifications.quietHours : null },
    security: { consequentialActions: 'confirm', sessionExpiryMinutes: integer(security.sessionExpiryMinutes, 5, 1440, 60), grantedScopes: strings(security.grantedScopes), allowDestructiveActions: false },
    activity: { retentionDays: integer(activity.retentionDays, 1, 365, 30), includeReads: bool(activity.includeReads, false) },
  };
}

export function validateConnectionSettings(providerId, input) {
  const descriptor = CONNECTION_PROVIDERS[providerId];
  if (!descriptor) return { valid: false, issues: [{ path: 'provider', code: 'unknown_provider', message: 'Choose a known connection provider.' }], value: null };
  const issues = [];
  if (!isObject(input)) issues.push({ path: '', code: 'invalid_type', message: 'Connection settings must be an object.' });
  if (isObject(input) && input.provider && input.provider !== providerId) issues.push({ path: 'provider', code: 'provider_mismatch', message: 'Settings cannot be applied to a different provider.' });
  const effect = new Map(descriptor.commands.map(item => [item.id, item.effect]));
  const requestedOverrides = isObject(input?.commands?.overrides) ? input.commands.overrides : {};
  for (const [id, setting] of Object.entries(requestedOverrides)) {
    if (!effect.has(id)) issues.push({ path: `commands.overrides.${id}`, code: 'unknown_command', message: 'This command is not registered by the connection.' });
    if (setting?.enabled === true) issues.push({ path: `commands.overrides.${id}.enabled`, code: 'not_implemented', message: 'Connection-contributed command execution is not implemented.' });
  }
  if (input?.commands?.enabled === true) issues.push({ path: 'commands.enabled', code: 'not_implemented', message: 'Connection-contributed command execution is not implemented.' });
  if (input?.rules?.enabled === true || input?.rules?.items?.some?.(item => item?.enabled === true)) issues.push({ path: 'rules.enabled', code: 'not_implemented', message: 'External connection rules cannot run in this build.' });
  if (input?.notifications?.external === true) issues.push({ path: 'notifications.external', code: 'not_implemented', message: 'External notification delivery is not implemented.' });
  if (input?.security?.allowDestructiveActions === true) issues.push({ path: 'security.allowDestructiveActions', code: 'unsafe_setting', message: 'Destructive external actions cannot be enabled.' });
  if (input?.agents?.requireApproval === false) issues.push({ path: 'agents.requireApproval', code: 'unsafe_setting', message: 'External agent actions require approval.' });
  if (input?.security?.consequentialActions && input.security.consequentialActions !== 'confirm') issues.push({ path: 'security.consequentialActions', code: 'unsafe_setting', message: 'Consequential actions must require confirmation.' });
  return { valid: issues.length === 0, issues, value: normalizeConnectionSettings(providerId, input) };
}

export function connectionSettingsTabs(providerId, { connectionState = 'not_connected' } = {}) {
  const descriptor = CONNECTION_PROVIDERS[providerId];
  if (!descriptor) return [];
  const state = CONNECTION_STATES.has(connectionState) ? connectionState : 'not_connected';
  return TAB_ORDER.map(id => {
    if (['overview', 'security', 'activity'].includes(id)) return { id, state: 'ready' };
    if (descriptor.implementation === 'metadata_only') return { id, state: 'preview', reason: descriptor.boundary };
    if (state !== 'connected') return { id, state: 'locked', reason: `Connect ${CONNECTION_PROVIDERS[descriptor.baseConnection]?.displayName ?? descriptor.displayName} to configure this section.` };
    if (id === 'commands' || id === 'rules' || id === 'notifications') return { id, state: 'preview', reason: 'These preferences are defined, but their external execution service is not implemented.' };
    return { id, state: 'ready' };
  });
}

export function effectiveConnectionCommands(providerId, settings) {
  const normalized = normalizeConnectionSettings(providerId, settings);
  return connectionCommandCatalog(providerId).map(item => ({
    ...item,
    enabled: false,
    alias: normalized.commands.aliases[item.id] ?? null,
    defaults: normalized.commands.overrides[item.id]?.defaults ?? {},
    disabledReason: 'Connection-contributed command execution is not implemented.',
  }));
}

export { EFFECTS as CONNECTION_COMMAND_EFFECTS, TAB_ORDER as CONNECTION_SETTINGS_TAB_ORDER };

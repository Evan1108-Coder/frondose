import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONNECTION_COMMAND_EFFECTS,
  CONNECTION_PROVIDERS,
  CONNECTION_SETTINGS_TAB_ORDER,
  connectionCommandCatalog,
  connectionSettingsTabs,
  defaultConnectionSettings,
  effectiveConnectionCommands,
  normalizeConnectionSettings,
  validateConnectionSettings,
} from '../src/lib/connection-settings.js';

const EXPECTED_PROVIDERS = [
  'codex', 'claude', 'github', 'github-actions', 'github-packages',
  'google-drive', 'google-docs', 'google-sheets', 'google-slides',
  'linear', 'jira', 'slack', 'figma', 'figjam',
];

test('connection catalog covers the requested providers and states implementation boundaries honestly', () => {
  assert.deepEqual(Object.keys(CONNECTION_PROVIDERS), EXPECTED_PROVIDERS);
  for (const provider of Object.values(CONNECTION_PROVIDERS)) {
    assert.ok(provider.boundary.length > 30, provider.id);
    assert.ok(['partial', 'metadata_only'].includes(provider.implementation), provider.id);
    assert.ok(provider.commands.length > 0, provider.id);
  }
  assert.deepEqual(
    Object.values(CONNECTION_PROVIDERS).filter(item => item.implementation === 'partial').map(item => item.id),
    ['codex', 'claude', 'github', 'google-drive'],
  );
  assert.match(CONNECTION_PROVIDERS.github.boundary, /not/);
  assert.match(CONNECTION_PROVIDERS['google-drive'].boundary, /Workspace Connections supports/);
  assert.ok(CONNECTION_PROVIDERS['google-drive'].workspaceCapabilities.includes('create_folder'));
  assert.deepEqual(CONNECTION_PROVIDERS.slack.unavailableCapabilities, ['authentication', 'all_external_operations']);
});

test('every contributed command declares its safety and availability contract', () => {
  const ids = new Set();
  for (const providerId of EXPECTED_PROVIDERS) {
    for (const item of connectionCommandCatalog(providerId)) {
      assert.equal(ids.has(item.id), false, item.id);
      ids.add(item.id);
      assert.ok(item.name.startsWith('/'));
      assert.ok(CONNECTION_COMMAND_EFFECTS.includes(item.effect));
      assert.ok(['never', 'always', 'when_running'].includes(item.confirmation));
      assert.ok(item.requiredConnection);
      assert.ok(item.resourceScope);
      assert.ok(item.expectedResult);
      assert.ok(item.undo);
      assert.ok(item.surfaces.includes('chat'));
      assert.equal(item.implementation, 'metadata_only');
      assert.equal(item.canExecute, false);
    }
  }
  assert.ok(ids.size >= 85);
});

test('defaults expose each settings section without sharing mutable data', () => {
  const one = defaultConnectionSettings('github');
  const two = defaultConnectionSettings('github');
  assert.deepEqual(Object.keys(one), ['version', 'provider', ...CONNECTION_SETTINGS_TAB_ORDER.slice(1)]);
  one.resources.allowed.push('repo-1');
  one.commands.overrides['github:github.issue'].defaults.template = 'bug';
  assert.deepEqual(two.resources.allowed, []);
  assert.deepEqual(two.commands.overrides['github:github.issue'].defaults, {});
  assert.throws(() => defaultConnectionSettings('unknown'), /Unknown connection provider/);
});

test('normalization bounds collections, strips unknown commands, and keeps unavailable execution disabled', () => {
  const settings = normalizeConnectionSettings('slack', {
    provider: 'github',
    resources: { allowed: [' C1 ', 'C1', '', 12], includeArchived: true, refresh: 'secondly' },
    mappings: {
      defaultTeamId: ' team ', intakeType: 'route', syncDirection: 'two_way', conflictPolicy: 'external_wins',
      fieldMappings: [{ source: 'channel', target: 'project', owner: 'external' }, { source: '', target: 'bad' }],
    },
    rules: { enabled: true, items: [{ id: 'rule-1', trigger: 'message', effect: 'request', enabled: true }] },
    agents: { allowedAgentIds: ['a', 'a'], requireApproval: false },
    context: { maxItems: 1000, retrieval: 'snapshot', requireCitations: false },
    commands: {
      enabled: true,
      aliases: { 'slack:slack.capture': '/capture', bad: '/bad', 'slack:slack.reply': 'reply' },
      overrides: { 'slack:slack.capture': { enabled: true, defaults: { destination: 'requests' } }, unknown: { enabled: true } },
    },
    notifications: { external: true, digest: 'daily', quietHours: '22:00-07:00' },
    security: { consequentialActions: 'allow', allowDestructiveActions: true, sessionExpiryMinutes: 2 },
    activity: { retentionDays: 900, includeReads: true },
  });
  assert.deepEqual(settings.resources.allowed, ['C1']);
  assert.equal(settings.resources.refresh, 'manual');
  assert.equal(settings.mappings.defaultTeamId, 'team');
  assert.equal(settings.mappings.fieldMappings.length, 1);
  assert.equal(settings.rules.enabled, false);
  assert.equal(settings.rules.items[0].enabled, false);
  assert.equal(settings.agents.requireApproval, true);
  assert.equal(settings.context.maxItems, 100);
  assert.equal(settings.commands.enabled, false);
  assert.deepEqual(settings.commands.aliases, { 'slack:slack.capture': '/capture' });
  assert.equal(settings.commands.overrides['slack:slack.capture'].enabled, false);
  assert.equal(settings.commands.overrides.unknown, undefined);
  assert.equal(settings.notifications.external, false);
  assert.equal(settings.security.consequentialActions, 'confirm');
  assert.equal(settings.security.allowDestructiveActions, false);
  assert.equal(settings.security.sessionExpiryMinutes, 5);
  assert.equal(settings.activity.retentionDays, 365);
});

test('validation rejects provider mismatch and attempts to enable unimplemented or unsafe behavior', () => {
  const result = validateConnectionSettings('github', {
    provider: 'slack',
    commands: { enabled: true, overrides: { unknown: { enabled: true }, 'github:github.pr': { enabled: true } } },
    rules: { enabled: true },
    notifications: { external: true },
    agents: { requireApproval: false },
    security: { consequentialActions: 'allow', allowDestructiveActions: true },
  });
  assert.equal(result.valid, false);
  assert.deepEqual(new Set(result.issues.map(item => item.code)), new Set(['provider_mismatch', 'not_implemented', 'unknown_command', 'unsafe_setting']));
  assert.equal(result.value.commands.enabled, false);
  assert.equal(validateConnectionSettings('unknown', {}).issues[0].code, 'unknown_provider');
  assert.equal(validateConnectionSettings('codex', defaultConnectionSettings('codex')).valid, true);
});

test('progressive tabs distinguish locked live setup from metadata previews', () => {
  const disconnected = Object.fromEntries(connectionSettingsTabs('github').map(item => [item.id, item.state]));
  assert.equal(disconnected.overview, 'ready');
  assert.equal(disconnected.resources, 'locked');
  assert.equal(disconnected.security, 'ready');
  const connected = Object.fromEntries(connectionSettingsTabs('github', { connectionState: 'connected' }).map(item => [item.id, item.state]));
  assert.equal(connected.resources, 'ready');
  assert.equal(connected.commands, 'preview');
  assert.equal(connected.notifications, 'preview');
  const planned = connectionSettingsTabs('figma', { connectionState: 'connected' });
  assert.equal(planned.find(item => item.id === 'resources').state, 'preview');
  assert.match(planned.find(item => item.id === 'resources').reason, /Configure OAuth and selected resources there/);
  assert.deepEqual(connectionSettingsTabs('unknown'), []);
});

test('effective commands preserve aliases and defaults but cannot become executable', () => {
  const commands = effectiveConnectionCommands('google-drive', {
    commands: {
      enabled: true,
      aliases: { 'google-drive:drive.find': '/files' },
      overrides: { 'google-drive:drive.find': { enabled: true, defaults: { query: 'brief' } } },
    },
  });
  const find = commands.find(item => item.name === '/drive find');
  assert.equal(find.alias, '/files');
  assert.deepEqual(find.defaults, { query: 'brief' });
  assert.equal(find.enabled, false);
  assert.match(find.disabledReason, /not implemented/);
});

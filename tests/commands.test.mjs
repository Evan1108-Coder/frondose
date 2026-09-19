import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMANDS, COMMAND_CATEGORIES, parseSlashCommand, searchCommands,
  commandAvailability, getCommand, tokenizeCommand,
} from '../src/lib/commands.js';

test('catalog has unique ids and complete UI/action metadata', () => {
  assert.ok(COMMANDS.length > 140, `expected a broad catalog, received ${COMMANDS.length}`);
  assert.equal(new Set(COMMANDS.map(command => command.id)).size, COMMANDS.length);
  for (const command of COMMANDS) {
    assert.ok(command.id && command.name && command.command.startsWith('/') && command.usage.startsWith('/'));
    assert.ok(Object.values(COMMAND_CATEGORIES).includes(command.category));
    assert.ok(command.description && command.risk && Array.isArray(command.contexts));
    for (const field of ['read', 'draft', 'write', 'external', 'destructive']) assert.equal(typeof command[field], 'boolean');
    assert.equal(typeof command.startsAgent, 'boolean');
    assert.equal(typeof command.paid, 'boolean');
    assert.equal(command.availability.mode, 'catalog-only');
  }
});

test('catalog covers core, work, agent, navigation, scheduling, workbench, git, and every specified connection', () => {
  const names = new Set(COMMANDS.map(command => command.name));
  for (const expected of ['help', 'reply', 'context add', 'chat new', 'chat branch', 'route new', 'approve', 'run', 'investigate', 'open', 'connections', 'repeat', 'rule preview', 'command', 'git status', 'git worktree']) {
    assert.ok(names.has(expected), `missing /${expected}`);
  }
  const connections = new Set(COMMANDS.map(command => command.connection).filter(Boolean));
  assert.deepEqual([...connections].sort(), ['actions', 'claude', 'codex', 'docs', 'drive', 'figjam', 'figma', 'github', 'jira', 'linear', 'package', 'sheets', 'slack', 'slides']);
  for (const expected of ['codex implement', 'claude review', 'github pr', 'actions dispatch', 'package release', 'drive snapshot', 'docs publish', 'sheets conflicts', 'slides sources', 'linear sync', 'jira transition', 'slack capture', 'figma compare', 'figjam decisions']) {
    assert.ok(names.has(expected), `missing /${expected}`);
  }
});

test('parser uses the longest hierarchical command and handles quotes and escapes', () => {
  const parsed = parseSlashCommand('  /context add "Release brief" source\\ file.md');
  assert.equal(parsed.type, 'command');
  assert.equal(parsed.command.id, 'context.add');
  assert.deepEqual(parsed.argv, ['Release brief', 'source file.md']);
  assert.equal(parsed.args, 'Release brief source file.md');
  assert.equal(parseSlashCommand('/git status').command.id, 'git.status');
  assert.equal(parseSlashCommand('/commands route').command.id, 'help');
  assert.equal(parseSlashCommand('/commands route').matchedAlias, '/commands');
  assert.equal(parseSlashCommand('ordinary message'), null);
  assert.equal(parseSlashCommand('//not-a-command'), null);
  assert.equal(parseSlashCommand('/Users/evan/project/file.js'), null);
  assert.equal(parseSlashCommand('/tmp/build.log'), null);
});

test('parser reports unknown commands and incomplete quoted arguments without throwing', () => {
  const unknown = parseSlashCommand('/warp now');
  assert.equal(unknown.type, 'unknown');
  assert.equal(unknown.name, 'warp');
  const quoted = parseSlashCommand('/find "unfinished');
  assert.equal(quoted.command.id, 'find');
  assert.match(quoted.error, /Unclosed/);
  assert.deepEqual(tokenizeCommand('a "" b').tokens, ['a', '', 'b']);
});

test('search is ranked, context aware, connection aware, and finds descriptions', () => {
  assert.equal(searchCommands('/git status')[0].id, 'git.status');
  assert.ok(searchCommands('workflow logs').some(command => command.id === 'actions.logs'));
  assert.equal(searchCommands('github', { connections: [] }).some(command => command.connection === 'github'), false);
  assert.ok(searchCommands('github', { connections: ['github'] }).some(command => command.id === 'github.pr'));
  assert.equal(searchCommands('terminal', { context: 'document' }).some(command => command.id === 'terminal.new'), false);
  assert.ok(searchCommands('terminal', { context: 'workbench' }).some(command => command.id === 'terminal.new'));
});

test('availability never claims execution without an explicit handler and applies safety gates', () => {
  assert.equal(commandAvailability('/help').reason, 'handler-required');
  assert.equal(commandAvailability('/help', { executableCommandIds: ['help'] }).available, true);
  assert.equal(commandAvailability('/github pr', { executableCommandIds: ['github.pr'] }).reason, 'connection-required');
  assert.equal(commandAvailability('/github pr', { connections: ['github'], executableCommandIds: ['github.pr'] }).available, true);
  assert.equal(commandAvailability('/codex ask', { connections: ['codex'], executableCommandIds: ['codex.ask'], allowPaid: false }).reason, 'paid-request-disabled');
  assert.equal(commandAvailability('/terminal new', { context: 'document', executableCommandIds: ['terminal.new'] }).reason, 'unsupported-context');
  assert.equal(commandAvailability('/does-not-exist').reason, 'unknown-command');
});

test('high-consequence command metadata is explicit', () => {
  const cancel = getCommand('actions.cancel');
  assert.equal(cancel.external, true);
  assert.equal(cancel.destructive, true);
  assert.equal(cancel.risk, 'confirmation');
  const implement = getCommand('/codex implement');
  assert.equal(implement.startsAgent, true);
  assert.equal(implement.paid, true);
  assert.equal(implement.connection, 'codex');
  const gitPush = getCommand('git.push');
  assert.equal(gitPush.external, true);
  assert.equal(gitPush.risk, 'confirmation');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalSessionHistoryService, parseLocalSessionJsonl } from '../server/local-session-history.mjs';

const owner = { id: 'local-owner' }, first = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222', third = '33333333-3333-4333-8333-333333333333';
const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const codex = (id, cwd, title = 'Find the lighthouse') => jsonl([
  { type: 'session_meta', timestamp: '2026-10-24T10:00:00Z', payload: { id, cwd, title, source: 'cli' } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Find the lighthouse in the project' }] } },
  { type: 'event_msg', payload: { type: 'user_message', message: 'Find the lighthouse in the project' } },
  { type: 'response_item', payload: { type: 'message', role: 'assistant', channel: 'analysis', content: [{ type: 'output_text', text: 'private-reasoning-forbidden' }] } },
  { type: 'response_item', payload: { type: 'function_call', arguments: 'private-tool-forbidden' } },
  { type: 'response_item', timestamp: '2026-10-25T12:00:00Z', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The lighthouse is blue.' }] } },
  { type: 'event_msg', payload: { type: 'agent_message', message: 'The lighthouse is blue.' } },
]);
const claude = (id, cwd) => jsonl([
  { type: 'user', sessionId: id, cwd, timestamp: '2026-10-25T09:00:00Z', message: { content: 'Build an orchid garden' } },
  { type: 'user', sessionId: id, cwd, isMeta: true, message: { content: 'hidden-meta-forbidden' } },
  { type: 'api-request-blob', sessionId: id, cwd, content: 'api-blob-forbidden' },
  { type: 'assistant', sessionId: id, cwd: join(cwd, 'later-location'), timestamp: '2026-10-25T11:00:00Z', message: { content: [{ type: 'thinking', thinking: 'private-thinking-forbidden' }, { type: 'tool_use', input: 'secret-tool-forbidden' }, { type: 'text', text: 'The orchid garden is ready.' }] } },
  { type: 'custom-title', sessionId: id, customTitle: 'Orchid garden' },
]);
async function fixture(callback) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'frondose-native-history-'))), root = join(directory, 'Workspace ü with spaces'), other = join(directory, 'Other project'), storage = join(directory, 'private'), home = join(directory, 'home');
  const codexRoot = join(home, '.codex', 'sessions'), claudeRoot = join(home, '.claude', 'projects'), codexFolder = join(codexRoot, '2026', '10', '25'), claudeFolder = join(claudeRoot, '-workspace');
  await Promise.all([mkdir(root), mkdir(other), mkdir(storage), mkdir(codexFolder, { recursive: true }), mkdir(claudeFolder, { recursive: true })]);
  let version = 'root_v1', bound = true;
  const summary = () => ({ ready: bound, binding: bound ? { path: root, projectId: 'p', version } : null, projects: [{ id: 'p', name: 'Current', path: root }, { id: 'other-p', name: 'Other', path: other }] });
  const roots = { get: async () => summary(), rootFor: async () => { if (!bound) throw Object.assign(Error('Choose workspace directory'), { code: 'directory_not_bound' }); return { root, row: { project_id: 'p', version } }; } };
  const make = () => createLocalSessionHistoryService({ dataDir: storage, roots, homeDir: home, env: {} });
  const service = make(), files = { codex: join(codexFolder, `rollout-2026-10-25T09-00-00-${first}.jsonl`), claude: join(claudeFolder, `${second}.jsonl`), other: join(codexFolder, `rollout-2026-10-25T10-00-00-${third}.jsonl`) };
  await Promise.all([writeFile(files.codex, codex(first, root)), writeFile(files.claude, claude(second, root)), writeFile(files.other, codex(third, other, 'Foreign directory phrase'))]);
  const enable = (allowAll = false) => service.configure('ws', owner, { enabled: true, allow_all: allowAll, confirmed: true });
  try { await callback({ service, make, root, other, home, storage, files, codexRoot, claudeRoot, codexFolder, claudeFolder, enable, setVersion: value => { version = value; }, setBound: value => { bound = value; } }); }
  finally { service.close(); await rm(directory, { recursive: true, force: true }); }
}

test('reviewed Codex/Claude parsers count visible text once and exclude system, tools and private reasoning', () => {
  const a = parseLocalSessionJsonl('codex', codex(first, '/fixture/project')), b = parseLocalSessionJsonl('claude', claude(second, '/fixture/project'));
  assert.equal(a.messageCount, 2); assert.equal(b.messageCount, 2); assert.equal(b.cwd, resolve('/fixture/project')); assert.equal(b.title, 'Orchid garden');
  assert.doesNotMatch(`${a.content}\n${b.content}`, /forbidden/); assert.match(a.content, /lighthouse/); assert.match(b.content, /orchid/);
  const worker = JSON.parse(codex(first, '/fixture/project').split('\n')[0]); worker.payload.source = { subagent: { thread_spawn: {} } };
  assert.equal(parseLocalSessionJsonl('codex', jsonl([worker])), null);
  assert.equal(parseLocalSessionJsonl('claude', jsonl([{ type: 'user', isSidechain: true, sessionId: first, cwd: '/fixture', message: { content: 'worker' } }])), null);
  assert.equal(parseLocalSessionJsonl('unknown', '{}'), null); assert.equal(parseLocalSessionJsonl('codex', '{}\ninvalid'), null);
});

test('legacy and paginated Codex formats, custom titles and first identity stay provider-native without duplicated fallback messages', () => {
  const metadata = { type: 'session_meta', payload: { id: first, cwd: '/project', history_mode: 'paginated' } };
  const paginated = parseLocalSessionJsonl('codex', jsonl([metadata, { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: 'Paginated rose' }] } } }, { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'AgentMessage', content: 'Rose complete' } } }, { type: 'response_item', payload: { type: 'message', role: 'user', content: 'duplicate non-paginated channel' } }, { type: 'session_meta', payload: { id: second, cwd: '/copied-parent' } }]));
  assert.equal(paginated.sessionId, first); assert.equal(paginated.cwd, resolve('/project')); assert.equal(paginated.messageCount, 2); assert.match(paginated.content, /Paginated rose/); assert.doesNotMatch(paginated.content, /duplicate/);
  const legacy = parseLocalSessionJsonl('codex', jsonl([{ ...metadata, payload: { id: first, cwd: '/project' } }, { type: 'event_msg', payload: { type: 'user_message', message: 'Legacy tulip' } }, { type: 'event_msg', payload: { type: 'agent_message', message: 'Legacy complete' } }]));
  assert.equal(legacy.messageCount, 2); assert.equal(legacy.title, 'Legacy tulip');
  assert.equal(parseLocalSessionJsonl('claude', claude(first, '/project') + jsonl([{ type: 'user', sessionId: second, cwd: '/project', message: { content: 'Conflicting identity' } }])), null);
});

test('disabled search and status never create an index or read native history automatically', async () => fixture(async ({ service, files, storage }) => {
  await writeFile(files.codex, 'not JSON and must not be indexed');
  const state = await service.status('ws', owner); assert.equal(state.enabled, false); assert.equal(state.indexed, 0); assert.deepEqual(await readdir(storage), []);
  await assert.rejects(service.refresh('ws', owner), { code: 'history_disabled' });
  await assert.rejects(service.search('ws', owner, { q: 'lighthouse' }), { code: 'history_disabled' });
  await assert.rejects(service.configure('ws', owner, { enabled: true, allow_all: false }), /Confirm/);
  await assert.rejects(service.status('ws', { id: 'another-user' }), { statusCode: 403 });
}));

test('explicit workspace refresh indexes matching user histories and searches title/content with honest metadata', async () => fixture(async ({ service, enable, root, storage }) => {
  await enable(); const indexed = await service.refresh('ws', owner); assert.equal(indexed.indexed, 2);
  const results = await service.search('ws', owner, { q: 'lighthouse blue' }); assert.equal(results.items.length, 1); assert.equal(results.items[0].providerId, 'codex'); assert.equal(results.items[0].messageCount, 2); assert.equal(results.items[0].directory, root); assert.equal(results.items[0].canResume, true); assert.equal(results.items[0].updatedAt, '2026-10-25T12:00:00.000Z');
  const title = await service.search('ws', owner, { q: 'orchid garden', provider: 'claude' }); assert.equal(title.items.length, 1);
  assert.equal((await service.search('ws', owner, { q: 'Foreign directory phrase' })).total, 0);
  assert.equal((await service.search('ws', owner, { q: 'forbidden' })).total, 0);
  assert.deepEqual(await readdir(storage), ['local-session-history-settings.json']);
  const consent = await readFile(join(storage, 'local-session-history-settings.json'), 'utf8'); assert.doesNotMatch(consent, /lighthouse|orchid|sessionId|Workspace/);
  if (process.platform !== 'win32') assert.equal((await lstat(join(storage, 'local-session-history-settings.json'))).mode & 0o777, 0o600);
}));

test('All scope needs a distinct opt-in and foreign directories cannot grant resume or change the workspace root', async () => fixture(async ({ service, enable }) => {
  await enable(); await assert.rejects(service.refresh('ws', owner, { scope: 'all' }), { code: 'history_all_not_allowed' });
  await enable(true); await service.refresh('ws', owner, { scope: 'all' }); const results = await service.search('ws', owner, { scope: 'all', q: 'Foreign directory phrase' });
  assert.equal(results.total, 1); assert.equal(results.items[0].canResume, false); assert.match(results.items[0].resumeReason, /original directory/);
  await assert.rejects(service.resolveResume({ workspaceId: 'ws', projectId: 'p', providerId: 'codex', historyResultId: results.items[0].id, actor: owner }), { code: 'history_scope_changed' });
}));

test('archived Codex chats are discoverable only in the approved all-local scope and never launch by stale ID',async()=>fixture(async({service,enable,root,home,files})=>{
 const archive=join(home,'.codex','archived_sessions');
 await mkdir(archive);
 await unlink(files.other);
 await writeFile(join(archive,`rollout-2026-02-05T00-00-00-${third}.jsonl`),codex(third,root,'Archived fixture chat'));
 await enable(true);
 await service.refresh('ws',owner);
 assert.equal((await service.search('ws',owner,{q:'Archived fixture chat'})).total,0);
 await service.refresh('ws',owner,{scope:'all'});
 const {items}=await service.search('ws',owner,{scope:'all',q:'Archived fixture chat'});
 assert.equal(items.length,1);
 assert.equal(items[0].archived,true);
 assert.equal(items[0].canResume,false);
 await assert.rejects(service.resolveResume({workspaceId:'ws',projectId:'p',providerId:'codex',historyResultId:items[0].id,actor:owner}),{code:'history_session_archived'});
}));

test('project scope is server-owned and unsupported providers or malformed search requests fail closed', async () => fixture(async ({ service, enable }) => {
  await enable(); await service.refresh('ws', owner, { scope: 'project', project_id: 'other-p' }); assert.equal((await service.search('ws', owner, { scope: 'project', project_id: 'other-p' })).total, 1);
  await assert.rejects(service.refresh('ws', owner, { scope: 'project', project_id: '../foreign' }), /Choose a local project/);
  await assert.rejects(service.search('ws', owner, { provider: 'goose' }), { code: 'history_provider_unavailable' });
  for (const input of [{ q: 'x'.repeat(181) }, { offset: -1 }, { offset: '1;drop table' }, { scope: 'website' }]) await assert.rejects(service.search('ws', owner, input));
}));

test('exact opaque result resume validates source/provider/root and reserves native identity until observed release', async () => fixture(async ({ service, enable, setVersion }) => {
  await enable(); await service.refresh('ws', owner); const result = (await service.search('ws', owner, { provider: 'codex' })).items[0];
  const input = { workspaceId: 'ws', projectId: 'p', providerId: 'codex', historyResultId: result.id, actor: owner };
  const lease = await service.resolveResume(input); assert.equal(lease.sessionId, first); assert.equal(lease.providerId, 'codex');
  await assert.rejects(service.resolveResume(input), { code: 'history_session_busy' }); lease.release(); lease.release(); (await service.resolveResume(input)).release();
  await assert.rejects(service.resolveResume({ ...input, providerId: 'claude' }), { code: 'history_scope_changed' });
  await assert.rejects(service.resolveResume({ ...input, historyResultId: first }), { code: 'history_scope_changed' });
  await assert.rejects(service.resolveResume({ ...input, projectId: 'wrong' }), { code: 'history_scope_changed' });
  setVersion('root_v2'); await assert.rejects(service.resolveResume(input), { code: 'history_scope_changed' }); assert.equal((await service.search('ws', owner)).needsRefresh, true);
}));

test('changed and deleted sources disappear immediately and cannot resume stale content', async () => fixture(async ({ service, enable, files }) => {
  await enable(); await service.refresh('ws', owner); const result = (await service.search('ws', owner, { provider: 'codex' })).items[0];
  await writeFile(files.codex, codex(first, '/different-root')); await unlink(files.claude);
  const results = await service.search('ws', owner); assert.equal(results.total, 0); assert.equal(results.needsRefresh, true);
  await assert.rejects(service.resolveResume({ workspaceId: 'ws', projectId: 'p', providerId: 'codex', historyResultId: result.id, actor: owner }), { code: 'history_source_changed' });
}));

test('clear and disable revoke old results across service instances without deleting provider files', async () => fixture(async ({ service, make, enable, files }) => {
  await enable(); await service.refresh('ws', owner); const result = (await service.search('ws', owner)).items[0], original = await readFile(files.codex, 'utf8');
  const secondInstance = make(); try {
    assert.equal((await secondInstance.status('ws', owner)).enabled, true); assert.equal((await secondInstance.status('ws', owner)).indexed, 0);
    await secondInstance.clear('ws', owner, { confirmed: true }); assert.equal((await service.search('ws', owner)).needsRefresh, true);
    await assert.rejects(service.resolveResume({ workspaceId: 'ws', providerId: result.providerId, historyResultId: result.id, actor: owner }), { code: 'history_scope_changed' });
    await secondInstance.configure('ws', owner, { enabled: false, allow_all: false, confirmed: true }); await assert.rejects(service.search('ws', owner), { code: 'history_disabled' });
    assert.equal(await readFile(files.codex, 'utf8'), original);
  } finally { secondInstance.close(); }
}));

test('symlinked roots, directories, transcripts, hard links and credential-shaped unrelated files are never indexed', async () => fixture(async ({ service, enable, files, claudeFolder, codexFolder, root }) => {
  await enable(true);
  await unlink(files.codex); await symlink(files.other, files.codex);
  await unlink(files.claude); await link(files.other, files.claude);
  await writeFile(join(codexFolder, 'auth.json'), codex(first, root, 'CREDENTIAL_TRAP'));
  await writeFile(join(claudeFolder, '.credentials.json'), claude(second, root));
  await service.refresh('ws', owner, { scope: 'all' }); const results = await service.search('ws', owner, { scope: 'all' }); assert.equal(results.total, 0, 'both aliases and their hard-linked source are excluded'); assert.equal((await service.search('ws', owner, { scope: 'all', q: 'CREDENTIAL_TRAP' })).total, 0);
}));

test('unsafe linked consent files cannot enable history search or be overwritten', async () => fixture(async ({ service, storage, files }) => {
  await symlink(files.codex, join(storage, 'local-session-history-settings.json'));
  await assert.rejects(service.status('ws', owner), { statusCode: 409 });
  await assert.rejects(service.configure('ws', owner, { enabled: true, allow_all: true, confirmed: true }));
  assert.match(await readFile(files.codex, 'utf8'), /session_meta/);
}));

test('linked provider roots and project subdirectories are excluded rather than following outside native histories', async () => fixture(async ({ service, enable, codexRoot, claudeRoot, claudeFolder, files }) => {
  await enable(true);
  const parent = join(codexRoot, '..'), moved = join(parent, 'original-sessions');
  const { rename } = await import('node:fs/promises'); await rename(codexRoot, moved); await symlink(moved, codexRoot);
  const movedProject = join(claudeRoot, 'original-project'); await rename(claudeFolder, movedProject); await symlink(movedProject, claudeFolder);
  // The original regular project is still a permitted own directory; only its
  // symlink alias is skipped, never duplicated into another native identity.
  await service.refresh('ws', owner, { scope: 'all' }); const result = await service.search('ws', owner, { scope: 'all' });
  assert.equal(result.total, 1); assert.equal(result.items[0].providerId, 'claude');
  assert.equal((await service.search('ws', owner, { scope: 'all', provider: 'codex' })).total, 0);
}));

test('oversized sessions are omitted with an honest bounded-scan indicator', async () => fixture(async ({ service, enable, files, root }) => {
  await enable(); await writeFile(files.codex, codex(first, root) + ' '.repeat(8_000_001));
  const result = await service.refresh('ws', owner); assert.equal(result.limited, true); assert.equal(result.indexed, 1); assert.equal((await service.search('ws', owner, { provider: 'codex' })).total, 0);
}));

test('history UI exposes access controls and tokens only, never raw source paths or auto scanning on mount', async () => {
  const source = await readFile(new URL('../src/components/workspace/SessionHistorySearch.jsx', import.meta.url), 'utf8');
  for (const label of ['Enable local history search', 'All local sessions', 'Clear local search index', 'Refresh index', 'Resume']) assert(source.includes(label));
  assert.match(source, /request\(workspaceId, 'refresh', 'POST'/); assert.match(source, /onClick=\{refresh\}/);
  assert.match(source, /disabled=\{!item\.canResume/); assert.match(source, /onResume\(item\)/); assert.match(source, /settings\?\.generation/);
  assert.doesNotMatch(source, /sessionId|shell_command|dangerouslySetInnerHTML|localStorage\.setItem/);
});

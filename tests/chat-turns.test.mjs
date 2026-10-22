import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createLocalApi } from '../server/local-api.mjs';

async function withApi(callback) {
  const dataDir = await mkdtemp(join(tmpdir(), 'rumbo-chat-turn-test-'));
  const fake = { mode: 'success', launches: 0, prompts: [], processes: [], commandCalls: 0 };
  const integrationOptions = {
    env: {},
    execute: async (_command, args) => {
      fake.commandCalls += 1;
      if (fake.mode === 'setup_failure' && args.includes('mcp')) return { stdout: '', stderr: 'Fixture error', code: 1 };
      return { stdout: args.includes('mcp') ? '[]' : 'Logged in', stderr: '', code: 0 };
    },
    fetchImpl: () => { throw new Error('External requests are forbidden'); },
    spawnProcess: (command, args, options) => {
      fake.launches += 1;
      fake.lastLaunch = { command, args, options };
      const child = new EventEmitter();
      child.stdin = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = () => queueMicrotask(() => child.emit('close', 1));
      child.stdin.end = (prompt) => {
        fake.prompts.push(prompt);
        if (fake.mode === 'hold') return;
        queueMicrotask(() => {
          if (fake.mode === 'success') child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Fixture reply — no real AI was called.' } }) + '\n'));
          if (fake.mode === 'failure') child.stderr.emit('data', Buffer.from('Fixture agent failed.'));
          child.emit('close', fake.mode === 'failure' ? 1 : 0);
        });
      };
      fake.processes.push(child);
      return child;
    },
  };
  const api = createLocalApi({ dataDir, integrationOptions });
  const server = createServer((req, res) => api.middleware(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, body, method = body === undefined ? 'GET' : 'POST', expected = method === 'POST' ? 201 : 200) => {
    const res = await fetch(origin + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await res.json();
    assert.equal(res.status, expected, JSON.stringify(result));
    return result;
  };
  try {
    const workspace = (await call('/workspaces', { name: 'Chat fixture' })).workspace;
    const project = (await call('/projects', { workspace_id: workspace.id, name: 'Preview', local_path: dataDir, goal: 'Build clear software.' })).project;
    const agent = (await call('/agents', { workspace_id: workspace.id, name: 'Reviewer', provider: 'codex', instructions: 'Cite the files.' })).agent;
    const chat = (await call('/chats', { workspace_id: workspace.id, project_id: project.id, title: 'Review', participant_agent_ids: [agent.id] })).chat;
    const turn = (overrides = {}) => ({ agent_id: agent.id, content: 'Please review the project.', client_turn_id: 'fixture-turn-001', work_mode: 'project', ...overrides });
    const connectFixture = () => call('/connections/codex/connect', { method: 'existing' }, 'POST', 200);
    await callback({ call, api, fake, workspace, project, agent, chat, turn, dataDir, integrationOptions, connectFixture });
  } finally { api.close(); await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); }
}

test('a disconnected chat turn rejects before saving and never probes or executes a provider', async () => {
  await withApi(async ({ call, api, fake, chat, turn }) => {
    const result = await call(`/chats/${chat.id}/turns`, turn(), 'POST', 409);
    assert.equal(result.error.code, 'not_connected');
    assert.equal(api.snapshot().messages.length, 0);
    assert.equal(api.snapshot().runs.length, 0);
    assert.equal(fake.commandCalls, 0);
    assert.equal(fake.launches, 0);
  });
});

test('general chat sends and retries without a folder while project work still requires one', async () => {
  await withApi(async ({ call, api, fake, chat, project, turn, connectFixture }) => {
    await connectFixture();
    await call(`/projects/${project.id}`, { local_path: '' }, 'PATCH', 200);
    fake.mode = 'failure';
    const first = await call(`/chats/${chat.id}/turns`, turn({ work_mode: undefined }));
    assert.equal(first.run.work_mode, 'conversation');
    assert.equal(first.message.metadata.work_mode, 'conversation');
    assert.match(fake.prompts[0], /Frondose general conversation/);
    assert.ok(fake.lastLaunch.args.includes('features.shell_tool=false'));
    assert.notEqual(fake.lastLaunch.options.cwd, process.cwd());
    fake.mode = 'success';
    const retry = await call(`/chats/${chat.id}/turns`, turn({ source_message_id: first.message.id, client_turn_id: 'general-retry-002', work_mode: 'conversation' }));
    assert.equal(retry.message.id, first.message.id);
    assert.equal(retry.run.work_mode, 'conversation');
    const failed = await call(`/chats/${chat.id}/turns`, turn({ client_turn_id: 'coding-needs-folder', work_mode: 'project', permission_mode: 'workspace-write' }), 'POST', 400);
    assert.match(failed.error.message, /require a linked folder/);
    assert.equal(fake.launches, 2);
    assert.equal(api.snapshot().messages.filter(message => message.sender_type === 'user').length, 1);
  });
});

test('general chat cannot smuggle editing permissions or reuse a send ID across work modes', async () => {
  await withApi(async ({ call, fake, chat, turn, connectFixture }) => {
    await connectFixture();
    const forbidden = await call(`/chats/${chat.id}/turns`, turn({ work_mode: 'conversation', permission_mode: 'workspace-write' }), 'POST', 400);
    assert.match(forbidden.error.message, /cannot request project editing/);
    assert.equal(fake.launches, 0);
    await call(`/chats/${chat.id}/turns`, turn({ work_mode: 'conversation' }));
    await call(`/chats/${chat.id}/turns`, turn({ work_mode: 'project' }), 'POST', 409);
    assert.equal(fake.launches, 1);
  });
});

test('sending a chat turn persists one source message and a reply linked by stable agent and run identity', async () => {
  await withApi(async ({ call, api, fake, chat, agent, turn, connectFixture }) => {
    await connectFixture();
    const attachment = { name: 'requirements.txt', type: 'text/plain', content: 'Keep the route readable.' };
    const { message, run } = await call(`/chats/${chat.id}/turns`, turn({ attachments: [attachment] }));
    assert.equal(message.sender_type, 'user');
    assert.equal(run.source_message_id, message.id);
    assert.equal(run.agent_id, agent.id);
    assert.equal(run.status, 'completed');
    const reply = api.snapshot().messages.find((row) => row.sender_type === 'agent');
    assert.equal(reply.sender_id, agent.id);
    assert.equal(reply.metadata.source_message_id, message.id);
    assert.equal(reply.metadata.run_id, run.id);
    assert.match(fake.prompts[0], /Cite the files/);
    assert.match(fake.prompts[0], /Build clear software/);
    assert.match(fake.prompts[0], /Keep the route readable/);
  });
});

test('duplicate submissions and replay after database reopen do not create duplicate messages or runs', async () => {
  await withApi(async ({ call, api, fake, chat, turn, connectFixture, dataDir, integrationOptions }) => {
    await connectFixture();
    const input = turn();
    const first = await call(`/chats/${chat.id}/turns`, input);
    const replay = await call(`/chats/${chat.id}/turns`, input, 'POST', 200);
    assert.equal(replay.replayed, true);
    assert.equal(replay.message.id, first.message.id);
    assert.equal(replay.run.id, first.run.id);
    assert.equal(fake.launches, 1);
    assert.equal(api.snapshot().messages.filter((row) => row.sender_type === 'user').length, 1);
    await call(`/chats/${chat.id}/turns`, turn({ content: 'Different question' }), 'POST', 409);
    await call(`/chats/${chat.id}/turns`, turn({ attachments: [{ name: 'other', content: 'Different' }] }), 'POST', 409);
    const reopened = createLocalApi({ dataDir, integrationOptions });
    try {
      assert.equal(reopened.snapshot().runs[0].source_message_id, first.message.id);
      assert.equal(reopened.snapshot().messages.filter((row) => row.sender_type === 'user').length, 1);
    } finally { reopened.close(); }
    assert.equal((await call(`/chats/${chat.id}/turns`, input, 'POST', 200)).run.id, first.run.id);
  });
});

test('an active reply blocks a second send to the same agent while an identical client ID replays safely', async () => {
  await withApi(async ({ call, api, fake, chat, turn, connectFixture }) => {
    await connectFixture(); fake.mode = 'hold';
    const first = await call(`/chats/${chat.id}/turns`, turn());
    assert.equal(first.run.status, 'running');
    await call(`/chats/${chat.id}/turns`, turn(), 'POST', 200);
    const busy = await call(`/chats/${chat.id}/turns`, turn({ client_turn_id: 'fixture-turn-002' }), 'POST', 409);
    assert.equal(busy.error.code, 'chat_agent_busy');
    assert.equal(api.snapshot().messages.length, 1);
    await call(`/runs/${first.run.id}/stop`, {}, 'POST', 200);
    assert.equal(api.snapshot().runs[0].status, 'stopped');
  });
});

test('failed and empty replies stay visible and retry uses the original message without duplication', async () => {
  for (const mode of ['failure', 'empty', 'setup_failure']) await withApi(async ({ call, api, fake, chat, turn, connectFixture }) => {
    await connectFixture(); fake.mode = mode;
    const first = await call(`/chats/${chat.id}/turns`, turn());
    assert.equal(first.run.status, 'failed', mode);
    assert(api.snapshot().events.some((event) => event.run_id === first.run.id && event.type === 'run.failed'));
    if (mode === 'empty') assert.match(api.snapshot().events.at(-1).summary, /without a text reply/);
    if (mode === 'setup_failure') assert(first.error?.message);
    fake.mode = 'success';
    const retry = await call(`/chats/${chat.id}/turns`, turn({ content: undefined, source_message_id: first.message.id, client_turn_id: 'fixture-retry-002' }));
    assert.equal(retry.message.id, first.message.id);
    assert.equal(retry.run.status, 'completed');
    assert.equal(api.snapshot().runs.length, 2);
    assert.equal(api.snapshot().messages.filter((row) => row.sender_type === 'user').length, 1);
    await call(`/chats/${chat.id}/turns`, turn({ content: undefined, source_message_id: first.message.id, client_turn_id: 'fixture-retry-003' }), 'POST', 409);
  });
});

test('chat turns reject invalid targets, archived context, missing folders and unsupported attachments without saving', async () => {
  await withApi(async ({ call, api, fake, workspace, project, agent, chat, turn, connectFixture }) => {
    await connectFixture();
    const other = (await call('/workspaces', { name: 'Other' })).workspace;
    const foreignAgent = (await call('/agents', { workspace_id: other.id, name: 'Private agent', provider: 'codex' })).agent;
    for (const overrides of [
      { agent_id: foreignAgent.id }, { agent_id: 'missing' }, { content: '' }, { client_turn_id: 'bad' },
      { attachments: [{ name: 'image.png', type: 'image/png', content: 'data:image/png;base64,eA==' }] },
      { attachments: [{ name: 'report.pdf', size: 20 }] }, { permission_mode: 'everything' },
    ]) await call(`/chats/${chat.id}/turns`, turn(overrides), 'POST', overrides.agent_id === 'missing' ? 409 : 400);
    await call(`/agents/${agent.id}`, { status: 'paused' }, 'PATCH');
    await call(`/chats/${chat.id}/turns`, turn(), 'POST', 400);
    await call(`/agents/${agent.id}`, { status: 'available' }, 'PATCH');
    await call(`/projects/${project.id}`, { local_path: '/not-a-real-rumbo-fixture' }, 'PATCH');
    await call(`/chats/${chat.id}/turns`, turn(), 'POST', 400);
    await call(`/workspaces/${workspace.id}`, { archived_at: new Date().toISOString() }, 'PATCH');
    await call(`/chats/${chat.id}/turns`, turn(), 'POST', 400);
    assert.equal(api.snapshot().messages.length, 0);
    assert.equal(api.snapshot().runs.length, 0);
    assert.equal(fake.launches, 0);
  });
});

test('new conversations bind one agent; mismatched live entry points reject before any provider call', async()=>{
  await withApi(async({call,api,fake,workspace,chat,agent,turn,connectFixture})=>{
    const other=(await call('/agents',{workspace_id:workspace.id,name:'Other',provider:'codex'})).agent;
    assert.equal(chat.responding_agent_id,agent.id);
    await call('/chats',{workspace_id:workspace.id,title:'Invalid group',participant_agent_ids:[agent.id,other.id]},'POST',400);
    await call(`/chats/${chat.id}`,{responding_agent_id:other.id},'PATCH',409);
    await call(`/chats/${chat.id}`,{responding_agent_id:null},'PATCH',409);
    await call(`/chats/${chat.id}/turns`,turn({agent_id:other.id}),'POST',409);
    await call('/runs',{mode:'live',chat_id:chat.id,agent_id:other.id,prompt:'No substitution'},'POST',409);
    await call('/context/inspect',{workspace_id:workspace.id,chat_id:chat.id,agent_id:other.id,prompt:'No substitution'},'POST',409);
    assert.equal(fake.launches,0);assert.equal(fake.commandCalls,0);assert.equal(api.snapshot().runs.length,0);
    await connectFixture();fake.mode='failure';
    const receipt=await call(`/chats/${chat.id}/turns`,turn({work_mode:'conversation'}));
    await call(`/agents/${agent.id}`,{archived_at:new Date().toISOString()},'PATCH');
    assert.equal((await call(`/chats/${chat.id}/turns`,turn({work_mode:'conversation'}),'POST',200)).run.id,receipt.run.id);
    await call(`/chats/${chat.id}/turns`,turn({client_turn_id:'new-after-archive',work_mode:'conversation'}),'POST',400);
    await call(`/chats/${chat.id}/messages`,{content:'A local note remains possible.'});
    assert.equal(fake.launches,1);
  });
});

test('concurrent first legacy sends select one identity without rewriting historical participants',async()=>{
  await withApi(async({call,api,fake,workspace,agent,chat,turn,connectFixture})=>{
    const other=(await call('/agents',{workspace_id:workspace.id,name:'Second',provider:'codex'})).agent;
    const db=new DatabaseSync(api.dbPath);
    try {
      db.prepare('UPDATE chats SET responding_agent_id=NULL,participant_agent_ids_json=? WHERE id=?').run(JSON.stringify([agent.id,other.id]),chat.id);
      const participants=db.prepare('SELECT participant_agent_ids_json FROM chats WHERE id=?').get(chat.id).participant_agent_ids_json;
      await connectFixture();fake.mode='hold';
      const results=await Promise.allSettled([
        call(`/chats/${chat.id}/turns`,turn({work_mode:'conversation'})),
        call(`/chats/${chat.id}/turns`,turn({agent_id:other.id,client_turn_id:'competing-first-send',work_mode:'conversation'})),
      ]);
      assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
      assert.equal(fake.launches,1);assert.equal(api.snapshot().runs.length,1);
      const saved=db.prepare('SELECT * FROM chats WHERE id=?').get(chat.id);
      assert.ok([agent.id,other.id].includes(saved.responding_agent_id));assert.equal(saved.participant_agent_ids_json,participants);
      const winner=results.find(result=>result.status==='fulfilled').value;
      await call(`/runs/${winner.run.id}/stop`,{},'POST',200);
      const loser=saved.responding_agent_id===agent.id?other.id:agent.id;
      const rejected=await call(`/chats/${chat.id}/turns`,turn({agent_id:loser,client_turn_id:'reject-other-after-win',work_mode:'conversation'}),'POST',409);
      assert.equal(rejected.error.code,'conversation_agent_mismatch');assert.equal(fake.launches,1);
    } finally {db.close();}
  });
});

test('concurrent identical first sends recover one receipt rather than launching twice',async()=>{
  await withApi(async({call,api,fake,chat,turn,connectFixture})=>{
    await connectFixture();fake.mode='hold';
    const input=turn({work_mode:'conversation'});
    const responses=await Promise.all([
      call(`/chats/${chat.id}/turns`,input),
      call(`/chats/${chat.id}/turns`,input,'POST',200),
    ]);
    assert.equal(responses[0].run.id,responses[1].run.id);assert.equal(fake.launches,1);
    assert.equal(api.snapshot().messages.length,1);
    await call(`/runs/${responses[0].run.id}/stop`,{},'POST',200);
  });
});

test('workspace archives remap conversation identity without transferring credentials or falling back to an original profile',async()=>{
  await withApi(async({call,api,fake,workspace,chat,agent})=>{
    const archive=await call(`/export?workspace_id=${workspace.id}`);
    const imported=await call('/import',archive);
    const copy=imported.bootstrap.chats.find(item=>item.workspace_id===imported.result.id && item.title===chat.title);
    const importedAgent=imported.bootstrap.agents.find(item=>item.workspace_id===imported.result.id && item.name===agent.name);
    assert.equal(copy.responding_agent_id,importedAgent.id);assert.notEqual(copy.responding_agent_id,agent.id);
    assert.equal(importedAgent.provider_connection_id,null);
    // Simulate an archive whose responding profile was deleted long ago.
    archive.data.chats[0].responding_agent_id='deleted-profile';
    const unavailable=await call('/import',archive);
    const blocked=unavailable.bootstrap.chats.find(item=>item.workspace_id===unavailable.result.id && item.title===chat.title);
    assert.notEqual(blocked.responding_agent_id,'deleted-profile');
    assert.ok(!unavailable.bootstrap.agents.some(item=>item.id===blocked.responding_agent_id));
    assert.equal(fake.launches,0);assert.equal(api.snapshot().runs.length,0);
  });
});

test('deleted conversation agents import as shared unavailable identities without reviving profiles',async()=>{
  await withApi(async({call,api,fake,workspace,chat,agent})=>{
    await call(`/chats/${chat.id}/messages`,{content:'Keep this conversation history.'});
    await call(`/agents/${agent.id}`,undefined,'DELETE',200);
    const archive=await call(`/export?workspace_id=${workspace.id}`);
    assert.ok(!archive.data.agents.some(item=>item.id===agent.id));
    assert.deepEqual(archive.data.chats[0].participant_agent_ids,[agent.id]);
    assert.equal(archive.data.chats[0].responding_agent_id,agent.id);
    const imported=await call('/import',archive);
    const copy=imported.bootstrap.chats.find(item=>item.workspace_id===imported.result.id && item.title===chat.title);
    assert.notEqual(copy.responding_agent_id,agent.id);
    assert.deepEqual(copy.participant_agent_ids,[copy.responding_agent_id]);
    assert.ok(!imported.bootstrap.agents.some(item=>item.id===copy.responding_agent_id));
    assert.equal(imported.bootstrap.messages.find(item=>item.chat_id===copy.id).content,'Keep this conversation history.');
    await call(`/chats/${copy.id}/turns`,{agent_id:'codex',content:'Do not substitute another identity.',client_turn_id:'deleted-agent-blocked'},'POST',409);
    assert.equal(fake.launches,0);assert.equal(api.snapshot().runs.length,0);

    for (const field of ['participant_agent_ids','responding_agent_id']) {
      const invalid=structuredClone(archive);
      invalid.data.chats[0][field]=field==='participant_agent_ids'?[workspace.id]:workspace.id;
      const rejected=await call('/import',invalid,'POST',400);
      assert.match(rejected.error.message,/non-agent content/);
    }
  });
});

test('turn context controls exclude history but retain the current message’s text attachments', async () => {
  await withApi(async ({ call, fake, workspace, project, chat, turn, connectFixture }) => {
    await connectFixture();
    await call('/memory-notes', { workspace_id: workspace.id, project_id: project.id, title: 'Secret note', content: 'EXCLUDED_MEMORY' });
    await call(`/chats/${chat.id}/messages`, { content: 'EXCLUDED_HISTORY' });
    await call(`/chats/${chat.id}/turns`, turn({ include_memory: false, include_chat: false, attachments: [{ name: 'current.txt', content: 'INCLUDED_ATTACHMENT' }] }));
    assert.doesNotMatch(fake.prompts[0], /EXCLUDED_MEMORY|EXCLUDED_HISTORY/);
    assert.match(fake.prompts[0], /INCLUDED_ATTACHMENT/);
  });
});

test('archived teams block project and standalone route work before saving or provider access', async () => {
  await withApi(async ({ call, api, fake, workspace, project, chat, turn }) => {
    const team = (await call('/teams', { workspace_id: workspace.id, name: 'Archived team' })).team;
    await call(`/projects/${project.id}`, { team_id: team.id }, 'PATCH');
    const task = (await call('/tasks', { workspace_id: workspace.id, team_id: team.id, title: 'Team route' })).task;
    await call(`/teams/${team.id}`, { archived_at: new Date().toISOString() }, 'PATCH');
    await call(`/chats/${chat.id}/turns`, turn(), 'POST', 400);
    await call('/runs', { workspace_id: workspace.id, project_id: project.id, mode: 'mock', scenario: 'manual' }, 'POST', 400);
    await call(`/tasks/${task.id}/runs`, { mode: 'mock', scenario: 'manual' }, 'POST', 400);
    assert.equal(api.snapshot().messages.length, 0);
    assert.equal(api.snapshot().runs.length, 0);
    assert.equal(fake.commandCalls, 0);
    assert.equal(fake.launches, 0);
    await call(`/teams/${team.id}`, { archived_at: null }, 'PATCH');
    const started = await call(`/tasks/${task.id}/runs`, { mode: 'mock', scenario: 'manual' });
    assert.equal(started.run.status, 'running');
    await call(`/runs/${started.run.id}/stop`, {}, 'POST', 200);
  });
});

test('malformed attachments are rejected on creation and editing without damaging valid messages', async () => {
  await withApi(async ({ call, api, chat }) => {
    const badAttachments = [null, 42, {}, { name: '' }, { name: 'bad.txt', content: 42 }, { name: 'bad.txt', type: {} }, { name: 'bad.txt', size: -1 }];
    for (const attachment of badAttachments) await call(`/chats/${chat.id}/messages`, { content: 'Invalid file', attachments: [attachment] }, 'POST', 400);
    assert.equal(api.snapshot().messages.length, 0);
    const files = [{ name: 'notes.txt', type: 'text/plain', content: 'Readable', size: 8 }, { name: 'legacy-reference.txt' }];
    const message = (await call(`/chats/${chat.id}/messages`, { content: 'Valid files', attachments: files })).message;
    await call(`/messages/${message.id}`, { attachments: [null] }, 'PATCH', 400);
    assert.deepEqual(api.snapshot().messages[0].attachments, files);
  });
});

test('message conversation identity is immutable across nested and generic update endpoints', async () => {
  await withApi(async ({ call, api, workspace, chat }) => {
    const otherWorkspace = (await call('/workspaces', { name: 'Other workspace' })).workspace;
    const otherChat = (await call('/chats', { workspace_id: otherWorkspace.id, title: 'Private conversation' })).chat;
    const sameWorkspaceChat = (await call('/chats', { workspace_id: workspace.id, title: 'Another conversation' })).chat;
    const message = (await call(`/chats/${chat.id}/messages`, { content: 'Keep in original chat' })).message;
    await call(`/messages/${message.id}`, { chat_id: otherChat.id }, 'PATCH', 400);
    await call(`/messages/${message.id}`, { chatId: sameWorkspaceChat.id }, 'PATCH', 400);
    await call(`/chats/${chat.id}/messages/${message.id}`, { chat_id: otherChat.id }, 'PATCH', 400);
    await call(`/messages/${message.id}`, { chat_id: chat.id, content: 'Edited in place' }, 'PATCH');
    assert.equal(api.snapshot().messages[0].chat_id, chat.id);
    assert.equal(api.snapshot().messages[0].content, 'Edited in place');
    const exported = (await call(`/export?workspace_id=${otherWorkspace.id}`, undefined, 'GET')).data;
    assert.equal(exported.messages.length, 0);
  });
});

test('retrying an older message prioritizes its attachments outside the recent history window', async () => {
  await withApi(async ({ call, fake, chat, turn, connectFixture }) => {
    await connectFixture(); fake.mode = 'failure';
    const first = await call(`/chats/${chat.id}/turns`, turn({attachments:[{name:'spec.txt',type:'text/plain',content:'ORIGINAL_SOURCE_ATTACHMENT'}]}));
    for (let index=0; index<21; index++) await call(`/chats/${chat.id}/messages`, {content:`Later note ${index}`,attachments:[{name:'large.txt',content:'x'.repeat(20000),type:'text/plain'}]});
    fake.mode = 'success';
    await call(`/chats/${chat.id}/turns`, {agent_id: first.run.agent_id,source_message_id:first.message.id,client_turn_id:'old-source-retry-002'});
    assert.match(fake.prompts.at(-1), /ORIGINAL_SOURCE_ATTACHMENT/);
    const references = fake.prompts.at(-1).split('\n').filter(line => line.startsWith('Reference data ')).map(line => JSON.parse(line.slice('Reference data '.length)));
    const attachments = references.filter(item => item.kind === 'attachment');
    assert.equal(attachments[0].id, `${first.message.id}:0`);
    assert.equal(attachments[0].content, 'ORIGINAL_SOURCE_ATTACHMENT');
  });
});

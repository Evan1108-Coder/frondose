import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createLocalApi } from '../server/local-api.mjs';
import { SKILL_TOOLS } from '../server/skills-service.mjs';

function childFor(launch, fake) {
  const child = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => queueMicrotask(() => child.emit('close', 1));
  child.stdin.end = (prompt) => {
    launch.prompt = prompt;
    if (fake.mode === 'hold') return;
    queueMicrotask(() => {
      if (fake.mode === 'success') child.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Injected context fixture reply.' } })}\n`));
      else child.stderr.emit('data', Buffer.from('Injected context fixture failure.'));
      child.emit('close', fake.mode === 'success' ? 0 : 1);
    });
  };
  return child;
}

async function fixture(callback) {
  const dataDir = await mkdtemp(join(tmpdir(), 'rumbo-context-execution-'));
  const fake = { launches: [], commands: [], networkCalls: 0, mode: 'success' };
  const integrationOptions = {
    env: {},
    fetchImpl: () => { fake.networkCalls += 1; throw new Error('External network is forbidden in context execution tests.'); },
    execute: async (command, args, options) => {
      fake.commands.push({ command, args: [...args], options });
      return { stdout: args.includes('mcp') ? '[]' : 'Logged in', stderr: '', code: 0 };
    },
    spawnProcess: (command, args, options) => {
      const launch = { command, args: [...args], options, prompt: null };
      fake.launches.push(launch);
      return childFor(launch, fake);
    },
  };
  const api = createLocalApi({ dataDir, seedMode: 'clean', integrationOptions });
  const server = createServer((req, res) => api.middleware(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (path, { method = 'GET', body, cookie } = {}) => {
    const response = await fetch(origin + path, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let result;
    try { result = await response.json(); } catch { result = null; }
    return { status: response.status, body: result, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const call = async (path, body, method = body === undefined ? 'GET' : 'POST', expected = method === 'POST' ? 201 : 200, cookie) => {
    const result = await request(path, { method, body, cookie });
    assert.equal(result.status, expected, `${method} ${path}: ${JSON.stringify(result.body)}`);
    return result.body;
  };
  try {
    const workspace = (await call('/workspaces', { name: 'Context execution fixture' })).workspace;
    const project = (await call('/projects', { workspace_id: workspace.id, name: 'Context project', local_path: dataDir, goal: 'Compile exact context.' })).project;
    const route = (await call('/tasks', { workspace_id: workspace.id, project_id: project.id, title: 'Inspect context' })).task;
    const document = (await call('/documents', { workspace_id: workspace.id, project_id: project.id, title: 'Pinned document', content: 'DOCUMENT_CONTEXT_V1' })).document;
    const memory = (await call('/memory-notes', { workspace_id: workspace.id, project_id: project.id, title: 'Pinned memory', content: 'MEMORY_CONTEXT_V1' })).memory_note;
    const pack = (await call('/workspace-items', {
      workspace_id: workspace.id,
      kind: 'context_pack',
      name: 'Execution pack',
      payload: { description: 'Sources for execution', document_ids: [document.id], memory_ids: [memory.id], content: 'PACK_CONTEXT_V1' },
    })).result;
    const agent = (await call('/agents', {
      workspace_id: workspace.id,
      name: 'Context agent',
      provider: 'codex',
      instructions: 'AGENT_INSTRUCTIONS_V1',
      context_source_ids: [pack.id],
      memory_policy: 'reviewed',
      permission_policy: 'review',
    })).agent;
    const chat = (await call('/chats', { workspace_id: workspace.id, project_id: project.id, task_id: route.id, title: 'Context chat', participant_agent_ids: [agent.id] })).chat;
    const inspectInput = (extra = {}) => ({
      workspace_id: workspace.id,
      project_id: project.id,
      task_id: route.id,
      chat_id: chat.id,
      agent_id: agent.id,
      prompt: 'Use only the inspected context.',
      work_mode: 'project',
      permission_mode: 'workspace-write',
      include_memory: true,
      include_chat: true,
      attachments: [],
      context_pack_ids: [pack.id],
      ...extra,
    });
    await callback({ api, call, request, fake, workspace, project, route, document, memory, pack, agent, chat, inspectInput, dataDir });
  } finally {
    api.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
}

async function connectFixture(call, fake) {
  await call('/connections/codex/connect', { method: 'existing' }, 'POST', 200);
  fake.commands.length = 0;
  fake.launches.length = 0;
}

function inspectedLaunch(input, inspectionId, overrides = {}) {
  return {
    ...input,
    mode: 'live',
    context_inspection_id: inspectionId,
    // The existing run API uses camel-case aliases; retaining the canonical
    // inspection fields lets the server compare the complete normalized scope.
    workMode: input.work_mode,
    permissionMode: input.permission_mode,
    ...overrides,
  };
}

test('inspection is provider-free, reports exclusions, respects memory opt-out and cannot invent tool availability', async () => {
  await fixture(async ({ call, fake, inspectInput }) => {
    const preview = (await call('/context/inspect', inspectInput({
      include_memory: false,
      attachments: [
        { name: 'notes.txt', type: 'text/plain', content: 'TEXT_ATTACHMENT_INCLUDED' },
        { name: 'image.png', type: 'image/png', content: 'data:image/png;base64,IMAGE_MUST_NOT_APPEAR' },
      ],
    }))).result;

    assert.equal(fake.commands.length, 0, 'Preview must not probe or execute a provider command');
    assert.equal(fake.launches.length, 0, 'Preview must not launch a provider process');
    assert.equal(fake.networkCalls, 0);
    assert.ok(preview.id);
    assert.ok(Number.isFinite(Date.parse(preview.expires_at)));
    assert.equal(preview.manifest.fingerprint.length, 64);
    assert.match(preview.finalPrompt, /TEXT_ATTACHMENT_INCLUDED/);
    assert.doesNotMatch(preview.finalPrompt, /IMAGE_MUST_NOT_APPEAR/);
    assert.doesNotMatch(preview.finalPrompt, /MEMORY_CONTEXT_V1/);
    assert.ok(preview.manifest.excluded.some((item) => item.kind === 'attachment' && item.reason === 'unsupported_attachment'));
    assert.ok(preview.manifest.excluded.some((item) => ['memory_disabled', 'agent_memory_disabled'].includes(item.reason)));

    const known = new Set(SKILL_TOOLS);
    for (const tool of preview.manifest.permissions.available_tools) {
      assert.ok(known.has(tool.id), `Inspector invented tool ${tool.id}`);
      assert.equal(typeof tool.available, 'boolean');
    }
    assert.equal(preview.manifest.permissions.available_tools.some((tool) => tool.id === 'client_claimed_admin_tool'), false);
  });
});

test('a fresh inspection requires the same scope, launches the exact preview prompt and persists an immutable run context snapshot', async () => {
  await fixture(async ({ api, call, fake, inspectInput, document }) => {
    await connectFixture(call, fake);
    const inspected = inspectInput();
    const preview = (await call('/context/inspect', inspected)).result;
    assert.equal(fake.commands.length, 0);
    assert.equal(fake.launches.length, 0);

    const beforeMismatch = { runs: api.snapshot().runs.length, messages: api.snapshot().messages.length };
    const mismatch = await call('/runs', inspectedLaunch(inspected, preview.id, { task_id: null }), 'POST', 409);
    assert.ok(mismatch.error?.message, JSON.stringify(mismatch));
    assert.equal(api.snapshot().runs.length, beforeMismatch.runs);
    assert.equal(api.snapshot().messages.length, beforeMismatch.messages);
    assert.equal(fake.launches.length, 0);

    const { run } = await call('/runs', inspectedLaunch(inspected, preview.id));
    assert.equal(fake.launches.length, 1);
    assert.equal(fake.launches[0].prompt, preview.finalPrompt, 'Provider stdin must exactly equal the reviewed preview');

    const captured = (await call(`/runs/${run.id}/context`)).result;
    assert.equal(captured.run_id, run.id);
    assert.equal(captured.finalPrompt, preview.finalPrompt);
    assert.equal(captured.manifest.fingerprint, preview.manifest.fingerprint);
    assert.deepEqual(captured.manifest, preview.manifest);

    await call(`/documents/${document.id}`, { content: 'DOCUMENT_CONTEXT_AFTER_RUN' }, 'PATCH');
    const unchanged = (await call(`/runs/${run.id}/context`)).result;
    assert.equal(unchanged.finalPrompt, preview.finalPrompt);
    assert.equal(unchanged.manifest.fingerprint, preview.manifest.fingerprint);
  });
});

test('instruction, document and memory changes make inspections stale before any run or message write', async () => {
  await fixture(async ({ api, call, fake, inspectInput, agent, document, memory }) => {
    await connectFixture(call, fake);
    const attempts = [
      {
        mutate: () => call(`/agents/${agent.id}`, { version: api.snapshot().agents.find((item) => item.id === agent.id).version, instructions: 'AGENT_INSTRUCTIONS_CHANGED' }, 'PATCH'),
      },
      {
        mutate: () => call(`/documents/${document.id}`, { content: 'DOCUMENT_CONTEXT_CHANGED' }, 'PATCH'),
      },
      {
        mutate: () => call(`/memory-notes/${memory.id}`, { content: 'MEMORY_CONTEXT_CHANGED' }, 'PATCH'),
      },
    ];
    for (const [index, attempt] of attempts.entries()) {
      const inspected = inspectInput();
      const inspection = (await call('/context/inspect', inspected)).result;
      await attempt.mutate();
      const beforeRuns = api.snapshot().runs.length;
      const beforeMessages = api.snapshot().messages.length;
      const rejected = await call('/runs', inspectedLaunch(inspected, inspection.id), 'POST', 409);
      assert.ok(rejected.error?.message, JSON.stringify(rejected));
      assert.equal(api.snapshot().runs.length, beforeRuns, `stale attempt ${index} wrote a run`);
      assert.equal(api.snapshot().messages.length, beforeMessages, `stale attempt ${index} wrote a message`);
      assert.equal(fake.launches.length, 0, `stale attempt ${index} launched a process`);
    }
  });
});

test('inspection IDs cannot cross workspace or authenticated sponsor boundaries, and captured source access is rechecked', async () => {
  await fixture(async ({ api, call, request, fake, inspectInput, workspace, project }) => {
    await connectFixture(call, fake);
    const inspected = inspectInput();
    const preview = (await call('/context/inspect', inspected)).result;
    const foreign = (await call('/workspaces', { name: 'Foreign context workspace' })).workspace;
    const foreignProject = (await call('/projects', { workspace_id: foreign.id, name: 'Foreign project', local_path: api.dbPath.replace(/\/rumbo\.sqlite$/, '') })).project;
    const before = { runs: api.snapshot().runs.length, messages: api.snapshot().messages.length };
    const cross = await request('/runs', { method: 'POST', body: inspectedLaunch(inspected, preview.id, {
      workspace_id: foreign.id,
      project_id: foreignProject.id,
    }) });
    assert.ok([400, 403, 409].includes(cross.status), JSON.stringify(cross.body));
    assert.equal(api.snapshot().runs.length, before.runs);
    assert.equal(api.snapshot().messages.length, before.messages);
    assert.equal(fake.launches.length, 0);

    const member = (await call('/governance', { workspace_id: workspace.id, action: 'create_member', name: 'Member', email: 'member-context@example.com' }, 'POST', 200)).result;
    const setup = await request('/identity/setup', { method: 'POST', body: { name: 'Owner', email: 'owner-context@example.com', password: 'owner context password 123' } });
    assert.equal(setup.status, 200, JSON.stringify(setup.body));
    const invitation = (await call('/identity/invite', { workspace_id: workspace.id, member_id: member.id }, 'POST', 201, setup.cookie)).result;
    const accepted = await request('/identity/accept', { method: 'POST', body: { token: invitation.invitation_token, password: 'member context password 123' } });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));

    const sponsored = await request('/runs', { method: 'POST', cookie: accepted.cookie, body: inspectedLaunch(inspected, preview.id) });
    assert.ok([403, 409].includes(sponsored.status), JSON.stringify(sponsored.body));
    assert.equal(api.snapshot().runs.length, before.runs);
    assert.equal(api.snapshot().messages.length, before.messages);
    assert.equal(fake.launches.length, 0);

    const memberPreview = (await call('/context/inspect', inspected, 'POST', 201, accepted.cookie)).result;
    const memberRun = (await call('/runs', inspectedLaunch(inspected, memberPreview.id), 'POST', 201, accepted.cookie)).run;
    assert.equal(fake.launches.length, 1);
    await call('/governance', {
      workspace_id: workspace.id,
      action: 'grant',
      member_id: member.id,
      permission: 'documents.read',
      effect: 'deny',
      scope_type: 'project',
      scope_id: project.id,
      reason: 'Captured source access revoked for fixture',
    }, 'POST', 200, setup.cookie);
    const revoked = await request(`/runs/${memberRun.id}/context`, { cookie: accepted.cookie });
    assert.equal(revoked.status, 403, JSON.stringify(revoked.body));
  });
});

test('legacy live launches still use the shared compiler and expose the captured run context', async () => {
  await fixture(async ({ call, fake, workspace, project, agent }) => {
    await connectFixture(call, fake);
    const { run } = await call('/runs', {
      workspace_id: workspace.id,
      project_id: project.id,
      agent_id: agent.id,
      mode: 'live',
      prompt: 'Legacy launch through the shared compiler.',
      permissionMode: 'workspace-write',
    });
    assert.equal(fake.launches.length, 1);
    const captured = (await call(`/runs/${run.id}/context`)).result;
    assert.equal(captured.run_id, run.id);
    assert.equal(captured.finalPrompt, fake.launches[0].prompt);
    assert.equal(captured.manifest.current_instruction.content, 'Legacy launch through the shared compiler.');
    assert.equal(captured.manifest.fingerprint.length, 64);
  });
});

test('a reviewed chat turn sends the exact preview with text attachments and persists its source message once', async () => {
  await fixture(async ({ api, call, fake, chat, inspectInput }) => {
    await connectFixture(call, fake);
    const attachment = { name: 'review-notes.txt', type: 'text/plain', content: 'CHAT_ATTACHMENT_REVIEWED' };
    const inspected = inspectInput({
      prompt: 'Send this reviewed chat turn.',
      attachments: [attachment],
    });
    const preview = (await call('/context/inspect', inspected)).result;

    const sent = await call(`/chats/${chat.id}/turns`, {
      ...inspected,
      content: inspected.prompt,
      client_turn_id: 'context-chat-turn-001',
      context_inspection_id: preview.id,
    });

    assert.equal(fake.launches.length, 1);
    assert.equal(fake.launches[0].prompt, preview.finalPrompt, 'Chat provider stdin must exactly equal the reviewed preview');
    assert.match(preview.finalPrompt, /CHAT_ATTACHMENT_REVIEWED/);
    assert.equal(sent.run.source_message_id, sent.message.id);
    assert.deepEqual(sent.message.attachments, [attachment]);
    assert.equal(api.snapshot().messages.filter((item) => item.sender_type === 'user' && item.id === sent.message.id).length, 1);
    assert.equal(api.snapshot().runs.filter((item) => item.source_message_id === sent.message.id).length, 1);
  });
});

test('a reviewed retry canonicalizes source attachments and reuses the old source message exactly once', async () => {
  await fixture(async ({ api, call, fake, chat, inspectInput }) => {
    await connectFixture(call, fake);
    fake.mode = 'failure';
    const attachment = { name: 'old-source.txt', type: 'text/plain', content: 'OLD_SOURCE_ATTACHMENT_REVIEWED' };
    const first = await call(`/chats/${chat.id}/turns`, {
      agent_id: inspectInput().agent_id,
      content: 'Retry this attached source.',
      attachments: [attachment],
      client_turn_id: 'context-source-first-001',
      work_mode: 'project',
      permission_mode: 'workspace-write',
      context_pack_ids: inspectInput().context_pack_ids,
      include_memory: true,
      include_chat: false,
    });
    assert.equal(first.run.status, 'failed');

    const inspected = inspectInput({
      prompt: first.message.content,
      source_message_id: first.message.id,
      include_chat: false,
      attachments: [],
    });
    const preview = (await call('/context/inspect', inspected)).result;
    const verificationDb = new DatabaseSync(api.dbPath);
    try {
      const savedInput = JSON.parse(verificationDb.prepare('SELECT input_json FROM run_context_inspections WHERE id=?').get(preview.id).input_json);
      assert.deepEqual(savedInput.attachments, [], 'A source-message inspection must store canonical attachments input, not a second caller-controlled copy');
      assert.equal(savedInput.source_message_id, first.message.id);
    } finally { verificationDb.close(); }
    assert.match(preview.finalPrompt, /OLD_SOURCE_ATTACHMENT_REVIEWED/);

    fake.mode = 'success';
    const retry = await call(`/chats/${chat.id}/turns`, {
      ...inspected,
      content: undefined,
      prompt: undefined,
      attachments: undefined,
      client_turn_id: 'context-source-retry-002',
      context_inspection_id: preview.id,
    });

    assert.equal(fake.launches.length, 2);
    assert.equal(fake.launches[1].prompt, preview.finalPrompt);
    assert.equal(retry.message.id, first.message.id);
    assert.deepEqual(retry.message.attachments, [attachment]);
    assert.equal(api.snapshot().messages.filter((item) => item.sender_type === 'user' && item.id === first.message.id).length, 1);
    assert.equal(api.snapshot().runs.filter((item) => item.source_message_id === first.message.id).length, 2);
  });
});

test('changed chat history or an edited inspected source rejects before writing a turn', async () => {
  await fixture(async ({ api, call, fake, chat, inspectInput }) => {
    await connectFixture(call, fake);
    const freshInput = inspectInput({ prompt: 'Reject this if chat history changes.' });
    const freshPreview = (await call('/context/inspect', freshInput)).result;
    await call(`/chats/${chat.id}/messages`, { content: 'NEW_HISTORY_AFTER_REVIEW' });
    let before = { runs: api.snapshot().runs.length, messages: api.snapshot().messages.length };
    const staleHistory = await call(`/chats/${chat.id}/turns`, {
      ...freshInput,
      content: freshInput.prompt,
      client_turn_id: 'context-stale-history-001',
      context_inspection_id: freshPreview.id,
    }, 'POST', 409);
    assert.equal(staleHistory.error.code, 'stale_context');
    assert.deepEqual({ runs: api.snapshot().runs.length, messages: api.snapshot().messages.length }, before);
    assert.equal(fake.launches.length, 0);

    fake.mode = 'failure';
    const first = await call(`/chats/${chat.id}/turns`, {
      agent_id: freshInput.agent_id,
      content: 'Original inspected retry source.',
      attachments: [{ name: 'source.txt', type: 'text/plain', content: 'SOURCE_BEFORE_EDIT' }],
      client_turn_id: 'context-stale-source-001',
      work_mode: 'project',
      permission_mode: 'workspace-write',
      include_chat: false,
      context_pack_ids: freshInput.context_pack_ids,
    });
    const sourceInput = inspectInput({
      prompt: first.message.content,
      source_message_id: first.message.id,
      include_chat: false,
      attachments: [],
    });
    const sourcePreview = (await call('/context/inspect', sourceInput)).result;
    await call(`/messages/${first.message.id}`, { content: 'Edited after inspection.' }, 'PATCH', 200);
    before = { runs: api.snapshot().runs.length, messages: api.snapshot().messages.length };
    const staleSource = await call(`/chats/${chat.id}/turns`, {
      ...sourceInput,
      content: undefined,
      prompt: undefined,
      attachments: undefined,
      client_turn_id: 'context-stale-source-002',
      context_inspection_id: sourcePreview.id,
    }, 'POST', 409);
    assert.ok(staleSource.error?.message, JSON.stringify(staleSource));
    assert.deepEqual({ runs: api.snapshot().runs.length, messages: api.snapshot().messages.length }, before);
    assert.equal(fake.launches.length, 1);
  });
});

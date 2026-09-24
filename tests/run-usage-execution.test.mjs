import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLocalApi } from '../server/local-api.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'rumbo-usage-execution-'));
  const launches = [], commands = [], pending = [];
  let next = { kind: 'codex', count: 0 };
  const options = { dataDir: directory, seedMode: 'clean', integrationOptions: {
    env: {}, fetchImpl() { throw new Error('No external network in usage execution tests.'); },
    async execute(command, args) { commands.push({ command, args }); return { code: 0, stdout: args.includes('mcp') ? '[]' : 'Logged in', stderr: '' }; },
    spawnProcess(command, args) {
      launches.push({ command, args });
      const scenario = next, child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
      child.kill = () => queueMicrotask(() => child.emit('close', 1));
      const emit = event => child.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
      child.stdin.end = () => queueMicrotask(() => {
        if (scenario.kind === 'pending') { pending.push(child); return; }
        for (let i = 0; i < scenario.count; i++) emit({ type: 'item.completed', item: { type: 'agent_message', phase: 'commentary', text: `Fixture progress ${i}` } });
        if (command === 'claude') emit({ type: 'result', subtype: 'success', is_error: false, result: 'Injected Claude result.', usage: { input_tokens: 20, output_tokens: 7, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 }, modelUsage: { 'fixture-model': { inputTokens: 40, outputTokens: 14, cacheReadInputTokens: 6, cacheCreationInputTokens: 4, costUSD: 0.003 } }, total_cost_usd: 0.003 });
        else {
          emit({ type: 'item.completed', item: { type: 'agent_message', text: 'Injected Codex result.' } });
          emit({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 9, reasoning_output_tokens: 2 } });
        }
        child.emit('close', 0);
      });
      return child;
    },
  } };
  let api = createLocalApi(options);
  const server = createServer((req, res) => api.middleware(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const call = async (path, body, method = body === undefined ? 'GET' : 'POST', expected = method === 'POST' ? 201 : 200) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`); return result;
  };
  t.after(async () => { api.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const workspace = (await call('/workspaces', { name: 'Usage execution fixture' })).workspace;
  const agents = {};
  for (const provider of ['codex', 'claude']) {
    await call(`/connections/${provider}/connect`, { method: 'existing' }, 'POST', 200);
    agents[provider] = (await call('/agents', { workspace_id: workspace.id, name: `${provider} usage fixture`, provider, memory_policy: 'none' })).agent;
  }
  const launch = async (provider, scenario = {}) => {
    next = { kind: provider, count: 0, ...scenario };
    return (await call('/runs', { workspace_id: workspace.id, agent_id: agents[provider].id, mode: 'live', work_mode: 'conversation', prompt: 'Return the injected fixture report.' })).run;
  };
  return { call, workspace, agents, launches, commands, pending, launch, restart() { api.close(); api = createLocalApi(options); } };
}

test('usage execution: canonical independent Codex and Claude runs retain separate final metrics without provider calls on reads', async t => {
  const f = await fixture(t), codex = await f.launch('codex'), claude = await f.launch('claude');
  const before = { launches: f.launches.length, commands: f.commands.length };
  const one = (await f.call(`/runs/${codex.id}/usage`)).result;
  const two = (await f.call(`/runs/${claude.id}/usage`)).result;
  assert.equal(one.state, 'reported'); assert.equal(two.state, 'reported');
  const aggregate = (await f.call(`/usage?workspace_id=${f.workspace.id}&group_by=agent`)).result;
  assert.equal(aggregate.totals.eligible_run_count, 2);
  assert.match(JSON.stringify(one), /input_tokens/); assert.ok(two.estimate);
  assert.equal(f.launches.length, before.launches); assert.equal(f.commands.length, before.commands);
  for (const invocation of f.launches) assert(!invocation.args.some(arg => ['--resume', '--continue', 'resume', '--session-id'].includes(arg)));
});

test('usage execution: final usage survives the presentation event cap and persists through restart', async t => {
  const f = await fixture(t), run = await f.launch('codex', { count: 5010 });
  const first = (await f.call(`/runs/${run.id}/usage`)).result;
  assert.equal(first.state, 'reported', 'Usage capture must not depend on presentation event capacity');
  f.restart();
  const restored = (await f.call(`/runs/${run.id}/usage`)).result;
  assert.deepEqual(restored, first);
});

test('usage execution: server restart preserves interruption rather than inventing a successful zero report', async t => {
  const f = await fixture(t), run = await f.launch('codex', { kind: 'pending' });
  assert.equal(f.pending.length, 1);
  f.restart();
  const restored = (await f.call(`/runs/${run.id}/usage`)).result;
  assert.notEqual(restored.state, 'reported');
  assert.match(JSON.stringify(restored), /interrupted/);
  const aggregate = (await f.call(`/usage?workspace_id=${f.workspace.id}&group_by=agent`)).result;
  assert.equal(aggregate.totals.eligible_run_count, 1);
});

test('usage execution: simulation sessions never contribute to provider usage or start a provider', async t => {
  const f = await fixture(t);
  await f.launch('codex');
  const launches = f.launches.length;
  await f.call('/runs', { workspace_id: f.workspace.id, agent_id: f.agents.codex.id, mode: 'mock', prompt: 'A local simulation, not provider consumption.' });
  const aggregate = (await f.call(`/usage?workspace_id=${f.workspace.id}&group_by=agent`)).result;
  assert.equal(aggregate.totals.eligible_run_count, 1);
  assert.equal(f.launches.length, launches);
});

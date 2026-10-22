// Provider-free subprocess fixture. Never imports vendor code or contacts AI.
import readline from 'node:readline';
import { spawn } from 'node:child_process';
const provider = process.argv[2];
if (process.argv.includes('--ignore-sigterm')) {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 10_000);
}
if (process.argv.includes('--descendant')) {
  // Keep inherited pipes open so merely killing the leader cannot confirm close.
  spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},10000)"], { stdio: ['ignore', process.stdout, process.stderr], windowsHide: true });
}
const native = 'fixture-native';
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const text = 'Reply from real IPC 👋';
if (provider === 'omp') send({ type: 'ready', supportedProtocolVersions: [1] });
if (provider === 'antigravity') send({ event: 'init', conversation_id: native, init: {} });
for await (const line of readline.createInterface({ input: process.stdin })) {
  const frame = JSON.parse(line), method = frame.method || frame.type;
  const reply = value => send(frame.type ? { type: 'response', id: frame.id, success: true, data: value } : { id: frame.id, result: value });
  if (method === 'initialize') reply(provider === 'muse' ? { schema: { fingerprint: 'sha256:e0e163db6ccf00dbe68402ce55d6319b3edc33c421f31e9583b587b2de8a118f' } } : { protocolVersion: 1 });
  else if (method === 'config/read') reply({ config: { mcp_servers: {} } });
  else if (method === 'thread/start') reply({ thread: { id: native } });
  else if (method === 'session/start') reply({ session: { sessionId: native }, viewCursor: 'cursor' });
  else if (method === 'session/new') reply({ sessionId: native });
  else if (method === 'get_state') reply({ sessionId: native });
  else if (provider === 'claude' && method === 'user') {
    send({ type: 'system', subtype: 'init', session_id: native });
    send({ type: 'assistant', session_id: native, message: { content: [{ type: 'text', text }] } });
    send({ type: 'result', subtype: 'success', session_id: native, result: text });
  } else if (provider === 'antigravity' && frame.event === 'user') send({ event: 'result', result: { conversation_id: native, status: 'SUCCESS', response: text } });
  else if (provider === 'codex' && method === 'turn/start') {
    reply({ turn: { id: 'turn' } });
    send({ method: 'item/completed', params: { threadId: native, item: { id: 'message', type: 'agentMessage', phase: 'final_answer', text } } });
    send({ method: 'turn/completed', params: { threadId: native, turn: { id: 'turn', status: 'completed' } } });
  } else if (provider === 'muse' && method === 'turn/start') {
    reply({ turnId: 'turn', disposition: 'started' });
    send({ method: 'item/completed', params: { sessionId: native, item: { itemId: 'message', kind: 'agentMessage', text } } });
    send({ method: 'turn/completed', params: { sessionId: native, turnId: 'turn', terminal: 'completed' } });
  } else if ((provider === 'pi' || provider === 'omp') && method === 'prompt') {
    reply({ agentInvoked: true }); send({ type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text }] }] });
  } else if (method === 'session/prompt') {
    send({ method: 'session/update', params: { sessionId: native, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });
    reply({ stopReason: 'end_turn' });
  }
}

// This is a presentation projection of the already permission-filtered snapshot.
// Never fetch hidden records or infer that a completed invocation achieved its goal.
export const STOPPABLE_ASSISTANT_RUNS = new Set(['queued', 'starting', 'running', 'needs_input', 'paused']);
const WORKING = new Set(['queued', 'starting', 'running']);
const NEEDS_YOU = new Set(['needs_input', 'paused', 'failed', 'interrupted']);
const TERMINAL = new Set(['completed', 'failed', 'stopped', 'cancelled', 'interrupted']);
export function assistantRunStatus(run) {
  return ({ queued: 'Queued', starting: 'Starting', running: 'Working', needs_input: 'Needs input', paused: 'Paused', completed: 'Run completed', failed: 'Failed', stopped: 'Stopped', cancelled: 'Cancelled', interrupted: 'Interrupted' })[run.status] || 'Status unavailable';
}
export function assistantActivity(data, workspaceId, { query = '', filter = 'all' } = {}) {
  const pendingApprovals = new Set((data.approvals || []).filter(approval => approval.status === 'pending').map(approval => approval.run_id));
  const chats = new Map((data.chats || []).filter(chat => chat.workspace_id === workspaceId && !chat.archived_at).map(chat => [chat.id, chat]));
  const agents = new Map((data.agents || []).filter(agent => !agent.archived_at && (!agent.workspace_id || agent.workspace_id === workspaceId)).map(agent => [agent.id, agent]));
  const outputs = new Map();
  for (const output of data.outputs || []) {
    if (output.workspace_id !== workspaceId || output.archived_at || !output.run_id) continue;
    if (!outputs.has(output.run_id)) outputs.set(output.run_id, []);
    outputs.get(output.run_id).push(output);
  }
  const needle = query.trim().toLocaleLowerCase();
  return (data.runs || []).filter(run => run.workspace_id === workspaceId && !run.archived_at)
    .map(run => { const approvalNeeded = !TERMINAL.has(run.status) && pendingApprovals.has(run.id); return { run, chat: chats.get(run.chat_id) || null, agent: agents.get(run.agent_id) || null, outputs: outputs.get(run.id) || [], approvalNeeded, working: WORKING.has(run.status) && !approvalNeeded, needsYou: NEEDS_YOU.has(run.status) || approvalNeeded }; })
    .filter(item => (filter === 'all' || filter === 'working' && item.working || filter === 'needs-you' && item.needsYou || filter === 'completed' && item.run.status === 'completed') && (!needle || [item.run.title, item.run.agent_name, item.agent?.name, item.chat?.title, item.run.id].filter(Boolean).join('\n').toLocaleLowerCase().includes(needle)))
    .sort((a, b) => String(b.run.updated_at || b.run.created_at || '').localeCompare(String(a.run.updated_at || a.run.created_at || '')) || a.run.id.localeCompare(b.run.id));
}

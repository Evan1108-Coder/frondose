import { byUpdated, val, visible } from "./model.js";
import { isBrowserAiProvider } from './ai-providers.js';

export const AGENT_PROVIDERS = {
  codex: {
    name: "Codex",
    company: "OpenAI",
    capabilities: ["Read and search", "Project edits"],
    permissions: "Read-only or project edits",
    description: "Code, investigate, and make changes inside a project folder.",
  },
  claude: {
    name: "Claude Code",
    company: "Anthropic",
    capabilities: ["Read and search"],
    permissions: "Read-only analysis",
    description: "Read code, explore a project, and explain findings. Editing is not supported in Rumbo yet.",
  },
  openrouter: { name: 'OpenRouter', company: 'OpenRouter', capabilities: ['Conversations', 'Reviewed Rumbo actions'], permissions: 'Reviewed workspace actions', description: 'Use an explicitly selected model through your connected OpenRouter account.' },
  huggingface: { name: 'Hugging Face Inference', company: 'Hugging Face', capabilities: ['Conversations', 'Reviewed Rumbo actions'], permissions: 'Reviewed workspace actions', description: 'Use a chat model through your configured Hugging Face account.' },
};

const ACTIVE_RUN_STATUSES = new Set(["queued", "starting", "running", "needs_input", "paused"]);

/** Connection state is saved account state, not a new authentication check. */
export function agentReadiness(agent, connection) {
  const provider = AGENT_PROVIDERS[agent?.provider];
  const result = (state, label, description, action, canStartLive = false, canSimulate = !isBrowserAiProvider(agent?.provider)) =>
    ({ state, label, description, action, canStartLive, canSimulate });
  if (!agent || val(agent, "archived_at")) return result("archived", "Archived", "Restore this agent before starting a session.", "restore", false, false);
  if (!provider) return result("unsupported", "Not supported", "This provider cannot run sessions in Rumbo yet. Choose Codex or Claude.", "configure", false, false);
  if (agent.status === "paused") return result("paused", "Paused", "New sessions are paused. Sessions already running are not stopped.", "resume", false, false);
  if ((Object.hasOwn(agent, "provider_connection_id") || Object.hasOwn(agent, "providerConnectionId")) && !val(agent, "provider_connection_id")) return result("needs_connection", "Choose connection", "This profile is not bound to an account. Select a shared provider connection in the profile before live work.", "configure");
  if (val(agent, "provider_connection_id") && connection?.id !== val(agent, "provider_connection_id")) return result("needs_connection", "Connection unavailable", "This profile’s selected provider connection is unavailable. Review the profile connection before live work.", "configure");
  const state = connection?.provider === agent.provider ? isBrowserAiProvider(agent.provider) ? connection.workspace_states?.[val(agent, 'workspace_id')] || connection.state : connection.state : "not_connected";
  if (state === 'connected' && connection.mode === 'demo' && connection.metadata?.simulated === true)
    return result('sample', 'Connected · sample', 'A simulated connection in a view-only sample workspace. No provider account is connected and no session can start.', 'inspect', false, false);
  if (state === "connecting") return result("connecting", "Signing in", `Finish ${provider.name} sign-in in the provider window.`, "connect");
  if (state === "not_installed") return result("not_installed", "Setup needed", `Install ${agent.provider === 'claude' ? "Claude Code" : "Codex CLI"}, then connect your account.`, "connect");
  if (state === "connected" && connection.mode !== "demo" && (isBrowserAiProvider(agent.provider) || connection.metadata?.liveAccountChecked !== false)) {
    if (isBrowserAiProvider(agent.provider)) return result('ready', 'Ready', 'Your workspace account is connected. Choose a chat model; Rumbo changes are proposed for review.', 'start', true);
    return result("ready", "Ready", "Account connected. General chat needs no folder; project-file work requires one. Access is checked again during launch.", "start", true);
  }
  const description = state === "available_not_authenticated"
    ? `${provider.name} is installed, but no account connection has been verified.`
    : state === "probe_failed"
      ? `Rumbo could not find a working ${provider.name} installation. Check setup in Connections.`
      : `Connect your ${provider.name} account to start live work. You can still try an explicit simulation.`;
  return result("needs_connection", "Connect account", description, "connect");
}

/** Keep setup-only profiles in Agent Studio, not the working-agent sidebar. */
export function agentVisibleInSidebar(agent, connections = []) {
  if (!agent || val(agent, 'archived_at')) return false;
  if (typeof agent.id === 'string' && agent.id.startsWith('rumbo_agent_')) return true;
  const connection = connections.find(item => item.provider === agent.provider && (!agent.provider_connection_id || item.id === agent.provider_connection_id));
  return agentReadiness(agent, connection).state === 'ready';
}

/** Names are labels, never identity: duplicate or renamed agents must not steal sessions. */
export function runsForAgent(agent, runs = []) {
  if (!agent?.id) return [];
  return runs.filter((run) => val(run, "agent_id") === agent.id &&
    (!val(agent, "workspace_id") || val(run, "workspace_id") === val(agent, "workspace_id")))
    .sort(byUpdated);
}

export function summarizeAgent(agent, data = {}) {
  const selectedConnection = val(agent, "provider_connection_id");
  const hasBinding = Object.hasOwn(agent, "provider_connection_id") || Object.hasOwn(agent, "providerConnectionId");
  const connection = (data.connections || []).find((item) => item.provider === agent.provider && (hasBinding ? !!selectedConnection && item.id === selectedConnection : true));
  const runs = runsForAgent(agent, data.runs);
  const inWorkspace = (item) => !val(agent, "workspace_id") || val(item, "workspace_id") === val(agent, "workspace_id");
  const assignedTasks = visible(data.tasks).filter((task) => inWorkspace(task) && (val(task, "assignee_agent_ids") || []).includes(agent.id));
  const chats = visible(data.chats).filter((chat) => inWorkspace(chat) && (val(chat, "participant_agent_ids") || []).includes(agent.id));
  const projectIds = new Set([...assignedTasks, ...chats, ...runs].map((item) => val(item, "project_id")).filter(Boolean));
  const runIds = new Set(runs.map(run => run.id));
  return {
    provider: AGENT_PROVIDERS[agent.provider] || { name: agent.provider || "Unknown provider", company: "", capabilities: [], permissions: "Not supported" },
    connection,
    readiness: agentReadiness(agent, connection),
    runs,
    activeRuns: runs.filter((run) => ACTIVE_RUN_STATUSES.has(run.status)),
    liveRuns: runs.filter((run) => run.mode === "live" && ACTIVE_RUN_STATUSES.has(run.status)),
    latestRun: runs[0] || null,
    projects: visible(data.projects).filter((project) => inWorkspace(project) && projectIds.has(project.id)),
    chats,
    assignedTasks,
    outputs: visible(data.outputs).filter(output => inWorkspace(output) && runIds.has(val(output, "run_id"))),
    failedRuns: runs.filter(run => run.status === "failed"),
  };
}

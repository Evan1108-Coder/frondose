import { val } from "./model.js";
import { EXECUTION_PROVIDERS, isBrowserAiProvider } from './ai-providers.js';

export const AGENT_REASONING_OPTIONS = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const DEFINITION_FIELDS = ["name", "role", "provider", "description", "instructions", "model", "reasoning_effort", "memory_policy", "output_behavior"];
const DEFINITION_LIMITS = { name: 200, role: 200, description: 1000, instructions: 100000, model: 120, output_behavior: 10000 };

export const AGENT_PRESETS = [
  {
    id: "build",
    label: "Build",
    name: "Builder",
    description: "Turns a clear plan into tested, working changes.",
    instructions: "Understand the project and propose a focused plan before making changes. Keep changes small, follow the project's conventions, and verify the result with relevant tests. Explain what changed and anything that still needs attention. Respect the permissions selected for each session.",
  },
  {
    id: "review",
    label: "Review",
    name: "Code reviewer",
    description: "Reviews code and catches regressions.",
    instructions: "Review code for correctness, security, and regressions. Prioritize actionable findings and include file references and a clear explanation of their impact. Explain findings before making changes. State any gaps in what you could verify.",
  },
  {
    id: "research",
    label: "Research",
    name: "Researcher",
    description: "Explores a project and turns evidence into clear answers.",
    instructions: "Read the available project context and investigate the question carefully. Separate verified facts from assumptions, cite the files or sources you used, and summarize useful next steps. Do not change project files during research.",
  },
];

export function initialAgentForm(item = null, defaults = {}) {
  const base = item ?? defaults;
  return {
    name: base.name ?? "",
    provider: base.provider ?? "codex",
    description: base.description ?? "",
    instructions: base.instructions ?? "",
    working_directory: val(base, "working_directory") ?? "",
    role: base.role ?? "",
    provider_connection_id: val(base, "provider_connection_id") ?? "",
    model: base.model ?? "",
    reasoning_effort: val(base, "reasoning_effort") ?? "",
    memory_policy: val(base, "memory_policy") ?? "reviewed",
    context_source_ids: [...(val(base, "context_source_ids") ?? [])],
    default_area_id: val(base, "default_area_id") ?? "",
    default_project_id: val(base, "default_project_id") ?? "",
    permission_policy: val(base, "permission_policy") ?? "review",
    output_behavior: val(base, "output_behavior") ?? "",
  };
}

export function applyAgentPreset(form, preset) {
  return { ...form, name: preset.name, description: preset.description, instructions: preset.instructions };
}

export function hasAgentText(form) {
  return [form.name, form.description, form.instructions].some((value) => value.trim());
}

export function validateAgentForm(form) {
  if (!form.name.trim()) return { field: "name", message: "Give this agent a name before saving." };
  if (!EXECUTION_PROVIDERS.includes(form.provider)) return { field: "provider", message: "Choose a supported AI provider." };
  if (isBrowserAiProvider(form.provider) && !form.model.trim()) return { field: 'model', message: 'Choose an explicit chat model from your provider’s catalog.' };
  for (const [field, limit] of Object.entries(DEFINITION_LIMITS)) {
    if (typeof form[field] !== "string" || form[field].length > limit || /\0/.test(form[field])) return { field, message: `${field.replaceAll("_", " ")} must be text, at most ${limit.toLocaleString()} characters, without null characters.` };
  }
  if (form.model && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(form.model.trim())) return { field: "model", message: "Use a provider model identifier, or leave this blank for the provider default." };
  if (form.reasoning_effort && (form.provider !== "codex" || !AGENT_REASONING_OPTIONS.includes(form.reasoning_effort))) return { field: "reasoning_effort", message: "Choose a supported Codex reasoning setting, or use the provider default." };
  if (!["reviewed", "none"].includes(form.memory_policy)) return { field: "memory_policy", message: "Choose reviewed memory or no saved memory." };
  if (!["review", "read-only"].includes(form.permission_policy)) return { field: "permission_policy", message: "Choose review required or read-only." };
  const directory = form.working_directory.trim();
  if (directory && (!directory.startsWith("/") || /[\0\r\n]/.test(directory))) {
    return { field: "working_directory", message: "Use an absolute folder path, such as /Users/you/Projects/example, or leave it blank." };
  }
  return null;
}

export function agentFormPayload(form, item, workspaceId) {
  return {
    workspace_id: item ? (val(item, "workspace_id") ?? null) : workspaceId,
    name: form.name.trim(),
    provider: form.provider,
    description: form.description.trim(),
    instructions: form.instructions.trim(),
    working_directory: form.working_directory.trim() || null,
    role: form.role.trim(),
    provider_connection_id: form.provider_connection_id || null,
    model: form.model.trim(),
    reasoning_effort: form.provider === "codex" ? form.reasoning_effort : "",
    memory_policy: form.memory_policy,
    context_source_ids: [...form.context_source_ids],
    default_area_id: form.default_area_id || null,
    default_project_id: form.default_project_id || null,
    permission_policy: form.permission_policy,
    output_behavior: form.output_behavior.trim(),
    ...(item?.version ? { version: item.version } : {}),
  };
}

/** Portable definitions intentionally exclude accounts, folders, scopes and permission grants. */
export function exportAgentDefinition(agent) {
  const form = initialAgentForm(agent);
  return { format: "rumbo-agent", format_version: 1, definition: Object.fromEntries(DEFINITION_FIELDS.map(key => [key, form[key]])) };
}

export function parseAgentDefinition(text) {
  if (typeof text !== "string" || text.length > 250000) throw new Error("Choose a Rumbo agent definition smaller than 250 KB.");
  let value;
  try { value = JSON.parse(text); } catch { throw new Error("Choose a valid JSON agent definition."); }
  if (!value || value.format !== "rumbo-agent" || value.format_version !== 1 || !value.definition || Array.isArray(value.definition) || typeof value.definition !== "object") throw new Error("This file is not a supported Rumbo agent definition (version 1).");
  const safe = Object.fromEntries(DEFINITION_FIELDS.filter(key => Object.hasOwn(value.definition, key)).map(key => [key, value.definition[key]]));
  if (Object.values(safe).some(value => typeof value !== "string")) throw new Error("Agent definition fields must be text.");
  const form = initialAgentForm(null, safe);
  form.permission_policy = "read-only";
  const invalid = validateAgentForm(form);
  if (invalid) throw new Error(invalid.message);
  return form;
}

export function duplicateAgentDefinition(agent) {
  const definition = parseAgentDefinition(JSON.stringify(exportAgentDefinition(agent)));
  return { ...definition, name: `${definition.name.slice(0, 195)} copy` };
}

export function agentDefaultChoices(data, workspaceId, areaId = "") {
  const available = items => (items ?? []).filter(item => val(item, "workspace_id") === workspaceId && !val(item, "archived_at"));
  return {
    areas: available(data.teams),
    projects: available(data.projects).filter(project => !areaId || val(project, "team_id") === areaId),
    packs: available(data.workspace_items).filter(item => item.kind === "context_pack"),
  };
}

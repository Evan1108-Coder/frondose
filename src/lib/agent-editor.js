import { val } from "./model.js";

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
  if (!["codex", "claude"].includes(form.provider)) return { field: "provider", message: "Choose Codex or Claude. Other providers are not supported in this release." };
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
  };
}

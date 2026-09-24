import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_PRESETS, agentFormPayload, applyAgentPreset, hasAgentText, initialAgentForm, validateAgentForm } from "../src/lib/agent-editor.js";

test("new agent profile starts blank without silently applying a purpose", () => {
  assert.deepEqual(initialAgentForm(), { name: "", provider: "codex", description: "", instructions: "", working_directory: "", role: "", provider_connection_id: "", model: "", reasoning_effort: "", memory_policy: "reviewed", context_source_ids: [], default_area_id: "", default_project_id: "", permission_policy: "review", output_behavior: "" });
});

test("agent editor preserves camel-case folder values and explicit duplication defaults", () => {
  const form = initialAgentForm(null, { name: "Reviewer copy", provider: "claude", description: "Careful reviews", workingDirectory: "/tmp/project", status: "paused", id: "old" });
  assert.equal(form.working_directory, "/tmp/project");
  assert.equal(form.name, "Reviewer copy");
  assert.equal(form.provider, "claude");
  assert.equal(form.description, "Careful reviews");
  assert.equal(form.id, undefined);
  assert.equal(form.status, undefined);
});

test("applying a purpose changes only its three text fields", () => {
  const before = initialAgentForm(null, { name: "Custom", provider: "claude", working_directory: "/tmp/project" });
  const next = applyAgentPreset(before, AGENT_PRESETS[1]);
  assert.equal(next.name, "Code reviewer");
  assert.equal(next.provider, "claude");
  assert.equal(next.working_directory, "/tmp/project");
  assert.equal(before.name, "Custom");
});

test("existing purpose text requires replacement confirmation even if only one field is set", () => {
  assert.equal(hasAgentText(initialAgentForm()), false);
  assert.equal(hasAgentText(initialAgentForm(null, { instructions: "  Keep it small.  " })), true);
  assert.equal(hasAgentText(initialAgentForm(null, { name: "   " })), false);
});

test("agent form validates names, supported providers and absolute folders", () => {
  assert.equal(validateAgentForm(initialAgentForm())?.field, "name");
  const form = initialAgentForm(null, { name: "Reviewer" });
  assert.equal(validateAgentForm(form), null);
  assert.equal(validateAgentForm({ ...form, name: "  " })?.field, "name");
  assert.equal(validateAgentForm({ ...form, provider: "custom" })?.field, "provider");
  for (const working_directory of ["~/project", "relative/path", "/tmp/project\nother", "/tmp/\0"]) {
    assert.equal(validateAgentForm({ ...form, working_directory })?.field, "working_directory");
  }
  assert.equal(validateAgentForm({ ...form, working_directory: " /Users/you/Projects/example " }), null);
});

test("editing a shared agent preserves global scope and leaves operational fields alone", () => {
  const payload = agentFormPayload(initialAgentForm(null, { name: " Reviewer ", description: " Notes ", instructions: " Check tests " }), { id: "shared", workspace_id: null, status: "paused", model: "custom" }, "ws_current");
  assert.equal(payload.workspace_id, null);
  assert.equal(payload.name, "Reviewer");
  assert.equal(payload.description, "Notes");
  assert.equal(payload.instructions, "Check tests");
  assert.equal(payload.working_directory, null);
  assert.equal(payload.status, undefined);
  assert.equal(payload.model, "");
  assert.equal(payload.provider_connection_id, null);
});

test("new agents use current workspace and existing agents retain their own workspace", () => {
  const form = initialAgentForm(null, { name: "Researcher" });
  assert.equal(agentFormPayload(form, null, "ws_current").workspace_id, "ws_current");
  assert.equal(agentFormPayload(form, { workspaceId: "ws_original" }, "ws_current").workspace_id, "ws_original");
});

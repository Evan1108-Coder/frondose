import { useEffect, useRef, useState } from "react";
import { Form } from "./Form.jsx";
import { Plus, Check } from "./icons.jsx";
import { frondoseActions } from "../data/useFrondose.js";
import { DateField } from "./DateField.jsx";
import { ImageField } from './ImageField.jsx';
import { validateProjectDates } from "../lib/workspace-spaces.js";
import { WorkflowSelect, LabelPicker } from './WorkProperties.jsx';
import { initialConversationAgent, conversationAgentFields } from '../lib/conversation-editor.js';
import {
  Button,
  Dialog,
  ErrorMessage,
  Field,
  Select,
  useApp,
  useAsync,
} from "../ui.jsx";
import {
  PRIORITIES,
  PROJECT_STATUSES,
  STATUSES,
  val,
  visible,
} from "../lib/model.js";

const labels = {
  workspace: "workspace",
  project: "project",
  task: "route",
  chat: "chat",
  agent: "agent",
  memory: "memory note",
};
const actions = {
  workspace: "Workspace",
  project: "Project",
  task: "Task",
  chat: "Chat",
  agent: "Agent",
  memory: "MemoryNote",
};
export function EntityDialog({ kind, item, defaults = {}, onClose }) {
  const { data, workspace, navigate, notify, setWorkspace, page } = useApp();
  const base = item ?? defaults;
  const defaultScope = { workspace: ['workspace', 'New workspace'], project: ['project', 'New project'], task: ['route', 'New Route'], chat: ['chat', 'New conversation'], agent: ['agent', 'New agent'], memory: ['memory', 'New memory note'] }[kind];
  const defaultField = (name, label) => defaultScope ? { 'data-field-default-key': `${defaultScope[0]}.new.${name}`, 'data-field-default-page': defaultScope[1], 'data-field-default-label': label, 'data-field-default-mode': item ? 'edit' : 'create' } : {};
  const [form, setForm] = useState({
    title: base.title ?? base.name ?? "",
    image_url: base.image_url ?? null,
    description: base.description ?? "",
    project_id: val(base, "project_id") ?? "",
    team_id: val(base, "team_id") ?? "",
    start_date: base.start_date ?? "",
    target_date: base.target_date ?? "",
    lead: base.lead ?? "",
    task_id: val(base, "task_id") ?? "",
    status: base.status ?? (kind === "project" ? "planned" : "backlog"),
    workflow_status_id: base.workflow_status_id ?? null,
    labels: base.labels ?? [],
    priority: base.priority ?? "medium",
    goal: base.goal ?? "",
    local_path: val(base, "local_path") ?? "",
    github_url: val(base, "github_url") ?? "",
    due_at: val(base, "due_at")?.slice(0, 10) ?? "",
    assignee_agent_ids: val(base, "assignee_agent_ids") ?? [],
    responding_agent_id: initialConversationAgent(base, Boolean(item)),
    provider: base.provider ?? "codex",
    instructions: base.instructions ?? "",
    working_directory: base.working_directory ?? "",
    content: base.content ?? "",
    kind: base.kind ?? "general",
  });
  const initial = useRef(form);
  const [discarding, setDiscarding] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const [createMore, setCreateMore] = useState(false);
  const titleRef = useRef(null);
  const keepRef = useRef(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial.current);
  useEffect(() => { if (discarding) keepRef.current?.focus(); }, [discarding]);
  const { busy, error, execute } = useAsync();
  const change = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));
  const projects = visible(data.projects);
  const teams = visible(data.teams);
  const linkedProject = projects.find((project) => project.id === form.project_id);
  const boundConversationAgent = kind === 'chat' ? val(item, 'responding_agent_id') : null;
  const conversationAgents = visible(data.agents).filter(agent => !val(agent, 'workspace_id') || val(agent, 'workspace_id') === workspace?.id);
  const selectedConversationAgent = data.agents.find(agent => agent.id === form.responding_agent_id);
  const unavailableConversationAgent = form.responding_agent_id && !conversationAgents.some(agent => agent.id === form.responding_agent_id);
  function requestClose() {
    if (busy) return;
    if (discarding) setDiscarding(false);
    else if (dirty) setDiscarding(true);
    else onClose();
  }
  const tasks = visible(data.tasks).filter(
    (task) => !form.project_id || val(task, "project_id") === form.project_id,
  );
  async function submit(event) {
    event.preventDefault();
    await execute(async () => {
      if (!form.title.trim()) throw new Error("Please enter a name or title.");
      if (kind === "project") {
        const invalidDates = validateProjectDates(form.start_date, form.target_date);
        if (invalidDates) throw new Error(invalidDates);
      }
      const common = { workspace_id: workspace?.id };
      let input;
      if (kind === "workspace")
        input = { name: form.title.trim(), description: form.description, image_url: form.image_url };
      if (kind === "project")
        input = {
          ...common,
          name: form.title.trim(),
          image_url: form.image_url,
          description: form.description,
          status: form.status,
          workflow_status_id: form.workflow_status_id,
          labels: form.labels,
          goal: form.goal,
          local_path: form.local_path.trim() || null,
          github_url: form.github_url.trim() || null,
          team_id: form.team_id || null,
          start_date: form.start_date || null,
          target_date: form.target_date || null,
          lead: form.lead.trim(),
        };
      if (kind === "task")
        input = {
          ...common,
          title: form.title.trim(),
          description: form.description,
          project_id: form.project_id || null,
          team_id: linkedProject ? linkedProject.team_id ?? null : form.team_id || null,
          status: form.status,
          workflow_status_id: form.workflow_status_id,
          labels: form.labels,
          priority: form.priority,
          due_at: form.due_at
            ? new Date(`${form.due_at}T12:00:00`).toISOString()
            : null,
          assignee_agent_ids: form.assignee_agent_ids,
        };
      if (kind === "chat")
        input = {
          ...common,
          title: form.title.trim(),
          project_id: form.project_id || null,
          task_id: form.task_id || null,
          kind: item?.kind || (form.task_id ? "task" : form.project_id ? "project" : "general"),
          ...conversationAgentFields({ item, agentId: form.responding_agent_id, agents: data.agents, workspaceId: workspace?.id }),
        };
      if (kind === "agent")
        input = {
          workspace_id: item
            ? (val(item, "workspace_id") ?? null)
            : workspace?.id,
          name: form.title.trim(),
          provider: form.provider,
          instructions: form.instructions,
          working_directory: form.working_directory.trim() || null,
        };
      if (kind === "memory")
        input = {
          ...common,
          title: form.title.trim(),
          content: form.content,
          project_id: form.project_id || null,
        };
      const result = item
        ? await frondoseActions[`update${actions[kind]}`](item.id, input)
        : await frondoseActions[`create${actions[kind]}`](input);
      notify(
        `${labels[kind][0].toUpperCase()}${labels[kind].slice(1)} ${item ? "saved" : "created"}`,
      );
      if (!item && kind === 'task' && createMore) {
        const next = { ...form, title: '', description: '' };
        initial.current = next;
        setForm(next);
        requestAnimationFrame(() => titleRef.current?.focus());
        return;
      }
      onClose();
      if (!item && result?.id) {
        if (kind === "workspace") setWorkspace(result.id);
        else if (["project", "task", "chat"].includes(kind))
          navigate(
            { project: "projects", task: "tasks", chat: "chats" }[kind],
            result.id,
            { projectId: kind === "project" ? null : input.project_id },
          );
      } else if (item && ["task", "chat"].includes(kind) && page.id === item.id) {
        navigate(kind === "task" ? "tasks" : "chats", item.id, { projectId: input.project_id });
      }
    });
  }
  return (
    <Dialog
      editor={!discarding}
      closeDisabled={busy}
      className={`writing-editor writing-editor-${kind}`}
      title={discarding ? "Discard your changes?" : `${item ? "Edit" : "New"} ${labels[kind]}`}
      subtitle={
        kind === "workspace"
          ? "A separate space for an Area, business, or personal work."
          : workspace?.name
      }
      onClose={requestClose}
    >
      {discarding ? <div className="space-discard"><p>Your changes have not been saved. You can keep editing or close without saving.</p><div className="space-editor-actions"><Button onClick={onClose}>Discard changes</Button><Button ref={keepRef} variant="primary" onClick={() => setDiscarding(false)}>Keep editing</Button></div></div> :
      <Form onSubmit={submit} className="entity-form writing-form">
        <div className="form-fields">
          <Field
            label={
              ["workspace", "project", "agent"].includes(kind)
                ? "Name"
                : "Title"
            }
          >
            <input
              {...defaultField(kind === 'project' || kind === 'workspace' || kind === 'agent' ? 'name' : 'title', ['workspace', 'project', 'agent'].includes(kind) ? 'Name' : 'Title')}
              autoFocus
              ref={titleRef}
              required
              maxLength={200}
              value={form.title}
              onChange={(e) => change("title", e.target.value)}
              placeholder={
                {
                  workspace: "e.g. Northstar studio",
                  project: "What are you building?",
                  task: "What needs to happen?",
                  chat: "Name this conversation",
                  agent: "e.g. Code reviewer",
                  memory: "What should your agents remember?",
                }[kind]
              }
            />
          </Field>
          {["workspace", "project", "task"].includes(kind) ? (
            <Field label="Description">
              <textarea
                {...defaultField('description', 'Description')}
                rows={3}
                value={form.description}
                onChange={(e) => change("description", e.target.value)}
                placeholder="Add details, goals, or acceptance criteria…"
              />
            </Field>
          ) : null}
          {["task", "chat", "memory"].includes(kind) && (kind !== 'task' || advancedOpen) ? (
            <Select
              label="Project"
              value={form.project_id}
              disabled={kind === 'chat' && Boolean(item)}
              onChange={(value) => {
                change("project_id", value);
                change("task_id", "");
                if (kind === "task") change("team_id", projects.find((project) => project.id === value)?.team_id ?? "");
              }}
            >
              <option value="">Workspace only</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          ) : null}
          {kind === 'task' && defaults.guided ? <div className="guided-route-note"><p>Start with a title and a short description of the outcome. Saving the Route does not start an agent.</p><button type="button" onClick={() => setAdvancedOpen(open => !open)} aria-expanded={advancedOpen}>{advancedOpen ? 'Hide optional settings' : 'Show project, Area, priority, and other settings'}</button></div> : null}
          {kind === "workspace" ? <ImageField label="Workspace picture" value={form.image_url} onChange={value => change('image_url', value)} disabled={busy} /> : null}
          {kind === "project" ? (
            <>
              <WorkflowSelect kind="project" item={form} onChange={patch => setForm(current => ({ ...current, ...patch }))} />
              <LabelPicker compact kind="project" value={form.labels} onChange={labels => change('labels', labels)} />
              <div className="form-grid">
                <Select label="Area" value={form.team_id} onChange={(value) => change("team_id", value)}><option value="">No Area</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</Select>
                <Field label="Project lead"><input {...defaultField('lead', 'Project lead')} value={form.lead} maxLength={200} onChange={(event) => change("lead", event.target.value)} placeholder="Name of the project lead" /></Field>
              </div>
              <div className="form-grid">
                <Field label="Start date"><DateField {...defaultField('start-date', 'Start date')} data-field-default-allow="true" value={form.start_date} onChange={(value) => change("start_date", value)} /></Field>
                <Field label="Target date"><DateField {...defaultField('target-date', 'Target date')} data-field-default-allow="true" value={form.target_date} onChange={(value) => change("target_date", value)} /></Field>
              </div>
              <details className="editor-details"><summary>Project details & picture</summary><div className="editor-detail-fields">
              <ImageField value={form.image_url} onChange={value => change('image_url', value)} disabled={busy} />
              <Field label="Project brief" hint="The goal and success criteria. Markdown headings and lists are supported.">
                <textarea
                  {...defaultField('brief', 'Project brief')}
                  rows={5}
                  value={form.goal}
                  onChange={(e) => change("goal", e.target.value)}
                  placeholder="What does success look like?"
                />
              </Field>
              <Field
                label="Working folder"
                hint="Absolute path to the project folder on this computer. Used when you start a live session."
              >
                <input
                  {...defaultField('folder', 'Working folder')}
                  value={form.local_path}
                  onChange={(e) => change("local_path", e.target.value)}
                  placeholder="/Users/you/Projects/my-project"
                />
              </Field>
              <Field label="GitHub repository">
                <input
                  {...defaultField('github', 'GitHub repository')}
                  type="url"
                  value={form.github_url}
                  onChange={(e) => change("github_url", e.target.value)}
                  placeholder="https://github.com/owner/repo"
                />
              </Field>
              </div></details>
            </>
          ) : null}
          {kind === "task" && advancedOpen ? (
            <>
              <Select label="Area" value={linkedProject ? linkedProject.team_id ?? "" : form.team_id} disabled={Boolean(linkedProject)} onChange={(value) => change("team_id", value)}><option value="">No Area</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</Select>
              <div className="form-grid">
                <WorkflowSelect item={form} onChange={patch => setForm(current => ({ ...current, ...patch }))} />
                <Select
                  label="Priority"
                  value={form.priority}
                  onChange={(value) => change("priority", value)}
                >
                  {Object.entries(PRIORITIES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="form-grid">
                <LabelPicker compact value={form.labels} onChange={labels => change('labels', labels)} />
                <Field label="Due date">
                  <DateField
                    {...defaultField('due-date', 'Due date')}
                    data-field-default-allow="true"
                    value={form.due_at}
                    onChange={(value) => change("due_at", value)}
                  />
                </Field>
                <Select
                  label="Assigned agent"
                  value={form.assignee_agent_ids[0] ?? ""}
                  onChange={(value) =>
                    change("assignee_agent_ids", value ? [value] : [])
                  }
                >
                  <option value="">Unassigned</option>
                  {visible(data.agents).map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          ) : null}
          {kind === "chat" ? (
            <>
              <Select
                label="Linked route"
                value={form.task_id}
                disabled={Boolean(item)}
                onChange={(value) => {
                  change("task_id", value);
                  const task = tasks.find((item) => item.id === value);
                  if (task) change("project_id", val(task, "project_id") ?? "");
                }}
              >
                <option value="">No route</option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </Select>
              <Select
                label="Responding agent"
                value={form.responding_agent_id}
                required={!item}
                disabled={busy || Boolean(boundConversationAgent)}
                onChange={value => change('responding_agent_id', value)}
              >
                {!boundConversationAgent ? <option value="">{item ? 'No future agent selected' : 'Choose one agent…'}</option> : null}
                {unavailableConversationAgent ? <option value={form.responding_agent_id} disabled>{selectedConversationAgent?.name || 'Saved agent'} · unavailable</option> : null}
                {conversationAgents.filter(agent => !boundConversationAgent || agent.id === boundConversationAgent).map(agent => <option key={agent.id} value={agent.id} disabled={agent.status === 'paused'}>{agent.name}{agent.status === 'paused' ? ' · paused' : ''}</option>)}
              </Select>
            </>
          ) : null}
          {kind === "agent" ? (
            <>
              <Select
                label="Provider"
                value={form.provider}
                onChange={(value) => change("provider", value)}
              >
                <option value="codex">Codex</option>
                <option value="claude">Claude</option>
              </Select>
              <Field
                label="Instructions"
                hint="These instructions travel with this agent when a session starts."
              >
                <textarea
                  {...defaultField('instructions', 'Instructions')}
                  rows={5}
                  value={form.instructions}
                  onChange={(e) => change("instructions", e.target.value)}
                  placeholder="How should this agent approach its work?"
                />
              </Field>
              <Field
                label="Default working folder"
                hint="Optional. The linked project folder takes precedence."
              >
                <input
                  {...defaultField('folder', 'Default working folder')}
                  value={form.working_directory}
                  onChange={(e) => change("working_directory", e.target.value)}
                  placeholder="/Users/you/Projects"
                />
              </Field>
              <p className="form-note">
                Connect {form.provider === "codex" ? "Codex" : "Claude"} in
                Connections before starting live work. You can try the session
                workflow in simulation mode first.
              </p>
            </>
          ) : null}
          {kind === "memory" ? (
            <Field
              label="Content"
              hint="Saved notes can be included in a session’s context."
            >
              <textarea
                {...defaultField('content', 'Content')}
                required
                rows={8}
                value={form.content}
                onChange={(e) => change("content", e.target.value)}
                placeholder="Decisions, conventions, or important project context…"
              />
            </Field>
          ) : null}
          <ErrorMessage error={error} />
        </div>
        <footer className="dialog-footer">
          {!item && kind === 'task' ? <label className="editor-create-more"><input type="checkbox" checked={createMore} disabled={busy} onChange={event => setCreateMore(event.target.checked)} />Create more</label> : null}
          <Button disabled={busy} onClick={requestClose}>Cancel</Button>
          <Button
            type="submit"
            variant="primary"
            icon={item ? Check : Plus}
            busy={busy}
            disabled={!form.title.trim() || kind === 'chat' && !item && !form.responding_agent_id}
          >
            {item ? "Save changes" : `Create ${labels[kind]}`}
          </Button>
        </footer>
      </Form>
      }
    </Dialog>
  );
}

// Semantic legacy keys remain compatible. The Vite source analyzer adds all
// other input sites before any page/dialog has been visited.
import { RESOURCE_TYPES } from './settings-catalog.js';
import { SOURCE_FIELD_DEFINITIONS } from './field-source-inventory.js';

const RESOURCE_FIELD_DEFINITIONS = Object.entries(RESOURCE_TYPES).flatMap(([kind, spec]) => {
  const page = `New ${spec.singular} · ${spec.title}`;
  return [
    { key: `resource.${kind}.new.name`, page, label: 'Name', type: 'text' },
    ...Object.entries(spec.fields)
      .filter(([, field]) => ['text', 'textarea'].includes(field.type))
      .map(([key, field]) => ({ key: `resource.${kind}.new.${key}`, page, label: field.label, type: field.type })),
  ];
});

const LEGACY_FIELD_DEFINITIONS = [
  { key: 'workspace.new.name', page: 'New workspace', label: 'Name', type: 'text' },
  { key: 'workspace.new.description', page: 'New workspace', label: 'Description', type: 'textarea' },
  { key: 'project.new.name', page: 'New project', label: 'Name', type: 'text' },
  { key: 'project.new.description', page: 'New project', label: 'Description', type: 'textarea' },
  { key: 'project.new.brief', page: 'New project', label: 'Project brief', type: 'textarea' },
  { key: 'project.new.lead', page: 'New project', label: 'Project lead', type: 'text' },
  { key: 'project.new.folder', page: 'New project', label: 'Working folder', type: 'text' },
  { key: 'project.new.github', page: 'New project', label: 'GitHub repository', type: 'url' },
  { key: 'project.new.start-date', page: 'New project', label: 'Start date', type: 'date' },
  { key: 'project.new.target-date', page: 'New project', label: 'Target date', type: 'date' },
  { key: 'route.new.title', page: 'New Route', label: 'Title', type: 'text' },
  { key: 'route.new.description', page: 'New Route', label: 'Description', type: 'textarea' },
  { key: 'route.new.due-date', page: 'New Route', label: 'Due date', type: 'date' },
  { key: 'chat.new.title', page: 'New conversation', label: 'Title', type: 'text' },
  { key: 'agent.new.name', page: 'New agent', label: 'Name', type: 'text' },
  { key: 'agent.new.description', page: 'New agent', label: 'Description', type: 'text' },
  { key: 'agent.new.role', page: 'New agent', label: 'Role', type: 'text' },
  { key: 'agent.new.instructions', page: 'New agent', label: 'Instructions', type: 'textarea' },
  { key: 'agent.new.folder', page: 'New agent', label: 'Default working folder', type: 'text' },
  { key: 'agent.new.model', page: 'New agent', label: 'Model identifier', type: 'text' },
  { key: 'agent.new.output-behavior', page: 'New agent', label: 'Expected output behavior', type: 'textarea' },
  { key: 'memory.new.title', page: 'New memory note', label: 'Title', type: 'text' },
  { key: 'memory.new.content', page: 'New memory note', label: 'Content', type: 'textarea' },
  { key: 'session.new.prompt', page: 'Start a session', label: 'What should the agent do?', type: 'textarea' },
  { key: 'conversation.compose.message', page: 'Conversation composer', label: 'Message', type: 'textarea' },
  { key: 'rumbo-agent.new.request', page: 'Talvori new conversation', label: 'Request', type: 'textarea' },
  { key: 'rumbo-agent.entry.request', page: 'Ask Talvori', label: 'What would you like help with?', type: 'textarea' },
  { key: 'update.new.title', page: 'New update', label: 'Update title', type: 'text' },
  { key: 'update.new.content', page: 'New update', label: 'Update', type: 'textarea' },
  { key: 'update.reply.content', page: 'Update reply', label: 'Reply', type: 'textarea' },
  { key: 'output.new.title', page: 'New output', label: 'Output title', type: 'text' },
  { key: 'output.new.reviewer', page: 'New output', label: 'Assigned reviewer', type: 'text' },
  { key: 'output.new.content', page: 'New output', label: 'Content', type: 'textarea' },
  { key: 'output.new.summary', page: 'New output', label: 'What changed?', type: 'textarea' },
  { key: 'context.new.name', page: 'Capture context', label: 'Snapshot name', type: 'text' },
  { key: 'context.new.additional', page: 'Capture context', label: 'Additional context', type: 'textarea' },
  { key: 'knowledge.new.title', page: 'New knowledge', label: 'Title', type: 'text' },
  { key: 'knowledge.new.content', page: 'New knowledge', label: 'Content', type: 'textarea' },
  { key: 'knowledge.new.source', page: 'New knowledge', label: 'Source or rationale', type: 'textarea' },
  { key: 'knowledge.new.review-date', page: 'New knowledge', label: 'Review again on', type: 'date' },
  { key: 'area-resource.new.name', page: 'Add Area resource', label: 'Name', type: 'text' },
  { key: 'area-resource.new.description', page: 'Add Area resource', label: 'Description', type: 'textarea' },
  { key: 'route.split.titles', page: 'Split Route', label: 'New route titles', type: 'textarea' },
  { key: 'route.duplicate.title', page: 'Duplicate Route', label: 'New route title', type: 'text' },
  { key: 'route.repeat.name', page: 'Repeat Route', label: 'Repeating route name', type: 'text' },
  { key: 'route.repeat.interval', page: 'Repeat Route', label: 'Repeat every (days)', type: 'number' },
  { key: 'route.repeat.first-date', page: 'Repeat Route', label: 'First occurrence (UTC date)', type: 'date' },
  { key: 'area.new.name', page: 'New Area', label: 'Name', type: 'text' },
  { key: 'area.new.description', page: 'New Area', label: 'Description', type: 'textarea' },
  { key: 'document.new.title', page: 'New document', label: 'Title', type: 'text' },
  { key: 'document.new.content', page: 'New document', label: 'Content', type: 'textarea' },
  { key: 'milestone.new.title', page: 'New milestone', label: 'Title', type: 'text' },
  { key: 'milestone.new.description', page: 'New milestone', label: 'Description', type: 'textarea' },
  { key: 'milestone.new.target-date', page: 'New milestone', label: 'Target date', type: 'date' },
  { key: 'skill.new.name', page: 'New Skill', label: 'Name', type: 'text' },
  { key: 'skill.new.purpose', page: 'New Skill', label: 'Purpose', type: 'textarea' },
  { key: 'skill.new.instructions', page: 'New Skill', label: 'Versioned instructions', type: 'textarea' },
  { key: 'skill.new.capabilities', page: 'New Skill', label: 'Required capabilities', type: 'textarea' },
  { key: 'skill.new.output-format', page: 'New Skill', label: 'Expected output format', type: 'textarea' },
  { key: 'skill-from-run.new.name', page: 'New Skill from run', label: 'Skill name', type: 'text' },
  { key: 'skill-from-run.new.purpose', page: 'New Skill from run', label: 'Reusable purpose', type: 'textarea' },
  { key: 'skill-from-run.new.instructions', page: 'New Skill from run', label: 'Reusable instructions', type: 'textarea' },
  ...RESOURCE_FIELD_DEFINITIONS,
];

export const STATIC_FIELD_DEFINITIONS = Object.freeze([...new Map([
  ...SOURCE_FIELD_DEFINITIONS, ...LEGACY_FIELD_DEFINITIONS,
].map(definition => [definition.key, definition])).values()]);

export function fieldDefinitionsForWorkspace(data) {
  const custom = (data?.workspace_items ?? [])
    .filter(item => !item.archived_at && ['route_template', 'project_template', 'chat_template'].includes(item.kind))
    .flatMap(item => (Array.isArray(item.payload?.fields) ? item.payload.fields : []).filter(field => ['text', 'textarea'].includes(field.type)).map(field => ({
      key: `template.${item.id}.${field.id}`,
      page: `${item.name} template`,
      label: field.label,
      type: field.type,
    })));
  return [...STATIC_FIELD_DEFINITIONS, ...custom];
}

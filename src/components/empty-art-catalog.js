// Every kind resolves to an individually generated photographic asset in
// public/empty-art. Aliases preserve older navigation and settings callers.
export const emptyArtKinds = Object.freeze([
  'overview', 'focus', 'documents', 'library', 'workbench', 'operations',
  'resources', 'connections', 'route_label', 'project_label', 'route_status',
  'project_status', 'route_template', 'project_template', 'chat_template',
  'collection', 'preset', 'context_pack', 'queue', 'handoff', 'automation',
  'saved_view', 'request', 'goal', 'review', 'update', 'emoji', 'preferences',
  'profile', 'appearance', 'notifications', 'code', 'security', 'accounts',
  'personalization', 'permissions', 'members', 'applications', 'api',
  'billing', 'usage', 'storage', 'audit', 'repeating', 'timeline',
  'strategy', 'milestones', 'teams', 'routes', 'projects', 'chats', 'memory',
  'work', 'inbox', 'agents', 'archive', 'search',
]);

export const emptyArtAliases = Object.freeze({
  home: 'overview', 'home-attention': 'focus', tasks: 'routes',
  workspaces: 'overview', workspace: 'overview', views: 'saved_view',
  outputs: 'review', knowledge: 'memory', templates: 'route_template',
  context: 'context_pack', collections: 'collection', presets: 'preset',
  handoffs: 'handoff', automations: 'automation', requests: 'request',
  goals: 'goal', reviews: 'review', updates: 'update', emojis: 'emoji',
  'route-labels': 'route_label', 'project-labels': 'project_label',
  'route-templates': 'route_template', 'project-templates': 'project_template',
  'route-workflow': 'route_status', 'project-statuses': 'project_status',
  'code-reviews': 'code',
  integrations: 'connections', coordination: 'operations',
  'output-policy': 'review', retention: 'archive',
});

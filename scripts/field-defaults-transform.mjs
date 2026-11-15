// One analyzer powers both the pre-discovered catalog and JSX instrumentation.
// Identities contain semantic source expressions, never line numbers, DOM IDs,
// or the position of a field/row in a list.
import { parse } from '@babel/parser';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fieldHintMetadata, normalizeFieldDefinition } from '../src/lib/field-defaults.js';

const CONTROL_NAMES = new Set(['input', 'textarea', 'DateField', 'SearchField']);
const OMIT_FILES = /(?:^|\/)(?:FieldDefaultsProvider|FieldDefaultsSettings|DateField|SelectField|Playbooks|TabApps|DesktopApplications)\.jsx$/;
const SENSITIVE_FORM = /password|passcode|credential|api.?key|private.?key|secret|authentication|sign.?in|sign.?up|payment|billing|credit.?card|cc[-_]|one.?time.?code|(?:pairing|recovery|verification|connection)[._ -]?code|security/i;
const slug = value => value.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'field';
const words = value => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 12);
// Product-facing labels change; semantic IDs must still find existing defaults.
const legacyFieldIdentity = value => value.replaceAll('Frondose', 'Rumbo').replaceAll('frondose', 'rumbo').replaceAll('Talvori', 'Rumbo').replaceAll('talvori', 'rumbo');
const LEGACY_REBRAND_KEYS = Object.freeze({
  // Explicit accessible labels must not discard saved personal-agent defaults.
  'source.views-settings-rumbo-agent-prefe.rumbo-agent-preferences.agent-name.dd98317cae38': 'source.views-settings-rumbo-agent-prefe.rumbo-agent-preferences.agent-name.b83e499d6b30',
  'source.views-settings-rumbo-agent-prefe.rumbo-agent-preferences.guidelines.3894eaf704b9': 'source.views-settings-rumbo-agent-prefe.rumbo-agent-preferences.guidelines.4f5700e8f77b',
  'source.views-settings-rumbo-agent-prefe.rumbo-agent-preferences.purpose.d23c92cfca14': 'source.views-settings-rumbo-agent-prefe.rumbo-agent-preferences.purpose.32b086b6238c',
  'source.views-rumbo-agent.agent-onboarding.rumbo.802a60c75c6a': 'source.views-rumbo-agent.agent-onboarding.rumbo-agent.5b3e6a176e8e',
  'source.views-rumbo-agent.history-dialog.search-conversations.f1eeab9bdd0c': 'source.views-rumbo-agent.history-dialog.search-conversations.842435947877',
});

// Shared primitives/editor functions have no page heading in their own AST.
// These are product-facing scopes, not identities; changing the wording does
// not invalidate any saved field key.
const SHARED_PRODUCT_SCOPES = {
  ActivityComposer: 'Updates · New update / Reply / Edit update',
  ActivityFeed: 'Updates · Feed search',
  AreaSettingsForm: 'Area settings · Instructions',
  ChangeReview: 'Code & reviews · Changed files and review notes',
  ColorChoice: 'Appearance & navigation · Colors',
  TabColorsSettings: 'Appearance & navigation · Icons & name colors',
  ScheduleTimeFields: 'Scheduled messages & actions · Schedule message / Change scheduled time',
  WorkbenchDialog: 'Workbench commands & terminals',
  ProjectWorkbench: 'Workbench · Commands & terminals',
  TemplateFieldsEditor: 'Route, Project & Chat templates · Custom template questions',
  TemplateAnswers: 'Use Route, Project or Chat template · Custom questions',
  'Resource Page:ResourceEditor': 'Settings resources · New / Edit item',
  ResourceAction: 'Settings resources · Use template',
  ResourcePage: 'Settings · Labels, templates, collections & saved views',
  StrategyEditor: 'Project direction · Audience, scope, success criteria & risks',
  GitHubCodeBrowser: 'GitHub · Repository code / Compare revisions',
  ConflictDetail: 'Knowledge · Review conflict',
  ConflictReport: 'Knowledge · Report conflict',
  ReviewWorkspace: 'Workbench · Code review / Compare revisions',
  TypedInputs: 'Workflows · Run inputs',
  WorkflowConditionValue: 'Workflows · Step condition',
  WorkflowHandoffEditor: 'Workflows · Step handoff',
  WorkspaceEditor: 'Areas, documents, milestones & contacts · New / Edit',
  EntityDialog: 'Workspaces, Projects & Routes · New / Edit',
  ReactionPicker: 'Icons & emojis · Reaction picker',
  DirectoryPage: 'Settings · Areas, Contacts, Documents & Agent profiles',
  GovernanceSettings: 'People & permissions · Search members, roles & audit history',
  SettingsCenter: 'Settings navigation',
  ConnectionContent: 'Plugins · Connection resources',
  ActionDialog: 'Plugins · Review connection action',
  MilestoneCriteriaEditor: 'Project milestones · Acceptance criteria',
  SkillEvaluationPrepare: 'Skill evaluations · Evaluate Skill',
  AgentOnboarding: 'Frondose setup · Make it yours',
  CommandLibrary: 'Slash commands · Command library',
  HierarchyDialog: 'Routes · Create sub-route / Move Route',
  UpdateWorkChanges: 'Updates · Report work changes',
  CaptureCheckpoint: 'Workbench · Capture checkpoint',
  CheckpointDetail: 'Workbench · Checkpoint details / Recorded paths',
  DocumentsPanel: 'Projects & Areas · Documents',
  FilesPanel: 'Workbench · Files',
  PeoplePanel: 'Areas · Contacts',
  TeamHub: 'Areas · Routes',
  TeamResources: 'Areas · Resources',
  'Team Resources:ResourceEditor': 'Area resources · New / Edit resource',
  ProjectHub: 'Projects · Routes',
  OutputDetail: 'Outputs · Version comments',
  Plans: 'Plans & work · Complete step / Handoff',
  DefinitionEditor: 'Workflows · Step definitions',
  WorkflowRunStep: 'Workflows · Run step decision',
  WorkflowMemoryDialog: 'Workflows · Keep approved knowledge',
};

function cleanDisplay(text) {
  return String(text || '').replace(/\s+/g, ' ').replace(/\s+([,.:;?!])/g, '$1').trim().replace(/[·:/—-]\s*$/, '').trim()
    .replace(/^Test (name|inputs|expected result)/i, 'Test case $1')
    .replace(/^Input (name|description|options)/i, 'Typed input $1');
}

function displayExpression(node, bindings = new Map(), seen = new Set()) {
  if (!node) return '';
  if (node.type === 'JSXExpressionContainer') return displayExpression(node.expression, bindings, seen);
  if (node.type === 'StringLiteral') return cleanDisplay(node.value);
  if (node.type === 'TemplateLiteral') return cleanDisplay(node.quasis.map(part => part.value.cooked || '').join(' '));
  if (node.type === 'ConditionalExpression') {
    if (node.test.type === 'Identifier' && /discard|confirm|archiv/i.test(node.test.name)) return displayExpression(node.alternate, bindings, seen);
    return [...new Set([displayExpression(node.consequent, bindings, seen), displayExpression(node.alternate, bindings, seen)].filter(Boolean))].join(' / ');
  }
  if (node.type === 'Identifier' && bindings.has(node.name) && !seen.has(node.name)) return displayExpression(bindings.get(node.name), bindings, new Set([...seen, node.name]));
  if (node.type === 'MemberExpression' && node.object.type === 'ObjectExpression') return [...new Set(node.object.properties.map(property => displayExpression(property.value, bindings, seen)).filter(Boolean))].join(' / ');
  if (node.type === 'LogicalExpression') return displayExpression(node.left, bindings, seen) || displayExpression(node.right, bindings, seen);
  return '';
}

function displayAttribute(node, name, bindings) { return displayExpression(attr(node, name)?.value, bindings); }
function displayChildren(node, bindings) {
  if (!node) return '';
  if (node.type === 'JSXText') return cleanDisplay(node.value);
  if (node.type === 'JSXExpressionContainer') return displayExpression(node, bindings);
  if (node.type !== 'JSXElement' && node.type !== 'JSXFragment') return '';
  if (CONTROL_NAMES.has(node.openingElement?.name?.name) || ['small', 'button', 'Button', 'Select'].includes(node.openingElement?.name?.name)) return '';
  return cleanDisplay(node.children.map(child => displayChildren(child, bindings)).filter(Boolean).join(' '));
}

function displayMetadata(node, ancestors, component, identityLabel, sourceType, fallbackPage, caches) {
  const owner = [...ancestors].reverse().find(item => ['FunctionDeclaration', 'ArrowFunctionExpression', 'FunctionExpression'].includes(item.type) && item.body?.type === 'BlockStatement');
  const bindings = owner && caches.bindings.get(owner) || new Map();
  if (owner && !caches.bindings.has(owner)) {
    walk(owner.body, [], item => { if (item.type === 'VariableDeclarator' && item.id.type === 'Identifier') bindings.set(item.id.name, item.init); });
    caches.bindings.set(owner, bindings);
  }
  const wrappers = ancestors.filter(item => item.type === 'JSXElement');
  const nearestLabel = [...wrappers].reverse().find(item => ['Field', 'label', 'Row'].includes(item.openingElement.name?.name));
  let mappedLabel = '';
  const labelVariable = attr(nearestLabel?.openingElement ?? {}, 'label')?.value?.expression;
  if (labelVariable?.type === 'Identifier') for (const ancestor of [...ancestors].reverse()) {
    if (ancestor.type !== 'CallExpression' || ancestor.callee.type !== 'MemberExpression' || ancestor.callee.property.name !== 'map' || ancestor.callee.object.type !== 'ArrayExpression') continue;
    const parameter = ancestor.arguments[0]?.params?.[0];
    const column = parameter?.type === 'ArrayPattern' ? parameter.elements.findIndex(item => item?.name === labelVariable.name) : -1;
    if (column >= 0) mappedLabel = ancestor.callee.object.elements.map(row => displayExpression(row?.elements?.[column], bindings)).filter(Boolean).join(' / ');
    if (mappedLabel) break;
  }
  let label = displayAttribute(node, 'data-field-default-label', bindings) || displayAttribute(node, 'aria-label', bindings) || (node.name.name === 'SearchField' ? displayAttribute(node, 'label', bindings) : '') || displayAttribute(nearestLabel?.openingElement ?? {}, nearestLabel?.openingElement.name?.name === 'Row' ? 'title' : 'label', bindings) || mappedLabel || (nearestLabel?.openingElement.name?.name === 'label' ? displayChildren(nearestLabel, bindings) : '') || displayAttribute(node, 'placeholder', bindings) || (/^[A-Za-z][A-Za-z\s(),%&—·/:?….-]*$/.test(identityLabel) ? identityLabel : sourceType === 'textarea' ? 'Text content' : 'Text value');
  if (component === 'ColorChoice') label = 'Custom hex color';
  if (component === 'TemplateFieldsEditor') label = `Template question ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
  if (component === 'TemplateAnswers') label = sourceType === 'textarea' ? 'Custom template question · Long text answer' : 'Custom template question · Text answer';
  if (component === 'GovernanceSettings') label = 'Search members, roles and audit history';
  if (component === 'ResourceEditor' && fallbackPage === 'Resource Page' && /^Text (?:value|content)$/.test(label)) label = sourceType === 'textarea' ? 'Resource field · Long text' : 'Resource field · Text';
  if (component === 'ActionDialog' && /^Text (?:value|content)$/.test(label)) label = sourceType === 'textarea' ? 'Action parameter · Long text' : 'Action parameter · Text';
  if (component === 'ConnectionContent' && label === 'Text value') label = 'Resource request field';
  if (component === 'DefinitionEditor' && label.toLowerCase() === 'name') label = 'Step name';
  label = label.charAt(0).toUpperCase() + label.slice(1);
  const dialog = [...wrappers].reverse().find(item => item.openingElement.name?.name === 'Dialog');
  const returned = [...ancestors].reverse().find(item => item.type === 'ReturnStatement');
  let heading = returned && caches.headings.get(returned) || '';
  if (returned && !caches.headings.has(returned)) {
    walk(returned.argument, [], (item, localAncestors) => {
    if (heading || localAncestors.some(parent => parent.type === 'JSXElement' && parent.openingElement.name?.name === 'Dialog')) return;
    if (item.type === 'JSXElement' && ['Heading', 'PageHeader', 'SectionTitle', 'h1'].includes(item.openingElement.name?.name)) heading = item.openingElement.name.name === 'h1' ? displayChildren(item, bindings) : displayAttribute(item.openingElement, 'title', bindings);
    });
    caches.headings.set(returned, heading);
  }
  let page = displayAttribute(node, 'data-field-default-page', bindings) || SHARED_PRODUCT_SCOPES[`${fallbackPage}:${component}`] || SHARED_PRODUCT_SCOPES[component] || (dialog ? displayAttribute(dialog.openingElement, 'title', bindings) : '') || heading || fallbackPage;
  const group = [...wrappers].reverse().find(item => ['fieldset', 'Group'].includes(item.openingElement.name?.name));
  let groupTitle = group?.openingElement.name?.name === 'Group' ? displayAttribute(group.openingElement, 'title', bindings) : '';
  if (group?.openingElement.name?.name === 'fieldset') groupTitle = group.children.filter(child => child.type === 'JSXElement' && child.openingElement.name?.name === 'legend').map(child => displayChildren(child, bindings)).join(' ');
  if (groupTitle && !page.toLowerCase().includes(groupTitle.toLowerCase()) && !/^Field\b/i.test(groupTitle)) page += ` · ${groupTitle}`;
  return { page: cleanDisplay(page), label: cleanDisplay(label) };
}

function attr(node, name) { return node.attributes?.find(item => item.type === 'JSXAttribute' && item.name.name === name); }
function literal(node, name) {
  const value = attr(node, name)?.value;
  return value?.type === 'StringLiteral' ? value.value : value?.expression?.type === 'StringLiteral' ? value.expression.value : null;
}
function expression(node, name, source) {
  const value = attr(node, name)?.value;
  return value ? source.slice(value.start, value.end).replace(/\s+/g, '') : '';
}
function componentName(ancestors) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const node = ancestors[index];
    if (node.type === 'FunctionDeclaration' && node.id?.name) return node.id.name;
    if (node.type === 'VariableDeclarator' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.init?.type)) return node.id.name || 'Editor';
  }
  return 'Page';
}
function walk(node, ancestors, callback) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const child of node) walk(child, ancestors, callback); return; }
  if (node.type) callback(node, ancestors);
  for (const [key, child] of Object.entries(node)) if (!['loc', 'comments', 'tokens'].includes(key) && child && typeof child === 'object') walk(child, [...ancestors, node], callback);
}

export function analyzeFieldSource(source, filename) {
  const path = filename.replaceAll('\\', '/').replace(/^.*?src\//, '');
  if (OMIT_FILES.test(path)) return [];
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const fields = [];
  const displayCaches = { bindings: new WeakMap(), headings: new WeakMap() };
  const sensitiveScopes = new WeakMap();
  walk(ast.program, [], (node, ancestors) => {
    if (node.type !== 'JSXOpeningElement' || !CONTROL_NAMES.has(node.name?.name)) return;
    const component = componentName(ancestors);
    if (path === 'ui.jsx' && component === 'SearchField') return; // caller supplies identity through forwarded props
    const wrappers = ancestors.filter(item => item.type === 'JSXElement').map(item => item.openingElement);
    const excluded = wrappers.some(item => attr(item, 'data-field-defaults-exclude'));
    const form = [...ancestors].reverse().find(item => item.type === 'JSXElement' && ['Dialog', 'form', 'Form'].includes(item.openingElement.name?.name));
    let sensitiveForm = false;
    if (form && sensitiveScopes.has(form)) sensitiveForm = sensitiveScopes.get(form);
    else if (form) {
      walk(form, [], item => {
      if (item.type === 'JSXOpeningElement' && ['input', 'textarea'].includes(item.name?.name)) {
        const metadata = [...['type', 'autoComplete', 'name', 'aria-label', 'data-field-default-label'].map(name => expression(item, name, source)), fieldHintMetadata(literal(item, 'placeholder') ?? expression(item, 'placeholder', source))].join(' ');
        if (SENSITIVE_FORM.test(metadata)) sensitiveForm = true;
      }
      });
      sensitiveScopes.set(form, sensitiveForm);
    }
    const type = node.name.name === 'textarea' ? 'textarea' : node.name.name === 'DateField' ? 'date' : node.name.name === 'SearchField' ? 'search' : literal(node, 'type') || 'text';
    const fieldWrapper = [...wrappers].reverse().find(item => item.name?.name === 'Field' || item.name?.name === 'label');
    const labelText = fieldWrapper?.name?.name === 'label' ? ancestors.findLast(item => item.type === 'JSXElement' && item.openingElement === fieldWrapper)?.children.filter(item => item.type === 'JSXText').map(item => item.value.trim()).join(' ') : '';
    // Keep the original identity label byte-for-byte. Readable display
    // metadata is inferred separately and must never re-key saved defaults.
    const identityLabel = literal(node, 'data-field-default-label') || literal(node, 'aria-label') || literal(fieldWrapper ?? {}, 'label') || labelText || literal(node, 'placeholder') || literal(node, 'name') || words(expression(node, 'value', source).replace(/[{}]/g, '').split('.').at(-1)) || words(type);
    const context = wrappers.map(item => ['title', 'aria-label', 'label'].map(name => expression(item, name, source)).filter(Boolean).join(':')).filter(Boolean).join('/');
    const semantic = legacyFieldIdentity(`${path}|${component}|${context}|${expression(node, 'name', source)}|${expression(node, 'value', source)}|${expression(node, 'aria-label', source)}|${identityLabel}|${type}`);
    const generatedKey = `source.${slug(legacyFieldIdentity(path).replace(/\.jsx$/, ''))}.${slug(legacyFieldIdentity(component))}.${slug(legacyFieldIdentity(identityLabel))}.${digest(semantic)}`;
    const key = LEGACY_REBRAND_KEYS[generatedKey] || generatedKey;
    const semanticType = type === 'text' && /^hh:mm$/i.test(literal(node, 'placeholder') || '') ? 'time' : type;
    const { page, label } = displayMetadata(node, ancestors, component, identityLabel, semanticType, words(path.split('/').at(-1).replace(/\.jsx$/, '')), displayCaches);
    const metadata = [...['type', 'autoComplete', 'name', 'value'].map(name => expression(node, name, source)), fieldHintMetadata(literal(node, 'placeholder') ?? expression(node, 'placeholder', source))].join(' ');
    const readOnlyAttribute = attr(node, 'readOnly');
    const readOnly = Boolean(readOnlyAttribute && (!readOnlyAttribute.value || readOnlyAttribute.value.expression?.value === true));
    const sensitive = excluded || sensitiveForm || /(?:IdentitySettings|AuthGate|SecuritySettings|BillingSettings)/.test(path) || component === 'GovernanceEditor' || SENSITIVE_FORM.test(metadata);
    const definition = normalizeFieldDefinition({ key, page, label, type: semanticType, sensitive, eligible: !readOnly && component !== 'FirstRun' }); // no workspace-scoped provider exists during first-use onboarding
    // Existing explicit keys win. Their metadata and compatibility entries are
    // kept in the hand-authored inventory; source identity remains a fallback.
    const directKey = literal(node, 'data-field-default-key');
    const explicit = directKey || node.attributes.some(item => item.type === 'JSXSpreadAttribute' && /defaultField|defaults/.test(source.slice(item.start, item.end)));
    const search = type === 'search' || /search|filter|query/i.test(`${label} ${expression(node, 'value', source)}`);
    const localDraft = /^(?:\{)?(?:query|search|filter)(?:\})?$/.test(expression(node, 'value', source));
    const auto = search && (localDraft || !/settings\//.test(path)) || /(?:New|Create)/.test(component) && !/settings\//.test(path);
    fields.push({ ...definition, directKey, start: node.start, end: node.end, explicit: Boolean(explicit), auto: Boolean(auto), hasAuto: Boolean(attr(node, 'data-field-default-auto')), hasExclude: Boolean(attr(node, 'data-field-defaults-exclude')), excluded: !definition?.eligible });
  });
  return fields;
}

export function instrumentFieldSource(source, filename) {
  const fields = analyzeFieldSource(source, filename);
  let code = source;
  for (const field of [...fields].sort((a, b) => b.end - a.end)) {
    // Authored exclusions already reach the DOM. Repeating them produces
    // duplicate JSX attributes (including when the original is boolean).
    if (field.excluded && field.hasExclude) continue;
    const end = field.end - (source[field.end - 2] === '/' ? 2 : 1);
    const attributes = field.excluded ? ' data-field-defaults-exclude="true"' : ` data-field-default-source=${JSON.stringify(field.key)} data-field-default-source-page=${JSON.stringify(field.page)} data-field-default-source-label=${JSON.stringify(field.label)}${field.hasAuto ? '' : ` data-field-default-auto=${JSON.stringify(String(field.auto))}`}`;
    code = code.slice(0, end) + attributes + code.slice(end);
  }
  return code;
}

export function discoverSourceFields(root) {
  const fields = new Map();
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith('.jsx')) for (const field of analyzeFieldSource(readFileSync(path, 'utf8'), relative(root, path))) {
        if (!field.excluded) {
          const { start, end, explicit, directKey, auto, hasAuto, hasExclude, excluded, ...sourceDefinition } = field;
          const definition = directKey ? normalizeFieldDefinition({ ...sourceDefinition, key: directKey }) : sourceDefinition;
          if (!definition?.eligible) continue;
          fields.set(definition.key, definition);
        }
      }
    }
  }
  visit(resolve(root, 'src'));
  return [...fields.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function fieldDefaultsSourcePlugin(root) {
  // Vite module IDs use forward slashes even when Node's filesystem paths use
  // Windows separators. Compare normalized paths or Windows silently loses
  // both source registration and live input instrumentation.
  const inventory = resolve(root, 'src/lib/field-source-inventory.js').replaceAll('\\', '/');
  const sourceRoot = `${resolve(root, 'src').replaceAll('\\', '/')}/`;
  return {
    name: 'rumbo-field-defaults-source', enforce: 'pre',
    load(id) {
      if (id.split('?')[0].replaceAll('\\', '/') !== inventory) return null;
      return `export const SOURCE_FIELD_DEFINITIONS = ${JSON.stringify(discoverSourceFields(root))};`;
    },
    transform(code, id) {
      if (!id.endsWith('.jsx') || !id.replaceAll('\\', '/').startsWith(sourceRoot)) return null;
      return { code: instrumentFieldSource(code, relative(root, id)), map: null };
    },
    handleHotUpdate(context) {
      if (!context.file.endsWith('.jsx')) return;
      const module = context.server.moduleGraph.getModuleById(inventory);
      if (module) { context.server.moduleGraph.invalidateModule(module); return [...context.modules, module]; }
    },
  };
}

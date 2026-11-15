import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { RETIRED_LOCAL_VIEWS, LOCAL_PRIMARY_NAV, isRetiredLocalPage, isLocalNavigationItemAllowed, isLocalCreationAllowed, isLocalShortcutAllowed } from '../src/lib/local-navigation.js';
import { normalizeOrganization, resolveFavorite, favoriteForPage } from '../src/lib/organization.js';

test('local retirement covers canonical pages and aliases, not real planning/review/file destinations', () => {
  for (const view of RETIRED_LOCAL_VIEWS) {
    assert.equal(isRetiredLocalPage(view), true);
    assert.equal(isRetiredLocalPage({ view, id: 'historical' }), true);
    assert.equal(isLocalNavigationItemAllowed(view), false);
    assert.equal(isLocalNavigationItemAllowed({ view, id: 'historical' }), false);
    assert.equal(isLocalNavigationItemAllowed(`entity:${view}:historical`), false);
  }
  for (const view of ['workspace', 'projects', 'tasks', 'docs', 'documents', 'library', 'teams', 'views', 'settings', 'starred']) assert.equal(isRetiredLocalPage(view), false);
  assert.equal(isRetiredLocalPage(null), false);
  assert.equal(isLocalNavigationItemAllowed(null), false);
  assert.deepEqual(LOCAL_PRIMARY_NAV.map(item => item.id), ['workspace', 'projects', 'tasks', 'todos']);
});

test('old agent/chat/session create and shortcut launchers cannot reintroduce local feature UI', () => {
  for (const kind of ['agent', 'chat', 'conversation', 'session', 'agent-session']) {
    assert.equal(isLocalCreationAllowed(kind), false);
    assert.equal(isLocalShortcutAllowed(`create:${kind}`), false);
  }
  for (const kind of ['project', 'team', 'task', 'memory']) assert.equal(isLocalCreationAllowed(kind), true);
  for (const view of RETIRED_LOCAL_VIEWS) assert.equal(isLocalShortcutAllowed({ id: `go:${view}` }), false);
  assert.equal(isLocalShortcutAllowed('go:workspace'), true);
  assert.equal(isLocalShortcutAllowed('search'), true);
});

test('retired favorites remain stored and resolve only in nonlocal compatibility mode', () => {
  const prefs = normalizeOrganization({ version: 1, favorites: [{ view: 'agents', id: 'a' }, { view: 'chats', id: 'c' }, { view: 'workbench', id: 'p' }, { view: 'projects', id: 'p' }] });
  const data = { projects: [{ id: 'p', name: 'Project' }], agents: [{ id: 'a', name: 'Old profile' }], chats: [{ id: 'c', title: 'Old chat' }] };
  const local = { ...data, meta: { product: { edition: 'local' } } };
  const before = JSON.stringify({ data, prefs });
  for (const ref of prefs.favorites) {
    assert.ok(resolveFavorite(data, ref));
    assert.equal(Boolean(resolveFavorite(local, ref)), ref.view === 'projects');
  }
  assert.equal(favoriteForPage(local, { view: 'agents', id: 'a' }), null);
  assert.equal(JSON.stringify({ data, prefs }), before);
  assert.deepEqual(normalizeOrganization(prefs).favorites, prefs.favorites);
});

test('shell, search, pins and editor parse and share the local presentation filter', () => {
  for (const file of ['Shell', 'GlobalToolbar', 'FloatingPinnedDock', 'SidebarEditor']) {
    const source = readFileSync(new URL(`../src/components/${file}.jsx`, import.meta.url), 'utf8');
    assert.doesNotThrow(() => transformSync(source, { loader: 'jsx', format: 'esm' }));
    assert.match(source, /local-navigation\.js/);
    assert.match(source, /isLocalNavigationItemAllowed/);
  }
  const shell = readFileSync(new URL('../src/components/Shell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /local-primary-navigation/);
  assert.match(shell, /isLocalCreationAllowed\(kind\)/);
  assert.match(shell, /visible\(local \? \[\] : data\.agents\)/);
  assert.match(shell, /visible\(local \? \[\] : data\.chats\)/);
  assert.match(shell, /!isRetiredLocalPage\(parsePage\(ref\.hash\)\)/);
  assert.match(shell, /useFrondoseAgentAppearance\(local \? null : workspace\?\.id\)/);
  assert.match(shell, /localDocsCatalog\(docs\.groups, docs\.articles, data\)/);
  for (const file of ['GlobalToolbar', 'FloatingPinnedDock']) assert.match(readFileSync(new URL(`../src/components/${file}.jsx`, import.meta.url), 'utf8'), /localWorkspaceQuickAccess\(/);
});

test('retained project, Route, Area and recorded-work views cannot reopen profile-driven local workflows', () => {
  for (const file of ['src/views/Projects.jsx', 'src/views/ProjectHub.jsx', 'src/views/Work.jsx', 'src/views/Teams.jsx', 'src/components/EntityDialog.jsx', 'src/components/FrondoseAgentEntry.jsx', 'src/components/AgentLinks.jsx', 'src/components/AreaSettings.jsx']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotThrow(() => transformSync(source, { loader: 'jsx', format: 'esm' }));
    assert.match(source, /isLocalProduct/);
  }
  const editor = readFileSync(new URL('../src/components/EntityDialog.jsx', import.meta.url), 'utf8');
  assert.match(editor, /agents=\{local \? \[\] : conversationAgents\}/);
  assert.match(editor, /!local \? <Select\s+label="Assigned agent"/);
  assert.match(editor, /assignee_agent_ids: form\.assignee_agent_ids/); // old assignments remain inert, not erased on unrelated edits
  const runs = readFileSync(new URL('../src/views/Work.jsx', import.meta.url), 'utf8');
  assert.match(runs, /!local && data\.runs\.length/);
  assert.match(runs, /\) : !local \? \(/);
  assert.match(runs, /secondaryAction=\{local \? undefined : 'Connect an agent'\}/);
  assert.match(runs, /frondoseActions\.stopRun\(run\.id\)/); // stopping existing work remains available
  const links = readFileSync(new URL('../src/components/AgentLinks.jsx', import.meta.url), 'utf8');
  assert.match(links, /useEffect\(\(\) => \{\s+if \(local\) return;/);
  assert.match(links, /if \(local\) return null/);
});

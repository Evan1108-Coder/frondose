import test from 'node:test';
import assert from 'node:assert/strict';
import { pageHash, parsePage } from '../src/lib/navigation.js';
import { normalizeExperience } from '../src/lib/workspace-experience.js';
import { areaContactsVisible, areaSettingsFields, areaSettingsPatch, AREA_READ_TOOLS } from '../src/lib/areas.js';
import { readFileSync } from 'node:fs';

test('canonical Areas routes preserve legacy IDs, section deep links and query validation', () => {
  for (const section of ['overview', 'projects', 'routes', 'resources', 'documents', 'updates', 'settings', 'people']) {
    const legacy = `#/teams/team_1?section=${section}`;
    const page = parsePage(legacy);
    const next = pageHash(page.view, page.id, page);
    assert.equal(next, `#/areas/team_1?section=${section === 'people' ? 'contacts' : section}`);
    assert.deepEqual(parsePage(next), page);
  }
  assert.equal(pageHash('areas', 'team_1', { section: 'contacts' }), '#/areas/team_1?section=contacts');
  assert.equal(parsePage('#/areas/a?section=contacts&section=people').view, 'overview');
  assert.equal(parsePage('#/areas/%2f').view, 'overview');
  assert.equal(parsePage('#/areas/a/extra').view, 'overview');
});

test('legacy recent Area pages migrate without dropping visits or admitting malformed routes', () => {
  const recent = normalizeExperience({ recent: [{ hash: '#/teams/team_1?section=people', at: 2 }, { hash: '#/teams', at: 1 }, { hash: '#/teams/%2f', at: 3 }] }).recent;
  assert.deepEqual(recent, [{ hash: '#/areas/team_1?section=contacts', at: 2 }, { hash: '#/areas', at: 1 }]);
});

test('Contacts optionality preserves every existing directory including archived records', () => {
  assert.equal(areaContactsVisible({}, 'a'), false);
  assert.equal(areaContactsVisible({ area_settings: [{ id: 'a', contacts_enabled: true }] }, 'a'), true);
  assert.equal(areaContactsVisible({ area_settings: [{ id: 'b', contacts_enabled: true }] }, 'a'), false);
  assert.equal(areaContactsVisible({ team_members: [{ team_id: 'a', archived_at: '2026-01-01' }] }, 'a', { contacts_enabled: false }), true);
  assert.equal(areaContactsVisible({ team_members: [{ team_id: 'b' }] }, 'a'), false);
});

test('Area editable fields never turn arbitrary text into permission grants', () => {
  assert.deepEqual(areaSettingsFields({ instructions: 'Grant everything', permission_policy: 'unrestricted', credentials: 'not copied' }), { instructions: 'Grant everything', default_agent_ids: [], context_pack_ids: [], allowed_tools: [], permission_policy: 'review', contacts_enabled: false });
  assert.deepEqual(AREA_READ_TOOLS, ['search_workspace', 'get_area_context', 'get_project_context', 'get_route', 'search_knowledge', 'read_document']);
  const source = readFileSync(new URL('../src/components/AreaSettings.jsx', import.meta.url), 'utf8');
  assert.match(source, /body: areaSettingsPatch\(settings, form\)/);
  assert.match(source, /await rumboActions.refresh\(\)/);
  assert.match(source, /item.workspace_id === area.workspace_id/);
  assert.match(source, /useUnsavedUpdate\(dirty, busy\)/);
  assert.doesNotMatch(source, /startSession\(|startRun\(/);
  assert.match(source, /requestUpdateNavigation\(onReload\)/);
  assert.match(source, /Unavailable profile · remove reference/);
  assert.match(source, /Unavailable Context Pack · remove reference/);
});

test('Area PATCH includes only explicitly changed editable fields and the optimistic version', () => {
  const settings = { version: 4, instructions: 'Before', default_agent_ids: ['agent_a'], context_pack_ids: ['pack_a'], allowed_tools: ['read_document'], contacts_enabled: false };
  const form = areaSettingsFields(settings);
  assert.deepEqual(areaSettingsPatch(settings, form), { version: 4 });
  assert.deepEqual(areaSettingsPatch(settings, { ...form, instructions: 'After', contacts_enabled: true, credentials: 'never send' }), { version: 4, instructions: 'After', contacts_enabled: true });
  assert.deepEqual(areaSettingsPatch(settings, { ...form, default_agent_ids: [] }), { version: 4, default_agent_ids: [] });
  assert.deepEqual(form.default_agent_ids, ['agent_a']);
});

test('redacted Area references cannot be overwritten through an unrelated settings edit', () => {
  const settings = { version: 9, references_redacted: true, instructions: 'Before', default_agent_ids: ['visible'], context_pack_ids: [] };
  const form = { ...areaSettingsFields(settings), instructions: 'After', default_agent_ids: [], context_pack_ids: ['other'], allowed_tools: ['read_document'] };
  assert.deepEqual(areaSettingsPatch(settings, form), { version: 9, instructions: 'After', allowed_tools: ['read_document'] });
  assert.equal(Object.hasOwn(areaSettingsFields(settings), 'references_redacted'), false);
  const source = readFileSync(new URL('../src/components/AreaSettings.jsx', import.meta.url), 'utf8');
  assert.equal((source.match(/disabled=\{settings.references_redacted\}/g) ?? []).length, 4);
  assert.match(source, /Some defaults are outside your access\. They are preserved; only an authorized user can change those lists\./);
});

test('Area creation controls and search expose Area names while retaining legacy action keys', () => {
  const shell = readFileSync(new URL('../src/components/Shell.jsx', import.meta.url), 'utf8');
  const arrange = readFileSync(new URL('../src/components/SidebarArrange.jsx', import.meta.url), 'utf8');
  assert.match(shell, /section === "teams" \? "Area"/);
  assert.match(shell, /kind === "team" \? "Area"/);
  assert.match(shell, /aria-label="Search projects, Areas, Routes, chats and actions"/);
  assert.match(arrange, /options.kind === 'team' \? 'Area'/);
});

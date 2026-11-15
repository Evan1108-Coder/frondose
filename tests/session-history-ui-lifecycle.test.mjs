import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';

// Exercise the exact production lifecycle function without loading JSX, the
// app provider or a real server/history directory into this unit fixture.
const source = await readFile(new URL('../src/components/workspace/SessionHistorySearch.jsx', import.meta.url), 'utf8');
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
const declaration = ast.program.body.find(node => node.type === 'ExportNamedDeclaration' && node.declaration?.id?.name === 'createHistoryRequestScope').declaration;
const createScope = Function('AbortController', `return (${source.slice(declaration.start, declaration.end)});`)(AbortController);

test('older search responses and their cleanup cannot overwrite or cancel a newer search', () => {
  const scope = createScope(), old = scope.begin('search'), next = scope.begin('search');
  assert.equal(old.controller.signal.aborted, true); assert.equal(scope.current(old), false); assert.equal(scope.current(next), true);
  scope.finish(old); scope.cancelTicket(old); assert.equal(scope.current(next), true);
  scope.finish(next); assert.equal(scope.current(next), false);
});

test('settings, refresh and search completions belong to the rendered workspace even before old effect cleanup', () => {
  const oldWorkspace = createScope(), newWorkspace = createScope();
  for (const channel of ['settings-load', 'settings-change', 'refresh', 'search']) {
    const old = oldWorkspace.begin(channel);
    assert.equal(oldWorkspace.current(old, newWorkspace), false, 'late old-workspace callback is ignored immediately');
    assert.equal(oldWorkspace.current(old, oldWorkspace), true);
  }
  oldWorkspace.cancelAll();
  for (const channel of ['settings-load', 'settings-change', 'refresh', 'search']) {
    const current = newWorkspace.begin(channel); assert.equal(newWorkspace.current(current, newWorkspace), true);
  }
});

test('privacy changes can abort an in-flight refresh/search while their own mutation remains live', () => {
  const scope = createScope(), refresh = scope.begin('refresh'), search = scope.begin('search'), load = scope.begin('settings-load');
  scope.cancel('refresh', 'search', 'settings-load'); const mutation = scope.begin('settings-change');
  for (const ticket of [refresh, search, load]) { assert(ticket.controller.signal.aborted); assert.equal(scope.current(ticket), false); }
  assert.equal(scope.current(mutation), true); scope.cancelAll(); assert(mutation.controller.signal.aborted);
});

test('workspace switches, denied scopes and newer queries reset stale visible results/loading/errors', () => {
  assert.match(source, /state = value\.workspaceId === workspaceId \? value : empty/);
  assert.match(source, /setValue\(\{ workspaceId, settings: null, error: null, settingsBusy: false, scanBusy: false \}\)/);
  assert.match(source, /setScope\('workspace'\); setProjectId\(''\); setProvider\(''\); setQuery\(''\)/);
  assert.match(source, /setResult\(null\); setSearching\(false\); setSearchError\(null\);\s*if \(!settings\?\.enabled/);
  assert.match(source, /scope === 'all' && !settings\.allowAll\) setScope\('workspace'\)/);
  assert.match(source, /if \(state\.isCurrent\(ticket\)\) \{ setResult\(next\); setSearchError\(null\); \}/);
  assert.match(source, /if \(next && state\.isActive\(\)\) setRevision/);
  assert.match(source, /settingsBusy: busy, change/);
  assert.doesNotMatch(source, /settings, busy, change/);
  assert.match(source, /settings\?\.generation/);
});

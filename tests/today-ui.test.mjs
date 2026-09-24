import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { pageHash, parsePage } from '../src/lib/navigation.js';
import { val } from '../src/lib/model.js';

const home = readFileSync(new URL('../src/views/Home.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/views/today.css', import.meta.url), 'utf8');
const helpers = runInNewContext(`${home.slice(home.indexOf('const TODAY_DESTINATIONS'), home.indexOf('function TodayItem')).replaceAll('export function', 'function')}\n({ todayFilters, todayDestination, todayGroups, todayEntries, todayFailureItem, todaySnoozeKeys, restoreTodayItem });`, { pageHash, parsePage, val });
const plain = value => JSON.parse(JSON.stringify(value));

test('Today filters cannot carry stale Area or project selections across workspaces', () => {
  const areas = [{ id: 'engineering' }, { id: 'product' }];
  const projects = [{ id: 'app', name: 'App', team_id: 'engineering' }, { id: 'research', team_id: 'product' }];
  assert.deepEqual(plain(helpers.todayFilters({ workspaceId: 'w', areaId: 'engineering', projectId: 'research' }, 'w', areas, projects)), { workspaceId: 'w', areaId: 'engineering', projectId: 'all' });
  assert.deepEqual(plain(helpers.todayFilters({ workspaceId: 'old', areaId: 'engineering', projectId: 'app' }, 'w', areas, projects)), { workspaceId: 'w', areaId: 'all', projectId: 'all' });
  assert.deepEqual(plain(helpers.todayFilters({ workspaceId: 'w', areaId: 'removed', projectId: 'removed' }, 'w', areas, projects)), { workspaceId: 'w', areaId: 'all', projectId: 'all' });
  assert.equal(helpers.todayFilters({ workspaceId: 'w', areaId: 'engineering', projectId: 'app' }, 'w', areas, projects).projectId, 'app');
});

test('Today destinations preserve real run, Workflow, and scoped review navigation only', () => {
  assert.deepEqual(plain(helpers.todayDestination({ view: 'workflows', id: 'run:workflow-run', project_id: 'app' })), { view: 'workflows', id: 'run:workflow-run', projectId: null });
  assert.deepEqual(plain(helpers.todayDestination({ view: 'library', id: 'output', project_id: 'app' })), { view: 'library', id: 'output', projectId: 'app' });
  assert.equal(helpers.todayDestination({ view: 'https://example.test', id: 'unknown' }), null);
  assert.equal(helpers.todayDestination({ view: 'work', id: '../invalid' }), null);
  assert.equal(helpers.todayDestination({ view: 'tasks', id: 'route', project_id: 'bad/scope' }), null);
});

test('Today project grouping preserves item order and unknown workspace scope honestly', () => {
  const items = [{ key: 'a', project_id: 'p' }, { key: 'b', project_id: null }, { key: 'c', project_id: 'p' }];
  const groups = plain(helpers.todayGroups(items, [{ id: 'p', name: 'Product' }], true));
  assert.deepEqual(groups.map(group => [group.title, group.items.map(item => item.key)]), [['Product', ['a', 'c']], ['Workspace', ['b']]]);
  assert.equal(helpers.todayGroups(items, [], false)[0].items, items);
});

test('Today preserves existing snoozes without hiding unrelated tool decisions from the same run', () => {
  const run = { key: 'run-failed:r', id: 'r', kind: 'run_failed' };
  assert.deepEqual(plain(helpers.todaySnoozeKeys(run)), ['run-failed:r', 'run:r']);
  assert.deepEqual(plain(helpers.todaySnoozeKeys({ key: 'native-request:x', id: 'r', kind: 'native_tool_review' })), ['native-request:x']);
  assert.deepEqual(plain(helpers.todaySnoozeKeys({ key: 'output-review:o', id: 'o', kind: 'output_review' })), ['output-review:o', 'output:o']);
  assert.deepEqual(plain(helpers.todaySnoozeKeys({ key: 'route-ready:t', id: 't', kind: 'ready_route' })), ['route-ready:t', 'task:t']);
  const existing = { 'run:r': 123, 'run-failed:r': 456, another: 789 };
  assert.deepEqual(plain(helpers.restoreTodayItem(existing, run)), { 'run:r': 0, 'run-failed:r': 0, another: 789 });
  assert.equal(existing['run:r'], 123);
});

test('Today deduplicates snoozed items and links failure clusters to recorded runs', () => {
  const entry = { key: 'one', title: 'Recorded' }, warning = { key: 'warning', title: 'Review source' };
  assert.deepEqual(plain(helpers.todayEntries({ sections: { needs_you: [entry], working_now: [entry] }, warnings: [warning], failure_clusters: [] })), [entry, warning]);
  const cluster = helpers.todayFailureItem({ key: 'failure', title: 'Two recorded failures', count: 2, run_ids: ['r1', 'r2'], latest_time: '2026-09-24T00:00:00Z', simulation: true });
  assert.equal(cluster.id, 'r1');
  assert.equal(cluster.view, 'work');
  assert.equal(cluster.simulation, true);
  assert.equal(cluster.time, '2026-09-24T00:00:00Z');
  assert.equal(helpers.todayDestination(helpers.todayFailureItem({ run_ids: [] })), null);
});

test('Today only reads status and navigates; opening or refreshing never starts provider work', () => {
  assert.doesNotThrow(() => transformSync(home, { loader: 'jsx', format: 'esm' }));
  assert.match(home, /apiRequest\(`\/api\/today\?\$\{query\}`, \{ signal: controller.signal \}\)/);
  assert.match(home, /return \(\) => controller.abort\(\)/);
  assert.match(home, /current.query === query \? current.result : null/);
  assert.match(home, /if \(!controller.signal.aborted\)/);
  assert.doesNotMatch(home, /method:\s*['"](?:POST|PATCH|DELETE)|\/api\/runs|prepare_step|decide_approval|setInterval|demoRequest|spawnProcess/);
  for (const section of ['Needs you', 'Working now', 'Ready to review', 'Suggested next', 'Recent context', 'Failures & context warnings']) assert.ok(home.includes(section));
  assert.match(home, /Proposals only\. Opening one never starts work/);
  assert.match(home, /Simulation/);
  assert.match(home, /The last loaded summary is shown/);
});

test('Today retains existing personal surfaces and accessible, responsive status states', () => {
  for (const label of ['Following', 'Recent', 'Activity', 'Bring back', 'Mark checked']) assert.ok(home.includes(label));
  for (const preference of ['groupAttention', 'snoozeHours', 'recentLimit', 'includeCompleted', 'lastSeenAt', 'followed']) assert.ok(home.includes(preference));
  assert.match(home, /role="tabpanel"/);
  assert.match(home, /aria-label="Today Area filter"/);
  assert.match(home, /aria-label="Today project filter"/);
  assert.match(home, /role="alert"/);
  assert.match(home, /role="status"/);
  assert.match(css, /focus-visible/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /grid-template-columns: 1fr/);
  assert.doesNotMatch(css, /#[a-f\d]{3,8}\b|animation:/i);
});

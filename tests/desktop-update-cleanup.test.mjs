import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { displayDesktopUpdateError } from '../src/lib/desktop-updates.js';

const { createUpdateCleanup } = createRequire(import.meta.url)('../desktop/update-cleanup.cjs');
test('update review errors show actionable text without Electron transport details', () => {
  const error = new Error("Error invoking remote method 'frondose-desktop:update': Error: The items changed. Review them again.");
  const shown = displayDesktopUpdateError(error);
  assert.equal(shown.message, 'The items changed. Review them again.');
  assert.equal(shown.cause, error);
  const original = new Error('No release is available');
  assert.equal(displayDesktopUpdateError(original), original);
});
const fixture = () => {
  let now = 100;
  const closed = [], current = [];
  const add = (key, kind = 'terminal', result = true) => {
    const row = { key, kind, identity: {}, item: { kind, label: `Fixture ${key}`, workspace: 'Test' }, stop() { closed.push(key); return result; } };
    current.push(row);
    return row;
  };
  return { cleanup: createUpdateCleanup({ targets: () => current, now: () => now, ttl: 50 }), closed, current, add, expire: () => { now = 150; } };
};

test('preview and cancel never stop anything; an exact confirmation consumes its token', async () => {
  const { cleanup, add, closed } = fixture();
  add('term'); add('unused', 'browser-page');
  const first = cleanup.preview('1');
  assert.deepEqual(first.items.map(({ kind, label }) => [kind, label]), [['terminal', 'Fixture term'], ['browser-page', 'Fixture unused']]);
  assert(!('stop' in first.items[0]));
  cleanup.clear();
  await assert.rejects(cleanup.confirm('1', first.token), /no longer valid/);
  const second = cleanup.preview('1');
  await assert.rejects(cleanup.confirm('2', second.token), /no longer valid/);
  assert.deepEqual(closed, []);
  assert.deepEqual(await cleanup.confirm('1', second.token), { closed: 2, unconfirmed: 0 });
  await assert.rejects(cleanup.confirm('1', second.token), /no longer valid/);
  assert.deepEqual(closed, ['term', 'unused']);
});

test('changed identity, label, Browser navigation, an added session and expiry fail closed', async () => {
  for (const edit of ['identity', 'label', 'browser-navigation', 'extra', 'expired']) {
    const { cleanup, add, closed, expire } = fixture();
    const row = add('term'); const browser = add('unused', 'browser-page');
    const preview = cleanup.preview('1');
    if (edit === 'identity') row.identity = {};
    if (edit === 'label') row.item.label = 'Renamed';
    if (edit === 'browser-navigation') browser.generation = 2;
    if (edit === 'extra') add('new');
    if (edit === 'expired') expire();
    await assert.rejects(cleanup.confirm('1', preview.token), /changed|expired/);
    assert.deepEqual(closed, [], edit);
  }
});

test('partial cleanup reports unconfirmed exits without claiming success for them', async () => {
  const { cleanup, add } = fixture();
  add('exited'); add('unconfirmed', 'terminal', false);
  assert.deepEqual(await cleanup.confirm('1', cleanup.preview('1').token), { closed: 1, unconfirmed: 1 });
});

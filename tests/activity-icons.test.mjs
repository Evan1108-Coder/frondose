import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UPDATE_TYPES } from '../src/lib/activity.js';
import { ICON_REACTIONS } from '../src/lib/reaction-catalog.js';
import { RUN_ACTIVITY_TYPES, activityIconId, runActivityType } from '../src/lib/activity-icons.js';

test('every activity type has a distinct Frondose icon in the shared Icons catalog', () => {
  const ids = [...UPDATE_TYPES, ...RUN_ACTIVITY_TYPES].map(([type]) => activityIconId('workspace', type));
  assert.equal(ids.length, new Set(ids).size);
  for (const id of ids) assert.ok(ICON_REACTIONS.some(icon => icon.id === id && icon.category === 'Frondose'));
  assert.equal(runActivityType({ type: 'file.changed' }), 'file');
  assert.equal(runActivityType({ type: 'run.failed' }), 'failed');
  assert.equal(runActivityType({ type: 'approval.requested' }), 'approval');
});

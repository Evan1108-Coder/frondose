import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { classifySupportRequest, installSupportLogs, readSupportLogs, recordSupportEvent, supportRequestOutcome } from '../server/support-logs.mjs';
import { installWorkspaceActivity, recordWorkspaceActivity } from '../server/workspace-activity.mjs';
import { formatSupportAgentDay, formatSupportDay, groupSupportRows } from '../src/lib/support-logs.js';

const now = Date.now();
const day = 86_400_000;
function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE workspaces (id TEXT PRIMARY KEY, archived_at TEXT);
    INSERT INTO workspaces VALUES ('private-workspace-id',NULL)`);
  installWorkspaceActivity(db);
  installSupportLogs(db);
  return db;
}

test('support logs combine recorded activity and diagnostic outcomes with no user-controlled details', t => {
  const db = fixture(t);
  const workspaceId = 'private-workspace-id';
  recordWorkspaceActivity(db, { workspaceId, kind: 'todo.created', title: 'Private Customer', entityId: 'secret-task-id' }, { now: now-2000 });
  recordWorkspaceActivity(db, { workspaceId, kind: 'file.saved', path: 'private/path.txt' }, { now: now-1000 });
  assert.equal(recordSupportEvent(db, { action: 'git.change', status: 'blocked', code: 409, message: 'private-secret' }, now), true);
  assert.equal(recordSupportEvent(db, { action: 'custom-action', status: 'blocked' }, now), false);
  assert.equal(recordSupportEvent(db, { action: 'git.change', status: 'constructor' }, now), false);
  const log = readSupportLogs(db, now);
  assert.deepEqual(log.rows.map(({ label, status }) => [label, status]), [['Git request', 'blocked'], ['File saved', 'recorded'], ['To-do created', 'recorded']]);
  assert.equal(log.rows[0].code, 409);
  assert.equal(Object.hasOwn(log.rows[1], 'code'), false);
  assert.doesNotMatch(JSON.stringify(log), /private|secret|Customer|\.txt/);
});

test('expired diagnostic rows are deleted, activity is projected within the same rolling 30 days', t => {
  const db = fixture(t);
  db.prepare('INSERT INTO local_support_events (action,status,recorded_at) VALUES (?,?,?)').run('app.update', 'failed', now-31*day);
  recordWorkspaceActivity(db, { workspaceId: 'private-workspace-id', kind: 'area.created' }, { now: now-31*day });
  recordSupportEvent(db, { action: 'app.opened', status: 'completed' }, now-30*day);
  db.prepare('INSERT INTO local_support_events (action,status,recorded_at) VALUES (?,?,?)').run('app.update', 'available', now+1000);
  assert.deepEqual(readSupportLogs(db, now).rows.map(row => row.label), ['Desktop app opened']);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM local_support_events WHERE recorded_at < ?').get(now-30*day).n, 0);
});

test('request classifications preserve only a fixed action and bounded status', () => {
  const git = classifySupportRequest('POST','/local-git/projects/private-id/push');
  assert.deepEqual(supportRequestOutcome(git, 502), { action: 'git.change', status: 'failed', code: 502 });
  assert.deepEqual(supportRequestOutcome(git, 403), { action: 'git.change', status: 'rejected', code: 403 });
  assert.equal(supportRequestOutcome(git, 201), null, 'workspace history already records successful Git operations');
  assert.equal(supportRequestOutcome(classifySupportRequest('PATCH','/settings'), 200).status, 'accepted');
  assert.equal(classifySupportRequest('GET','/settings'), null);
  assert.equal(classifySupportRequest('POST','/support-logs'), null);
});

test('dated sharing groups in local time and bounds the agent excerpt without auto-sharing', () => {
  const row = { label:'Git request', status:'blocked', code:409, recordedAt:new Date(now).toISOString() };
  const recent = Array.from({ length:65 }, () => row);
  const groups = groupSupportRows([...recent, { ...row, recordedAt: new Date(now-2*day).toISOString() }]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0][1].length, 65);
  assert.match(formatSupportDay(groups[0][0], groups[0][1], 'UTC'), /Git request \| Blocked \(HTTP 409\)/);
  const prompt = formatSupportAgentDay(...groups[0]);
  assert.equal(prompt.split('Git request').length - 1, 60);
  assert.match(prompt, /untrusted diagnostic data/);
  assert.match(prompt, /Only the 60 most recent entries/);
});

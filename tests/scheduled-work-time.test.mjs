import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleInstant, localScheduleTime, nextScheduledTime, validTimezone } from '../src/lib/scheduled-time.js';

test('wall clock resolves actual offsets and invalid calendars/zones fail closed',()=>{
  assert.equal(scheduleInstant('2026-10-08T20:01','Asia/Shanghai'),'2026-10-08T12:01:00.000Z');
  assert.equal(scheduleInstant('2026-10-08T17:46','Asia/Kathmandu'),'2026-10-08T12:01:00.000Z');
  assert.equal(localScheduleTime('2026-10-08T12:01:00.000Z','Asia/Shanghai'),'2026-10-08T20:01');
  for (const date of ['2026-02-30T12:00','2026-10-08T24:00','2026-10-08T12:61','2026-10-08T12:01:00']) assert.throws(()=>scheduleInstant(date,'UTC'));
  assert.equal(validTimezone('Invalid/Zone'),false);assert.throws(()=>scheduleInstant('2026-10-08T12:00','Invalid/Zone'));
});
test('spring-forward gaps reject and fall-back folds consistently select the first occurrence',()=>{
  assert.throws(()=>scheduleInstant('2026-03-08T02:30','America/New_York'),/does not exist/);
  assert.equal(scheduleInstant('2026-11-01T01:30','America/New_York'),'2026-11-01T05:30:00.000Z');
  assert.equal(scheduleInstant('2026-10-25T02:30','Europe/Berlin'),'2026-10-25T00:30:00.000Z');
  assert.equal(scheduleInstant('2026-04-05T01:45','Australia/Lord_Howe'),'2026-04-04T14:45:00.000Z');
});
test('recurrence maintains local clock, skips nonexistent dates and folds once per day',()=>{
  assert.equal(nextScheduledTime('2026-03-07T07:30:00.000Z','daily','America/New_York'),'2026-03-09T06:30:00.000Z');
  assert.equal(nextScheduledTime('2026-10-31T05:30:00.000Z','daily','America/New_York'),'2026-11-01T05:30:00.000Z');
  assert.equal(nextScheduledTime('2026-11-01T05:30:00.000Z','daily','America/New_York'),'2026-11-02T06:30:00.000Z');
  assert.equal(nextScheduledTime('2026-03-01T14:00:00.000Z','weekly','America/New_York'),'2026-03-08T13:00:00.000Z');
  assert.equal(nextScheduledTime('2026-10-08T12:01:00.000Z','daily','UTC','2026-10-11T12:05:00.000Z'),'2026-10-12T12:01:00.000Z');
  assert.equal(nextScheduledTime('2026-10-08T12:01:00.000Z','none','UTC'),null);assert.throws(()=>nextScheduledTime('2026-10-08T12:01:00.000Z','monthly','UTC'));
});

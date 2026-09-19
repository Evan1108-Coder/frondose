import test from "node:test";
import assert from "node:assert/strict";
import { formatLocalDate, monthCells, parseCalendarDate, shiftCalendarMonth } from "../src/lib/calendar.js";

test("custom calendar validates real ISO dates without UTC rollover", () => {
  assert.equal(formatLocalDate(parseCalendarDate("2028-02-29")), "2028-02-29");
  for (const invalid of ["2026-02-29", "2026-04-31", "2026-00-01", "2026-13-01", "2026-01-00", "2026-1-2", "", "0000-01-01"]) assert.equal(parseCalendarDate(invalid), null, invalid);
});

test("month grid always contains six complete Monday-first weeks", () => {
  const days = monthCells(parseCalendarDate("2026-09-18"));
  assert.equal(days.length, 42);
  assert.equal(days[0].getDay(), 1);
  assert.equal(formatLocalDate(days[0]), "2026-08-31");
  assert.equal(formatLocalDate(days.at(-1)), "2026-10-11");
});

test("keyboard month navigation clamps long months and handles years", () => {
  assert.equal(formatLocalDate(shiftCalendarMonth(parseCalendarDate("2026-01-31"), 1)), "2026-02-28");
  assert.equal(formatLocalDate(shiftCalendarMonth(parseCalendarDate("2028-02-29"), 12)), "2029-02-28");
  assert.equal(formatLocalDate(shiftCalendarMonth(parseCalendarDate("2026-01-15"), -1)), "2025-12-15");
});

import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSidebarPreferences, readSidebarPreferences, saveSidebarPreferences } from "../src/lib/sidebar-preferences.js";

test("sidebar defaults expand useful sections without invented projects", () => {
  assert.deepEqual(normalizeSidebarPreferences(null), { version: 1, sections: { teams: true, projects: true, workspace: true, chats: true, favorites: true, agents: true, views: true }, projects: {}, teams: {} });
});
test("disclosure preferences persist separately for each workspace", () => {
  const map = new Map();
  const storage = { getItem: (key) => map.get(key), setItem: (key, value) => map.set(key, value) };
  const preferences = { version: 1, sections: { chats: false }, projects: { project_one: true } };
  saveSidebarPreferences(storage, "a", preferences);
  assert.equal(readSidebarPreferences(storage, "a").sections.chats, false);
  assert.equal(readSidebarPreferences(storage, "a").projects.project_one, true);
  assert.equal(readSidebarPreferences(storage, "a").sections.teams, true);
  assert.equal(readSidebarPreferences(storage, "b").sections.chats, true);
  assert.deepEqual(readSidebarPreferences(storage, "b").projects, {});
});
test("malformed, unversioned, and unavailable browser storage recover safely", () => {
  assert.deepEqual(normalizeSidebarPreferences({ projects: { x: true } }).projects, {});
  assert.deepEqual(normalizeSidebarPreferences({ version: 1, projects: { x: "yes", y: false } }).projects, { y: false });
  assert.equal(readSidebarPreferences({ getItem: () => "bad json" }, "a").sections.projects, true);
  const denied = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
  assert.doesNotThrow(() => saveSidebarPreferences(denied, "a", null));
  assert.equal(readSidebarPreferences(denied, "a").sections.chats, true);
});

test("new Teams preference migrates independently without changing existing disclosure choices", () => {
  const previous = normalizeSidebarPreferences({ version: 1, sections: { projects: false, workspace: true, chats: false }, projects: { existing: false } });
  assert.equal(previous.sections.teams, true);
  assert.equal(previous.sections.projects, false);
  assert.equal(previous.sections.chats, false);
  const next = normalizeSidebarPreferences({ ...previous, sections: { ...previous.sections, teams: false } });
  assert.equal(next.sections.teams, false);
  assert.deepEqual(next.projects, { existing: false });
});

import assert from "node:assert/strict";
import test from "node:test";
import { pageHash, parsePage } from "../src/lib/navigation.js";

const home = { view: "overview", id: null, projectId: null };

test('solo-first navigation names preserve existing stored route identities', () => {
  for (const [name, legacy] of [['today', 'overview'], ['conversations', 'chats'], ['knowledge', 'library'], ['runs', 'work']]) {
    assert.deepEqual(parsePage(`#/${name}`), { view: legacy, id: null, projectId: null });
    assert.equal(pageHash(name, 'record_1'), pageHash(legacy, 'record_1'));
  }
  assert.deepEqual(parsePage('#/conversations/chat_1?message=message_1'), { view: 'chats', id: 'chat_1', projectId: null, messageId: 'message_1' });
});

test('retired Playbooks links resolve to the scheduled-work settings page', () => {
  const destination = { view: 'settings', id: 'scheduled-work', projectId: null };
  for (const hash of ['#/playbooks', '#/playbooks/old_book', '#/playbooks?project=p']) assert.deepEqual(parsePage(hash), destination);
  assert.equal(pageHash('playbooks'), '#/settings/scheduled-work');
  assert.equal(pageHash('playbooks', 'old_book'), '#/settings/scheduled-work');
  assert.deepEqual(parsePage('#/settings/scheduled-work'), destination);
  for (const hash of ['#/playbooks/%2F', '#/playbooks/a/b', '#/playbooks?project=%ZZ']) assert.deepEqual(parsePage(hash), home);
  assert.throws(() => pageHash('playbooks', '../invalid'), TypeError);
  assert.equal(parsePage('#/workflows/workflow_1').view, 'workflows');
});

test('team section deep links preserve the selected tab', () => {
  for (const section of ['overview', 'routes', 'projects', 'resources', 'documents', 'updates', 'people']) {
    assert.deepEqual(parsePage(pageHash('teams', 'team_1', { section })), { view: 'teams', id: 'team_1', projectId: null, section });
  }
  assert.deepEqual(parsePage('#/teams/team_1?section=invalid'), home);
  assert.deepEqual(parsePage('#/teams/team_1?section=routes&section=people'), home);
  assert.throws(() => pageHash('teams', 'team_1', { section: 'invalid' }), TypeError);
});

test("existing Frondose hashes keep their view and identifier", () => {
  assert.deepEqual(parsePage("#/projects/project_sourcelens"), {
    view: "projects", id: "project_sourcelens", projectId: null,
  });
  assert.deepEqual(parsePage("#/settings/appearance"), {
    view: "settings", id: "appearance", projectId: null,
  });
  assert.deepEqual(parsePage("#/chats"), {
    view: "chats", id: null, projectId: null,
  });
});

test("project-scoped lists and details round-trip with encoded identifiers", () => {
  for (const view of ["tasks", "chats", "memory"]) {
    for (const id of [null, "route one", "计划-1", "note?with#symbols"]) {
      const projectId = "project with & context";
      const hash = pageHash(view, id, { projectId });
      assert.deepEqual(parsePage(hash), { view, id, projectId });
    }
  }
  assert.equal(pageHash("tasks", null, { projectId: "p_1" }), "#/tasks?project=p_1");
});

test("unscoped views do not carry project query filters", () => {
  assert.equal(pageHash("projects", "p_1", { projectId: "p_2" }), "#/projects/p_1");
  assert.deepEqual(parsePage("#/overview?project=p_1"), home);
});

test("malformed encodings and ambiguous path identifiers recover safely", () => {
  for (const hash of [
    "#/tasks/%E0%A4%A", "#/tasks?project=%ZZ", "#/tasks?project=%E0%A4%A",
    "#/projects/a/b", "#/tasks/", "#/tasks/%2Fsettings", "#/tasks/%5Ctest",
    "#/tasks/..", "#/tasks/%2e", "#/tasks/%00", "#/tasks?project=../x",
    "#/tasks?project=", "#/tasks?project=a&project=b", "#/tasks?project=%2F",
    "#/unknown/item", "https://example.com/#/tasks", "#//tasks", "#/tasks#extra",
  ]) assert.deepEqual(parsePage(hash), home, hash);
  assert.deepEqual(parsePage(null), home);
});

test("builders reject invalid identifiers and normalize unknown views", () => {
  for (const id of ["", "/", "..", "x\\y", "\u0000", "x".repeat(513)]) {
    assert.throws(() => pageHash("tasks", id), TypeError);
    assert.throws(() => pageHash("memory", null, { projectId: id }), TypeError);
  }
  assert.equal(pageHash("missing"), "#/overview");
  assert.equal(pageHash("tasks"), "#/tasks");
});

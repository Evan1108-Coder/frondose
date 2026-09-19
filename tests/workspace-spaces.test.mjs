import test from "node:test";
import assert from "node:assert/strict";
import { teamProjects, teamRoutes, ownerDocuments, projectActivity, documentFilename, validateProjectDates } from "../src/lib/workspace-spaces.js";

const data = {
  projects: [{ id: "p1", team_id: "t1" }, { id: "p2", team_id: "t2" }, { id: "p3", team_id: "t1", archived_at: "today" }],
  tasks: [{ id: "r1", project_id: "p1" }, { id: "r2", team_id: "t1" }, { id: "r3", project_id: "p2" }, { id: "r4", team_id: "t1", archived_at: "today" }],
  documents: [{ id: "d1", team_id: "t1" }, { id: "d2", project_id: "p1" }, { id: "d3", team_id: "t1", archived_at: "today" }],
};
test("team spaces include direct routes and active project routes without other teams", () => {
  assert.deepEqual(teamProjects(data, "t1").map((row) => row.id), ["p1"]);
  assert.deepEqual(teamRoutes(data, "t1").map((row) => row.id), ["r1", "r2"]);
});
test("documents preserve exact ownership and archive filtering", () => {
  assert.deepEqual(ownerDocuments(data, { teamId: "t1" }).map((row) => row.id), ["d1"]);
  assert.deepEqual(ownerDocuments(data, { projectId: "p1" }).map((row) => row.id), ["d2"]);
  assert.deepEqual(ownerDocuments(data, { teamId: "t1" }, true).map((row) => row.id), ["d3"]);
});
test("project activity does not leak other projects or archived content", () => {
  const rows = projectActivity({ ...data, runs: [{ id: "run1", project_id: "p1" }], events: [{ id: "e1", run_id: "run1", summary: "Ready", created_at: "2026-09-19" }, { id: "e2", run_id: "run2" }] }, "p1");
  assert.equal(rows[0].title, "Ready");
  assert.deepEqual(new Set(rows.map((row) => row.id)), new Set(["event-e1", "route-r1", "document-d2"]));
});
test("document downloads use a safe readable filename", () => {
  assert.equal(documentFilename("Plan / spec: v1"), "Plan - spec- v1.md");
  assert.equal(documentFilename(""), "Untitled document.md");
});
test("project dates reject a target before the start", () => {
  assert.equal(validateProjectDates("2026-09-20", "2026-09-19"), "Target date must be on or after the start date.");
  assert.equal(validateProjectDates("2026-09-19", "2026-09-19"), null);
  assert.equal(validateProjectDates("", "2026-09-19"), null);
});

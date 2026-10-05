PRAGMA foreign_keys = ON;

-- Local-only human review records. They never grant context access or transfer
-- review authority through a workspace archive. Parent knowledge IDs retain
-- historical identity and are checked against current scope on every read.
CREATE TABLE IF NOT EXISTS knowledge_conflicts (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  left_id TEXT NOT NULL, right_id TEXT NOT NULL,
  left_snapshot_json TEXT NOT NULL, right_snapshot_json TEXT NOT NULL,
  left_snapshot_hash TEXT NOT NULL, right_snapshot_hash TEXT NOT NULL,
  source_access_json TEXT NOT NULL, reason TEXT NOT NULL,
  reported_by TEXT NOT NULL, reported_by_name TEXT NOT NULL, created_at TEXT NOT NULL,
  CHECK(left_id<>right_id)
);
CREATE INDEX IF NOT EXISTS knowledge_conflicts_workspace ON knowledge_conflicts(workspace_id,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS knowledge_conflict_decisions (
  id TEXT PRIMARY KEY, conflict_id TEXT NOT NULL UNIQUE REFERENCES knowledge_conflicts(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK(decision IN ('keep_both','supersede_left','supersede_right')),
  rationale TEXT NOT NULL, reviewed_by TEXT NOT NULL, reviewed_by_name TEXT NOT NULL,
  left_after_hash TEXT NOT NULL, right_after_hash TEXT NOT NULL,
  left_after_version INTEGER NOT NULL, right_after_version INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_conflict_requests (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL, request_key TEXT NOT NULL, operation TEXT NOT NULL,
  fingerprint TEXT NOT NULL, conflict_id TEXT NOT NULL REFERENCES knowledge_conflicts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, PRIMARY KEY(workspace_id,actor_id,request_key)
);
CREATE TRIGGER IF NOT EXISTS knowledge_conflicts_immutable BEFORE UPDATE ON knowledge_conflicts
  BEGIN SELECT RAISE(ABORT,'Knowledge conflict reports are immutable'); END;
CREATE TRIGGER IF NOT EXISTS knowledge_conflict_decisions_immutable BEFORE UPDATE ON knowledge_conflict_decisions
  BEGIN SELECT RAISE(ABORT,'Knowledge conflict decisions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS knowledge_conflict_requests_immutable BEFORE UPDATE ON knowledge_conflict_requests
  BEGIN SELECT RAISE(ABORT,'Knowledge conflict receipts are immutable'); END;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS local_profile (
  id TEXT PRIMARY KEY CHECK (id = 'local'),
  name TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'briefcase',
  image_url TEXT,
  color TEXT NOT NULL DEFAULT '#6b7280',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  identifier TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  goal TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',
  icon TEXT NOT NULL DEFAULT 'folder',
  color TEXT NOT NULL DEFAULT '#737373',
  local_path TEXT,
  github_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, identifier)
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'users',
  color TEXT NOT NULL DEFAULT '',
  icon_color TEXT NOT NULL DEFAULT '',
  tab_icon_color TEXT NOT NULL DEFAULT 'team',
  empty_icon_color TEXT NOT NULL DEFAULT 'team',
  tab_label_color TEXT NOT NULL DEFAULT 'global',
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'Member',
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((team_id IS NULL) != (project_id IS NULL))
);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',
  target_date TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'backlog',
  priority TEXT NOT NULL DEFAULT 'no_priority',
  assignee_agent_ids_json TEXT NOT NULL DEFAULT '[]',
  labels_json TEXT NOT NULL DEFAULT '[]',
  due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, number)
);

-- Playbooks are separate from manual agent Workflows and legacy workspace rules.
-- Definition revisions are immutable; each execution pins one revision.
CREATE TABLE IF NOT EXISTS playbooks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  definition_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS playbooks_workspace ON playbooks(workspace_id, archived_at, updated_at);
CREATE TABLE IF NOT EXISTS playbook_versions (
  playbook_id TEXT NOT NULL REFERENCES playbooks(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(playbook_id, version)
);
CREATE TABLE IF NOT EXISTS playbook_runs (
  id TEXT PRIMARY KEY,
  playbook_id TEXT NOT NULL REFERENCES playbooks(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  playbook_version INTEGER NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE(playbook_id, trigger_key)
);
CREATE INDEX IF NOT EXISTS playbook_runs_workspace ON playbook_runs(workspace_id, created_at);
CREATE TABLE IF NOT EXISTS playbook_step_receipts (
  run_id TEXT NOT NULL REFERENCES playbook_runs(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  action_id TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(run_id, step_index)
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'general',
  participant_agent_ids_json TEXT NOT NULL DEFAULT '[]',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL,
  sender_id TEXT,
  sender_name TEXT NOT NULL,
  content TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'message',
  attachments_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'not_connected',
  mode TEXT NOT NULL DEFAULT 'demo',
  auth_method TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  constraints_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  last_probed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  chat_id TEXT REFERENCES chats(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'mock',
  archived_at TEXT,
  work_mode TEXT NOT NULL DEFAULT 'project',
  timeout_ms INTEGER NOT NULL DEFAULT 1800000,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(run_id, sequence)
);

-- Server-recorded invocation provenance and allowlisted terminal observations.
-- Historical scope IDs do not follow later moves or grant access by themselves.
CREATE TABLE IF NOT EXISTS run_usage_invocations (
  run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  mode TEXT NOT NULL,
  agent_id TEXT,
  agent_profile_version INTEGER,
  model TEXT,
  project_id TEXT,
  task_id TEXT,
  workflow_id TEXT,
  workflow_run_id TEXT,
  context_fingerprint TEXT NOT NULL,
  source_access_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  terminal_status TEXT,
  terminal_reason TEXT,
  finalized_at TEXT
);

CREATE TABLE IF NOT EXISTS run_usage_reports (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run_usage_invocations(run_id) ON DELETE CASCADE,
  report_hash TEXT NOT NULL,
  report_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  UNIQUE(run_id,report_hash)
);

CREATE INDEX IF NOT EXISTS run_usage_scope ON run_usage_invocations(workspace_id,started_at DESC);
CREATE TRIGGER IF NOT EXISTS run_usage_invocation_identity_immutable
BEFORE UPDATE OF run_id,workspace_id,provider,mode,agent_id,agent_profile_version,model,project_id,task_id,workflow_id,workflow_run_id,context_fingerprint,source_access_json,started_at
ON run_usage_invocations BEGIN SELECT RAISE(ABORT,'run usage invocation provenance is immutable'); END;
CREATE TRIGGER IF NOT EXISTS run_usage_invocation_final_once
BEFORE UPDATE OF terminal_status,terminal_reason,finalized_at ON run_usage_invocations
WHEN OLD.finalized_at IS NOT NULL AND (NEW.terminal_status IS NOT OLD.terminal_status OR NEW.terminal_reason IS NOT OLD.terminal_reason OR NEW.finalized_at IS NOT OLD.finalized_at)
BEGIN SELECT RAISE(ABORT,'run usage finalization is immutable'); END;
CREATE TRIGGER IF NOT EXISTS run_usage_reports_immutable BEFORE UPDATE ON run_usage_reports
BEGIN SELECT RAISE(ABORT,'run usage reports are immutable'); END;

CREATE TABLE IF NOT EXISTS chat_turns (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  client_turn_id TEXT NOT NULL,
  source_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(chat_id, client_turn_id)
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES run_events(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  decision_note TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'custom',
  role TEXT NOT NULL DEFAULT '',
  provider_connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  working_directory TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  model TEXT NOT NULL DEFAULT '',
  reasoning_effort TEXT NOT NULL DEFAULT '',
  memory_policy TEXT NOT NULL DEFAULT 'reviewed',
  context_source_ids_json TEXT NOT NULL DEFAULT '[]',
  default_area_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
  default_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  permission_policy TEXT NOT NULL DEFAULT 'review',
  output_behavior TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  color TEXT NOT NULL DEFAULT '#8b95a5',
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_profile_versions (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(agent_id, version)
);

CREATE TABLE IF NOT EXISTS agent_profile_content_restores (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  new_version INTEGER NOT NULL,
  source_version INTEGER NOT NULL,
  source_sha256 TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  restored_by TEXT NOT NULL,
  restored_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(agent_id,new_version),
  FOREIGN KEY(agent_id,source_version) REFERENCES agent_profile_versions(agent_id,version) ON DELETE CASCADE,
  FOREIGN KEY(agent_id,new_version) REFERENCES agent_profile_versions(agent_id,version) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_profile_history_requests (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  restoration_id TEXT NOT NULL REFERENCES agent_profile_content_restores(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(agent_id,actor_id,request_key)
);

CREATE TABLE IF NOT EXISTS memory_notes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  contract_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  classification TEXT NOT NULL,
  idempotency_key TEXT,
  input_hash TEXT NOT NULL,
  input_json TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT,
  error_json TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, tool_name, idempotency_key)
);

CREATE TABLE IF NOT EXISTS agent_tool_requests (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL UNIQUE REFERENCES agent_tool_calls(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review',
  version INTEGER NOT NULL DEFAULT 1,
  target_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  before_json TEXT NOT NULL,
  stale_guard_json TEXT NOT NULL,
  result_json TEXT,
  reviewer_id TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  CHECK(status IN ('pending_review', 'rejected', 'reviewed', 'applied'))
);

-- Versioned Skill reliability evidence is installed by
-- installSkillReliability at startup as well. These declarations keep fresh
-- schema builds inspectable without changing legacy skill_test_runs.
CREATE TABLE IF NOT EXISTS skill_evaluation_preparations (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES skill_versions(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  test_case_id TEXT NOT NULL,
  test_case_name TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  expected_output_hash TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE NO ACTION,
  team_id TEXT REFERENCES teams(id) ON DELETE NO ACTION,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE NO ACTION,
  profile_version INTEGER NOT NULL,
  prepared_by TEXT NOT NULL,
  work_mode TEXT NOT NULL,
  permission_mode TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL,
  native_tools INTEGER NOT NULL DEFAULT 0,
  context_request_json TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  source_access_json TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'prepared',
  version INTEGER NOT NULL DEFAULT 1,
  canonical_run_id TEXT REFERENCES runs(id) ON DELETE NO ACTION,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(status IN ('prepared','bound','evaluated','cancelled')),
  CHECK(work_mode IN ('conversation','project')),
  CHECK(permission_mode IN ('read-only','workspace-write')),
  CHECK(timeout_ms BETWEEN 1000 AND 1800000)
);

CREATE TABLE IF NOT EXISTS skill_evaluations (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES skill_versions(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  test_case_id TEXT NOT NULL,
  test_case_name TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  expected_output_hash TEXT NOT NULL,
  preparation_id TEXT NOT NULL UNIQUE REFERENCES skill_evaluation_preparations(id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE RESTRICT,
  artifact_type TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  artifact_content TEXT NOT NULL,
  run_status TEXT NOT NULL,
  run_error_code TEXT,
  outcome TEXT NOT NULL,
  evidence TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'reviewed_live',
  evaluator_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL,
  profile_snapshot_hash TEXT NOT NULL,
  context_fingerprint TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  evidence_version INTEGER NOT NULL DEFAULT 2,
  created_at TEXT NOT NULL,
  CHECK(outcome IN ('passed','failed')),
  CHECK(mode='reviewed_live'),
  CHECK(evidence_version=2),
  CHECK(artifact_type IN ('run_event','output_version'))
);

CREATE TABLE IF NOT EXISTS skill_evaluation_comparisons (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  test_case_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  left_evaluation_id TEXT NOT NULL REFERENCES skill_evaluations(id) ON DELETE RESTRICT,
  right_evaluation_id TEXT NOT NULL REFERENCES skill_evaluations(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL,
  rationale TEXT NOT NULL,
  evaluator_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK(decision IN ('left_better','right_better','equivalent','inconclusive')),
  CHECK(left_evaluation_id<>right_evaluation_id)
);

CREATE TABLE IF NOT EXISTS skill_reliability_requests (
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,actor_id,request_key)
);

-- Opt-in Route acceptance evidence. The service installer also creates these
-- additive tables and their indexes/immutability and workspace-cleanup triggers.
-- Policy requirements are portable; assessments and review authority are not.
CREATE TABLE IF NOT EXISTS route_acceptance_policies (
  route_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  policy_version INTEGER NOT NULL DEFAULT 2,
  enabled_by TEXT,
  enabled_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  CHECK(policy_version=2)
);

CREATE TABLE IF NOT EXISTS route_acceptance_assessments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  route_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agreement_version INTEGER NOT NULL,
  criterion_id TEXT NOT NULL,
  criterion_text TEXT NOT NULL,
  criterion_text_hash TEXT NOT NULL,
  output_id TEXT NOT NULL REFERENCES outputs(id) ON DELETE CASCADE,
  output_version_id TEXT NOT NULL REFERENCES output_versions(id) ON DELETE RESTRICT,
  output_content_hash TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_content_hash TEXT NOT NULL,
  artifact_content TEXT NOT NULL,
  source_access_json TEXT NOT NULL,
  decision TEXT NOT NULL,
  rationale TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  reviewer_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK(decision IN ('passed','failed')),
  CHECK(artifact_type IN ('output_version','run_event'))
);

CREATE TABLE IF NOT EXISTS output_acceptance_review_snapshots (
  review_id TEXT PRIMARY KEY REFERENCES output_reviews(id) ON DELETE CASCADE,
  output_id TEXT NOT NULL REFERENCES outputs(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  route_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  output_version_id TEXT NOT NULL REFERENCES output_versions(id) ON DELETE RESTRICT,
  agreement_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS acceptance_evidence_requests (
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,actor_id,request_key)
);

-- Private installation-local Workbench checkpoints. Contents are deliberately
-- excluded from bootstrap and workspace import/export.
CREATE TABLE IF NOT EXISTS workbench_checkpoints (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id TEXT,
  run_id TEXT,
  kind TEXT NOT NULL,
  parent_checkpoint_id TEXT REFERENCES workbench_checkpoints(id) ON DELETE CASCADE,
  historical_team_ids_json TEXT NOT NULL DEFAULT '[]',
  root_path TEXT NOT NULL,
  root_device TEXT NOT NULL,
  root_inode TEXT NOT NULL,
  complete INTEGER NOT NULL,
  limited INTEGER NOT NULL,
  file_count INTEGER NOT NULL,
  byte_size INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK(kind IN ('manual','before_run','after_run','pre_restore')),
  CHECK(complete IN (0,1)),
  CHECK(limited IN (0,1))
);

CREATE TABLE IF NOT EXISTS workbench_checkpoint_files (
  checkpoint_id TEXT NOT NULL REFERENCES workbench_checkpoints(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  state TEXT NOT NULL,
  sha256 TEXT,
  byte_size INTEGER NOT NULL,
  mode INTEGER,
  content BLOB,
  reason TEXT,
  PRIMARY KEY(checkpoint_id,path),
  CHECK(state IN ('present','absent','unavailable'))
);

CREATE TABLE IF NOT EXISTS workbench_checkpoint_restores (
  id TEXT PRIMARY KEY,
  checkpoint_id TEXT NOT NULL REFERENCES workbench_checkpoints(id) ON DELETE CASCADE,
  pre_restore_checkpoint_id TEXT NOT NULL REFERENCES workbench_checkpoints(id) ON DELETE RESTRICT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  status TEXT NOT NULL,
  preview_fingerprint TEXT NOT NULL,
  paths_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK(status IN ('in_progress','interrupted','completed','partial','failed'))
);

CREATE TABLE IF NOT EXISTS workbench_checkpoint_requests (
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  restore_id TEXT NOT NULL REFERENCES workbench_checkpoint_restores(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,actor_id,request_key)
);

CREATE INDEX IF NOT EXISTS workbench_checkpoints_project ON workbench_checkpoints(workspace_id,project_id,created_at DESC);
CREATE INDEX IF NOT EXISTS workbench_checkpoints_run ON workbench_checkpoints(run_id,created_at DESC);
CREATE TRIGGER IF NOT EXISTS workbench_checkpoints_immutable BEFORE UPDATE ON workbench_checkpoints
  BEGIN SELECT RAISE(ABORT,'Workbench checkpoints are immutable'); END;
CREATE TRIGGER IF NOT EXISTS workbench_checkpoint_files_immutable BEFORE UPDATE ON workbench_checkpoint_files
  BEGIN SELECT RAISE(ABORT,'Workbench checkpoint files are immutable'); END;
CREATE TRIGGER IF NOT EXISTS workbench_checkpoint_project_cleanup BEFORE DELETE ON projects BEGIN
  DELETE FROM workbench_checkpoint_restores WHERE project_id=OLD.id;
  DELETE FROM workbench_checkpoints WHERE project_id=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS workbench_checkpoint_workspace_cleanup BEFORE DELETE ON workspaces BEGIN
  DELETE FROM workbench_checkpoint_restores WHERE workspace_id=OLD.id;
  DELETE FROM workbench_checkpoints WHERE workspace_id=OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS skill_reliability_workspace_cleanup
BEFORE DELETE ON workspaces
BEGIN
  DELETE FROM skill_evaluation_comparisons WHERE workspace_id=OLD.id;
  DELETE FROM skill_evaluations WHERE workspace_id=OLD.id;
  DELETE FROM skill_reliability_requests WHERE workspace_id=OLD.id;
  DELETE FROM skill_evaluation_preparations WHERE workspace_id=OLD.id;
END;

CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_chats_workspace ON chats(workspace_id);
CREATE INDEX IF NOT EXISTS idx_chats_project ON chats(project_id);
CREATE INDEX IF NOT EXISTS idx_chats_task ON chats(task_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_runs_workspace ON runs(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_memory_workspace ON memory_notes(workspace_id);
CREATE INDEX IF NOT EXISTS agent_tool_calls_run ON agent_tool_calls(run_id, created_at);
CREATE INDEX IF NOT EXISTS agent_tool_requests_run ON agent_tool_requests(run_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_teams_workspace ON teams(workspace_id);
CREATE INDEX IF NOT EXISTS idx_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
CREATE INDEX IF NOT EXISTS idx_documents_team ON documents(team_id);
CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);

-- Answers to custom template fields remain structured and pinned to the
-- definition used at creation. They are fetched only after the parent item's
-- current read scope is checked; never include this table in broad bootstrap.
CREATE TABLE IF NOT EXISTS workspace_template_instances (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  template_id TEXT REFERENCES workspace_items(id) ON DELETE SET NULL,
  template_version INTEGER NOT NULL,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('tasks','projects','chats')),
  entity_id TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  values_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(entity_type,entity_id)
);
CREATE INDEX IF NOT EXISTS workspace_template_instances_scope
  ON workspace_template_instances(workspace_id,entity_type,entity_id);
CREATE TRIGGER IF NOT EXISTS template_instances_after_task_delete
AFTER DELETE ON tasks BEGIN
  DELETE FROM workspace_template_instances WHERE entity_type='tasks' AND entity_id=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS template_instances_after_project_delete
AFTER DELETE ON projects BEGIN
  DELETE FROM workspace_template_instances WHERE entity_type='projects' AND entity_id=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS template_instances_after_chat_delete
AFTER DELETE ON chats BEGIN
  DELETE FROM workspace_template_instances WHERE entity_type='chats' AND entity_id=OLD.id;
END;

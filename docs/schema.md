# Schema and migration contract

Updated October 4, 2026. SQLite is the local source of truth. `server/schema.sql` defines base tables; service installers add extension tables and columns. Review both when changing the schema. This document covers the additive solo-first slices and their compatibility boundaries.

## Workspace pictures and status icons

`workspaces.image_url` is an optional, additively migrated image field. Existing rows remain unchanged. The workspace editor reuses the PNG/JPEG/WebP crop flow and the server's bounded image validation. Workspace JSON export includes the image; import validates and restores it into a new workspace. Clearing a picture writes `NULL` and returns to the Rumbo symbol. Custom Route and project status resources retain their lifecycle category while an optional catalog-backed icon choice is stored in their existing payload; no status identifiers or linked work items are rewritten.

## Rumbo Agent compatibility storage

Rumbo Agent uses existing `chats` (`kind='rumbo-agent'`), agent profiles, messages, runs, settings and chat-collaboration storage rather than a second execution engine. Workspace-scoped preferences contain provider/model/context defaults only. Explicit chat creation uses an actor/workspace-bound request identity for replay protection; source references in chat collaboration retain provenance and are revalidated through the canonical context compiler. Effective model/reasoning are captured with the user turn and used for retry validation. Existing records are not renamed or deleted, and opening the assistant does not provision an account/profile or start a run.

The `rumboAgent:<workspaceId>` settings value stores validated defaults, including `include_workspace`; it is never an access grant. `rumbo_creation` and optional `rumbo_source` in chat collaboration preserve server-owned creation/source identity independently of display fields. Bounded workspace-index rows participate in the same captured/current access checks. `include_workspace` joins model/reasoning in turn metadata and exact context selection. Source-dependent retained artifacts block permanent chat deletion rather than losing provenance through null foreign keys; archive is recoverable. No schema migration or live-data rewrite is needed for this slice.

## Areas compatibility storage

An Area continues to use its original row in `teams`. The primary key is unchanged. Existing `team_id` columns on projects, Routes (`tasks`), documents, directory entries and resources keep the same values. Historical change records, legacy links, scope grants and archived rows remain intact. Legacy API/storage identifiers are compatibility names, not a second Team hierarchy.

`server/area-service.mjs` installs `area_settings`:

| Column | Meaning |
| --- | --- |
| `id` | Primary key and foreign key to `teams(id)`; same stable Area identity. |
| `workspace_id` | Owning workspace; validated against the Area and every selected source. |
| `instructions` | Bounded Area guidance, up to 20,000 characters; untrusted content, not execution authority. |
| `default_agent_ids_json` | Unique selected workspace agent IDs. |
| `context_pack_ids_json` | Unique Context Pack IDs; packs and their source references must remain in the workspace and accessible. |
| `allowed_tools_json` | Allowlisted read-tool **preferences**, not a permission grant or an implemented native-tool claim. |
| `permission_policy` | Only `review` is accepted by the current schema and service. |
| `contacts_enabled` | Optional Contacts visibility. Hiding does not delete `team_members`. |
| `version` | Optimistic update version. Unsaved/default settings report version 0; first persistence becomes version 1. |
| `updated_at` | Server-recorded modification timestamp. |

All reference/tool lists are bounded to 50 unique strings. Read-tool preference names are `search_workspace`, `get_area_context`, `get_project_context`, `get_route`, `search_knowledge` and `read_document`. Saving them does not create native tool execution endpoints.

`GET /api/areas/:id/settings` returns saved or derived defaults. `PATCH` requires current `version`, editable Area scope and valid references. Writes are transactional and produce a change record. The current schema migration creates an additive table; it does not recreate legacy rows or rewrite ownership.

## Export and import

Area settings extend the existing workspace archive. Import creates a new workspace, remaps Area IDs through legacy `teams` mappings and remaps agent/Context Pack references. Imported policy is review-only. Credentials, folder paths/grants, active processes and execution approvals are never restored from these settings. Existing optional Contacts are ordinary retained directory content, not authenticated memberships.

Workspace JSON is **not** a complete installation backup: resource file bytes, credentials and some existing history/memory extension data remain outside that format. Keep the existing export limitations visible. Do not infer that including Area defaults solves those unrelated omissions.

## Backup and reversibility

Before a live migration, stop writes or use a consistent SQLite backup and verify its integrity. The migration checkpoint for this implementation is `.rumbo/backups/pre-areas-20260922`; the operator recorded a successful integrity check before applying live schema changes. The checkpoint is private local data, never a Git artifact.

Because this migration is additive, rolling the application back leaves old Team identities and relationships available; the extra settings table can remain unused. Do not drop it automatically. Restoring a backup is a separate destructive operation: stop the server, preserve a copy of the current data, obtain explicit confirmation, then restore the selected consistent checkpoint. A full restore would discard work recorded after that checkpoint unless separately recovered.

## Versioned Skills

`server/skills-service.mjs` adds four tables:

- `skills`: stable workspace identity, optional project/Area ownership, name/purpose, current definition number, draft/published state, exact published version, sanitized provenance and archive timestamp. Scoped parents cannot be deleted while Skills reference them; archiving remains available without widening access.
- `skill_versions`: append-only definitions with unique `(skill_id, number)`, author attribution and creation time. Definitions contain typed inputs (`string`, `number`, `boolean`, `enum`), instructions, `{kind,id}` required-context references, tool preferences, preferred profile, capabilities, output format, examples, approval policy and test cases. Tools are declarations, not grants; approval policy is `always`.
- `skill_test_runs`: legacy handwritten observations pinned to an immutable version. These records retain their attribution and inputs but do not satisfy the current case-bound evidence policy.
- `skill_request_keys`: optional actor/workspace-scoped retry keys with request fingerprints and recorded results. A key cannot be reused for different input; replay rechecks access before returning a result.

`GET/POST /api/skills`, `GET/PATCH /api/skills/:id`, `POST /api/skills/:id/test`, `POST /api/skills/:id/publish` and `POST /api/skills/from-run` provide the backend. A detail response bundles `skill`, immutable `versions` and legacy `test_runs`. Content edits append a new draft version with optimistic concurrency. New versions use evidence policy 2 with stable test-case IDs. Publication requires instructions, output format, test cases and a qualifying reviewed canonical-run pass for every case in that exact version. Old published definitions remain intact; changing or republishing a legacy definition requires an explicit new version and current evidence.

Completed-run conversion creates a draft containing only user-supplied reusable fields and a provenance link. Original prompts, replies, attachments and conversation history are not copied. Without explicit sanitized instructions the instructions are blank. Archive requires confirmation and archive permission; restore preserves history but returns to a draft requiring fresh evaluation.

All Skill reads, writes, bootstrap data and histories enforce workspace/parent scope and required-context access. Workspace import remaps Skill/version/context/profile/test references, clears execution provenance and publication, resets author/evaluator identities and marks imported observations as historical. Imported passed notes cannot satisfy publication: the restored draft needs fresh case-bound evidence. Current Skills store and validate capabilities; they are not themselves a native tool runner or workflow engine.

## Case-bound Skill evaluation evidence

`server/skill-reliability-service.mjs` adds four installation-local tables:

- `skill_evaluation_preparations` pins a Skill version/case, typed case inputs, expected-result hash, profile version, scope, execution mode, permissions, context request and source boundary. A hashed private token authorizes one canonical run binding, not additional tools. Preparations expire after ten minutes; cancellation is explicit.
- `skill_evaluations` is immutable evidence: one terminal canonical live run per preparation, exact recorded terminal reply or output version, content hash, human verdict/rationale, evaluator identity, captured profile hash and context fingerprint. Failed/stopped runs cannot pass. A completed process without recorded reply evidence cannot pass merely because it ended successfully.
- `skill_evaluation_comparisons` records immutable human comparisons of two evaluations with the same stable case and input hash. Profile/model and context may differ; this is not a controlled benchmark, automatic model selection or an invented confidence score.
- `skill_reliability_requests` stores actor/workspace-scoped idempotency receipts. Replays recheck current source/evidence access and cannot start a duplicate run.

`POST /api/skills/:id/evaluations/prepare` reserves a case and returns separate Context Inspector and launch requests. The expected answer is for the human reviewer, not part of the provider prompt. Preparing or inspecting never starts a provider. The ordinary live `/api/runs` endpoint requires the reviewed inspection and private preparation binding; capture, binding and run creation share a transaction before dispatch. `POST /api/skills/:id/evaluations` accepts a selected server artifact and verdict, not caller-authored replacement evidence. `POST /api/skills/:id/comparisons` records a comparison; `POST /api/skills/:id/evaluation-preparations/:preparationId/cancel` cancels unused preparation.

`GET /api/skills/:id/reliability` returns current-case coverage and up to 100 preparations, evaluations and comparisons, filtered by current access. Coverage uses the latest evaluation per case; an inaccessible latest result becomes missing rather than falling back to an older pass. Access to captured context and output evidence is rechecked on reads, grading, comparisons, publication and replay. These tables, tokens and authority are excluded from workspace JSON import/export. Legacy observations remain visible separately and cannot turn into verified execution history through import.

`output_reviews.reviewer_id` is an additive, server-owned identity field for new human reviews. A typed reviewer name remains display attribution, not an authenticated signature. Legacy/imported review rows retain their original text with an unknown (`NULL`) server identity; importing history does not impersonate that reviewer. Agent callers cannot record review decisions.

A verified consistent backup preceded this slice under `.rumbo/backups/pre-reliability-*`. Schema changes are additive; no old observations, reviews, definitions or workspace resources are discarded.

## Route acceptance evidence

Route-linked outputs may opt into evidence policy 2. `route_acceptance_policies` keeps the stable Route/workspace IDs, policy version and enabling actor/time. Absence means legacy policy 1. Enabling requires a saved agreement with criteria, the current agreement version, editable scope and explicit confirmation. There is no downgrade endpoint. This does not change an existing approval or mark a Route complete.

`route_acceptance_assessments` is an immutable ledger of human pass/fail assessments. Each row pins the agreement revision, criterion ID/text/hash, current output-version ID/content hash, exact output artifact or canonical terminal run result, captured source ancestry, reviewer actor and rationale. The artifact body is server-derived; pasted replacement evidence is not accepted. New assessments do not approve an output. A changed agreement or output version requires fresh coverage. Equal timestamps use insertion order; an inaccessible latest result becomes missing, never an older pass.

Approval uses the existing output-review endpoint. For policy 2 it checks complete current pass coverage inside the review transaction, then stores `output_acceptance_review_snapshots` separately from legacy review rows. This captures the accepted criteria and assessment references for the exact reviewed output. Generic history/bootstrap/export does not expose the evidence ledger or snapshots. Later edits do not rewrite that historical decision. Current and captured source access—including captured run context for run-derived outputs—must still permit reading evidence. Old reviews are not backfilled with invented evidence.

`acceptance_evidence_requests` contains actor/workspace-scoped idempotency receipts; replay rechecks access. `GET/POST /api/workflow/routes/:id/acceptance-policy` reads or explicitly enables policy. `GET/POST /api/workflow/outputs/:id/acceptance-evidence` reads current coverage or records one criterion assessment. Reads launch no provider and make no workspace mutation. History responses expose up to 500 readable assessments and 100 accepted checklists; current coverage uses the full ledger. Pagination is not yet available.

Workspace export includes only the safe `route_workflows[].acceptance_policy_version` requirement. Import remaps the Route and preserves policy 2 with unknown enabling identity, but imports no assessments, review snapshots, receipts or grants. Restored outputs require fresh review and evidence. Legacy archives without this field keep policy 1. Cleanup triggers remove the local ledgers during an otherwise authorized workspace deletion without leaving blocking foreign keys.

A verified consistent backup preceded this additive slice under `.rumbo/backups/pre-acceptance-evidence-*`. No real-provider account or real-workspace fixture is needed for its tests.

## Agent profiles and exact run context

`connections` contains installation-level provider identities; `agents` contains separate profiles; `platform_connections` contains workspace service authorization. `ai_account_connections` is a separate per-workspace, per-actor browser AI account ledger; it currently stores OpenRouter's user-controlled key and Hugging Face OAuth tokens encrypted with AES-256-GCM using the private connection key. `ai_authorization_attempts` holds a ten-minute, actor/workspace/origin-bound one-use PKCE verifier encrypted at rest. The callback checks the same signed-in actor and current workspace access before exchanging a code; disconnect removes local credentials and pending attempts but does not revoke the remote provider grant. Neither AI table is part of workspace export/import, a provider profile binding, or a public-hosting authorization grant. Do not merge these stores or copy credentials into profiles. Additive profile fields include shared binding, role, model/reasoning, memory policy, context-pack IDs, default Area/project, permission policy and output behavior. `agent_profile_versions` retains immutable definitions; `runs.agent_profile_version` pins execution. Model and supported reasoning defaults are passed to the provider adapter, not treated as new accounts. Updates accept an optimistic profile version. Imports remap safe references, clear provider bindings/folders and force read-only; old agents are migrated once without rebinding deliberately unbound profiles.

### Instruction history and content-only restoration

`GET /api/agents/:id/content-history` returns content-only snapshots (role, description, instructions, output behavior), time, content SHA-256 and recorded attribution where available. It supports an exclusive `before_version` cursor with `limit` 1–50 (default 20), or an exact `version` query. The stored full snapshot hash is verified first. Current and historical reference checks produce explicit restricted summaries without content or hashes; unavailable content is never compared as deleted text. Missing legacy authors are not reconstructed from a display name. The older full-profile `/versions` API retains its compatibility redaction behavior.

`POST /api/agents/:id/restore-content` requires `current_version`, `source_version`, `source_hash`, a nonempty subset of the four text fields, `confirmed:true`, and a stable `request_id`. Fresh agent read and write permission are both required; shared profiles require the installation owner. Agent callers cannot restore themselves. The server derives selected text from the same agent's saved version and atomically appends a new profile version, audit entry, restoration provenance and retry receipt. Provider, connection, model/reasoning, folder, context, memory, name, status and permission settings are not restorable through this endpoint. Existing runs and context snapshots remain pinned.

`agent_profile_content_restores` records source/new versions, content hash, selected fields and server actor. `agent_profile_history_requests` stores actor/agent-bound idempotency receipts; replay rechecks current and source access and never overwrites later edits. UPDATE-blocking triggers protect profile snapshots and restore provenance while allowing authorized parent deletion to cascade. These new local ledgers are not exported or imported as authority. Explicitly restored text becomes agent-owned instruction content; generic agent/audit reads are not a separate source-document revocation boundary. No document content is automatically copied by a restore.

A consistent backup under `.rumbo/backups/pre-profile-history-*` preceded this additive migration. Tests use isolated fixtures. Skill definition comparison uses already authorized immutable versions and adds no schema or execution authority.

`run_context_inspections` holds immutable actor/workspace-bound normalized input, exact prompt/manifest, private runtime nonce and a ten-minute expiry. One preview may be consumed by one run; same-run consumption is idempotent. `run_context_snapshots` holds the immutable inspection captured for a run. Preview consumption and capture share the run/message transaction. These tables are internal installation history, not execution grants or portable workspace-import content. SQL triggers prevent rewrites. No expired-preview cleanup is automatic yet.

`POST /api/context/inspect` creates a preview without provider calls. Live run/chat endpoints accept `context_inspection_id`, normalize the same input and recompile under current access. A changed request/fingerprint rejects before creating run/message state. Legacy launches use the same compiler and capture. `GET /api/runs/:id/context` first authorizes the run and rechecks captured source access; older runs return explicit `context_not_recorded`. Snapshot prompt text does not include provider-owned hidden instructions or subsequent tool reads. Reliable counts are UTF-16 characters and UTF-8 bytes, not invented token/usage estimates.

Verified local SQLite backups were taken before profile and context migrations; private checkpoint directories are under `.rumbo/backups/pre-agent-studio-*` and `.rumbo/backups/pre-context-inspector-*`. Use Node SQLite's consistent backup API and verify nonzero size, schema contents and integrity before touching live data; a successful check of an empty file is not sufficient.

## Knowledge conflict review

`knowledge_conflicts` stores an immutable human report with two server-derived Knowledge snapshots, exact versions/content hashes, captured historical source-access boundaries, reason and server actor. `knowledge_conflict_decisions` stores one immutable `keep_both`, `supersede_left` or `supersede_right` decision, rationale, actor and resulting source pins. Status and freshness are derived, not caller-authored. `knowledge_conflict_requests` provides actor/workspace-bound retry protection. Reports and decisions require both-source read/write access, including historical scope on replay. A report itself changes neither approval nor future context selection. Explicit superseding updates only the chosen entry's state/version and change log, atomically with the review receipt. Existing snapshots are never rewritten.

`GET /api/knowledge-conflicts?workspace_id=…&status=all|open|resolved` returns up to 50 accessible reports with `has_more`; pagination is not implemented. `POST /api/knowledge-conflicts` pins current approved pairs and a rationale; `GET /:id` reads exact reported content; `POST /:id/decision` requires confirmation and a stable request key. Changed source hashes/versions block decisions. Stale reports remain historical and require a fresh current-version report; there is no stale-dismiss endpoint yet. Missing/revoked source access withholds the pair entirely, including list counts and labels.

An explicit `GET /api/knowledge-conflicts/candidates?workspace_id=…` scans at most 500 accessible approved entries and returns at most 50 pairs with the same normalized title, project scope and kind but different content. It reports scan bounds and makes no semantic accuracy/confidence claim. It changes no state and starts no provider. Ordinary memory notes and agent memories are not silently merged into the approved-Knowledge store.

Context Inspector records unresolved human-review notices only when both pair IDs already appear in its included knowledge. The notice is part of the exact Rumbo prompt and fingerprint; both entries' captured/current source boundaries protect later reads. A report is not authorization or a verified contradiction. Explicit superseding excludes an entry from future automatic approved-knowledge inclusion, without modifying old captures. Reports/decisions/receipts are private installation records, excluded from workspace import/export. A consistent integrity-checked backup under `.rumbo/backups/pre-knowledge-conflicts-*` preceded the additive tables; authorized workspace deletion cascades their records.

## Recorded provider usage

`run_usage_invocations` pins each independently launched canonical live Codex/Claude run: workspace, provider, agent/profile version, configured model, project/Route, Workflow attempt, exact context fingerprint and historical source-access boundary. Historical parent IDs are provenance, not mutable foreign keys. A new invocation is inserted inside the run/context transaction before spawning. Finalization is write-once; restart marks unfinished records interrupted. `run_usage_reports` contains only allowlisted normalized terminal counters, a content hash and timestamp. Exact duplicates are ignored; different terminal reports for one invocation are ambiguous, never summed. UPDATE-blocking triggers protect both ledgers. No prompt, credential or arbitrary provider payload belongs here.

Codex `turn.completed.usage` records input, cached-input, output and reasoning-output counters separately. Cached input is a subset, not an additional charge. Claude final `result` records separate main-loop and all-model families; assistant-message counters are not totals. Missing/unsafe counters remain `null`; model count alone is not consumption evidence. Documented unreliable all-zero execution-error reports remain unknown. `total_cost_usd` is a provider-client price-table estimate, not authoritative billing. Independent invocation support does not imply support for resumed-session accounting. See the official [Codex JSON event example](https://learn.chatgpt.com/docs/non-interactive-mode) and [Claude cost-tracking semantics](https://code.claude.com/docs/en/agent-sdk/cost-tracking).

`GET /api/runs/:id/usage` returns measured/unknown/partial/ambiguous state, captured launch provenance, distinct metric families and explicit limitations. `GET /api/usage?workspace_id=…&group_by=agent|project|workflow` accepts exact agent/project/Workflow and inclusive `from`/exclusive `to` start-time filters. It scans a bounded window of at most 5,000 currently readable eligible runs. Historical and current run/context/parent permissions are checked before counts, groups, labels or denominators. Missing captured provenance fails closed. Subtotal overflow is unknown, not a rounded or coerced measurement. Report counts and metric coverage distinguish failed/interrupted partial reports from completed terminal reports.

No usage request starts a provider or probes an account. Old untracked live runs remain unknown; simulations, definitions and prepared Workflow steps are excluded. Real retry invocations are separate canonical runs. Ledger data is installation-local and excluded from portable workspace import/export. A verified consistent backup under `.rumbo/backups/pre-run-usage-*` preceded this additive migration. Removing a parent preserves immutable IDs; authorized workspace deletion cleans up the ledger. This is not billing reconciliation, account allowance reporting or spend enforcement.

## Manual Workflows

`server/manual-workflow-service.mjs` adds an execution ledger alongside the existing plans. `work_plans.kind` defaults to `plan`, preserving existing rows and legacy plan APIs. Executable definitions use `manual_workflow`; legacy plan endpoints cannot mutate them.

- `work_plan_versions` pins a definition: typed inputs, bounded agent/Skill steps, conditions, explicit handoffs, human gates and the server-supported approved-knowledge tool. Profile and Skill versions are explicit; creating a new version does not rewrite an existing run.
- `work_plan_runs` records inputs and a pinned definition version. Creating or previewing a run never starts a provider.
- `work_plan_step_runs` records numbered attempts and their canonical `runs` binding, exact output/version/review IDs, preparation expiry, failures and optimistic versions. Private preparation tokens are hashed; canonical run creation, reviewed-context capture and attempt binding share a transaction before process launch.
- `work_plan_approvals` records explicit human decisions. The workflow requests approval; the solo user may decide it. Agent text is not a decision.
- `work_plan_requests` stores actor/workspace-scoped idempotency receipts. `work_plan_audit` stores attributed actions. Internal requests and preparation material are not shared bootstrap data.

Endpoints are `/api/coordination/workflows`, `/api/coordination/workflows/:id/{versions,preview,runs}`, and `/api/coordination/workflow-runs/:id[/actions]`. Actions prepare a step, reconcile a terminal canonical run, retry within a bounded attempt budget, decide a gate, finalize approved knowledge, or cancel. Agent steps use the normal Context Inspector and live-run API; the workflow service does not create another provider process implementation. No background scheduler or uncontrolled agent conversation is introduced.

`runs.timeout_ms` defaults to 1,800,000 and permits 1,000–1,800,000 milliseconds. The adapter enforces this **provider execution** bound and records `run_timeout`. Provider setup and the termination grace period are additional; it is not a claim of exact whole-request wall-clock timing. Token and cost limits remain explicitly unsupported: terminal counters and client estimates do not supply continuous account-level metering or enforcement.

Bootstrap uses separate `manual_workflows`, `manual_workflow_versions`, `manual_workflow_runs`, `manual_workflow_step_runs` and `manual_workflow_approvals` collections. Workspace export/import carries reusable definitions and versions only. Imports remap references, repin imported profile versions, force step permissions to read-only and pause the workflow. Imported agents remain unbound; historical approvals, process bindings, reservations and run claims do not become authority. Imported knowledge remains draft and must be reviewed before it can become run context.

A verified SQLite backup preceded this migration under `.rumbo/backups/pre-manual-workflow-*`. Additive schema changes do not delete old plan data. Restoration is an explicit local-data operation, not an automatic downgrade.

## Run-bound native tools

`agent_tool_calls` is the bounded audit ledger for native MCP calls. Each row pins the workspace, canonical live run, agent, versioned contract ID, tool name/classification, canonical input hash, status and bounded result or structured error. Write calls also use a caller key unique to `(run_id, tool_name, idempotency_key)`; replay with changed input is rejected. Invalid inputs are recorded with redacted input rather than persisting untrusted malformed values.

`agent_tool_requests` stores proposed effects separately from calls. It contains the exact target/payload/before state, a stale-target guard, optimistic version, decision, reviewer and apply result. Status is `pending_review`, `rejected`, `reviewed` or `applied`. Agent callers cannot decide requests. Approval rechecks the captured source boundary, the current target, the original run sponsor, the reviewer and both parties' current permission before a synchronous allowlisted handler may write.

Native tools are enabled only when `native_tools: true` was included in an actor-bound Context Inspector preview and consumed by the matching live run. The run must have a connected active profile, pinned profile version and authenticated sponsor. Available names are captured in the manifest; Area/Skill tool preferences alone are not grants. The private bridge is a per-run Unix socket and random in-memory capability exposed to only the generated `rumbo` MCP stdio process. It is bounded and revoked on stop, completion, expiry or startup failure. There is no HTTP/browser tool-invocation endpoint.

Read contracts (`search_workspace`, Area/Project/Route context, approved-knowledge search and document read) return only exact included captured sections and recheck historical plus current source access. Write contracts create pending review for a draft Route, allowlisted Project patch, draft memory candidate or review-needed output. `request_permission` remains a reviewed record with `grants_access: false`; `handoff_to_agent` remains a reviewed record with `launches_agent: false`. Approved memory is still governed by the existing knowledge review lifecycle, and output acceptance remains an exact-version human review.

`GET /api/runs/:id/native-tools` returns permission-filtered call/request history after current authority checks. `POST /api/native-tool-requests/:id/decision` is the human review surface. Native call authority and capability material are installation runtime state and are intentionally omitted from workspace export/import; imports cannot restore calls, requests, approvals, sockets or execution authority.

## Today read model


`GET /api/today?workspace_id=…&area_id=…&project_id=…` derives a bounded, permission-filtered summary from existing records. Workspace is required; Area and Project are optional, must be active and accessible, and must agree when both are selected. No new table, migration, provider probe or execution side effect is introduced. Sections are limited to 24 entries, failure groups to 12, and context warnings to 24; displayed counts describe returned entries, not an unlimited backlog total. Native pending reviews use the cached native authority service, not raw proposal payloads.

Context Snapshot access also validates its nested source graph for list, direct, result and history reads. Revoked/deleted sources fail closed. Legacy snapshots did not record original source ancestry; current source access and recorded container-history scope can be checked, but missing historical permissions cannot be reconstructed. Captured run and Workflow context retain their stronger historical source-access records.

## Manual Workbench checkpoints

`workbench_checkpoints` and `workbench_checkpoint_files` preserve immutable snapshot metadata, the exact linked physical root identity, historical Area IDs, file state, SHA-256, mode and bounded UTF-8 bytes. Header and file records are inserted together in a savepoint. Automatic enumeration includes Git-tracked and unignored untracked paths at the linked repository root, with at most 200 files, 512,000 bytes per file and 2,000,000 total bytes. Private paths, binaries, invalid UTF-8, inaccessible paths and unsupported files are excluded with bounded/incomplete reporting. An omitted path is never inferred to have been absent. Explicit path capture can record absence only when its existing parent is safe. No parent directories are created by restore.

`workbench_checkpoint_restores` records per-file outcomes and the exact pre-restore recovery checkpoint. `workbench_checkpoint_requests` binds an actor/workspace retry key to its payload and operation before staging or filesystem writes. Startup marks unfinished operations `interrupted`; replay returns the recorded uncertain result and never resumes filesystem changes automatically. Runtime restore operations serialize by physical device/inode, including different Projects linked to the same root. Fresh root, human read/write, historical Area access, active provider/terminal and file state/hash/mode checks protect each restore. Multi-file writes are not an atomic transaction. External OS processes are not locked; a remaining filesystem check/write race cannot be eliminated by these application checks. Interruption tests use deterministic ledger fixtures, not a power-loss durability claim.

Endpoints use `{result:…}`: list `GET /api/workbench/checkpoints?workspace_id=…&project_id=…&run_id=…` returns at most 100 recent metadata records; manual capture `POST /api/workbench/checkpoints` accepts workspace/project, optional environment and optional explicit paths. Capture persists history and requires write access; uncertain capture must be checked in the list rather than retried automatically. `GET /api/workbench/checkpoints/:id` returns the manifest. `POST /:id/preview` accepts selected paths and returns exact current/desired text, modes, hashes and a preview fingerprint without changing files. `POST /:id/restore` requires that fingerprint, checkpoint version, selected current-state/hash pins (mode is recommended and also fingerprint-bound), `confirmed:true`, and a stable `request_id`. At most 50 selected paths can be restored at once. No endpoint changes Git index, commits, branches or unselected files.

Checkpoint records are private installation history, excluded from bootstrap and workspace JSON export/import. They do not grant folder access and are not native agent tools. Project/workspace deletion removes associated private ledgers; checkpoint deletion/restoration is not exposed through generic CRUD. A consistent live backup at `.rumbo/backups/pre-workbench-checkpoints-e0Fwtm/rumbo.sqlite` passed SQLite integrity and foreign-key checks before the additive schema was installed. This manual surface does not replace the existing before/after run comparison mechanism or automatically create run checkpoints.

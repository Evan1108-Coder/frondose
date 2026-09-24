# Solo-first AI work environment

Decision recorded September 22, 2026. This document separates the intended product from the implementation already available. The first implementation slice is Areas; later slices must pass their own verification before being described as complete.

## Product model

**Intent → Route → Run → Output → Review → Memory**

An Area is a durable domain of one person's work, not a human department. Projects collect outcomes; Routes remain connected work units. Conversations preserve discussion, runs record bounded execution, outputs preserve exact deliverables, and review determines acceptance. Successful execution alone is neither approval nor authority to save knowledge into memory.

Provider connections own execution access. Multiple profiles share one connected account and its limits, with independent instructions and histories. Profiles are not separate provider accounts. Ordinary ChatGPT or Claude chat history is unavailable unless a supported provider interface actually supplies it.

Prompt, Skill and Workflow are distinct:

- A Prompt is a message or instruction.
- A Skill is a reusable, versioned capability with defined inputs, context, tools, expected output, examples, approvals, tests and evidence.
- A Workflow coordinates bounded agent, Skill, tool and human-decision steps.

The eventual main navigation is Today, Conversations, Agents, Workflows, Projects, Knowledge, Runs, Connections and Settings. Areas organize and filter these surfaces. Do not relabel incomplete features to imply this entire system exists.

## Ordered vertical slices

| Order | Slice | Completion boundary |
| --- | --- | --- |
| 1 | Repository and migration audit | Inspect concurrent changes, rerun tests/build, map existing architecture, back up live data and document migration risks. |
| 2 | Teams → Areas | Preserve IDs, ownership, grants, history and resources; add scoped defaults and optional Contacts; verify migration and import/export without changing execution access. |
| 3 | Provider connections and profiles | Explicit shared connection identity, capability-backed profile defaults, no credential duplication and immutable execution configuration. |
| 4 | Agent Studio foundation | Searchable roster, instructions, context, tools, permissions, conversations, runs/results and safe lifecycle actions; distinguish tests/simulations from live work. |
| 5 | Versioned Skills | Typed inputs, immutable versions, required context/capabilities, allowed tools, approvals, examples, manual tests and run evidence. Conversion from a run must remove one-off context deliberately. |
| 6 | Context Inspector and Packs | One server compiler previews the exact bounded payload and tool/permission manifest later consumed by the run; show exclusions, unavailable sources and truncation. |
| 7 | One complete manual Workflow | Persist definition versions, steps/attempts, handoffs, human gates, failure/retry bounds, outputs and history. Complete the representative workflow below before background scheduling. |
| 8 | Native agent tool contracts | Run-bound server authority, stable IDs, scope validation, read/write classes, explicit approvals, structured errors, idempotency and audit. |
| 9 | Today command center | Needs you, working now, ready for review, proposed next work and recent context; opening the page starts nothing. |
| 10 | Reliability and automation | Acceptance/evidence verification, real evaluations, failure grouping, inspection, reliable usage, stale/contradictory context, checkpoints and explicitly authorized automation. |

Representative manual Workflow: feature request → Researcher analysis → Planner plan → human approval → Builder implementation → Reviewer diff/test review → human acceptance → approved memory candidate. Every invocation needs a role, explicit context, expected output, limit and stopping condition. No indefinite agent group chats.

## First slice: Areas

Reuse existing Team identities and all their linked work. Keep compatibility storage and routes rather than destructively renaming tables or regenerating IDs. Add `area_settings` beside the existing record for Area instructions, default workspace agents, Context Packs, read-tool preferences, review-only policy and optional Contacts.

Saved Area defaults do **not** grant tools or widen permissions. The Context Inspector now resolves the selected Area's instructions and packs through the current access boundary and exposes them for review before a run. Existing Contacts remain recoverable when hidden. Import remaps Area, agent and pack references into a new workspace and cannot restore execution authority or folders. See [schema documentation](schema.md).

## Architecture to extend, not replace

- `server/integration-service.mjs`: restricted CLI adapters, explicit readiness, bounded execution, stop/events and injected test providers.
- `src/views/AgentRoster.jsx`, `src/components/AgentEditor.jsx`: searchable profiles, independent instructions, stable-ID histories and explicit simulation.
- `server/chat-collaboration.mjs` and `server/workflow-service.mjs`: immutable context snapshots, bounded Context Packs, versioned outputs and exact-version review.
- `server/coordination-service.mjs`: manual work plans, acyclic dependencies, preparation, run links and recorded handoffs. This is not yet a workflow execution engine.
- `server/agent-awareness.mjs`: scoped approved memories and reviewed final-reply proposals. This remains a separate fallback protocol when a run does not opt into native tools.
- `server/access-boundary.mjs`, `server/native-agent-tool-authority.mjs` and `server/native-agent-tools.mjs`: current membership plus run/profile/sponsor/captured-source authority, immutable tool contracts, pending review, idempotency and audit. No owner-level route fallback grants tool access.
- `server/native-agent-tool-bridge.mjs` and `server/native-agent-tool-stdio.mjs`: ephemeral run-private Unix-socket capability and bounded MCP stdio adapter. Provider/global config files are never changed.

September 24 continuation: profile model defaults and Codex reasoning are forwarded through validated, separate CLI arguments. Shared-account binding, immutable profile versions, independent memory/context/output policies and safe profile copying are implemented in Agent Studio. Versioned Skills retain manual test evidence without claiming provider execution. Run context uses one bounded compiler for preview and execution, actor-bound expiring inspections, stale-input/source rejection and immutable run snapshots. Native tool availability defaults to false and becomes available only through explicit reviewed per-run opt-in. Provider-owned hidden context and subsequent granted file reads are not represented as captured prompt text.

The manual Workflow slice now connects reusable versioned definitions to canonical agent runs and exact output handoffs. It includes a seven-step feature-request starter, typed Skill input mappings, conditions, bounded retries/time, plan and output gates, and exact approved-knowledge finalization. Every provider invocation is explicitly prepared, inspected and launched; the engine does not schedule background work. Historical context permission guards survive source moves and are rechecked on cached retries. Imports restore paused definitions, not execution authority. Verification uses isolated injected providers, never real accounts.

The native-tool slice now connects a reviewed live run to a private MCP bridge. Reads are limited to captured context. Writes become pending human-review requests; only allowlisted handlers may apply approved draft Route/Project/memory/output effects. Permission review never grants access and handoff review never launches another agent. Capabilities expire with the run and are not exported. This slice is verified with isolated databases and simulated provider processes only; real-account compatibility is not claimed.

Today now derives permission-filtered decision, execution, review, next-action and context queues without starting work. Prepared or retryable Workflows remain explicit next actions, not running agents. Failures retain recorded codes or unknown states; context warnings come from stored review dates and immutable profile pins, not inferred confidence. Existing sidebar IDs and links remain compatible with Today, Conversations, Knowledge and Runs labels.

The first reliability sub-slice binds Skill test cases to canonical live runs and exact recorded output evidence. Preparation and context inspection never launch work. Human assessments pin profile/context provenance; same-input comparisons remain explicit manual judgments. New Skill versions require complete latest-case pass coverage before publication; legacy handwritten observations remain historical. Permission revocation invalidates evidence visibility and current coverage without erasing history.

The second reliability sub-slice adds explicit Route evidence policy 2. Current criteria need human assessments of exact recorded output/run artifacts; current evidence coverage and output approval are separate decisions. Immutable accepted checklists retain the exact criterion and artifact references. Changed agreements or outputs require new assessments; access revocation hides evidence and blocks current coverage. Existing manual policies stay compatible until explicit opt-in. Imports retain a stricter policy without restoring evidence or approval authority.

The third reliability sub-slice compares immutable Skill definitions and agent instruction content using shared code appearance. Explicit selected-field instruction restoration creates a new profile version while preserving current provider/runtime settings. Exact source hashes, optimistic versions, fresh read/write access and human confirmation protect restores; old run pins never change. Missing/restricted text and unknown legacy authors are labeled rather than invented.

The fourth reliability sub-slice records allowlisted terminal usage from independent canonical provider invocations. Immutable launch provenance supports permission-filtered run detail and agent/project/Workflow grouping; retries count only when an actual invocation occurs. Missing, malformed, interrupted and conflicting reports remain explicitly unknown, partial or ambiguous. Provider metric families are separate; Claude client price-table estimates are not billing. Account-wide limits and cost enforcement remain unavailable. Reading reports never contacts a provider.

The fifth reliability sub-slice reviews possible conflicts between exact approved Knowledge versions. A human can report a pair, retain both or explicitly supersede one with a recorded rationale. A bounded, optional scan finds only same-title/scope/type entries with differing text; it does not verify semantic contradictions or inspect separate agent-memory stores. Reports alone change nothing. Exact run context includes a notice only when both entries already belong to the authorized context. Superseding an entry affects future selection, not previously captured text; historical and current source permissions still protect old captures.

The sixth reliability sub-slice adds durable manual Workbench checkpoints and explicitly reviewed selected-file restoration. Exact UTF-8 bytes and modes are preserved for bounded files in a linked Git root. A restore pins current file states, root identity and historical/current access, blocks active project sessions, saves a recovery checkpoint and records retry intent before writing. Interrupted delivery never blindly resumes writes. Multi-file operations can be partial; Git history/index and omitted files are unchanged. Automatic provider-run checkpoint capture is not included.

These slices form a bounded supervised solo-AI release, not completion of the entire product vision. Existing supervised rules, manually generated repeating Routes and manually launched Workflow steps remain available. Universal selection-to-agent actions, broader semantic/agent-memory conflict detection and background orchestration remain future work. Native tools do not schedule follow-up work, create approved memory, accept outputs or widen access automatically.

## Safety and evidence

Workspace content, documents, prompts, memories and provider responses are untrusted data. None grants permission. Reading explicitly approved context may be automatic; draft creation requires explicit user intent; ordinary mutations require review unless preapproved for a specific Workflow. File edits, commands, external writes, archives and deletion require explicit authority; destructive actions need clear confirmation. Agents cannot approve themselves or expand their access.

Text-selection actions such as Ask agent should prepare a reviewed request showing the selection, source, chosen agent and context. Selection itself must not launch a run. This contextual action expansion remains planned, not part of the Areas slice.

All automated checks use isolated temporary databases and injected providers. Do not probe, authenticate or test real Codex/Claude accounts. Live provider compatibility remains separately unverified. Preserve `.openai/hosting.json`, `worker/index.js`, Sites packaging and the localhost runtime boundary. No confidence percentages or cost estimates should be invented where provider data is unavailable.

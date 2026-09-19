# Agents: behavior and verification

## Profile versus connection

An agent is a saved name, description, provider, instructions, and optional default working folder. Creating a profile does not authenticate an account or start a session. Profiles for the same provider share that provider's local connection.

New profiles belong to the current workspace. Existing shared profiles keep their global scope; the inspector and editor identify them as shared. Editing does not silently move a profile between workspaces.

The roster supports search, readiness filtering, a selected-profile inspector, and session history. Narrow screens switch between the roster and inspector. Optional Build, Review, and Research presets only apply on explicit selection; replacing text and discarding edits require confirmation.

## Actions and safety

- **Connect** opens the existing provider setup flow. Viewing this flow only reads cached local setup/status; sign-in and authentication checks require a separate explicit action.
- **Start session** chooses live mode only for a connected, available profile. The launch form reviews the agent, project, route, folder, context, and permissions before submission.
- **Try a simulation** explicitly selects local simulation. It does not contact an AI provider, run commands, or change project files.
- **Pause** prevents new sessions; it does not stop work already running. Resume restores availability.
- **Duplicate** opens a new prefilled profile for review and saving. It does not copy history or connection credentials.
- **Archive** is recoverable through Undo or Settings → Archive. Profiles with active sessions cannot be archived, deleted, or switched to another provider.

Codex supports read-only and project-edit sessions. Claude is restricted to read/search analysis in this release. Stored model override fields are not exposed as functional settings because the runner does not apply them.

## Context and identity

New sessions persist `runs.agent_id`. Renaming a profile or using duplicate names does not change attribution. Historical sessions lacking an agent ID remain accessible in Live work; the migration does not guess their owner from a display name.

Session context derives from a linked chat or route when callers omit its parent IDs. Conflicting IDs, aliases, or explicit nulls cannot bypass required relationships. Workspace and archive checks also apply to derived context.

A linked project's local folder takes precedence over the agent default. A contradictory explicit folder is rejected; normalized or symlink-equivalent paths are accepted. When the project has no folder, the agent default or an explicitly supplied working directory may be used. The live runner still validates the directory before execution.

## Verification

Run `npm test` and `npm run build`. The refresh added agent-readiness, stable identity, profile form, context derivation, folder precedence, and calendar regression tests.

Browser verification used a separate temporary SQLite database and injected/blocked provider operations. It exercised create, edit, reload persistence, duplicate, pause/resume, archive/undo, search/filter, setup display, blocked disconnected live launch, explicit simulation, route/project propagation, history, unsaved-change protection, custom selectors, calendar save, and cross-page rendering. Desktop, 390px, 320px, dark, and light layouts were checked.

Real account authentication, live provider availability, billing, and actual model output were not tested. The existing user database was only read for final rendering verification; no test profiles or connections were inserted into it.

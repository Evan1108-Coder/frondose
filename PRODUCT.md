# Talvori

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users and purpose

A browser-first personal work environment for organizing projects, Routes,
documents, conversations, AI agents, runs, and reviewed outputs. Individuals
are the primary audience; larger teams are a planned commercial audience.

## Product principles

- Preserve the lifecycle Intent → Route → Run → Output → Review → Memory.
- Connected AI uses each user's own authorization; opening a page never launches work.
- Agent actions remain subject to current permissions. An explicit per-account,
  per-workspace policy can allow safe new Routes and self-membership links;
  other mutations and proposed schedules require human review.
- Preserve existing data, preferences, conversations, and working connections.

## Brand commitments

On October 19, 2026, Evan chose **Talvori** to replace Rumbo, requested new
logos and a complete rebrand, and explicitly confirmed that features,
navigation, workflows, and layouts should be preserved. Audit authorization,
loading/error screens, metadata, exports, and small labels as well as primary UI.
Do not rewrite user-authored content to achieve branding consistency.

## Operating constraints

React/Vite frontend and a persistent Node/SQLite backend. Public mode is
currently an invite-only beta, not completed open public registration.
Provider app registrations and live-account verification remain separate from
implementation and must not be claimed complete without evidence.

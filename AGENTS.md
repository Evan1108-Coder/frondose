# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Rumbo product decisions

- The selected visual direction is the second generated concept: a chat-centered workspace where conversations, tasks, context, and live agent work are visibly connected.
- Keep the restrained gray-to-gray-black tone, compact density, and careful hierarchy, but do not reproduce Linear's exact sidebar, proportions, interaction patterns, accent color, or component anatomy. Rumbo must feel like its own product.
- The first release is localhost-first and local-first. Real Codex and Claude accounts must not be used during automated or smoke testing.

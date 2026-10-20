# 003 — Unify interface icons with Lucide and Morphicons

- **Status**: DONE
- **Commit**: 2fdda5f
- **Severity**: MEDIUM
- **Category**: Cohesion, state feedback, accessibility
- **Scope**: Shared icon renderer and existing interface icon imports/state controls.

## Problem and selected direction

The user explicitly requests Lucide interface icons and Morphicons transitions, excluding the custom empty-state illustrations and brand assets. Current imports use `@phosphor-icons/react` across `src/ui.jsx`, `src/components/`, and `src/views/`. Stateful branches such as `busy ? <Spinner /> : <Icon />` in `src/ui.jsx` remount instead of morphing. Sidebar/select chevrons rotate with CSS; adding morphing without removing that rotation would double-transform them.

## Target

Use tree-shaken Lucide IconNode data and the actual `morphicons/react` package behind a shared renderer. Preserve stable SVG identity for state changes. Keep existing 16–24px CSS sizing, currentColor strokes (1.75 default), and authored accessible button names. All interface glyphs use the shared renderer; noninteractive labels stay still. Morph only user-triggered state/feedback: disclosure orientation, folder open/closed, sidebar collapse/expand, pin, copy success, loading and completion. Do not imply success before an operation actually succeeds.

Use interruptible custom springs (state: stiffness 2400 / damping 96; hover: 4400 / 130), verified against a sub-300ms visual budget. Controls receive a tiny 3.4% geometric hover expansion; static labels remain still. Read OS reduced motion and Frondose's `data-motion="reduced"`; instantly set the final geometry for reduced motion or keyboard input, including interruption of an already-running morph. No per-frame React state. Vector path morphing is a narrowly scoped exception to GPU-only guidance explicitly required by the user; use the library's shared rAF scheduler and keep labels, backgrounds and layout unanimated.

## Steps

1. Inspect the installed library APIs and Lucide's IconNode export format. Add exact package versions; remove Phosphor after migration.
2. Create a shared icon data map and renderer, preserving tree-shaking and existing semantic names during migration. Remove Phosphor-only weight props.
3. Route all interface icons through it. Do not change any illustration paths in `src/components/EmptyState.jsx`, brand SVGs, or image assets.
4. Replace remounting stateful icon branches with one persistent renderer and remove conflicting chevron CSS rotations. Add copy success only after clipboard success.
5. Keep all controls, focus handling and app workflows intact. The later folder-optional chat request adds a separate backend work-mode distinction; no account connections or authentication changes.

## Verification

- Scan for remaining Phosphor imports and missing mappings; assert all mapped icons have valid Lucide geometry.
- `npm test`, `npm run build`, `git diff --check`.
- Browser: inspect all sections, desktop and mobile, dark/light; check no console errors, clipping or blank glyphs.
- Record actual SVG path changes during disclosure/copy/loading transitions, rapid reversal, and exact settled geometry.
- Keyboard and both reduced-motion preferences must swap instantly, not merely hide a running animation with CSS. Retain Frondose's existing gentle surface feedback.
- Verify logos and complex empty-state illustrations are unchanged.

## Boundaries

No account connection, real AI calls, user-data reset, layout redesign or generated assets. The audit/planning phase is complete; implement under the user's explicit request, then independently review motion and rendered behavior.

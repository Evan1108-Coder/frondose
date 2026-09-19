# 004 — Add semantic pointer feedback to interface icons

- **Status**: DONE
- **Commit**: 2fdda5f (existing worktree changes retained)
- **Severity**: MEDIUM
- **Category**: Missed opportunities; accessibility; interruptibility
- **Estimated scope**: 4 shared icon/motion files and tests

## Problem

`src/lib/icon-motion.js:12` only supplies the same hover expansion to every icon:
```js
hoverShapes.set(node, fitIcon(node, [0.4, 0.4, 23.2, 23.2]));
```
`src/components/icons.jsx:38` registers settle and hover but no semantic activation feedback. The user explicitly requests individual click motion and a head-first directional arrow, without delaying navigation.

## Target

Pointer activation provides one short semantic response per icon. Settings turns with deceleration; faces change expression and settle; documents open, branches route, inbox receives, and other icons move in ways relevant to their meaning. Arrow head leads, shaft elongates, then tail follows and settles. Maximum 280ms; transform/opacity or SVG geometry morphing only. No layout animation. Repeated activation must cancel/retarget safely, with no accumulated timers or transforms.

Use `cubic-bezier(0.23, 1, 0.32, 1)` for deceleration and the existing critically damped Morphicons springs for geometry. Keyboard activation, app reduced motion, OS reduced motion and static/noninteractive icons never move. Retain color/focus feedback. Never delay navigation or replay on page load.

## Repo conventions to follow

`src/lib/icon-motion.js` owns one delegated event subscription and teardown for all icons. `src/components/icons.jsx` owns stable SVG identity and Morphicons handles. Preserve those conventions. Preserve spin indicators and disclosure state morphs.

## Steps

1. Add semantic activation definitions to shared icon motion, based on icon identity, including staged arrow geometry and gear deceleration.
2. Extend the existing delegated pointer activation handling without per-icon global listeners. Cancel on keyboard, reduction preference change, hiding, unmount, and rapid retrigger.
3. Wire shared UiIcon activation without replacing SVG identity. Keep click action synchronous.
4. Add tests for distinct semantic responses, arrow phases, reduced motion, keyboard and cancellation.

## Boundaries

No dependencies. Do not edit application routing, chat logic or server. Do not animate whole screens, typing, scrolling, reaction catalog entrances or large empty artwork continuously. Existing node shapes may be inspected and the implementation adapted to actual Morphicons APIs; report incompatible APIs rather than inventing methods.

## Verification

Run `node --test tests/icons.test.mjs tests/motion.test.mjs`, then `npm run build`. Browser-check sidebar Settings and several other icons; inspect arrow at slowed playback to confirm head movement before tail. Rapidly click and navigate without stale movement. Reduced motion and keyboard show instant states. Done when geometry settles, actions remain immediate, and listeners clean up.

## Deliberately rejected

No looping empty illustrations; no stagger across hundreds of reaction cells; no animated keyboard navigation. These would compete with work and slow frequent interactions.

## Verified September 19

Semantic pointer feedback is implemented in the shared icon wrapper. Isolated browser measurements verified arrow head movement before the tail and a settled 267ms endpoint; gear activation, keyboard cancellation, and reduced-motion cancellation passed. Eleven targeted motion/icon tests and the full regression suite passed. The large empty-state catalog now has 57 distinct compositions; it remains static.

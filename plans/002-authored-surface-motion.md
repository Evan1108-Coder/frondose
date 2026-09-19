# 002 — Unify authored popup and feedback motion

- **Status**: DONE (targeted component/browser QA; whole-site integration QA remains with root)
- **Commit**: 2fdda5f
- **Severity**: HIGH
- **Category**: Frequency, physicality, cohesion, accessibility
- **Estimated scope**: Shared motion stylesheet, input-modality hook and popup positioning

## Problem

`src/styles.css:3038` gives every dialog—including the keyboard command palette—the same `dialog-in 120ms ease-out` keyframe. `src/styles.css:3288` reuses that keyframe on toasts whose resting transform is `translateX(-50%)`; the animation temporarily overrides horizontal centering. Author dropdowns appear without spatial cues. Lines 4584–4600 suppress all reduced-motion feedback.

```css
.dialog { animation: dialog-in 120ms ease-out; }
.toast { transform: translateX(-50%); animation: dialog-in 120ms ease-out; }
```

## Target

Use shared `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`, and `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`. All specified UI motion stays below 300ms.

Pointer-opened modal: transform `translateY(4px) scale(.98)` and opacity 0 to settled, 200ms strong ease-out, centered origin. Dropdown: scale(.97) and opacity 0 to settled, 160ms strong ease-out, origin at trigger (bottom if opening upward). Toast: preserve horizontal translation throughout, `translate(-50%,4px)` to `translate(-50%,0)`, 160ms strong ease-out. Use CSS transitions and `@starting-style`, not reusable keyframes that restart.

Command palette and keyboard-triggered menus/modals remain instant. Reduced motion retains only 80ms opacity; no movement. Explicit user motion setting and OS preference both apply. Avoid hover movement; optional mouse/touch button press feedback is 100ms scale(.98), release 60ms, and never affects keyboard actions or navigation rows.

## Repo conventions

Add `src/components/motion.css` imported after `styles.css` from `src/main.jsx`. Last interaction is represented once on the root with `data-input-modality`, set by capture-phase pointerdown/keydown listeners. Existing popup positioning stays inside owning dialogs; ensure motion transforms do not create stale containing-block offsets.

## Steps

1. Remove inherited dialog/toast keyframes and global blanket reduced-motion rules in favor of explicit shared feedback rules.
2. Add transform/opacity entry transitions with `@starting-style` and keyboard exclusions. Keep command palette and its backdrop instant.
3. Add popup transform origin returned by `usePopupPosition` according to actual up/down placement, if ownership permits.
4. Share drawer easing with existing mobile sidebar (220ms). Preserve no interaction delays.

## Boundaries

No routing, data, account connections, business logic, arbitrary gestures or new dependencies. Keep popup geometry/focus management correct. Exit animation is out of scope unless its owning parent retains the node; never delay confirmed actions merely to play an exit.

## Verification

- Open each custom dialog/menu by mouse and keyboard; keyboard states appear instantly.
- Toast stays horizontally centered at the first frame and settled state, including mobile.
- Select/calendar menu remains anchored inside animated dialog, including menus opening upward.
- Set reduced motion via OS emulation and Settings independently: transforms stop, opacity feedback remains.
- Rapid menu toggles never strand invisible clickable elements. Command palette animation count is zero.

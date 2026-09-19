# 001 — Make sidebar disclosures understandable and interruptible

- **Status**: DONE (targeted component/browser QA; whole-site integration QA remains with root)
- **Commit**: 2fdda5f
- **Severity**: MEDIUM
- **Category**: State indication, interruptibility, accessibility
- **Estimated scope**: Shell, shared Collapse primitive, sidebar preferences and styles

## Problem

`src/components/Shell.jsx:195` replaces `CaretDown` with `CaretRight`; section contents at lines 283, 295, 312 and 320 toggle the HTML `hidden` attribute. These changes jump with no relationship between the user's disclosure action and the resulting content.

```jsx
{preferences.sections[section] ? <CaretDown /> : <CaretRight />}
<div id="navigation-projects" className="sidebar-section-content" hidden={!preferences.sections.projects}>
```

## Target

Pointer-triggered chevrons rotate from 0 to 90 degrees over 160ms using `cubic-bezier(0.23, 1, 0.32, 1)`. Contents reveal over 200ms, with a 20ms opening delay so the chevron leads without imposing a noticeable wait. Closing begins immediately. A shared measured-collapse primitive retargets from its current rendered height when interrupted, retains content during closure, and immediately marks closed children inert and aria-hidden. Text must not scale.

The user's explicit request is for a section to expand until its final shape, including the following sections moving downward. A bounded sidebar height transition is a documented layout-animation exception: it affects only a short local navigation tree and performs no JS per-frame measurements. Do not apply it to tables, messages or full pages. In reduced-motion or keyboard mode, layout changes immediately; opacity feedback is at most 80ms without translation. No page-navigation entrance animation.

## Repo conventions

Section state stays in `src/lib/sidebar-preferences.js`, with per-workspace storage. Continue storing version 1, add `teams` to the validated section keys, and preserve existing user preferences. Shared motion tokens live in a new `src/components/motion.css` loaded after legacy global styles.

## Steps

1. Add shared collapse component retaining children, measuring before retargeting, releasing fixed height after transition, and cleaning scheduled frames/timers on unmount.
2. Replace Shell section and project-child hidden toggles with the component. Keep aria-controls/expanded. Use one stable chevron wrapped in a rotating span.
3. Add Teams navigation backed by `data.teams`, `navigate('teams', id)` and `edit('team')`, preserving all existing links. Persist its section preference.
4. Use global last-input modality to bypass motion on keyboard-triggered actions. Preserve mobile focus containment, ignoring inert collapsed links.

## Boundaries

No server, App routing, entity editor or view changes. No new dependencies. No animation on navigation selection or command palette. Do not animate sidebar width or text scale.

## Verification

- `node --test tests/sidebar-preferences.test.mjs`: existing preferences and new Teams key persist independently.
- Browser: pointer-click expand/collapse ten times rapidly; current position retargets without jumping to zero or leaving a stuck height.
- Check collapsed links cannot receive Tab focus immediately after closing.
- At 25% animation speed, chevron leads children slightly and siblings move without scaled lettering.
- Keyboard-triggered disclosure changes are immediate; reduced-motion drops movement but retains brief opacity feedback.
- Narrow mobile sidebar still traps focus and closes on Escape.

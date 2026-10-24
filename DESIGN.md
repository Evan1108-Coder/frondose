---
name: Frondose
description: "The observed visual system for Frondose's connected personal-work environment."
colors:
  accent: "#6266d5"
  accent-hover: "#585dc4"
  accent-text: "#ffffff"
  bg: "#0f1011"
  nav: "#090a0b"
  surface: "#191a1b"
  elevated: "#1c1c1f"
  hover: "#232326"
  selected: "#28282c"
  input: "#111213"
  border: "#2a2e33"
  border-soft: "#202122"
  border-strong: "#3e3e44"
  text: "#f7f8f8"
  secondary: "#d0d6e0"
  muted: "#a1a6af"
  faint: "#8a8f98"
  focus: "#969aff"
  success: "#4cb782"
  warning: "#e4b85a"
  danger: "#f06b6b"
  avatar: "#34343a"
  brand-logo-background: "#ffffff"
  brand-logo-fallback: "#34383d"
  backdrop: "#000000a8"
  scrim: "#00000099"
  selection: "#4653ae"
  light-bg: "#ffffff"
  light-nav: "#f7f8f8"
  light-surface: "#f4f5f6"
  light-elevated: "#ffffff"
  light-hover: "#eef0f2"
  light-selected: "#e6e8eb"
  light-input: "#ffffff"
  light-border: "#dfe1e5"
  light-border-soft: "#eceef0"
  light-border-strong: "#c1c5cc"
  light-text: "#18191b"
  light-secondary: "#3e4148"
  light-muted: "#60646c"
  light-faint: "#62666d"
  light-focus: "#6266d5"
  light-success: "#19784b"
  light-warning: "#886400"
  light-danger: "#c02f3d"
  light-avatar: "#e0e3e7"
  light-backdrop: "#16181c66"
  light-scrim: "#16181c66"
  conversation-user: "#2c2c2c"
  conversation-user-text: "#f5f5f5"
  conversation-user-link: "#b9c9ff"
  conversation-user-code: "#ffffff19"
typography:
  headline:
    fontFamily: '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "32px"
    fontWeight: 620
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  title:
    fontFamily: '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  title-small:
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    lineHeight: 1.5
  label:
    fontSize: "14px"
    fontWeight: 550
    lineHeight: 1.35
  navigation:
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
    letterSpacing: "normal"
  conversation:
    fontSize: "16px"
    lineHeight: 1.7
  conversation-mobile:
    fontSize: "15px"
    lineHeight: 1.65
  reader:
    fontSize: "16px"
    lineHeight: 1.75
  reader-heading:
    fontSize: "clamp(24px, 3.4vw, 36px)"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  metadata:
    fontSize: "12px"
  mono:
    fontFamily: '"SFMono-Regular", Consolas, monospace'
    fontSize: "12px"
rounded:
  compact: "6px"
  button: "7px"
  field: "8px"
  popover: "10px"
  panel: "12px"
  composer: "16px"
  user-bubble: "20px 20px 5px 20px"
  pill: "9999px"
spacing:
  space-4: "4px"
  space-6: "6px"
  space-8: "8px"
  space-10: "10px"
  space-12: "12px"
  space-14: "14px"
  space-16: "16px"
  space-18: "18px"
  space-20: "20px"
  space-24: "24px"
  space-28: "28px"
  space-32: "32px"
  space-36: "36px"
  space-48: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-text}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "8px 14px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.accent-text}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "8px 14px"
    height: "38px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "8px 14px"
  input:
    backgroundColor: "{colors.input}"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    padding: "10px 12px"
    height: "44px"
  search:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    height: "35px"
  navigation-row:
    textColor: "{colors.muted}"
    typography: "{typography.navigation}"
    rounded: "{rounded.compact}"
    padding: "6px 8px"
    height: "32px"
  navigation-row-active:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.text}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "24px"
  reaction:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
    height: "30px"
  conversation-user-bubble:
    backgroundColor: "{colors.conversation-user}"
    textColor: "{colors.conversation-user-text}"
    rounded: "{rounded.user-bubble}"
    padding: "12px 18px"
  conversation-avatar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    size: "40px"
  composer:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.composer}"
    padding: "18px 16px 12px"
  website-result:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "16px"
  sidebar-frame:
    backgroundColor: "{colors.nav}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    width: "240px"
  single-choice-filter:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.popover}"
    padding: "3px"
  single-choice-option:
    textColor: "{colors.secondary}"
    rounded: "{rounded.button}"
    padding: "7px 16px"
    height: "34px"
  single-choice-option-selected:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-text}"
    rounded: "{rounded.button}"
---

# Design System: Frondose

## Overview

Frondose uses a restrained workspace interface: Inter typography, neutral layered surfaces, thin outline icons, and a single indigo brand accent. The inset, rounded navigation frame remains distinct from the working canvas. Existing logos, navigation structure, workflows, data, and working connections are retained; the conversation work extends this identity rather than replacing it.

This document is an extraction from the incumbent implementation, not a new visual-world proposal. No creative metaphor or unconfirmed brand language is asserted. Values in the frontmatter are the normative snapshot; production components should use the matching live CSS custom properties so dark and light themes remain coupled. The conversation's human-right/agent-left composition and temporary Docs reader are surface-specific choices recorded in `.impeccable/surfaces/src-views-chats-jsx.md`, not requirements for every Frondose screen.

Key characteristics:

- Neutral tonal separation; indigo reserved for recognizable actions and selected emphasis.
- Compact workspace navigation and controls, with more space allocated to reading.
- Real provider marks and authored Frondose assets rather than substitute symbols.
- Clear focus, honest readiness, and visible outcomes without decorative activity logs.

## Colors

### Primary

The accent family is the approved Frondose indigo. `accent` and `accent-hover` identify primary actions; `accent-text` maintains their text treatment. Focus has its own theme-aware token rather than tinting whole panels with brand color.

### Neutral

The dark theme separates the darker `nav` from the `bg` canvas, then uses `surface`, `elevated`, `hover`, and `selected` for containers and interaction states. `text`, `secondary`, `muted`, and `faint` provide the reading hierarchy. The three border tokens distinguish ordinary structure, quiet division, and stronger control boundaries. Corresponding `light-*` entries record the actual light-theme overrides; shared accent and logo tokens do not change with the theme.

`success`, `warning`, and `danger` are semantic status colors, not additional brand accents. Status labels retain text and an icon, so color is not their only carrier. `backdrop` and `scrim` belong to overlays. `selection` is the existing text-selection color. Logo backing and fallback tokens protect third-party mark legibility in either theme.

The conversation user-bubble family is an explicit local exception: the supplied dark neutral background remains dark in both themes, with its own text, link, and inline-code colors. Agent prose continues to use theme text tokens on the canvas.

## Typography

Inter Variable is the application family, falling back to Inter and native system sans-serif fonts. Native monospace is used for code and keyboard hints. The interface uses role-specific sizes rather than a single fixed ratio.

- `headline`, `title`, and `title-small` record the global heading hierarchy. The global headline uses a tight tracking and medium weight; individual views may override it.
- `body` is the default application copy. Small-screen global body copy reduces to (14px).
- `label` describes the shared button. `navigation` records the effective sidebar row typography after the loaded navigation overrides.
- `conversation` is agent prose; its mobile override is `conversation-mobile`. User-bubble prose uses (15px) with (1.65) line height.
- `reader` preserves a comfortable document rhythm, with the fluid `reader-heading`. Document subheads, lists, links, quotations, code, tables, tasks, footnotes, and mathematics retain semantic structure rather than becoming flattened message text.
- `metadata` is the common status scale; conversation attribution and timestamps use smaller local (11px) metadata.

## Layout

The application is viewport-height with bounded scroll regions. The desktop shell uses an inset sidebar and a working area with `minmax(0, 1fr)` sizing. The existing frame starts (12px) from the top, bottom, and left. The approved compact default is recorded by `sidebar-frame`; the main and Settings rails share the browser-local width, preserving explicitly saved widths. User resizing and reversible hiding remain available. The ordinary desktop range starts at (200px) and is capped at the smaller of (62%) of the viewport or the viewport minus (300px). At (800px) and below the sidebar becomes a separate fixed drawer, bounded by `min(260px, calc(100vw - 28px))`, rather than shrinking the working area into a permanent rail. Full-width navigation is a temporary mode on viewports at least (1000px) wide and (600px) tall; its small page preview is inert until restored.

Navigation uses a standard (32px) row and a compact (28px) option. The loaded CSS uses (16px) row glyphs and a (20px) nesting inset. Spacing values in the frontmatter are recurring measurements extracted from the CSS, not evidence of a universal mathematical spacing scale.

The conversation thread is a single working pane; the global navigation already provides recent conversations. Its reading flow is centered and bounded at (820px); the composer wrapper is bounded at (884px), including its outer gutters. Human messages use a fit-content, right-aligned bubble; agent identity and rich prose sit left. Message content wraps, while wide code, tables, and display mathematics scroll within their own containers. The composer is a non-shrinking sibling of the message scroller, so it remains reachable without covering the message flow.

At the narrow conversation rule (540px), header controls compact and composer controls use a six-column arrangement with attachment/context controls on their own row. Global search becomes icon-only at (760px); language is hidden at (400px). These are existing component-specific thresholds, not a new breakpoint scale.

The temporary Docs reader replaces the shell for that visit. It uses a full-height scroll region, a back-to-origin top bar, and an article bounded at (820px). At (600px) and below its document gutters become (20px), its top bar compacts, and the workspace name in the breadcrumb hides. Document navigation must preserve the conversation's draft and return location; the reader does not create a permanent navigation or recent item.

## Elevation & Depth

Tonal layers and thin borders carry most depth. The sidebar has a barely perceptible static gradient; the working canvas has its existing restrained neutral gradient. Neither is an animated decorative effect. Dialogs use the elevated surface, a strong border, an overlay, and a slight backdrop blur; popovers use a stronger border rather than a global heavy shadow.

The conversation composer has a low ambient shadow (`0 12px 32px rgb(0 0 0 / .08)`). Temporary navigation overlays and slash-command menus have stronger local shadows. These are component roles, not a requirement to add shadows to every panel.

Motion is bounded and interruptible. The incumbent motion file defines feedback, popover/fade, dialog/disclosure, and chevron timings; these exact values live in the sidecar. Keyboard modality removes transitions for frequent controls. OS or in-app reduced motion removes travel, scale, and staged expansion, retaining only brief fades where implemented. A working status dot can pulse; reduced motion removes the pulse. Existing one-time route entrance rules are recorded as source behavior, not a new recommendation to animate page content or incoming data.

The approved extension adds a sliding indigo selected plate for single-choice filters and a trigger-origin clipped reveal for shared dialogs. Only the plate changes geometry; labels and dialog text remain at their actual size. Dialog travel is bounded even when the opener is distant. Preference changes cancel in-flight spatial motion. These timings and geometry live in the sidecar; they do not replace the incumbent fallback CSS tokens or authorize decorative movement elsewhere.

## Shapes

Compact navigation and menus use the compact radius; shared buttons use the button radius; text fields use the field radius. Panels and dialogs are gently rounded, while the composer has a larger silhouette. The conversation user bubble has one tighter lower corner. Circular identity frames and reaction pills are distinct from rectangular work containers. Most structural outlines are a thin (1px) border.

## Components

### Buttons and icon controls

The shared button has a compact, medium-weight label, a thin border, and a (38px) minimum height. Primary, secondary, ghost, and danger are real variants of the same component; contextual views can override dimensions. Busy buttons show the loading glyph and disable activation. The ordinary icon button is (34px) square with an (18px) glyph; toolbars and mobile conversation controls have their own measured sizes. Hover uses tonal feedback. Non-text controls retain a visible keyboard outline.

### Inputs and search

Standard fields use the input surface, ordinary border, and field radius. A focused text field has one thin focused border, not a second outline or glow. Search and composer containers own the focus border when they enclose the field. A search border encloses its icon and input as one control. Non-text native controls keep their keyboard indicator; forced-colors mode uses system `Highlight`.

### Navigation and toolbar

Sidebar labels use neutral default text, brighten on hover/focus, and receive a selected tonal background for the active destination. Section disclosure, user resizing, reversible hiding, and custom ordering remain intact. The global toolbar is a bounded flex group, with horizontally bounded quick access and an icon-only search on narrow screens. Breadcrumb text truncates to protect the controls rather than forcing horizontal page overflow.

### Single-choice filters and dialog reveal

Connection categories, featured-provider choices and other adopted single-choice filters use a shared sliding selected plate, not a tabpanel controller. The group exposes radio checked state, one Tab stop, arrow/Home/End selection, disabled-option skipping and RTL direction. Labels use (13px), weight (550), with (20px) line height; coarse-pointer targets grow to (44px). Selection updates immediately. Keyboard input and reduced motion snap the plate without spatial travel.

Shared dialogs reveal actual-size content from a small clipped shell near the opening control; they do not scale the text. Closing during entrance begins from the visible frame. Header, backdrop, Escape and adopted render-prop footer actions use the same guarded close request. Dirty-draft guards may keep the mounted dialog open, restoring visibility. Explicit navigation continuations run after dismissal, not before it. Command palettes remain immediate. See `docs/sidebar-motion-and-sizing.md` for operation details.

### Agent connection library

Your Agents extends the established workspace identity with open section spacing, real connected-identity tiles, a wide authored product-image frame and grouped provider cards. The surface-specific composition remains in `.impeccable/surfaces/src-views-agentconnectionshome-jsx.md`, not a mandate to turn every page into a catalog. Ordinary catalog cards retain the panel radius, thin quiet border and semantic neutral surfaces. Product illustrations are visibly non-live examples; real provider marks remain distinct from connection readiness. Detail pages lead with explicit connection choices, then two non-live previews and readable setup information. At narrower widths, grids step from three columns to two and then one; actions wrap without losing their labels.

### Release timeline and popup reader

Help keeps an ordered dot-and-dash release timeline and a separate resources control. Only the newest published unread release with a real article becomes the footer announcement. The centered reader leads with an authored illustration or brand mark, then date, lead and semantic article sections in a bounded scroller; its footer remains reachable. Back to work dismisses through the shared close request. Go to Docs uses an explicit close continuation before navigation. Reading does not change the working route or create a permanent tab; this popup is distinct from the existing full-viewport temporary Docs reader.

### Panels, result cards, and reactions

Ordinary panels use the surface, ordinary border, panel radius, and contextual padding. Website results are a source mark, title/description, and outbound affordance in a bordered row; document results open the temporary reader. Code-change summaries only describe recorded evidence. Reactions use bordered pills with stable icon or emoji content, not decorative status colors applied indiscriminately.

### Conversation and composer

The neutral user bubble and unboxed agent prose establish the exchange. Agent marks sit inside padded circular identity frames; source logos retain their genuine appearance. Attribution, timestamps, actions, replies, selection, bookmarks, reactions, attachments, selected context, and reviewed actions remain usable. Compact observed work status links to Active work; private model reasoning is not a transcript.

The composer groups the message field and controls inside a single rounded surface. It supports bounded text growth and responsive control wrapping. Connection state, explicit identity binding, queued follow-ups, and the permissions of reviewed work remain visible rather than being implied by appearance. A queued follow-up is next-turn draft work, not proof of native mid-turn steering or an autonomous paid launch.

### Temporary Docs reader

Reading gets the available viewport, not a dialog or another permanent workspace tab. A real back action identifies the source; a source/original link remains available below the article. Loading, revoked access, unavailable documents, unsupported files, and retries have explicit states. Code and tables contain their own horizontal scrolling.

## Do's and Don'ts

### Do:

- Do use the live semantic theme properties for new UI and verify the corresponding light theme.
- Do retain the established Frondose logos, inset navigation, Inter hierarchy, and existing feature behavior when extending a surface.
- Do give text-entry wrappers a single focused border while preserving keyboard visibility for non-text controls.
- Do keep provider marks contained and padded, with readable attribution alongside them.
- Do confine long code and tables to local horizontal scrollers and keep the conversation composer reachable.
- Do distinguish observed run results and setup requirements from unverified capability claims.

### Don't:

- Don't turn the conversation's right/left composition or temporary reader into a global screen-layout rule.
- Don't tint all surfaces with indigo, add rainbow decoration, or introduce decorative glows as part of this established neutral identity.
- Don't replace real company/service marks with generic plug or terminal symbols.
- Don't expose private reasoning as a transcript or expand routine execution details into the conversation's primary reading flow.
- Don't treat saved defaults, catalog presence, or a connected-looking mark as authorization to launch work.
- Don't ship the generated critique concept, its invented content, or its invented domain as Frondose assets.

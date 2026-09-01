# Rumbo design QA

## Comparison target

- Source visual truth:
  - `artifacts/qa/reference-main-gray.png` — sampled main gray.
  - `artifacts/qa/reference-dark-layer.png` — sampled darker navigation layer.
  - `artifacts/qa/reference-lifted-frame.png` — lifted, rounded Linear frame reference supplied by the user.
- Implementation screenshot: `artifacts/qa/rumbo-clean-start-final.png`.
- Combined comparison: `artifacts/qa/reference-vs-clean-start-final.png`.
- Responsive evidence: `artifacts/qa/rumbo-clean-start-mobile.png`.
- Desktop viewport and CSS size: 1440 × 1024 at device scale factor 1.
- Desktop implementation pixels: 1440 × 1024.
- Frame-reference pixels: 3316 × 1670. It was used as a component/style reference rather than a same-state full-screen clone.
- Mobile viewport and implementation pixels: 390 × 844 at device scale factor 1.
- State: completely new local installation, zero user workspaces and zero authenticated connections.

## Full-view comparison evidence

The combined image compares the supplied Linear frame treatment with Rumbo's new first-run screen. Both use a recessed dark navigation area, a separately bordered main surface, large rounded outer corners, subtle inner highlights, and restrained shadow elevation. Rumbo intentionally keeps its own onboarding composition and branding rather than copying Linear's issue-detail content or navigation structure.

Computed implementation tokens were verified in the browser:

- Main surface: `rgb(37, 38, 38)` / `#252626`, matching the first swatch.
- Dark layer: `rgb(31, 32, 33)` / `#1f2021`, matching the second swatch.
- Outer frame radius: `18px`.
- Font: `Inter Variable` with automatic optical sizing; headings use the display optical range.

## Focused-region comparison evidence

The first-run card and app frame were inspected at full screenshot resolution. Borders remain one pixel and low contrast, corners are continuous without clipping, the card uses a separate shadow from the app frame, and the input focus ring stays inside its rounded boundary. The source does not contain a comparable first-run form, so component geometry was assessed against its panel and floating-composer treatments rather than forcing content-level fidelity.

## Findings and comparison history

### Pass 1 — blocked

- P1: The prior Rumbo palette used `#303030` and `#292929`, both materially lighter than the supplied swatches.
- P1: The application touched the viewport edges and did not reproduce the lifted rounded frame.
- P1: Demo workspaces, projects, chats, runs, and provider states prevented a real first-use experience.
- P2: Inter was present, but headings did not explicitly use its display optical treatment.

### Fixes

- Replaced palette tokens with the sampled `#252626` main surface and `#1f2021` dark layer.
- Added a rounded 18px outer shell, a separately rounded inner surface, restrained borders, inset highlights, and layered shadows.
- Added Inter optical sizing for headings while retaining regular Inter for interface copy.
- Changed the production database seed to clean mode and added a purpose-built first-run workspace screen.
- Reset the actual local database after interaction testing. Provider catalog entries now start at `not_connected`; no authorization or account probe was performed.
- Added a clean-install regression test.

### Pass 2 — passed

- Desktop: root and document both measured exactly 1440 × 1024 with no horizontal or vertical overflow.
- Mobile: root and document both measured exactly 390 × 844 with no horizontal overflow.
- Page identity and meaningful DOM passed.
- Fresh-tab console check returned no errors or warnings.
- First-run interaction passed: entering a workspace name created the workspace and opened the empty Chats view.
- Connection-state check passed: GitHub, Google Drive, Codex, and Claude each rendered `Not connected`.
- The interaction database was removed afterward and the final screenshot reconfirmed that no test or demo workspace name remained.

## Required fidelity surfaces

- Fonts and typography: passed. Official Inter family, optical sizing for display text, stable hierarchy, and readable wrapping at desktop and mobile.
- Spacing and layout rhythm: passed. Lifted outer frame, inner panel, onboarding card, consistent radii, and non-clipping responsive spacing.
- Colors and visual tokens: passed. Browser-computed colors match the two supplied swatches exactly.
- Image quality and assets: passed. No source image was replaced with CSS art; interface symbols use the existing Phosphor icon family. The new-user state does not show the previous generated avatar.
- Copy and content: passed. The screen explains the first action and accurately states that all providers are disconnected.
- Accessibility and interaction: passed for prototype scope. Labeled input, keyboard focus treatment, disabled/active submit state, semantic form controls, and mobile wrapping were verified.

## Follow-up polish

- P3: A formal WCAG contrast audit can be performed before a public release; the deliberately muted secondary text follows the supplied dark reference but is not yet documented against every contrast ratio.

final result: passed

# Motion refresh plans

These plans implement the September 19 request after a bounded read-only motion audit. The product is a daily-use work application: motion explains state changes; it does not animate navigation, live data, or the background for decoration.

| Order | Plan | Severity | Status |
| --- | --- | --- | --- |
| 1 | [Navigation disclosures](001-navigation-disclosures.md) | Medium | DONE |
| 2 | [Authored surface motion](002-authored-surface-motion.md) | High | DONE |
| 3 | [Lucide and Morphicons](003-lucide-morphicons.md) | Medium | DONE |

Both use the same input-modality tracking and shared tokens; implement them together, then independently review against the animation standards. The measured sidebar height transition is an intentional narrowly scoped exception required by the requested expanding layout; verify interruption and local rendering cost. Root agent will conduct two full-product smoke-test rounds after integration.

Targeted QA completed with actual Shell, Collapse, EmptyState, Dialog, Select and CommandPalette components on an isolated Vite harness (no database or provider). Verified at 1536×1000 and 390×844: exact empty-state centering, rapid-reversal height retargeting, immediate inert closed content, instantaneous keyboard disclosures and command palette, team search/navigation, custom select operation, OS-reduced motion and mobile sidebar focus boundary. Main workspace screenshot inspected in both widths. There were no console errors. Full application routes, live AI and other browsers were not part of this targeted check.
# Current addition

| Plan | Priority | Status |
| --- | --- | --- |
| [004 — Semantic icon feedback](004-semantic-icon-feedback.md) | Medium | DONE |

004 extends the existing shared Morphicons implementation. Semantic pointer feedback, head-first arrow movement, immediate keyboard behavior, and reduced-motion interruption passed targeted tests and isolated browser checks.

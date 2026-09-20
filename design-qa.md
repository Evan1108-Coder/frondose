# Sidebar typography QA — WEB-11

final result: passed

## Reference and scope

- Source visual truth: `/var/folders/6n/tzgzdf5n4_q456cm6018dv680000gq/T/TemporaryItems/NSIRD_screencaptureui_wGYqnc/截屏2026-09-20 21.34.56.png` (474 × 1252 screenshot crop supplied by the user).
- Implementation: `http://127.0.0.1:4176/#/overview`, isolated Review QA workspace; in-app browser screenshots captured inline in the Codex task. The browser returns image bytes, not a durable screenshot file path.
- Desktop viewport: 1440 × 1000 CSS pixels, devicePixelRatio 1. Mobile: 390 × 844, devicePixelRatio 1.
- Density: the source is treated as a 2× screenshot crop (237 × 626 logical pixels); this is an inference, not embedded device metadata. Its approximately 64-pixel row stride normalizes to 32 CSS pixels. The authorized live Linear page confirmed Inter Variable and 500-weight navigation labels; its current scale is not assumed identical to the supplied screenshot.
- Compare the sidebar content region, not browser chrome or the entire app. Rumbo has different navigation content and more sections. No exact full-page pixel-match claim is made.

## Comparison history

1. Baseline: P2 inconsistent vertical cadence. Nested icon-color buttons plus outer row padding produced 42-pixel rows and 44-pixel rows with counts. The 3-pixel root layout gap compounded this. Group margins were also accumulated on both sides. Baseline desktop screenshot and computed dimensions confirmed this.
2. Fix: colorable rows have no outer vertical padding; their buttons own the 32-pixel height. Count badges cannot expand it. Root gap is zero. Group gaps use one 24-pixel margin; compact mode uses 16. Labels use 14/20-pixel Inter at weight 500; headings use 13/20 at 500; icons are 16 pixels. Nested items keep the same text scale and a 20-pixel indentation.
3. Post-fix: desktop and mobile screenshots show consistent line rhythm, aligned icons/text and no clipped labels caused by the change. Computed top-level rows, including badges, are exactly 32 pixels; compact rows are 28. Expanded project children use the same typography. No remaining actionable P0/P1/P2 finding within this typography/spacing scope.

## Required fidelity surfaces

- Fonts: existing locally bundled Inter Variable retained; label weight, size and line height normalized. No new remote font request. Long names still truncate.
- Spacing: uniform rows and icon slots; section spacing no longer doubles; responsive drawer and collapsed rail retained.
- Colors: existing theme tokens and explicit global/team/group/tab overrides preserved, not replaced with Linear's colors. This is intentional per the user's scoped request and existing customization requirements.
- Assets: existing Rumbo icon library retained and sized consistently. No raster illustrations or replacement logos are required for this text/spacing-only task.
- Copy: Rumbo navigation labels and feature structure unchanged; Linear product content is not copied.

## Interaction verification

- Sidebar navigation, icon-color dialog, project folding/count, Shift+B customization, saved compact/comfortable choice and collapsed/expanded rail exercised.
- Mobile drawer opened and dismissed; document width equals viewport width (390 pixels), with no horizontal overflow.
- Default density restored in the disposable workspace after testing. User workspace preferences/data were not changed by QA.

## Follow-up polish / limitations

- Font rasterization can differ by OS and browser zoom. The screenshot does not establish exact original zoom metadata.
- This change does not restyle the settings navigation rail, change sidebar width, or remove/reorder Rumbo features.

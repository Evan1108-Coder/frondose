# Maintaining Rumbo Docs

The handbook lives at `#/docs`. Article routes are `#/docs/<article-id>`; category indexes use `#/docs/group-<group-id>`. It is an area of the existing Rumbo app, not a separately deployed documentation service.

## Content and behavior

- `src/lib/docs-content.js` defines the reference library and category list.
- `src/lib/docs-workflows.js` defines practical end-to-end tutorials.
- `src/lib/docs-utils.js` provides full-text search and complete Markdown copying.
- `src/views/Docs.jsx` renders the responsive home, category, article and search views.
- Keep article IDs stable. Update related links when retiring an article, and avoid links to internal services that are not public APIs.
- Describe current behavior separately from plans. An enabled setting is not proof that a delivery service, permission boundary or integration exists.

## Screenshots

`public/docs/` contains paired light/dark PNG captures of the real Rumbo interface, made with an isolated sample workspace. They are not user data, generated product mockups, or production account captures. Theme changes select the matching image immediately. Preserve both images when updating a feature screenshot.

Projects, chats, teams and Playbooks are main-panel crops, 1088 × 912. Appearance settings, Field defaults, and the structured-template dialog show the complete settings screen, 1440 × 980. The renderer uses those intrinsic dimensions to reserve layout space without stretching the capture. Workbench has no screenshot rather than showing a fabricated execution result. The new pairs use an isolated sample workspace; the Playbooks capture shows a real completed local draft action, and no AI account was contacted.

## Verify edits

Run `node --test tests/docs.test.mjs` to verify article identifiers, references, routing, search, Markdown and paired assets. Run `npm test` and `npm run build` for broader regression checks. In an isolated browser workspace, check help → docs, search → article, table of contents, copy page, theme switching, Developers, narrow navigation, and unknown links. Verify feedback submission still makes no request while delivery remains a placeholder.

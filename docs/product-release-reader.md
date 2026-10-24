# Product release reader

The Help footer announces only the newest published release with a real Updates
article. Its title replaces the question mark until the reader has been opened
and dismissed. A separate Help-menu control keeps Docs, Contact us, shortcuts,
sidebar customization and Settings reachable while the announcement is present.

The menu's Updates section orders up to three releases newest first, joins their
dots with a dashed vertical line, and ends with Full changelog. Selecting a
release opens a centered reader over the current page. The reader uses the same
authored article sections as the full Docs view; it does not change the route,
create navigation entries, access a provider or send the current draft anywhere.
Go to Docs is the explicit navigation action.

Back to work and Go to Docs use the shared Dialog close request, like its header,
backdrop and Escape paths. Go to Docs supplies an explicit continuation so the
reader exits before navigation; it does not bypass the shared dismissal path.

## Read receipts

Dismissal records only the article that was actually displayed. Opening a menu,
rendering a title, or switching account/workspace does not mark a release read.
Once the newest release has been read, older unread entries remain accessible in
the timeline but do not replace the question mark in a sequence of announcements.

Receipts are versioned browser-local state, keyed by stable profile and workspace
identifiers. They contain release IDs, not profile names, messages or credentials.
Other tabs receive browser storage events. Corrupt or unavailable storage does
not prevent reading; blocked storage may cause an announcement to return after
reload. This is not server-synchronized read state or a notification service.

Future dates, invalid dates and releases without an authored Updates article are
not announced. Current release content describes the shipped UI, not public
provider certification. Illustrations are explicitly non-live examples. Native
CLI history import, continuation and synchronization are not part of this update.

## Checks

`tests/product-update-state.test.mjs` covers publication filtering, ordering,
actor/workspace isolation, bounded receipt normalization, missing articles,
newest-only announcements, blocked storage and explicit Docs navigation.
Docs structure and distinct-icon coverage remain covered by their existing tests.
Rendered desktop/mobile focus, scroll, image loading and reduced-motion checks
belong to the combined UI delivery pass.

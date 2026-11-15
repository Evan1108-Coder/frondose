# What’s New and installed app versions

Product release notes in Help and Docs are called **What’s New**. Workspace
activity Updates is a separate saved-content feature and keeps its name, IDs,
routes and data. Help shows at most three dated published releases; Full changelog
opens the dedicated Docs group. Release notes open in a centered reader without
replacing the workspace tab, and Go to Docs is an explicit navigation choice.

The desktop exposes only a trusted read-only `appInfo` bridge for its actual
packaged version. Frondose records the first version seen as a baseline, so
first installation does not pretend that an update just occurred. Development
and packaged `0.0.0` builds do not automatically announce installed-version
changes. A later different packaged version opens What’s New once for that local
installation/actor/workspace. Dismissing records that version. Other workspaces
and identities have separate receipts; reopening the same workspace does not
repeat a dismissed version.

An authored release may set `appVersion` to the exact packaged version. Only
that exact match supplies automatic release content. If the installed version
changed without matching authored notes, the popup identifies the actual version
and says its exact release notes are not included; it offers Go to Docs instead
of relabeling older notes as the new version's changes.

These receipts and the popup are presentation behavior only. They do not check a
release server, download a package, schedule installation or restart the app.
Frondose-owned update feeds, signed distribution metadata and safe installation
scheduling remain the separate queued updater work. No Orca release endpoint or
signing identity is reused. Current `0.0.0` packages intentionally have no fake
release-version metadata just to make this popup appear.

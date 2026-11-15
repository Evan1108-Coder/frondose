# External file state — validation, 29 October 2026

## Automated

- Complete Node regression run: **2,277 passing, zero failed, cancelled or skipped**. Log: `/private/tmp/frondose-external-files-final-tests.log`.
- Focused policy/merge/UI tests cover settings defaults, scoped recovery identities, clean reload, dirty preservation, metadata-only changes, identical external saves, new/pending/discarded buffers, unsupported files, read-only policy, fresh save decisions, revision guards, generated lockfiles, CRLF/trailing newlines, separated/overlapping/deletion edits, merge size/line bounds, recovery count/byte limits, worker termination and bundled license.
- Added a real filesystem service regression: a read-only file exposes read-only metadata and atomic replacement is refused, leaving original bytes unchanged.
- Final Vite build and standard `npm run build` passed; Sites client/server/hosting outputs preserved. Existing large-chunk warning remains.
- Mac x64 package produced and its ad-hoc signature verified. Packaged smoke test passed a fixture PTY and isolated Chromium create/hide/close lifecycle, without changing the root Node-native dependency ABI. Public notarization/automatic release delivery is not configured.

## Browser interaction checks

Used a separate temporary server, database and project folder; no real account sign-in, GitHub mutation, or user file edits.

- External saved edit reloaded a clean buffer.
- Dirty buffer retained its text and showed Changed on disk; Save was disabled pending review.
- Original/draft/disk/result panel rendered; an adjacent-line conflict required an explicit side choice before Apply. Both original draft and disk were visible.
- A second disk write invalidated an open comparison and disabled Apply/Keep/Reload until Recheck.
- Applying a resolved result changed the draft only; direct fixture disk read verified no write. Explicit Save then succeeded.
- Optional automatic merge combined separated local/disk edits and left the result unsaved until explicit Save.
- Read-only mode was detected; typing a draft remained possible and Save stayed disabled.
- Moving the fixture file away showed Unavailable without erasing its draft; restoring it recovered normal state.
- Recovery copies persisted through a client reload, were capped at four for the file, and could be restored through confirmation. A differing copy became an unsaved draft without writing disk.
- At a 430 × 900 viewport, the comparison was 406 px wide with no document horizontal overflow, wrapping actions and usable scrolling. Screenshot: `/private/tmp/frondose-file-state-mobile.png`.
- Long-source external reload retained scrollTop **2994 → 2994**, while source length increased and the persistent scroll indicator remained functional.
- No browser warning/error entries were captured in the final checked fixture run.

## Live activation / limits

The final hashed assets were published atomically to the existing host with old assets retained. The installed `/Applications/Frondose.app` was updated with a recoverable backup and reopened against that same external host. Its current saved user file displayed Up to date and the comparison panel, including the generated-lockfile review warning. No user file was saved/merged during native verification. Existing tabs were retained.

Host PID **72576** was not restarted; its status continued to report **two active work sessions**. Consequently, the new backend read-only metadata/replacement check is packaged and fixture-tested but awaits the next safe host startup; the running legacy host still uses its previous in-memory backend. External-change detection, comparison, recovery and version-guarded frontend saves are active now.

Native Windows/Linux runtime execution was not available here. Shared merge/policy/server tests ran on macOS; this is not a claim of Windows/Linux native acceptance.

No Git push was made: this checkout already contained a large mixed set of unrelated changes, so pushing all of it would be unsafe. No existing changes were reset or discarded.

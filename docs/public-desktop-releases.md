# Frondose public desktop releases

Users download Frondose once. A release-enabled install checks an anonymous
HTTPS feed on launch and about every four hours while open. The bottom-right
**Update available** prompt remains the normal entry point. A check never
downloads or installs; the user chooses **Update**. Frondose verifies the
download, checks work again before quitting, and reopens after installation.
Offline background checks leave the workspace and the last offer alone.
No account, workspace content or R2 write credential is needed to check.

## One-time owner setup

1. In Cloudflare **Storage & databases → R2**, activate R2 and create the
   bucket `frondose-releases`. Add `updates.frondose.com` via **Settings →
   Custom Domains** in the same Cloudflare account as the zone. If the
   production domain is different, substitute it everywhere. Upload a harmless
   test object and confirm its full HTTPS URL works signed out. Leave this
   hostname free of Access login and browser challenges; your website preview
   can stay protected on a separate hostname. Do not put private builds here.
2. Add a Cache Rule for the update hostname that bypasses cache for
   `latest*.yml`; versioned binaries can be cached long-term. The publisher
   also sends `Cache-Control: no-store` for manifests. Do not override this
   with a rule that caches everything.
3. In GitHub Actions set repository variables `FRONDOSE_UPDATES_ORIGIN`
   (e.g. `https://updates.frondose.com`) and `FRONDOSE_DOWNLOADS_URL` (the
   public website download page). Create these protected environments:

   - `desktop-sign-mac`: variable `APPLE_TEAM_ID`; secrets
     `MAC_CSC_LINK` (base64 Developer ID Application certificate and key
     in a P12), `MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY_B64` (App Store
     Connect notarization P8), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.
   - `desktop-sign-windows`: variables `WINDOWS_PUBLISHER` (certificate
     CN), `WINDOWS_SIGN_ENDPOINT`, `WINDOWS_SIGN_ACCOUNT`,
     `WINDOWS_SIGN_PROFILE`; secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
     `AZURE_CLIENT_SECRET` for a principal assigned only to the chosen
     Microsoft Artifact Signing certificate profile. An alternative provider
     would need a reviewed signing adapter.
   - `desktop-build-linux`: no signing or upload credentials.
   - `desktop-release-production`: variables `R2_ENDPOINT` (the account's
     S3 endpoint), `R2_BUCKET` (`frondose-releases`); secrets
     `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` from an R2 Object Read &
     Write token scoped to this bucket. Restrict deployment branches to
     `master-mac` and configure a required approval before promotion, where
     supported by the GitHub plan. Restrict signing environments to the same
     workflow dispatch branch. Do not enable publishing on production until
     the platform upgrade gate below is met.

Never put signing credentials or the R2 token in source, screenshots, chats,
download artifacts, or client configuration.

## Release procedure and acceptance

1. Review the exact heads of `master-mac`, `master-windows`, and
   `master-linux`. Use one stable version across all builds. Dispatch
   **Desktop public release** on `master-mac` with those SHAs and publishing
   off first. The jobs verify branch heads, run tests, build installer and
   update assets, verify publisher signatures where applicable, and verify
   manifest filenames and SHA-512 hashes. No build job gets the R2 write token.
2. Before promotion, test older → newer **signed** builds on Intel/Apple
   Silicon Mac and Windows x64 using a separate staging feed and disposable
   profiles. On Ubuntu x64, **AppImage update and reopen QA** uses a
   runner-only TLS feed and two real AppImages. It checks for the popup while
   the old app is still open, clicks **Update**, verifies the replacement file
   hash and new process/window, and reads the original workspace and project
   in the relaunched app. The separate staging feed must never be the stable
   prefix. Do not substitute an unpacked launch or silent installer smoke for
   this upgrade gate.
3. When approval and upgrade evidence exist, enable publishing on the
   approved release run. The publisher checks every asset, writes immutable
   versioned binaries under per-platform/architecture prefixes, verifies that
   the public HTTPS objects are readable, and switches each `latest*.yml`
   last. It refuses a downgrade or overwriting a different binary under the
   same version. If a run is interrupted after updating one manifest, resume
   using the **same** build artifacts; do not rebuild a version in place.
4. Link the first-time installers from the website: macOS DMG, Windows signed
   NSIS EXE, Ubuntu AppImage and optional DEB. This workflow does not publish a
   Windows ZIP containing an NSIS-enabled updater. This implementation uses
   manual replacement for DEB; the production feed targets AppImage. Existing
   local builds lacking the public URL need a one-time transition.

This is an opt-in release pipeline, not a claim that Cloudflare, signing,
the website, or a public release has already been configured.

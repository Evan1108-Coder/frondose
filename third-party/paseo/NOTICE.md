# Paseo attribution and modifications

Portions of Frondose derive from Paseo (https://github.com/getpaseo/paseo),
Copyright (c) 2025-present Mohamed Boudra, licensed under Apache License 2.0.
Pinned source revision: c70a6cfb9ea29c87df52b6b6c574775b0d3b169c.

The complete upstream LICENSE is retained in this directory. No root NOTICE file
was present at this revision; this file records Frondose attribution and changes,
not an additional restriction on the Apache license.

Reused source:
- packages/app/src/data/acp-provider-catalog.ts: catalog data adapted into
  src/lib/runner-provider-catalog.js. Original snapshot retained as
  acp-provider-catalog.upstream.ts.txt.
- packages/app/src/assets/acp-provider-icons/*.svg: runtime identity artwork
  copied to public/brand/runners (except Codewhale, sourced separately below).
- packages/app/src/components/icons/{antigravity,omp,pi}-icon.tsx: static SVG
  geometry extracted, Svg/Path converted to SVG elements, dimensions fixed at
  24, and color converted to currentColor; no executable module is bundled.
- plugins/muse-provider/icon.svg: unmodified static Muse Code identity artwork.
- packages/plugin/src/server/process-internal/windows-command.ts: reviewed as a
  reference for Windows command-script dispatch. Frondose's runner-process.mjs
  is an independent stricter implementation, rejecting shell-expansion values
  rather than relying on the upstream escaping policy.

Frondose modifications: removed executable/embedded SVG imports; added reviewed
static local SVG files, theme-aware mask rendering, verified display-name
overrides (original catalog titles retained as upstreamTitle), explicit provenance,
connection method, protocol, install-approval and unverified platform metadata;
combined native/bundled provider identities without duplicating Hoplite; no
upstream installer, account secrets, CLI package, runtime adapter or plugin code
is redistributed by this catalog. Asset-level source URLs, revision, hashes and
modifications are in src/lib/runner-brand-assets.json. Codewhale's newer whale
mark comes directly from codewhale-hq/CodeWhale at revision
0ab0d4ac297249ad379192074a250c792d312beb, web/app/icon.svg, under MIT; its
copyright/license is retained in third-party/codewhale/LICENSE. Names and links identify third-party software;
no provider endorsement or trademark license is claimed.

A plugin or dependency outside these files must have its own license and security
review before incorporation. The Apache license does not authorize service usage
or account sharing.

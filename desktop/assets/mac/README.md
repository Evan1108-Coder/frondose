# Frondose macOS app icon

Selected by Evan on October 26, 2026: option B from the dark Orca-style concept set, with the white Frondose flower on a soft black satin rounded-square face and restrained upper-edge highlight. This supersedes the earlier flat-gradient icon. This selection applies to the native Mac icon only, not the website or other platforms.

- `Frondose.icns`: native multi-resolution macOS icon; wired through `mac.icon` in electron-builder.
- `Frondose.png`: matching 1024 × 1024 RGBA master; used for the macOS development Dock icon.
- `assets.json`: hashes and source provenance for regression checks.

The exported ICNS was packed with Apple's `iconutil`, using all ten standard and Retina representations. The built-in image tool used the previous flower and supplied Orca icon as references; the selected generated PNG was mechanically resampled to 1024px. The image has transparent pixels outside the rounded-square icon and no presentation backdrop. The previous PNG/ICNS remain recoverable in `design/mac-icon-history/2026-10-26-before-option-B/`.

Keep these assets in the isolated packaging whitelist. Do not change the bundle ID, storage directories, signing settings or website branding for an icon refresh.

October 30 optical correction: the complete approved face is now mechanically
scaled to 952px inside its transparent 1024px master (opaque bounds approximately
96–927px). This aligns its Dock footprint with standard Mac icons without
changing the flower, satin finish or other platforms. The exact earlier PNG,
ICNS and manifest remain in `design/mac-icon-history/2026-10-30-before-optical-padding/`.

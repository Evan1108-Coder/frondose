# Talvori — approved route-ribbon identity

A directional R built from two broad paths. The negative channel suggests work moving toward a shared direction, while the rounded turns keep the mark from feeling like a generic arrow.

## Assets

- `icon.png`: approved first image — the overall Talvori symbol, indigo on transparency. Visually checked at 16, 24, 32, 48, 64, and 128 CSS pixels against white and charcoal backgrounds.
- `wordmark-dark.png`: horizontal symbol plus custom Talvori lettering, on an opaque charcoal background. The background is intentional: the first transparent wordmark had edge artifacts and was rejected.
- `app-badge.png`: approved second image — the website and app icon, with a white symbol in an indigo rounded square and transparent outer corners.

The user approved images one, two, and four on September 18, 2026. The third, defective transparent wordmark is not used. `wordmark-dark.png` is the fourth, cleaned-up full logo.

These are image-generated raster PNG assets, not vector masters, an installable font, or a multi-size ICO/ICNS package. Small color/edge variations remain inherent to the generated artwork. Before a production app release, prepare approved clean vector masters and platform-specific exports. No trademark clearance is implied.

## App integration

Unmodified copies are served locally from `public/brand/`:

- `rumbo-symbol.png` — used by `TalvoriSymbol` for the overall identity.
- `rumbo-app-icon.png` — used by `TalvoriAppIcon`, the favicon, Apple touch icon, and web manifest.
- `rumbo-wordmark-dark.png` — used by `TalvoriWordmark` for the complete branded signature.

The reusable components are exported from `src/components/Brand.jsx`; their styles are imported automatically. Icons accept `size` (default 32), `className`, `style`, `label` (default “Talvori”), and `decorative`. Use `decorative` when adjacent text already supplies the product name. The wordmark accepts `width` (default 244) and the same accessibility props. It intentionally remains on a charcoal plate in both themes; the original background is not transparent. Keep the default image proportions and do not apply filters or recolor the approved artwork.

The web manifest supplies identity metadata only. It does not implement offline mode or package Talvori as a desktop app. The original high-resolution PNGs are used as-is; platform-specific small icon optimization is still a production follow-up.

Created with the built-in image-generation tool. The original artwork brief used indigo `#5e6ad2`, near-white `#f7f8f8`, and charcoal `#0f1011`. The September 18 UI brand pass uses `#6266d5` (hover `#585dc4`) to align the controls with the approved artwork's indigo tone; the PNGs remain unchanged. White primary-button text has 4.79:1 contrast. Neutral charcoal surfaces, neutral selections, and monochrome empty-state illustrations keep the brand restrained; green/amber/red remain reserved for semantic status. Light mode uses the same indigo with its own accessible neutral surface and text tokens.

## Final generation prompts

### Icon

Use case: logo-brand. Create ONE original icon-only logo candidate for RUMBO, a premium local-first workspace where multiple AI workers, projects, and conversations come together. Asset: master browser favicon / app symbol, square 1024x1024, genuinely transparent background with alpha, no white backing. Art direction: a distinctive architectural 'route ribbon' emblem, inspired by two purposeful paths converging into one direction. A sculptural but FLAT vector-style silhouette, subtly suggesting a capital R through negative space and an ascending diagonal, not a typed R. Thoughtfully interlocking broad bands, one memorable off-axis curved corner, two well-proportioned angular turns, generous open negative channels. Rich, custom-designed geometry, not a generic arrow, compass, star, infinity sign, or stock monogram. User wants character and sophistication, not an oversimplified basic shape; put the sophistication into the silhouette and optical balance, NOT tiny details. Must remain recognizable at 16 and 32 px: thick strokes, only 2-3 major masses, no hairlines, no small detached ornaments. Solid single-color indigo #5e6ad2, clean sharp antialiased edges. Emblem centered and occupies about 78% of canvas, even optical margins. No gradients, shadows, lighting, 3D extrusion, grain, mockup, border, tile, typography, labels or additional variants. ONE isolated finished emblem only.

### Full wordmark — final repair

Inputs: the initial wordmark candidate and the clean icon master.

Use case: precise-object-edit / logo-brand. Repair image 1, a horizontal Talvori full logo. Image 2 is the clean master symbol reference. Keep the composition, exact custom two-band R symbol at left, and exact text 'Talvori' at right. CRITICAL: replace ALL transparent background with one absolutely solid opaque charcoal #0f1011 background. No alpha, no simulated transparency checkerboard. Remove EVERY white speckle, fringe, scratch, smudge, extrusion or residue between and around the letters. Letter counters and spaces must be completely clean solid charcoal. Redraw the wordmark with pristine smooth flat near-white #f7f8f8 letter faces and sharp antialiased edges. Refine it into a confident custom semibold grotesk with softened-square counters, slightly less heavy than image 1, careful optical kerning, a distinctive diagonal R leg, readable lowercase u m b o. Use custom letter geometry, not generic typed text and not bubble lettering. Preserve the indigo #5e6ad2 route-ribbon emblem's exact silhouette from image 2; make it clean flat color. Wide horizontal 1536x640 brand signature, comfortably centered with whitespace, symbol slightly taller than capital R. No texture, gradient, lighting, shadows, bevels, glows, decorative details, tagline, extra versions or mockup. Only the crisp indigo emblem and white 'Talvori' on perfectly flat dark charcoal.

### App badge

Input: the icon master.

Use case: logo-brand / precise-object-edit. Produce ONE companion app badge for the Talvori identity, using the supplied route-ribbon R emblem EXACTLY: keep its silhouette, two bands, central open negative channel, unique curved corners, diagonal foot, and optical proportions unchanged. This is an app/installed-web-app icon variant, not a new symbol. Recolor the reference emblem to solid #ffffff. Place it centered on a flat solid indigo #5e6ad2 rounded-square tile. Tile has softly squared corners with radius about 19% of tile width, no outline. White emblem occupies 68% of tile width, carefully balanced safe margins so it is never cropped by app icon masks. Square 1024x1024 image; tile occupies 94% of image width, genuinely transparent alpha beyond the tile's rounded outer corners. No words, letters outside the emblem, extra marks, gradients, lighting, noise, 3D, bevels, shadow, presentation surface, mockup, or decorative background. Crisp flat vector-like edges, clear silhouette, professional finished export.

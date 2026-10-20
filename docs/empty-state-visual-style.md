# Talvori empty-state visual style

## Purpose

Use a coherent family of generated photographic product renders for empty tabs, search results, settings resources, and disconnected states. These are decorative aids; the title, explanation, and real next action remain the accessible source of meaning.

## Reference and direction

The four user-supplied September 26 references showed monochrome isolated objects, oblique depth, layered forms, and large negative space. They are composition references, not assets to copy. The approved direction is an actual generated image per semantic kind—not SVG line drawings, CSS art, enlarged navigation icons, or a single generic image reused everywhere.

## Asset rules

- Each of the 57 canonical kinds in `src/components/empty-art-catalog.js` has a distinct generated, transparent 600 × 400 WebP in `public/empty-art/`.
- Render as a small physical sculpture photographed in a restrained studio-CGI style: satin graphite ceramic, brushed pewter/silver edges, subtle microtexture, slight three-quarter perspective, and pale neutral rim light.
- Do not include text, logos, people, screenshots, a rectangular backdrop, strong color, or a cast shadow outside the isolated object.
- Keep the subject readable at both the 224px page size and the compact 88px size, against dark and light themes.
- The image remains static and decorative (`aria-hidden`, empty image `alt`). Text and action controls must communicate the state without it.
- Personal/Area illustration color settings may tint the generated image via a masked color overlay that preserves its photographic luminance; the underlying image file stays unchanged. The default is neutral rather than the Area accent.

## Maintenance

When adding an empty-state kind, generate a new image in this same visual family, add its canonical key and asset test, then inspect dark/light and compact layouts. After artwork changes, refresh screenshots from the real frontend, including the Talvori Landing embedded product demo where affected. Do not hand-paint artwork into screenshots.

## Personal Talvori welcome illustration · October 20

`public/empty-art/talvori-welcome.webp` is a separate first-use illustration,
not a replacement for the 57 canonical empty-state kinds. Generated with the
built-in image-generation tool, then encoded as a 640 × 585 transparent WebP
(41,032 bytes). Original output is preserved at
`/Users/EvanLu/.codex/generated_images/01a04dac-27be-7e60-b8f4-ac39def96b22/exec-e7c264dd-5c5d-4129-aac1-c832ea9cb0e9.png`.
The supplied October 20 metallic device was a style/subject reference, not an
asset copied into the app. The illustration is static and decorative.

Generation prompt:

> Use case: stylized-concept. Asset type: Talvori personal assistant welcome-screen illustration, a single isolated object with genuine transparent background. Primary request: a beautifully rendered small metallic desktop assistant device inspired by a silver desktop monitor on a sculptural stand, black inactive rounded-rectangle screen, brushed aluminum frame, subtle side hinge, softly rounded broad base with one circular triangular play button. Three-quarter front view, object centered, entire base visible, no text, no lettering, no logo, no scenery, no additional objects. Premium 3D industrial product illustration, precise silver machining, soft studio reflections and restrained dark glass. The device should be immediately legible at 280px wide in a dark productivity app; strong silver edge highlights, calm quiet mood. Reference is conceptual only; produce a new original object rather than reproducing the screenshot. Transparent background, no checkerboard, no background panel, no drop shadow rectangle.

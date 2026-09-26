# Rumbo empty-state visual style

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

When adding an empty-state kind, generate a new image in this same visual family, add its canonical key and asset test, then inspect dark/light and compact layouts. After artwork changes, refresh screenshots from the real frontend, including the Rumbo Landing embedded product demo where affected. Do not hand-paint artwork into screenshots.

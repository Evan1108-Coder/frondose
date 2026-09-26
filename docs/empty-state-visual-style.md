# Rumbo empty-state visual style

## Purpose

One reusable illustration language for empty tabs, search results, settings resources, and disconnected states. The artwork should orient a person without overpowering the title, explanation, or primary action.

## Reference family

Four user-supplied September 26 screenshots show isolated monochrome line objects on a near-black field: an oblique round object, an orbit of small objects, a layered stack, and a central object with surrounding arcs. They are style references, not assets to copy. Rumbo keeps its own semantic drawings and compositions.

## Fixed rules

- SVG in a 240 × 180 viewBox. No raster export, embedded words, bitmap texture, glow, or looping animation.
- `currentColor` only: dark/light theme and the existing global/Area illustration-color preferences must work without separate assets.
- Thin rounded contours, bright semantic foreground, two quieter relief layers, and generous clear space around the drawing.
- Choose one of four scene families—oblique orbit, layered plane, receding panel, or segmented flow—according to the empty state's meaning. The scene supports, rather than repeats, the subject.
- The illustration is decorative (`aria-hidden`); meaningful state and next action remain in accessible text and controls.
- Keep a distinct semantic composition for each kind in the shared catalog. Do not replace them with enlarged navigation icons or the same generic artwork.

## Variable content

The central object, scene family, and copy can change for a Route, project, chat, agent, document, setting, or search. Scene depth and composition stay consistent. Product screenshots and the landing's embedded demo must be refreshed from the real frontend after an illustration change; do not paint these vectors into screenshots by hand.

## Review checklist

- Is the subject recognizable at full size and at the compact 88px slot?
- Are the foreground and receding contours separable, without a knot of overlapping lines?
- Do dark, light, and custom-color settings remain legible?
- Does an empty state still offer an honest explanation and usable next step?
- Do reduced-motion users see the same static artwork?

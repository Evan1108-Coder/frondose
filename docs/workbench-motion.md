# Workbench motion

The interactive terminal remains rendered by xterm. The small transient line reveal at its top right mirrors at most two **new, complete, plain-text** lines from subsequent polls. The initial history is not presented as new. ANSI control sequences, carriage-return redraws, control characters, and long lines are not mirrored; xterm remains the authoritative and accessible output. The reveal is decorative (`aria-hidden`) and does not intercept input. It is disabled when reduced motion is requested.

The Workbench development-preview link shows a destination card on hover or keyboard focus only after the user explicitly verifies the port. It uses the verified URL and locally known metadata. It does not fetch the destination, capture an image, or claim the page has been inspected. Therefore this intentionally does **not** reproduce the image screenshot in the supplied hover-video reference. An image preview would need an explicit, permission-aware capture workflow.

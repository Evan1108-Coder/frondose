import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { MOTION, motionPreference } from "../src/lib/motion.js";

test("motion is instant for keyboard, gentle for reduced, and bounded for pointer", () => {
  assert.deepEqual(motionPreference({ keyboard: true }), { movement: false, fadeMs: 0 });
  assert.deepEqual(motionPreference({ keyboard: true, reduced: true }), { movement: false, fadeMs: 0 });
  assert.deepEqual(motionPreference({ reduced: true }), { movement: false, fadeMs: 80 });
  assert.deepEqual(motionPreference(), { movement: true, fadeMs: 200 });
  assert.ok(MOTION.disclosureMs + MOTION.disclosureLeadMs < 300);
  assert.equal(MOTION.easeOut, "cubic-bezier(0.23, 1, 0.32, 1)");
});
test("surface motion excludes command palette and does not use restartable keyframes", () => {
  const css = readFileSync(new URL("../src/components/motion.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /@keyframes|transition:\s*all/);
  assert.match(css, /\.command-dialog,[\s\S]+transition: none/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\[data-motion="reduced"\]/);
  assert.match(css, /\.toast \{ opacity: 0; transform: translate\(-50%, var\(--motion-travel\)\)/);
  assert.match(css, /\.dialog-backdrop\[data-closing="true"\]/);
  assert.match(css, /\.view-entrance >/);
});
test("input modality is tracked before workspace onboarding completes", () => {
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../src/components/Shell.jsx", import.meta.url), "utf8");
  assert.match(app, /useEffect\(trackInputModality, \[\]\)/);
  assert.doesNotMatch(shell, /useEffect\(trackInputModality/);
});

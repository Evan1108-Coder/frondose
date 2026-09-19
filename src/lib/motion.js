export const MOTION = Object.freeze({
  easeOut: "cubic-bezier(0.23, 1, 0.32, 1)",
  disclosureMs: 200,
  disclosureLeadMs: 20,
  reducedFadeMs: 80,
});

export function motionPreference({ keyboard = false, reduced = false } = {}) {
  return { movement: !keyboard && !reduced, fadeMs: keyboard ? 0 : reduced ? MOTION.reducedFadeMs : MOTION.disclosureMs };
}

export function currentMotionPreference() {
  if (typeof document === "undefined") return motionPreference({ reduced: true });
  return motionPreference({
    keyboard: document.documentElement.dataset.inputModality === "keyboard",
    reduced: document.documentElement.dataset.motion === "reduced" || window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
}

// One capture listener pair for the application. Reading modality at the moment
// of an action avoids a render of the entire app for every keystroke.
export function trackInputModality() {
  const root = document.documentElement;
  const pointer = () => { root.dataset.inputModality = "pointer"; };
  const keyboard = (event) => {
    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1 && /^(INPUT|TEXTAREA)$/.test(event.target?.tagName)) return;
    root.dataset.inputModality = "keyboard";
  };
  document.addEventListener("pointerdown", pointer, true);
  document.addEventListener("keydown", keyboard, true);
  return () => {
    document.removeEventListener("pointerdown", pointer, true);
    document.removeEventListener("keydown", keyboard, true);
  };
}

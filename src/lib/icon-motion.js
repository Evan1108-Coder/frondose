import { fitIcon } from "morphicons";
import { currentMotionPreference } from "./motion.js";
import { BellRing, BookOpenCheck, FileCheck, FolderOpen, GitBranchPlus, Laugh, BotMessageSquare } from "lucide";

// Critically damped, sub-300ms at the engine's rest threshold. The stock
// "snappy" spring visibly overshoots and settles too slowly for this workspace.
export const ICON_SPRING = Object.freeze({ stiffness: 2400, damping: 96 });
export const ICON_HOVER_SPRING = Object.freeze({ stiffness: 4400, damping: 130 });
const hoverShapes = new WeakMap();
export function hoverShape(node) {
  if (!hoverShapes.has(node)) hoverShapes.set(node, fitIcon(node, [0.4, 0.4, 23.2, 23.2]));
  return hoverShapes.get(node);
}

const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';
const morphTargets = { Bell: BellRing, BookOpen: BookOpenCheck, FileText: FileCheck, Folder: FolderOpen, GitBranch: GitBranchPlus, Smile: Laugh, Bot: BotMessageSquare };

// A small vocabulary of physically meaningful gestures, not a universal bounce.
// Each identity retains its own geometry; this never changes the control's action.
export function activationSpec(name) {
  if (/^Arrow(Right|Left|Up|Down|UpRight)$/.test(name)) return { type: 'arrow', duration: 260, direction: name.slice(5) };
  if (morphTargets[name]) return { type: 'morph', duration: 260, target: morphTargets[name] };
  const specs = {
    Settings: ['turn', [0, -7, 50, 60]], RotateCw: ['turn', [0, 18, 68, 90]], RotateCcw: ['turn', [0, -18, -68, -90]],
    Compass: ['turn', [0, -14, 9, 0]], Paintbrush: ['turn', [0, -14, 5, 0]], Pencil: ['turn', [0, -11, 4, 0]],
    SquarePen: ['turn', [0, -8, 4, 0]], Hammer: ['turn', [0, -22, 6, 0]], KeyRound: ['turn', [0, -10, 13, 0]],
    Clock: ['turn', [0, 8, 20, 0]], TimerReset: ['turn', [0, -14, -28, 0]], SmilePlus: ['turn', [0, -8, 8, 0]],
    Inbox: ['receive', [0, -2, 1, 0]], Download: ['receive', [0, -2, 2, 0]], Archive: ['receive', [0, -1.5, 1, 0]],
    Upload: ['receive', [0, 1, -2, 0]], Play: ['advance', [0, -1, 2, 0]], Send: ['advance', [0, -.6, 2, 0]],
    ExternalLink: ['diagonal', [0, -.5, 2, 0]], GitFork: ['open', [1, .92, 1.06, 1]],
    Users: ['open', [1, .96, 1.05, 1]], UsersRound: ['open', [1, .94, 1.04, 1]],
    Link: ['join', [1, 1.08, .95, 1]], Plug: ['join', [1, 1.06, .93, 1]], Cable: ['join', [1, 1.04, .95, 1]],
    Search: ['inspect', [1, 1.1, 1.03, 1]], Focus: ['inspect', [1, .9, 1.02, 1]],
    Check: ['confirm', [1, .86, 1.06, 1]], CircleCheck: ['confirm', [1, .9, 1.04, 1]],
    ShieldCheck: ['confirm', [1, .94, 1.04, 1]], BadgeCheck: ['confirm', [1, .92, 1.03, 1]],
    Pin: ['receive', [0, -1.2, 1, 0]], PinOff: ['receive', [0, .8, -1, 0]],
    Activity: ['open', [1, .91, 1.05, 1]], Waveform: ['open', [1, .88, 1.06, 1]],
    Plus: ['turn', [0, -15, 6, 0]], X: ['turn', [0, 10, -4, 0]], Copy: ['diagonal', [0, .5, 1.5, 0]],
    Calendar: ['receive', [0, -.8, .6, 0]], Terminal: ['advance', [0, -.5, 1.2, 0]],
    MessageCircle: ['open', [1, .96, 1.06, 1]], MessageSquareText: ['open', [1, .95, 1.04, 1]],
    SlidersHorizontal: ['advance', [0, -1.1, 1.1, 0]], LayoutGrid: ['open', [1, .93, 1.05, 1]],
    Tag: ['turn', [0, -10, 5, 0]], Tags: ['turn', [0, -7, 4, 0]], Flag: ['open', [1, .94, 1.03, 1]],
    Route: ['advance', [0, -.6, 1.4, 0]], Waypoints: ['open', [1, .94, 1.04, 1]],
    ScrollText: ['receive', [0, -.7, 1.2, 0]], ListChecks: ['confirm', [1, .95, 1.04, 1]],
    PanelsTopLeft: ['open', [1, .96, 1.035, 1]], Radio: ['inspect', [1, .92, 1.06, 1]],
    Shapes: ['turn', [0, -5, 3, 0]], ChartNoAxesCombined: ['receive', [0, .6, -1.6, 0]],
    ReceiptText: ['receive', [0, -.4, 1.4, 0]], ShieldUser: ['confirm', [1, .94, 1.025, 1]],
    UserRound: ['receive', [0, -.4, .8, 0]], UserRoundCog: ['turn', [0, -5, 5, 0]],
    Network: ['open', [1, .94, 1.07, 1]], AppWindow: ['open', [1, .94, 1.025, 1]],
    Webhook: ['turn', [0, -6, 8, 0]], Gauge: ['turn', [0, -11, 15, 0]],
    ClipboardCheck: ['confirm', [1, .94, 1.055, 1]], ListOrdered: ['receive', [0, -.5, 1.1, 0]],
    Workflow: ['advance', [0, -.8, 1.3, 0]], Target: ['inspect', [1, 1.07, .98, 1]],
    Code: ['open', [1, .92, 1.08, 1]],
    NotebookPen: ['turn', [0, -6, 3, 0]], Package: ['open', [1, .92, 1.03, 1]],
    LibraryBig: ['open', [1, .95, 1.045, 1]], ArchiveRestore: ['receive', [0, 1.1, -1.3, 0]],
    History: ['turn', [0, -12, -23, 0]], FolderKanban: ['open', [1, .95, 1.06, 1]],
    SquareStack: ['diagonal', [0, -.7, 1.2, 0]], CircleUser: ['receive', [0, -.8, .4, 0]],
    Sparkles: ['inspect', [1, .9, 1.08, 1]], FileCheck: ['confirm', [1, .93, 1.06, 1]],
    BookOpenCheck: ['open', [1, .96, 1.07, 1]], Database: ['receive', [0, .6, -1, 0]],
    HardDrive: ['receive', [0, -.6, .9, 0]], House: ['receive', [0, .7, -1, 0]],
    Keyboard: ['confirm', [1, .95, 1.01, 1]], Paperclip: ['turn', [0, -9, 6, 0]],
    Pause: ['join', [1, 1.09, .97, 1]], CircleAlert: ['inspect', [1, 1.05, .98, 1]],
    Info: ['inspect', [1, 1.045, .99, 1]], Menu: ['open', [1, .92, 1.025, 1]],
    Ellipsis: ['open', [1, 1.09, .98, 1]], Minus: ['open', [1, .9, 1.02, 1]],
    UserPlus: ['open', [1, .93, 1.06, 1]], FlaskConical: ['turn', [0, -8, 7, 0]],
  };
  // Disclosure geometry already morphs to actual expanded/collapsed state.
  if (/^(Chevron|PanelLeft|LoaderCircle)/.test(name)) return null;
  const [gesture, values] = specs[name] ?? ['confirm', [1, .96, 1.025, 1]];
  return { type: 'transform', duration: 260, gesture, values };
}

export function arrowFrame(direction, progress) {
  // Head leads for 38%; tail follows while the whole arrow advances, then settles.
  const p = Math.max(0, Math.min(1, progress));
  const head = p < .38 ? 3 * (1 - (1 - p / .38) ** 3) : p < .7 ? 3 : 3 * (1 - (p - .7) / .3);
  const tail = p < .38 ? 0 : p < .7 ? 3 * (1 - (1 - (p - .38) / .32) ** 3) : 3 * (1 - (p - .7) / .3);
  const point = (x, y) => direction === 'Left' ? [24-x, y] : direction === 'Up' ? [y, 24-x] : direction === 'Down' ? [y, x] : direction === 'UpRight' ? [12+(x-12+y-12)/Math.SQRT2, 12+(-(x-12)+y-12)/Math.SQRT2] : [x,y];
  const coord = (x, y) => point(x,y).map(n => Number(n.toFixed(3))).join(' ');
  return [['path', { d: `M${coord(5+tail,12)} L${coord(19+head,12)}` }], ['path', { d: `M${coord(12+head,5)} L${coord(19+head,12)} L${coord(12+head,19)}` }]];
}

function transformFrames({ gesture, values }) {
  return values.map((value, index) => ({ offset: [0, .16, .58, 1][index], transform: gesture === 'turn' ? `rotate(${value}deg)` : gesture === 'receive' ? `translateY(${value}px)` : gesture === 'advance' ? `translateX(${value}px)` : gesture === 'diagonal' ? `translate(${value}px, ${-value}px)` : gesture === 'open' ? `scaleX(${value})` : gesture === 'join' ? `scaleX(${value})` : `scale(${value})` }));
}

/** One cancellable activation; no React render or navigation delay is involved. */
export function activateIcon(element, controller, name, node) {
  const spec = activationSpec(name);
  if (!controller || !spec || !currentMotionPreference().movement) return () => {};
  let frame = null, timer = null, animation = null, stopped = false;
  const restore = () => controller.set(node);
  const cancel = () => {
    if (stopped) return;
    stopped = true;
    if (frame !== null) cancelAnimationFrame(frame);
    if (timer !== null) clearTimeout(timer);
    animation?.cancel();
    restore();
  };
  if (spec.type === 'arrow') {
    let start;
    const tick = now => {
      if (stopped) return;
      if (!currentMotionPreference().movement || !element.isConnected) { cancel(); return; }
      start ??= now;
      const progress = (now-start) / spec.duration;
      if (progress >= 1) { cancel(); return; }
      controller.set(arrowFrame(spec.direction, progress));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  } else if (spec.type === 'morph') {
    controller.morphTo(spec.target, ICON_HOVER_SPRING);
    if (name === 'Smile') {
      const face = element.querySelector('path');
      if (face) {
        face.style.transformBox = 'view-box'; face.style.transformOrigin = 'center';
        animation = face.animate?.(transformFrames({ gesture: 'turn', values: [0, -6, 5, 0] }), { duration: spec.duration, easing: EASE });
      }
    }
    timer = setTimeout(() => {
      if (stopped) return;
      controller.morphTo(node, ICON_HOVER_SPRING);
      timer = setTimeout(cancel, 170);
    }, 90);
  } else {
    const target = element.querySelector('path') ?? element;
    target.style.transformBox = 'view-box'; target.style.transformOrigin = 'center';
    animation = target.animate?.(transformFrames(spec), { duration: spec.duration, easing: EASE });
    if (animation) animation.onfinish = cancel;
  }
  return cancel;
}

const controllers = new Map();
let teardown;
const controlSelector = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"]';

// One event/OS-preference subscription for the whole icon system, not one per
// icon. Static labels never animate; a pointer hover gives controls only a tiny
// 3.4% geometric expansion without changing their meaning or adding a loop.
export function registerIcon(element, controller) {
  if (!element) return () => {};
  controllers.set(element, controller);
  if (!teardown) {
    const root = document.documentElement;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const fine = matchMedia("(hover: hover) and (pointer: fine)");
    const settle = () => { for (const entry of controllers.values()) entry.settle(); };
    const preferences = () => { if (!currentMotionPreference().movement) settle(); };
    const keyboard = () => settle();
    const activate = (event) => {
      if (event.detail === 0 || !currentMotionPreference().movement) return;
      const control = event.target.closest?.(controlSelector);
      if (!control || control.matches(':disabled, [aria-disabled="true"]')) return;
      for (const icon of control.querySelectorAll('svg[data-rumbo-icon]')) controllers.get(icon)?.activate?.();
    };
    const pointer = (event) => {
      if (event.pointerType !== "mouse" || !fine.matches || !currentMotionPreference().movement) return;
      const control = event.target.closest?.(controlSelector);
      if (!control || control.contains(event.relatedTarget) || control.matches(':disabled, [aria-disabled="true"]')) return;
      const over = event.type === "pointerover";
      for (const icon of control.querySelectorAll("svg[data-rumbo-icon]")) controllers.get(icon)?.hover(over);
    };
    const visibility = () => { if (document.hidden) settle(); };
    const observer = new MutationObserver(preferences);
    observer.observe(root, { attributes: true, attributeFilter: ["data-motion", "data-input-modality"] });
    reduced.addEventListener("change", preferences);
    document.addEventListener("keydown", keyboard, true);
    document.addEventListener("pointerover", pointer, true);
    document.addEventListener("pointerout", pointer, true);
    document.addEventListener("click", activate, true);
    document.addEventListener("visibilitychange", visibility);
    teardown = () => {
      observer.disconnect();
      reduced.removeEventListener("change", preferences);
      document.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("pointerover", pointer, true);
      document.removeEventListener("pointerout", pointer, true);
      document.removeEventListener("click", activate, true);
      document.removeEventListener("visibilitychange", visibility);
    };
  }
  return () => {
    controller.settle();
    controllers.delete(element);
    if (!controllers.size) { teardown?.(); teardown = undefined; }
  };
}

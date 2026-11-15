import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const require = createRequire(import.meta.url);
const built = buildSync({ stdin: { contents: "export {directoryOverlayBlocksGuest, visibleGuestBounds} from './src/components/workspace/BrowserWorkspace.jsx';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'jsx' }, bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react-dom'], loader: { '.css': 'empty' } });
const module = { exports: {} };
new Function('module', 'exports', 'require', built.outputFiles[0].text)(module, module.exports, require);
const { directoryOverlayBlocksGuest, visibleGuestBounds } = module.exports;
const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const guestBounds = box(0, 110, 390, 600);
function fixture(panes = []) {
  const layout = { querySelectorAll(selector) { assert.equal(selector, '.workspace-directory-pane'); return panes; } };
  const guest = { closest(selector) { assert.equal(selector, '.workspace-content-layout'); return layout; }, getBoundingClientRect: () => guestBounds };
  const pane = ({ position = 'absolute', display = 'flex', visibility = 'visible', rect = box(90, 75, 300, 700), visible = true } = {}) => ({ style: { position, display, visibility }, getClientRects: () => visible ? [rect] : [], getBoundingClientRect: () => rect });
  return { guest, pane, panes, detect: () => directoryOverlayBlocksGuest(guest, guestBounds, node => node.style) };
}

test('visible absolute and fixed file drawers block overlapping native browser guests', () => {
  for (const position of ['absolute', 'fixed']) {
    const f = fixture(); f.panes.push(f.pane({ position }));
    assert.equal(f.detect(), true, position);
  }
});

test('desktop flow panes never hide a native guest, even before resize measurements settle', () => {
  for (const position of ['static', 'relative', 'sticky']) {
    const f = fixture(); f.panes.push(f.pane({ position }));
    assert.equal(f.detect(), false, position);
  }
});

test('closed, hidden, collapsed and zero-size drawers do not block the guest', () => {
  for (const options of [{ visible: false }, { display: 'none' }, { visibility: 'hidden' }, { visibility: 'collapse' }, { rect: box(90, 75, 0, 700) }, { rect: box(90, 75, 300, 0) }]) {
    const f = fixture(); f.panes.push(f.pane(options)); assert.equal(f.detect(), false, JSON.stringify(options));
  }
  assert.equal(fixture().detect(), false);
});

test('offscreen drawers and merely adjacent panes do not obscure a native guest', () => {
  for (const rect of [box(390, 110, 300, 600), box(-300, 110, 300, 600), box(90, -90, 300, 200), box(90, 710, 300, 200)]) {
    const f = fixture(); f.panes.push(f.pane({ rect })); assert.equal(f.detect(), false);
  }
});

test('overlay detection tracks real drawer insertion, removal and responsive layout changes', () => {
  const f = fixture();
  assert.equal(f.detect(), false);
  const pane = f.pane({ position: 'static' }); f.panes.push(pane);
  assert.equal(f.detect(), false);
  pane.style.position = 'absolute'; assert.equal(f.detect(), true);
  pane.style.position = 'static'; assert.equal(f.detect(), false);
  pane.style.position = 'fixed'; assert.equal(f.detect(), true);
  f.panes.length = 0; assert.equal(f.detect(), false);
});

test('only the guest\'s workspace layout participates in drawer detection', () => {
  const f = fixture(); f.panes.push(f.pane());
  assert.equal(f.detect(), true);
  const other = fixture(); assert.equal(other.detect(), false);
  assert.equal(directoryOverlayBlocksGuest({ closest: () => null }, guestBounds), false);
  assert.equal(directoryOverlayBlocksGuest(null, guestBounds), false);
});

test('the measured native guest effect uses drawer detection and preserves hide-not-close cleanup', () => {
  const source = readFileSync(new URL('../src/components/workspace/BrowserWorkspace.jsx', import.meta.url), 'utf8');
  assert.match(source, /!bounds \|\| directoryOverlayBlocksGuest\(host.current, rect\)/);
  assert.match(source, /if \(shown\) \{ shown = false; previousBounds = ''; void bridge.hide\(identity\(\)\)/);
  assert.match(source, /new MutationObserver\(measure\)/); assert.match(source, /childList: true, subtree: true/);
  assert.match(source, /window.addEventListener\('resize', measure\)/);
  assert.match(source, /overlays.disconnect\(\)/); assert.match(source, /window.removeEventListener\('resize', measure\)/);
  assert.doesNotMatch(source, /bridge\.close\(/);
});

function clipFixture(rect = box(50, 80, 200, 150), ancestors = [], viewport = { innerWidth: 800, innerHeight: 600 }) {
  let parentElement = null;
  for (const entry of [...ancestors].reverse()) {
    const bounds = entry.rect || box(0, 0, 800, 600);
    parentElement = { parentElement, hidden: entry.hidden, style: entry.style || {}, matches: () => entry.pane || false, getBoundingClientRect: () => bounds, clientLeft: entry.clientLeft || 0, clientTop: entry.clientTop || 0, clientWidth: entry.clientWidth ?? bounds.width, clientHeight: entry.clientHeight ?? bounds.height };
  }
  const element = { parentElement, style: {}, getClientRects: () => [rect], getBoundingClientRect: () => rect };
  return { element, options: { viewport, readStyle: node => node.style }, detect() { return visibleGuestBounds(element, this.options); } };
}

test('native guest bounds are rounded inward and fit every clipping ancestor', () => {
  const f = clipFixture(box(50.1, 80.2, 200.8, 150.6), [{ pane: true, rect: box(50, 80, 202, 153) }]);
  assert.deepEqual(f.detect(), { x: 51, y: 81, width: 199, height: 149 });
  assert.equal(clipFixture(box(50, 80, 200, 80), [{ pane: true, rect: box(50, 80, 200, 79) }]).detect(), null, 'short split pane must hide rather than leak');
  assert.equal(clipFixture(box(50, 80, 200, 150), [{ pane: true, rect: box(50, 80, 200, 150) }, { style: { overflow: 'hidden' }, rect: box(0, 0, 800, 200) }]).detect(), null, 'all outer clipping bounds apply');
});

test('horizontal scrolling hides partially clipped browser leaves and restores fully visible ones', () => {
  for (const left of [-10, 230]) assert.equal(clipFixture(box(left, 80, 200, 150), [{ style: { overflowX: 'auto', overflowY: 'visible' }, rect: box(0, 0, 400, 400) }]).detect(), null);
  assert.deepEqual(clipFixture(box(200, 80, 200, 150), [{ style: { overflowX: 'scroll', overflowY: 'visible' }, rect: box(0, 0, 400, 100) }]).detect(), { x: 200, y: 80, width: 200, height: 150 }, 'only the clipped axis participates');
  assert.equal(clipFixture(box(10, 80, 200, 150), [{ style: { overflowX: 'auto' }, rect: box(0, 0, 220, 400), clientWidth: 205 }]).detect(), null, 'client box excludes scrollbars');
});

test('viewport, visual viewport, hidden ancestors and zero-sized guests cannot attach', () => {
  assert.equal(clipFixture(box(-1, 0, 200, 150)).detect(), null);
  assert.equal(clipFixture(box(0, 500, 200, 150)).detect(), null);
  assert.equal(clipFixture(box(0, 80, 200, 150), [], { innerWidth: 800, innerHeight: 600, visualViewport: { offsetLeft: 50, offsetTop: 0, width: 400, height: 600 } }).detect(), null);
  assert.equal(clipFixture(box(0, 0, 1.9, 100)).detect(), null);
  for (const entry of [{ hidden: true }, { style: { display: 'none' } }, { style: { visibility: 'hidden' } }, { style: { opacity: '0' } }, { style: { contentVisibility: 'hidden' } }]) assert.equal(clipFixture(undefined, [entry]).detect(), null);
  const f = clipFixture(); f.element.getClientRects = () => []; assert.equal(f.detect(), null);
});

test('browser observation tracks clipping ancestors, while native focus is explicit and identity scoped', () => {
  const source = readFileSync(new URL('../src/components/workspace/BrowserWorkspace.jsx', import.meta.url), 'utf8');
  assert.match(source, /node = node.parentElement\) resize.observe\(node\)/);
  assert.match(source, /'class', 'style', 'hidden'/);
  assert.match(source, /state.workspaceId !== workspaceId \|\| state.tabId !== tabId/);
  assert.match(source, /state.event === 'focus' && activeRef.current\) focusCallback.current\?\.\(\)/);
  assert.match(source, /shown && previousBounds === serialized/);
  assert.match(source, /dataset.workspaceDragging === 'true'/);
  assert.match(source, /window.addEventListener\('frondose:workspace-view-geometry', measure\)/);
  assert.match(source, /window.removeEventListener\('frondose:workspace-view-geometry', measure\)/);
  const css = readFileSync(new URL('../src/components/workspace/browser-workspace.css', import.meta.url), 'utf8');
  assert.match(css, /workspace-browser-guest \{[^}]*min-height: 0;/);
});

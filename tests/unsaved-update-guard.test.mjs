import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

test('a successful editor can release only its own navigation guard before unmount', () => {
  const require = createRequire(import.meta.url);
  const code = buildSync({
    entryPoints: [fileURLToPath(new URL('../src/components/UnsavedUpdates.jsx', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', '../ui.jsx'], write: false,
  }).outputFiles[0].text;
  let nextId = 0;
  const cleanups = [];
  const hooks = { useId: () => String(++nextId), useEffect: effect => cleanups.push(effect()), useCallback: callback => callback };
  const loaded = { exports: {} };
  new Function('module', 'exports', 'require', code)(loaded, loaded.exports,
    name => name === 'react' ? hooks : name === '../ui.jsx' ? {} : require(name));
  const { useUnsavedUpdate, requestUpdateNavigation, unsavedUpdatesSafe } = loaded.exports;
  const events = new EventTarget();
  const previousWindow = globalThis.window;
  globalThis.window = events;
  try {
    const warnings = [];
    events.addEventListener('rumbo:unsaved-update', event => warnings.push(event.detail.pending));
    const releaseSavingArea = useUnsavedUpdate(true, true);
    let navigated = 0;
    const navigate = () => { navigated++; };
    requestUpdateNavigation(navigate);
    assert.deepEqual(warnings, [true]);
    assert.equal(navigated, 0);

    const releaseOtherDraft = useUnsavedUpdate(true, false);
    releaseSavingArea();
    requestUpdateNavigation(navigate);
    assert.deepEqual(warnings, [true, false]);
    assert.equal(unsavedUpdatesSafe(), false);
    assert.equal(navigated, 0);

    releaseOtherDraft();
    requestUpdateNavigation(navigate);
    assert.equal(unsavedUpdatesSafe(), true);
    assert.equal(navigated, 1);
    assert.deepEqual(warnings, [true, false]);
  } finally {
    cleanups.forEach(cleanup => cleanup());
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

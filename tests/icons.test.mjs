import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as lucide from 'lucide';
import { canonicalD, createMorph } from 'morphicons/dom';
import { ICON_SPRING, ICON_HOVER_SPRING, hoverShape, activationSpec, arrowFrame, activateIcon, registerIcon } from '../src/lib/icon-motion.js';
import { emptyArtKinds } from '../src/components/empty-art-catalog.js';

test('every interface icon is backed by actual Lucide geometry and no Phosphor imports remain', () => {
  const source = readFileSync(new URL('../src/components/icons.jsx', import.meta.url), 'utf8');
  const names = [...source.matchAll(/defineIcon\("([^"]+)"/g)].map(match => match[1]);
  assert.ok(names.length > 60);
  for (const name of names) {
    assert.ok(Array.isArray(lucide[name]), name);
    assert.ok(canonicalD(lucide[name]).length > 3, name);
  }
  for (const file of readdirSync(new URL('../src', import.meta.url), { recursive: true }).filter(file => /\.(jsx|js)$/.test(file))) {
    assert.doesNotMatch(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), /@phosphor-icons/);
  }
  const empty = readFileSync(new URL('../src/components/EmptyState.jsx', import.meta.url), 'utf8');
  assert.match(empty, /<img src=\{source\}/);
  assert.match(empty, /\/empty-art\/\$\{resolved\}\.webp/);
  assert.doesNotMatch(empty, /<svg|<EmptyArtScene/);
});

test('empty states use photographic assets with a theme-aware tint overlay', () => {
  const art = readFileSync(new URL('../src/components/EmptyState.jsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/components/empty-state.css', import.meta.url), 'utf8');
  assert.match(art, /empty-illustration-tint/);
  assert.match(css, /mask: var\(--empty-art-source\)/);
  assert.match(css, /mix-blend-mode: color/);
  const agentCss = readFileSync(new URL('../src/views/frondose-agent.css', import.meta.url), 'utf8');
  assert.match(agentCss, /\.rumbo-agent-disconnected > \.empty-illustration \{[^}]*width: 220px/);
});

test('Morphicons transitions retarget and settle to canonical Lucide geometry within 300ms', () => {
  const pending = new Map(); let frameId = 0;
  const oldRaf = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = callback => { pending.set(++frameId, callback); return frameId; };
  globalThis.cancelAnimationFrame = id => pending.delete(id);
  try {
    for (const spring of [ICON_SPRING, ICON_HOVER_SPRING]) {
      let d;
      const morph = createMorph({ setAttribute: (_name, value) => { d = value; } }, lucide.ChevronRight);
      morph.morphTo(lucide.ChevronDown, spring);
      let elapsed = 0;
      for (; pending.size && elapsed <= 300; elapsed += 1000 / 60) {
        const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback(elapsed));
      }
      assert.ok(elapsed <= 300, `settling took ${elapsed}ms`);
      assert.equal(d, canonicalD(lucide.ChevronDown));
      morph.morphTo(lucide.ChevronRight, spring);
      morph.morphTo(lucide.ChevronUp, spring);
      morph.set(lucide.ChevronUp);
      assert.equal(d, canonicalD(lucide.ChevronUp));
      assert.equal(pending.size, 0);
      morph.destroy();
    }
  } finally { globalThis.requestAnimationFrame = oldRaf; globalThis.cancelAnimationFrame = oldCancel; }
});

test('reduced motion uses an immediate swap and hover variants are cached', () => {
  let d;
  const morph = createMorph({ setAttribute: (_name, value) => { d = value; } }, lucide.Copy, { reducedMotion: 'always' });
  morph.morphTo(lucide.Check, ICON_SPRING);
  assert.equal(d, canonicalD(lucide.Check));
  morph.destroy();
  assert.equal(hoverShape(lucide.House), hoverShape(lucide.House));
  assert.notEqual(hoverShape(lucide.House), canonicalD(lucide.House));
});

test('semantic activation distinguishes gears, messages, documents and directional arrows', () => {
  assert.equal(activationSpec('Settings').gesture, 'turn');
  assert.equal(activationSpec('FileText').type, 'morph');
  assert.equal(activationSpec('ArrowRight').type, 'arrow');
  assert.equal(activationSpec('MessageCircle').gesture, 'open');
  assert.equal(activationSpec('Smile').target, lucide.Laugh);
  assert.equal(activationSpec('ChevronDown'), null, 'stateful disclosures own their morph');
  for (const name of ['Settings', 'Smile', 'ArrowRight', 'FileText', 'Bot']) assert.ok(activationSpec(name).duration <= 280);
});

test('arrow head leads while tail stays fixed, then tail follows and exact original geometry returns', () => {
  const start = arrowFrame('Right', 0), lead = arrowFrame('Right', .38), follow = arrowFrame('Right', .7);
  assert.equal(start[0][1].d, 'M5 12 L19 12');
  assert.equal(lead[0][1].d, 'M5 12 L22 12');
  assert.equal(follow[0][1].d, 'M8 12 L22 12');
  assert.deepEqual(arrowFrame('Right', 1), start);
  assert.equal(arrowFrame('Left', .38)[0][1].d, 'M19 12 L2 12');
});

test('pointer activation can be cancelled and never travels under keyboard/reduced motion', () => {
  const before = { document: globalThis.document, window: globalThis.window, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame };
  const pending = new Map(); let id = 0, changes = [];
  globalThis.document = { documentElement: { dataset: { inputModality: 'pointer' } } };
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  globalThis.requestAnimationFrame = callback => { pending.set(++id, callback); return id; };
  globalThis.cancelAnimationFrame = key => pending.delete(key);
  const element = { isConnected: true }, controller = { set: node => changes.push(node) };
  try {
    const stop = activateIcon(element, controller, 'ArrowRight', lucide.ArrowRight);
    const tick = [...pending.values()][0]; pending.clear(); tick(0);
    assert.equal(changes.length, 1);
    stop(); stop();
    assert.equal(pending.size, 0);
    assert.equal(changes.at(-1), lucide.ArrowRight);
    document.documentElement.dataset.inputModality = 'keyboard';
    activateIcon(element, controller, 'ArrowRight', lucide.ArrowRight);
    assert.equal(pending.size, 0);
    document.documentElement.dataset.inputModality = 'pointer'; document.documentElement.dataset.motion = 'reduced';
    activateIcon(element, controller, 'ArrowRight', lucide.ArrowRight);
    assert.equal(pending.size, 0);
  } finally { for (const [key, value] of Object.entries(before)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
});

test('all icons share one delegated click subscription and clean up on final unmount', () => {
  const before = Object.fromEntries(['document', 'window', 'matchMedia', 'MutationObserver'].map(key => [key, globalThis[key]]));
  const listeners = new Map(); let additions = 0, removals = 0, activations = 0, settled = 0;
  const mq = { matches: false, addEventListener() {}, removeEventListener() {} };
  globalThis.matchMedia = () => mq; globalThis.window = { matchMedia: () => mq };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  globalThis.document = { documentElement: { dataset: { inputModality: 'pointer' } }, addEventListener(type, handler) { additions++; listeners.set(type, handler); }, removeEventListener(type) { removals++; listeners.delete(type); } };
  try {
    const one = {}, two = {}, control = { matches: () => false, querySelectorAll: () => [one] };
    const disposeOne = registerIcon(one, { activate: () => activations++, settle: () => settled++, hover() {} });
    const firstAdditions = additions;
    const disposeTwo = registerIcon(two, { settle: () => settled++, hover() {} });
    assert.equal(additions, firstAdditions);
    const target = { closest: () => control };
    listeners.get('click')({ target, detail: 1 });
    assert.equal(activations, 1);
    listeners.get('click')({ target, detail: 0 });
    assert.equal(activations, 1, 'synthetic keyboard clicks do not animate');
    listeners.get('keydown')(); assert.equal(settled, 2);
    disposeOne(); assert.equal(removals, 0);
    disposeTwo(); assert.equal(additions, removals);
  } finally { for (const [key, value] of Object.entries(before)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
});

test('every empty-state resource has a generated photographic asset and distinct settings navigation symbol', () => {
  const kinds = emptyArtKinds;
  assert.ok(kinds.length >= 57);
  assert.equal(new Set(kinds).size, kinds.length);
  const imageHashes = new Set();
  for (const kind of kinds) {
    const asset = new URL(`../public/empty-art/${kind}.webp`, import.meta.url);
    const bytes = readFileSync(asset);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', kind);
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', kind);
    assert.ok(statSync(asset).size > 8_000, kind);
    imageHashes.add(createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(imageHashes.size, kinds.length, 'every kind should have its own generated image');
  const settings = readFileSync(new URL('../src/views/settings/SettingsCenter.jsx', import.meta.url), 'utf8');
  const mapping = settings.match(/const PAGE_ICONS = \{([^}]+)\}/)[1];
  const icons = [...mapping.matchAll(/:\s*(\w+)/g)].map(match => match[1]);
  assert.equal(new Set(icons).size, icons.length);
  const resources = readFileSync(new URL('../src/views/settings/ResourcePage.jsx', import.meta.url), 'utf8');
  assert.match(resources, /kind=\{query \? 'search' : archived \? 'archive' : kind\}/);
});

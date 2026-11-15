import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const parse = (block) =>
  Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6,8});/gi)].map(
      ([, name, value]) => [name, value],
    ),
  );
const dark = parse(css.match(/:root\s*\{([^}]+)\}/)[1]);
const light = {
  ...dark,
  ...parse(css.match(/:root\[data-theme="light"\]\s*\{([^}]+)\}/)[1]),
};
const luminance = (hex) => {
  const [r, g, b] = hex
    .slice(1, 7)
    .match(/../g)
    .map((value) => parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
};
const contrast = (a, b) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) /
  (Math.min(luminance(a), luminance(b)) + 0.05);

test("dark surfaces remain neutral and use the requested white primary action", () => {
  assert.equal(dark.bg, "#0f1011");
  assert.equal(dark.nav, "#090a0b");
  assert.ok(luminance(dark.nav) < luminance(dark.bg), 'Sidebar is darker than the canvas');
  assert.equal(dark.accent, "#eeeeee");
  for (const name of [
    "bg",
    "nav",
    "surface",
    "elevated",
    "hover",
    "selected",
    "input",
  ]) {
    const channels = dark[name]
      .slice(1)
      .match(/../g)
      .map((value) => parseInt(value, 16));
    assert.ok(
      Math.max(...channels) - Math.min(...channels) <= 4,
      `${name} must not have a purple cast`,
    );
  }
});

for (const [theme, tokens] of Object.entries({ dark, light })) {
  test(`${theme} text and metadata meet 4.5:1 contrast on all working surfaces`, () => {
    for (const text of ["text", "secondary", "muted", "faint"]) {
      for (const surface of [
        "bg",
        "nav",
        "surface",
        "elevated",
        "hover",
        "selected",
        "input",
      ]) {
        const ratio = contrast(tokens[text], tokens[surface]);
        assert.ok(
          ratio >= 4.5,
          `${theme}/${text} on ${surface}: ${ratio.toFixed(2)}:1`,
        );
      }
    }
  });
  test(`${theme} primary, semantic, and keyboard-focus colors stay legible`, () => {
    for (const state of ["accent", "accent-hover", "selection"])
      assert.ok(contrast(tokens["accent-text"], tokens[state]) >= 4.5, state);
    for (const state of ["success", "warning", "danger"]) {
      for (const surface of ["bg", "surface", "elevated"])
        assert.ok(
          contrast(tokens[state], tokens[surface]) >= 4.5,
          `${state}/${surface}`,
        );
    }
    for (const surface of [
      "bg",
      "nav",
      "surface",
      "elevated",
      "hover",
      "selected",
      "input",
    ])
      assert.ok(
        contrast(tokens.focus, tokens[surface]) >= 3,
        `focus/${surface}`,
      );
  });
}

test("component colors use shared tokens so light mode does not inherit dark fills", () => {
  const componentCss = css.slice(css.indexOf(":root[data-density="));
  assert.doesNotMatch(componentCss, /#[\da-f]{3,8}\b/i);
  assert.match(
    componentCss,
    /\.button\.primary:not\(:disabled\):hover\s*\{\s*background: var\(--accent-hover\)/,
  );
});

test("read items and system messages stay readable instead of fading their text", () => {
  for (const selector of [".inbox-row.read", ".system-message"]) {
    const block = css.slice(css.indexOf(`${selector} {`)).split("}")[0];
    assert.match(block, /color: var\(--muted\)/);
    assert.doesNotMatch(block, /opacity:/);
  }
});

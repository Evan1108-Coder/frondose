import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { aboutHtml } = require('../desktop/about-window.cjs');
test('About displays the approved PNG directly rather than a transformed system icon', async () => {
  const png = await readFile(new URL('../desktop/assets/mac/Frondose.png', import.meta.url));
  const html = aboutHtml({ iconBytes: png, version: '1.2.3' });
  assert.ok(html.includes(png.toString('base64'))); assert.match(html, /Frondose flower app icon/); assert.doesNotMatch(html, /https?:|<script|onload=/);
  assert.match(html, /node|default-src 'none'/); assert.match(html, /Version 1.2.3/);
});
test('About metadata is escaped and the window has no app IPC or script access', async () => {
  const html = aboutHtml({ iconBytes: Buffer.from('fixture'), version: '<script>run()</script>' });
  assert.doesNotMatch(html, /<script>/); assert.match(html, /&lt;script&gt;/);
  const source = await readFile(new URL('../desktop/about-window.cjs', import.meta.url), 'utf8');
  assert.match(source, /nodeIntegration: false/); assert.match(source, /contextIsolation: true/); assert.match(source, /sandbox: true/); assert.doesNotMatch(source, /preload:/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

test('CLI tabs lazy-load a standalone terminal renderer, never the retired Workbench UI', async () => {
  const [workspace, pane, legacy, css] = await Promise.all(['../src/components/workspace/TerminalWorkspace.jsx', '../src/components/workspace/TerminalPane.jsx', '../src/views/Workbench.jsx', '../src/components/workspace/terminal-pane.css'].map(file => readFile(new URL(file, import.meta.url), 'utf8')));
  assert.match(workspace, /lazy\(\(\) => import\('\.\/TerminalPane\.jsx'\)/); assert.doesNotMatch(workspace, /import\('.*Workbench/);
  assert.match(legacy, /export \{ TerminalPane \} from '\.\.\/components\/workspace\/TerminalPane\.jsx'/);
  assert.match(pane, /import\('@xterm\/xterm'\)/); assert.match(pane, /import\('@xterm\/addon-fit'\)/);
  assert.doesNotMatch(pane, /FrondoseAgent|WorkbenchCheckpoints|useApp|native-agent-preview|terminal-providers/);
  assert.doesNotMatch(pane, /`terminals\/\$\{terminal\.id\}\/stop`|provider_id|confirm_execution/);
  assert.match(pane, /observer\?\.disconnect\(\)/); assert.match(pane, /instance\.current\?\.dispose\(\)/);
  assert.match(pane,/Object\.assign\(instance\.current\.options, terminalOptions\(preferences/);
  assert.match(pane,/fallbackSize: fontSize/); assert.match(pane,/fitView\.current\?\.\(\)/);
  assert.match(pane,/\}, \[terminal\.id\]\)/, 'display preference changes must not recreate the PTY attachment');
  for (const rule of ['.wb-terminal-canvas', '.wb-xterm', '.wb-terminal-latest', 'prefers-reduced-motion']) assert.ok(css.includes(rule));
  assert.doesNotMatch(pane, /terminalArrivals|setArrivals/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('local installation and new CLI tabs use the same filesystem-only Orca inventory', async () => {
  const [api, panel, workbench] = await Promise.all(['../server/local-api.mjs', '../src/components/LocalInstallation.jsx', '../server/workbench-service.mjs'].map(file => readFile(new URL(file, import.meta.url), 'utf8')));
  assert.match(api, /localDiscovery = detectTerminalProviders/);
  assert.match(api, /localDiscovery\(\{ platform: process\.platform, env: terminalEnv \}\)/);
  assert.match(api, /runtimes: TERMINAL_PROVIDER_CATALOG\.map/);
  assert.match(workbench, /providers: await detectTerminalProviders/);
  assert.match(panel, /runtime\.title \|\| runtime\.id/); assert.doesNotMatch(panel, /RUNNER_PROVIDER_CATALOG/);
  assert.match(panel, /Default terminal:/); assert.match(panel, /Not found in inherited PATH or known install folders/);
});

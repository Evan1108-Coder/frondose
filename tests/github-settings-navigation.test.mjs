import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localWorkspaceSettingsGroups } from '../src/lib/local-settings-catalog.js';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
test('GitHub settings are a real local destination with disconnected controls disabled', () => {
  const groups = localWorkspaceSettingsGroups([], {meta:{product:{edition:'local'}}});
  assert.equal(groups.flatMap(([,items])=>items).filter(([id])=>id==='github').length,1);
  const source=read('src/views/settings/SettingsCenter.jsx');
  assert.match(source,/useGitHubConnection\(workspace\?\.id, isLocalProduct\(data\)\)/);
  assert.match(source,/disabled=\{s.id === 'github' && !githubConnected\}/);
  assert.match(source,/const disabled = id === 'github' && !githubConnected/);
  assert.match(source,/if \(disabled\) return/);
  assert.match(source,/section === 'github'.*<GitHubSettings/);
});
test('connection availability is read-only and root/workspace scoped, not an account probe', () => {
  const source=read('src/lib/github-connection.js');
  assert.match(source,/apiRequest\(localGitApiPath\(workspaceId\),/);
  assert.doesNotMatch(source,/method:\s*['"]POST|auth login|\/connect|setInterval/);
  assert.match(source,/connection.workspaceId === workspaceId/);
  assert.match(source,/controller\?\.abort\(\)/);
  assert.match(source,/frondose:github-connection-changed/);
});
test('comment page, scoped sidebar handoffs and API are wired into the local product', () => {
  assert.match(read('src/App.jsx'),/comments: localEdition.*<WorkspaceCommentsView/);
  assert.match(read('src/components/Shell.jsx'),/kind: 'comments', rootVersion: commentRootVersion/);
  const api=read('server/local-api.mjs');
  assert.match(api,/fileComments\.dispatch\(\{ workspaceId, actor,/);
  assert.match(api,/fileComments = product.local \? createFileCommentsService/g);
  assert.match(read('src/components/workspace/WorkspaceSurface.jsx'),/value.rootVersion!==directory.binding.version/);
});

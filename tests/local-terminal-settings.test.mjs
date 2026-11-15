import test from 'node:test';
import assert from 'node:assert/strict';
import { localTerminalSettingsTarget, assertLocalTerminalSettingsTarget } from '../src/lib/local-terminal-settings.js';
const home = { ready:false,binding:null };
const bound = { ready:true,binding:{projectId:'project_a',version:'binding_1',path:'/fixture/Project'} };
test('unbound terminal settings use a separate home host without inventing project authority', () => {
  const target=localTerminalSettingsTarget('workspace_a',home);
  assert.deepEqual(target.scope,{workspaceId:'workspace_a',projectId:null,host:'workspace'});
  assert.equal(target.home,true);assert.equal(target.expectedBindingVersion,null);
  assert.equal(assertLocalTerminalSettingsTarget(target,{...home}).identity,target.identity);
});
test('bound and unavailable-linked terminal settings retain the exact project epoch, never fall back home', () => {
  const target=localTerminalSettingsTarget('workspace_a',bound);
  assert.deepEqual(target.scope,{workspaceId:'workspace_a',projectId:'project_a'});assert.equal(target.expectedBindingVersion,'binding_1');assert.equal(target.home,false);
  const offline=localTerminalSettingsTarget('workspace_a',{...bound,ready:false});
  assert.equal(offline.home,false);assert.equal(offline.scope.projectId,'project_a');
});
test('host adoption, rebinds, project/path changes and availability changes invalidate a pending preference update', () => {
  const target=localTerminalSettingsTarget('workspace_a',bound), unbound=localTerminalSettingsTarget('workspace_a',home);
  assert.throws(()=>assertLocalTerminalSettingsTarget(unbound,bound),/directory changed/);
  for(const directory of [home,{...bound,ready:false},{...bound,binding:{...bound.binding,version:'binding_2'}},{...bound,binding:{...bound.binding,projectId:'project_b'}},{...bound,binding:{...bound.binding,path:'/other'}}])assert.throws(()=>assertLocalTerminalSettingsTarget(target,directory),/directory changed/);
  assert.throws(()=>localTerminalSettingsTarget('workspace_a',{binding:{}}),/directory changed/);
});

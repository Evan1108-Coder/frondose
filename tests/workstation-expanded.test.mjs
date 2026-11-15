import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transformSync } from 'esbuild';
import { normalizeTerminalPreferences, terminalOptions, terminalTheme, importTerminalAppearance } from '../src/lib/terminal-preferences.js';
import { normalizeWorkstationAppearance } from '../src/lib/workstation-appearance.js';
const require = createRequire(import.meta.url), { CATALOG, credentials, createProviderClient } = require('../desktop/integration-providers.cjs'), { createLocalIntegrations, publicAddress } = require('../desktop/integration-service.cjs'), { createOpenInApps, launchPlan } = require('../desktop/open-in-apps.cjs'), { createTerminalShell, shellCommand } = require('../desktop/terminal-shell.cjs'), { parseListeners, runtimeStatus } = require('../desktop/runtime-status.cjs');
const uuid='11111111-2222-3333-4444-555555555555';
const memory = initial => { let value = initial ?? null; return { load:async()=>structuredClone(value),save:async next=>{value=structuredClone(next);},get:()=>value }; };
test('terminal preference normalization has hard bounds and never accepts executable configuration',()=>{
  const value=normalizeTerminalPreferences({fontSize:100,scrollback:1e9,scroll:0,fastScroll:100,gpu:'bad',fontFamily:'url(secret)',customTheme:{background:'#123456',foreground:'#abcdef',javascript:'alert(1)'},wordSeparator:'x\n'});
  assert.equal(value.fontSize,32);assert.equal(value.scrollback,50000);assert.equal(value.scroll,.5);assert.equal(value.fastScroll,10);assert.equal(value.gpu,'auto');assert(!value.fontFamily.includes('url'));assert.equal(value.customTheme.javascript,undefined);assert(!value.wordSeparator.includes('\n'));
  const options=terminalOptions(value,{platform:'MacIntel',light:true});assert.equal(options.minimumContrastRatio,4.5);assert.equal(options.macOptionIsMeta,true);assert.equal(terminalTheme(value).background,'#101113');
  assert.equal(terminalOptions(normalizeTerminalPreferences({optionAsAlt:'off'}),{platform:'MacIntel'}).macOptionIsMeta,false);
});
test('bounded Ghostty/Warp imports retain only font and terminal color values',()=>{
  const ghostty=importTerminalAppearance('font-family = Menlo\nfont-size = 16\nbackground = #101010\nforeground = #eeeeee\npalette = 2=#aabbcc\ncommand = rm -rf /\nconfig-file = secrets','ghostty');
  assert.equal(ghostty.fontSize,16);assert.equal(ghostty.fontFamily,'Menlo');assert.equal(ghostty.customTheme.green,'#aabbcc');assert.equal(ghostty.command,undefined);assert.equal(ghostty['config-file'],undefined);
  const warp=importTerminalAppearance('background: "#112233"\nforeground: "#ddeeff"\nnormal:\n  blue: "#0088ff"\nbright:\n  red: "#ff0000"');assert.equal(warp.customTheme.blue,'#0088ff');assert.equal(warp.customTheme.brightRed,'#ff0000');
  for(const value of ['x'.repeat(131073),'!!js/function unsafe','---\nbackground: #000000','&secret'])assert.throws(()=>importTerminalAppearance(value));
});
test('workstation zoom and sidebar preferences remain bounded and ignore unsupported quotas',()=>{
  assert.equal(normalizeWorkstationAppearance({zoom:500,font:'bad',sidebar:'terminal',codexUsage:true}).zoom,150);assert.equal(normalizeWorkstationAppearance({zoom:-1}).zoom,75);assert.equal(normalizeWorkstationAppearance().portsIndicator,false);assert.equal(normalizeWorkstationAppearance({codexUsage:true}).codexUsage,undefined);
});
test('native Open in launch argv keeps paths as one argument on all target platforms',()=>{
  assert.deepEqual(launchPlan({id:'ghostty',path:'/Applications/Ghostty.app'},'/fixture/Project & notes','darwin').args,['-n','-a','/Applications/Ghostty.app','--args','--working-directory=/fixture/Project & notes']);
  assert.deepEqual(launchPlan({id:'iterm',path:'/Applications/iTerm.app'},'/fixture/Project with spaces','darwin').args,['-a','/Applications/iTerm.app','/fixture/Project with spaces']);
  assert.deepEqual(launchPlan({id:'windows-terminal',path:'C:\\Tools\\wt.exe'},'C:\\Project with spaces','win32').args,['-d','C:\\Project with spaces']);
  assert.deepEqual(launchPlan({id:'kitty',path:'/usr/bin/kitty'},'/fixture/a;echo bad','linux').args,['--directory','/fixture/a;echo bad']);
  assert.throws(()=>launchPlan({id:'x',path:'/bin/editor'},'relative','linux'));
});
test('Open in Apps discovery/save/rename never launches, and stale roots or changed binaries refuse execution',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'frondose-native-app-test-')),file=join(dir,'fixture-editor'),root=join(dir,'project');await mkdir(root);await writeFile(file,'fixture executable',{mode:0o700});let binding={workspaceId:'workspace',ready:true,binding:{path:root,version:'v1'}},runs=[];
  const storage=memory(),service=await createOpenInApps({userData:dir,platform:'linux',env:{PATH:dir},home:dir,storage,chooseApp:async()=>file,readDirectory:async()=>binding,run:async plan=>runs.push(plan)});
  const state=await service.command({operation:'add'});assert.equal(runs.length,0);const id=state.selected[0].id;
  await service.command({operation:'rename',id,name:'My editor'});assert.equal(runs.length,0);
  await assert.rejects(service.command({operation:'open',id,workspaceId:'workspace',expectedBindingVersion:'old'}),/directory changed/);assert.equal(runs.length,0);
  await service.command({operation:'open',id,workspaceId:'workspace',expectedBindingVersion:'v1'});assert.equal(runs.length,1);assert.equal(runs[0].cwd,await realpath(root));
  await writeFile(file,'changed executable',{mode:0o700});await assert.rejects(service.command({operation:'open',id,workspaceId:'workspace',expectedBindingVersion:'v1'}),/not available|changed/);assert.equal(runs.length,1);
  await service.command({operation:'remove',id});assert.equal(service.state().selected.length,0);assert.equal(runs.length,1);
});
test('shell plans quote literal POSIX paths and reject unsafe Windows paths',()=>{
  assert.equal(shellCommand("/fixture/a'b",'linux'),"exec '/fixture/a'\\''b'");
  assert.equal(shellCommand('C:\\Shells\\pwsh.exe','win32'),'"C:\\Shells\\pwsh.exe"');
  for(const value of ['C:\\bad&shell.exe','C:\\bad%TEMP%.exe','C:\\shell.cmd'])assert.throws(()=>shellCommand(value,'win32'));
});
test('custom shell selection is inert, persistent and fingerprint-checked only for future launches',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'frondose-shell-test-')),shell=join(dir,'fish');await writeFile(shell,'fixture',{mode:0o700});const storage=memory();const service=await createTerminalShell({userData:dir,platform:'linux',storage,systemShell:shell,chooseShell:async()=>shell});
  assert.equal((await service.command({operation:'status'})).mode,'system');assert.equal((await service.command({operation:'choose'})).mode,'custom');assert.match((await service.command({operation:'plan'})).command,/^exec '/);
  await writeFile(shell,'new bytes',{mode:0o700});await assert.rejects(service.command({operation:'plan'}),/changed/);await service.command({operation:'system'});assert.equal(storage.get().mode,'system');
});
test('all seven integration identities and credential methods are explicit and endpoints cannot be URLs',()=>{
  assert.deepEqual(CATALOG.map(item=>item.id),['github','gitlab','bitbucket','azure-devops','gitea','linear','jira']);
  for(const host of ['localhost','127.0.0.1','x.local','https://gitlab.com/path','a:b@gitlab.com','gitlab.com:443'])assert.throws(()=>credentials('gitlab',{token:'fixture-token',host}));
  assert.throws(()=>credentials('jira',{token:'fixture-token',email:'user@example.com',site:'evil.com'}));assert.throws(()=>credentials('bitbucket',{token:'fixture-token',email:'username'}));assert.throws(()=>credentials('azure-devops',{token:'fixture-token',organization:'../org'}));
});
for(const provider of CATALOG.map(item=>item.id))test(`${provider}: verify, enumerate, select, bounded read and disconnect use only fixture credentials`,async()=>{
  const records=new Map(),calls=[],input={token:'fixture-secret-token',email:'fixture@example.com',organization:'fixture',site:'fixture.atlassian.net'},store=key=>{if(!records.has(key))records.set(key,memory());return records.get(key);};
  const request=async(url,options)=>{calls.push({url,options});if(provider==='linear'){const body=JSON.parse(options.body);if(body.query.includes('viewer'))return{data:{viewer:{id:uuid,name:'Fixture'}}};if(body.query.includes('teams('))return{data:{teams:{nodes:[{id:uuid,name:'Fixture team'}]}}};return{data:{team:{issues:{nodes:[{id:uuid,title:'Fixture issue',identifier:'FIX-1',state:{name:'Open'}}]}}}};}
    if(url.endsWith('/user')||url.endsWith('/myself'))return{id:1,login:'fixture',displayName:'Fixture'};
    if(provider==='azure-devops'&&url.includes('/projects?'))return{value:[]};
    if(provider==='jira'&&url.includes('/project/search'))return{values:[{id:'1',key:'FIX',name:'Fixture'}]};
    if(provider==='azure-devops'&&url.includes('/git/repositories?'))return{value:[{id:uuid,name:'Repo',project:{name:'Fixture'}}]};
    if(provider==='bitbucket'&&url.includes('/user/workspaces?'))return{values:[{workspace:{slug:'fixture'}}]};
    if(provider==='bitbucket'&&url.includes('/repositories/fixture?'))return{values:[{full_name:'fixture/repo'}]};
    if(provider==='bitbucket'&&url.includes('/repositories/fixture/repo?'))return{full_name:'fixture/repo'};
    if(provider==='github'&&url.includes('/user/repos')||provider==='gitea'&&url.includes('/user/repos'))return[{full_name:'fixture/repo'}];
    if(provider==='gitlab'&&url.includes('/projects?'))return[{id:1,path_with_namespace:'fixture/repo'}];
    const item={id:1,title:'Fixture item',number:1,fields:{summary:'Fixture item',status:{name:'Open'}}};return['bitbucket','azure-devops'].includes(provider)?{[provider==='bitbucket'?'values':'value']:[item]}:provider==='jira'?{issues:[item]}:[item];};
  const safeStorage={isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'gnome_libsecret',encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()};
  const service=createLocalIntegrations({userData:'/unused',safeStorage,storageFor:store,authorizeWorkspace:async id=>assert.equal(id,'workspace'),request});const base={workspaceId:'workspace',providerId:provider};
  await assert.rejects(service.command({...base,operation:'connect',credentials:input}),/Confirm/);assert.equal(calls.length,0);
  await service.command({...base,operation:'connect',credentials:input,confirmed:true});const catalog=await service.command({...base,operation:'catalog'});assert.equal(catalog.providers.find(item=>item.id===provider).connected,true);assert(!JSON.stringify([...records.values()].map(record=>record.get())).includes(input.token));
  const result=await service.command({...base,operation:'resources'}),id=result.resources[0].id;await assert.rejects(service.command({...base,operation:'read',resourceId:id,kind:'issues'}),/Select/);
  await service.command({...base,operation:'select',resourceIds:[id]});const read=await service.command({...base,operation:'read',resourceId:id,kind:['azure-devops','bitbucket'].includes(provider)?'pulls':'issues'});assert.equal(read.items.length,1);assert.equal(read.maxItems,50);
  assert(calls.every(call=>!call.url.includes(input.token)));assert(calls.every(call=>call.options.method==='GET'||provider==='linear'&&call.options.method==='POST'));
  if(provider==='linear')assert.equal(calls[0].options.headers.Authorization,input.token);if(provider==='gitlab')assert.equal(calls[0].options.headers['PRIVATE-TOKEN'],input.token);if(provider==='gitea')assert.equal(calls[0].options.headers.Authorization,`token ${input.token}`);
  await service.command({...base,operation:'disconnect'});assert.equal((await service.command({...base,operation:'catalog'})).providers.find(item=>item.id===provider).connected,false);
});
test('unavailable keychain, denied workspace or failed identity never stores a credential',async()=>{
  for(const mode of ['keychain','workspace','provider']){const storage=memory(),service=createLocalIntegrations({userData:'/unused',storageFor:()=>storage,safeStorage:{isEncryptionAvailable:()=>mode!=='keychain',encryptString:()=>{throw Error('Must not encrypt');}},authorizeWorkspace:async()=>{if(mode==='workspace')throw Error('Denied workspace');},request:async()=>{throw Error('Provider unavailable');}});await assert.rejects(service.command({operation:'connect',workspaceId:'workspace',providerId:'github',confirmed:true,credentials:{token:'fixture-token'}}));assert.equal(storage.get(),null);}
});
test('a damaged integration is isolated, does not expose parser diagnostics, and can be cleared explicitly',async()=>{
  const stores = new Map();
  const storageFor = key => {
    if (!stores.has(key)) {
      const record = memory();
      stores.set(key, { record, damaged: false });
    }
    const holder = stores.get(key);
    return {
      load: async () => {
        if (holder.damaged) throw SyntaxError('fixture private path and credential detail');
        return holder.record.get();
      },
      save: async value => {
        holder.damaged = false;
        return holder.record.save(value);
      },
    };
  };
  const service = createLocalIntegrations({
    userData: '/unused',
    safeStorage: { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret', encryptString: value => Buffer.from(value).reverse() },
    authorizeWorkspace: async workspaceId => assert.equal(workspaceId, 'fixture'),
    storageFor,
    request: async url => url.includes('linear') ? { data: { viewer: { id: uuid, name: 'Fixture Linear' } } } : { id: 1, login: 'fixture-github' },
  });
  const command = (operation, providerId, extra) => service.command({ workspaceId: 'fixture', operation, providerId, ...extra });
  for (const id of ['github','linear']) await command('connect', id, { credentials: { token: 'fixture-key' }, confirmed: true });
  const [github] = [...stores.values()];
  github.damaged = true;
  const { providers } = await command('catalog');
  const githubStatus = providers.find(item => item.id === 'github');
  assert.equal(githubStatus.connected, false);
  assert.equal(githubStatus.needsRepair, true);
  assert.deepEqual(githubStatus.selected, []);
  assert.equal(providers.find(item => item.id === 'linear').connected, true);
  assert.doesNotMatch(JSON.stringify(providers), /fixture private path|fixture-key/);
  await command('disconnect', 'github');
  const cleared = (await command('catalog')).providers.find(item => item.id === 'github');
  assert.equal(cleared.connected, false);
  assert.equal(cleared.needsRepair, undefined);
});
test('public API transport refuses loopback, private, mapped and special ranges',()=>{
  for(const address of ['127.0.0.1','10.0.0.1','192.168.1.1','169.254.169.254','100.64.0.1','198.18.0.1','192.0.2.1','203.0.113.1','::1','::ffff:127.0.0.1','fe80::1','fc00::1','2001:db8::1','bad'])assert.equal(publicAddress(address),false,address);for(const address of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])assert.equal(publicAddress(address),true,address);
});
test('opening or refreshing the integration catalog does not initialize credential storage', async () => {
  const calls = [];
  const service = createLocalIntegrations({ platform: 'darwin', userData: '/unused', storageFor: () => memory(),
    authorizeWorkspace: async () => {}, request: async () => { throw Error('Catalog must not contact a provider'); },
    safeStorage: {
      isEncryptionAvailable() { calls.push('sync probe'); throw Error('OS authentication may block the event loop'); },
      async isAsyncEncryptionAvailable() { calls.push('async probe'); return true; },
      async encryptStringAsync() { calls.push('encrypt'); }, async decryptStringAsync() { calls.push('decrypt'); },
    },
  });
  const workspaceId = 'fixture';
  for (let i = 0; i < 2; i++) assert.equal((await service.command({ workspaceId, operation: 'catalog' })).providers.length, CATALOG.length);
  await assert.rejects(service.command({ workspaceId, providerId:'github', operation: 'connect', credentials:{token:'fixture-key'} }), /Confirm/);
  assert.deepEqual(calls, []);
});

test('confirmed macOS integration work uses async storage; Linux plaintext is refused before a provider request', async () => {
  const store = memory();
  const calls = [];
  const base = { workspaceId: 'fixture', providerId:'github' };
  const connect = { ...base, operation:'connect', confirmed:true, credentials:{token:'fixture-key'} };
  const common = { userData: '/unused', storageFor:()=>store, authorizeWorkspace:async()=>{}, request:async url=>{ calls.push('provider'); return url.endsWith('/user') ? {id:1,login:'fixture'} : [{full_name:'fixture/repo'}]; } };
  const asyncStore = createLocalIntegrations({ ...common, platform:'darwin', safeStorage:{
    isEncryptionAvailable(){throw Error('Do not use synchronous macOS storage');},
    async isAsyncEncryptionAvailable(){calls.push('async available');return true;},
    async encryptStringAsync(text){calls.push('async encrypt');return Buffer.from(text).reverse();},
    async decryptStringAsync(bytes){calls.push('async decrypt');return {result:Buffer.from(bytes).reverse().toString()};},
  } });
  await asyncStore.command(connect);
  await asyncStore.command({...base,operation:'resources'});
  assert.deepEqual(calls,['async available','provider','async encrypt','async available','async decrypt','provider']);
  const linuxStore = createLocalIntegrations({ ...common, platform:'linux', safeStorage:{ isEncryptionAvailable:()=>true, getSelectedStorageBackend:()=> 'basic_text', encryptString(){throw Error('Must not encrypt');} } });
  await assert.rejects(linuxStore.command(connect),/Secure OS credential storage is unavailable/);
  assert.equal(calls.length,6);
});
test('provider resource identifiers cannot escape their API namespace',async()=>{
  const client=createProviderClient('github',{token:'fixture'},async()=>[{full_name:'../admin'}]);await assert.rejects(client.resources(),/invalid resource/);
});
test('Bitbucket uses scoped workspace discovery and rechecks the exact selected repository before pulls',async()=>{
 const urls=[];
 const client=createProviderClient('bitbucket',{token:'example-test-token',email:'fixture@example.test'},async address=>{
  const url=new URL(address);urls.push(url.pathname);
  if(url.pathname==='/2.0/user/workspaces')return{values:[{workspace:{slug:'fixture'}}]};
  if(url.pathname==='/2.0/repositories/fixture')return{values:[{full_name:'fixture/project'}]};
  if(url.pathname==='/2.0/repositories/fixture/project')return{full_name:'fixture/different'};
  throw Error('Unexpected endpoint');
 });
 assert.deepEqual(await client.resources(),[{id:'fixture/project',name:'fixture/project'}]);
 await assert.rejects(client.items('fixture/project','pulls'),/no longer accessible/);
 assert.deepEqual(urls,['/2.0/user/workspaces','/2.0/repositories/fixture','/2.0/repositories/fixture/project']);
});
test('system listener parsing is bounded, deduplicated and does not claim workspace ownership',async()=>{
  const listeners=parseListeners('p123\ncnode\nn*:4174\nn127.0.0.1:4174\np456\ncOther\nn[::1]:3000\n','darwin');assert.equal(listeners.length,2);assert.equal(listeners[1].port,4174);
  assert.equal(parseListeners('[{"LocalPort":5173,"OwningProcess":9}]','win32')[0].port,5173);
  const metrics=await runtimeStatus({app:{getAppMetrics:()=>[{pid:1,type:'Browser',cpu:{percentCPUUsage:2},memory:{workingSetSize:102400}}]}});assert.equal(metrics.processes[0].memoryMiB,100);
  const result=await runtimeStatus({app:{},ports:true,platform:'darwin',run:async(file,args,options)=>{assert.equal(options.shell,false);assert.equal(file,'/usr/sbin/lsof');return{stdout:'p123\ncnode\nn*:4174\n'};}});assert.match(result.scope,/not workspace/);
});
test('new rendered surfaces compile and preload exposes narrow controls rather than arbitrary launch or file access',async()=>{
  for(const name of ['src/components/DesktopApplications.jsx','src/components/WorkstationStatus.jsx','src/views/settings/NativeIntegrations.jsx','src/views/settings/TerminalPreferences.jsx','src/views/settings/WorkstationAppearance.jsx','src/views/settings/TerminalSessions.jsx'])assert.doesNotThrow(()=>transformSync(awaitSource(name),{loader:'jsx',format:'esm'}));
  function awaitSource(name){return require('node:fs').readFileSync(new URL('../'+name,import.meta.url),'utf8');}
  const preload=await readFile(new URL('../desktop/preload.cjs',import.meta.url),'utf8');assert.match(preload,/scopeId: payload\?\.scopeId/);assert.doesNotMatch(preload,/open-in-apps|executeJavaScript|execFile|readFile|\.spawn\(/);
});
test('a terminal name appears only in its tab, while single and split panes retain stop controls',async()=>{
  const source=await readFile(new URL('../src/components/workspace/TerminalWorkspace.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(source,/className="terminal-workspace-toolbar-start"|<strong>\{terminal\.name\}<\/strong>/);
  assert.match(source,/leaves\.length === 1.*aria-label="Stop current terminal"/);
  assert.match(source,/path\.length > 0 \? <header>/);
  assert.match(source,/aria-label=\{`Stop \$\{terminal\.name\}`\}/);
  const css=await readFile(new URL('../src/components/workspace/terminal-workspace.css',import.meta.url),'utf8');
  assert.match(css,/\.terminal-workspace-toolbar-actions\{flex-wrap:wrap;max-width:100%\}/);
});

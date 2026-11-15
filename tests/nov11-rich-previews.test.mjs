import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, writeFile, readFile, symlink, link, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDirectoryWorkspaceService } from '../server/directory-workspace.mjs';
import { richPreviewType, previewTable, safePreviewHtml, MAX_PREVIEW_BYTES } from '../src/lib/rich-previews.js';
import { newWorkspaceTab, persistedWorkspaceTabs, normalizeWorkspaceTabs } from '../src/lib/workspace-tabs.js';
test('Every supported workspace tab kind has a registered renderable tab icon',async()=>{
  const source=await readFile(new URL('../src/components/workspace/WorkspaceSurface.jsx',import.meta.url),'utf8');
  const map=source.match(/const kindIcons = \{([^;]+)\};/)[1];
  const {TAB_KINDS}=await import('../src/lib/workspace-tabs.js');
  for(const kind of TAB_KINDS)assert(new RegExp('(?:^|[,\\s])(?:[\'\"]'+kind+'[\'\"]|'+kind+')\\s*:').test(map),'Missing icon for '+kind);
});

test('Rich preview classification is explicit, case-insensitive and read-only', () => {
  for (const [path,kind] of [['photo.PNG','image'],['a.pdf','pdf'],['a.html','html'],['a.mmd','mermaid'],['a.csv','table'],['a.tsv','table'],['a.mp4','video'],['a.mp3','audio'],['a.ipynb','notebook']]) assert.equal(richPreviewType(path).kind,kind);
  for (const path of ['a.exe','a.js','photo.png.exe','',null]) assert.equal(richPreviewType(path),null);
});
test('CSV preview handles quoted delimiters, escaped quotes, CRLF and multiline cells', () => {
  assert.deepEqual(previewTable('a,b\r\n"hello, world","a""b"\r\n"multi\nline",x').rows,[['a','b'],['hello, world','a"b'],['multi\nline','x']]);
  assert(previewTable('a\nb\nc',',',2).truncated); assert(previewTable('"unterminated').malformed);
  assert.deepEqual(previewTable('a\tb\n1\t2','\t').rows,[['a','b'],['1','2']]);
});
test('HTML previews receive a restrictive CSP before all untrusted content', () => {
  const value = safePreviewHtml('<script>fetch("https://evil.invalid")</script>');
  assert(value.indexOf('default-src') < value.indexOf('<script>')); assert(value.includes("form-action 'none'")); assert(value.includes("base-uri 'none'")); assert(!value.includes('allow-scripts'));
});
test('Tool tabs persist only recognized capabilities and never commands or grants', () => {
  const tab = newWorkspaceTab('workstation-tool',{ toolId:'computer',label:'Computer Use',command:'evil',token:'secret',confirmed:true });
  const state = {version:1,tabs:[tab],activeTabId:tab.id};
  const restored = normalizeWorkspaceTabs(persistedWorkspaceTabs(state));
  assert.equal(restored.tabs[0].toolId,'computer'); assert.equal(tab.token,undefined);assert.equal(tab.command,undefined);assert.equal(tab.confirmed,undefined);
  assert.equal(newWorkspaceTab('workstation-tool',{toolId:'execute-anything'}).toolId,'ai');
});
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(),'frondose-previews-')), root=join(directory,'project'), data=join(directory,'private'); await mkdir(root); await mkdir(data);
  const db=new DatabaseSync(':memory:'); db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY,archived_at TEXT);CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,local_path TEXT,archived_at TEXT);INSERT INTO workspaces VALUES('ws',NULL)"); db.prepare('INSERT INTO projects VALUES(?,?,?,?,NULL)').run('p','ws','Preview',root);
  const service=createDirectoryWorkspaceService({db,dataDir:data}); const bound=await service.bind('ws',{id:'local-owner'},{project_id:'p',path:root,confirmed:true});
  t.after(async()=>{db.close();await rm(directory,{recursive:true,force:true});}); return {service,root,version:bound.binding.version};
}
test('Binary preview reads preserve bytes and reject stale bindings and other actors',async t=>{
  const {service,root,version}=await fixture(t),bytes=Buffer.from([137,80,78,71,0,255]);await writeFile(join(root,'image.png'),bytes);
  const result=await service.richFile('ws',{id:'local-owner'},'image.png',version);assert.deepEqual(Buffer.from(result.base64,'base64'),bytes);assert.equal(result.read_only,true);assert.equal(result.kind,'image');
  await assert.rejects(service.richFile('ws',{id:'local-owner'},'image.png','stale'),/changed/);
  await assert.rejects(service.richFile('ws',{id:'other'},'image.png',version),/owner/);
});
test('Rich previews reject private paths, symlinks, hardlinks and files exceeding 25 MB',async t=>{
  const {service,root,version}=await fixture(t),owner={id:'local-owner'};await writeFile(join(root,'file.pdf'),'pdf');await writeFile(join(root,'.env'),'secret');await symlink(join(root,'file.pdf'),join(root,'link.pdf'));await link(join(root,'file.pdf'),join(root,'hard.pdf'));
  for(const path of ['.env','../file.pdf','link.pdf','hard.pdf'])await assert.rejects(service.richFile('ws',owner,path,version));
  await writeFile(join(root,'big.png'),Buffer.alloc(MAX_PREVIEW_BYTES+1));await assert.rejects(service.richFile('ws',owner,'big.png',version),/25 MB/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv,createHash,randomBytes } from 'node:crypto';
import { mkdtemp,mkdir,realpath,rm,symlink,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import browserImport from '../desktop/browser-import.cjs';
const {createBrowserImport,cleanCookie,decryptMacCookie,decodeSafari}=browserImport;

test('cookie validation blocks expired, partitioned, embedded credentials, invalid names, and source-bound sign-ins',()=>{
  const good={domain:'.example.test',name:'session',value:'synthetic',secure:true,httpOnly:true,sameSite:'none'};
  assert.equal(cleanCookie(good).details.domain,'.example.test');
  assert.equal(cleanCookie({...good,domain:'example.test',hostOnly:true}).details.domain,undefined);
  for(const patch of [{domain:'accounts.google.com'},{domain:'google.co.uk'},{domain:'host@evil.test'},{domain:'127.0.0.1'},{domain:'localhost'},{name:'bad name'},{name:'__Host-prefix'},{path:'/abc?x'},{expirationDate:10},{partitioned:true},{partitionKey:{}},{firstPartyDomain:'other.test'},{value:'a; b'}, {secure:false}])assert.equal(cleanCookie({...good,...patch}),null);
});
test('Chromium v24 checks the exact encrypted host binding, never decrypts app-bound values as CBC',()=>{
  const host='.example.test', key=randomBytes(16), cipher=createCipheriv('aes-128-cbc',key,Buffer.alloc(16,0x20));
  const blob=Buffer.concat([Buffer.from('v10'),cipher.update(Buffer.concat([createHash('sha256').update(host).digest(),Buffer.from('fixture')])),cipher.final()]);
  assert.equal(decryptMacCookie(blob,key,host,24),'fixture');
  assert.equal(decryptMacCookie(blob,key,'other.test',24),null);
  assert.equal(decryptMacCookie(Buffer.concat([Buffer.from('v20'),blob.subarray(3)]),key,host,24),null);
});
test('preview is redacted, workspace-scoped and single-use; only confirmed selected sites are written',async t=>{
  const tmp=await mkdtemp(join(tmpdir(),'frondose-browser-import-unit-'));
  t.after(()=>rm(tmp,{recursive:true,force:true}));
  const file=join(tmp,'fixture.json');
  await writeFile(file,JSON.stringify([{domain:'a.example.test',name:'a',value:'secret-one'},{domain:'b.example.test',name:'b',value:'secret-two'},{domain:'accounts.google.com',name:'sid',value:'never'}]));
  const calls=[];let allow=true;
  const handler=createBrowserImport({platform:'linux',chooseFile:async()=>file,authorize:async id=>assert(['one','two'].includes(id)),confirm:async()=>allow,
    session:{fromPartition:partition=>({cookies:{set:async row=>calls.push({partition,row}),flushStore:async()=>{}}})}});
  const preview=()=>handler({operation:'preview',workspaceId:'one',sourceId:'file'});
  const first=await preview();
  assert.deepEqual(first.domains,[{domain:'a.example.test',count:1},{domain:'b.example.test',count:1}]);
  assert.equal(first.skipped,1);assert(!JSON.stringify(first).includes('secret'));assert.equal(calls.length,0);
  await assert.rejects(handler({operation:'commit',workspaceId:'two',token:first.token,domains:['a.example.test']}),/expired/);
  const second=await preview();allow=false;
  assert.equal(await handler({operation:'commit',workspaceId:'one',token:second.token,domains:['a.example.test']}),null);
  assert.deepEqual(calls,[]);allow=true;
  const third=await preview();
  const options={operation:'commit',workspaceId:'one',token:third.token,domains:['a.example.test']};
  assert.deepEqual(await handler(options),{imported:1,rejected:0,saved:true});
  assert.match(calls[0].partition,/^persist:frondose-browser-/);assert.equal(calls[0].row.value,'secret-one');
  await assert.rejects(handler(options),/expired/);
});
test('synthetic Chrome WAL and Firefox cookie profiles are found without touching real browser data',async t=>{
  const home=await realpath(await mkdtemp(join(tmpdir(),'frondose-browser-profiles-unit-')));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const chrome=join(home,'Library','Application Support','Google','Chrome','Default','Network');
  const fox=join(home,'Library','Application Support','Firefox','Profiles','test.default');
  await mkdir(chrome,{recursive:true});await mkdir(fox,{recursive:true});
  const db=new DatabaseSync(join(chrome,'Cookies'));t.after(()=>db.close());
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE meta(key,value); INSERT INTO meta VALUES('version',24);
    CREATE TABLE cookies(host_key,name,path,value,encrypted_value,is_secure,is_httponly,samesite,expires_utc,top_frame_site_key,has_cross_site_ancestor);
    INSERT INTO cookies VALUES('chrome.example.test','sid','/','fixture',x'',1,1,1,0,'',0),
    ('skip.example.test','sid','/','partitioned',x'',1,1,1,0,'https://other.test',0);`);
  const firefox=new DatabaseSync(join(fox,'cookies.sqlite'));
  firefox.exec(`CREATE TABLE moz_cookies(host,name,path,value,expiry,isSecure,isHttpOnly,sameSite,originAttributes);
    INSERT INTO moz_cookies VALUES('fox.example.test','sid','/','fixture',0,1,1,1,''),
    ('skip.example.test','sid','/','container',0,1,1,1,'^userContextId=2');`);firefox.close();
  if(process.platform!=='win32')await symlink(fox,join(home,'Library','Application Support','Firefox','Profiles','not-real'));
  const handler=createBrowserImport({home,platform:'darwin',authorize:async()=>{},confirm:async()=>true,getKey:async()=>{throw Error('No Keychain read should happen');}});
  const invoke=(operation,sourceId)=>handler({operation,workspaceId:'one',sourceId});
  assert.deepEqual((await invoke('sources')).map(x=>x.id),['Chrome:Default','Firefox:test.default']);
  assert.deepEqual((await invoke('preview','Chrome:Default')).domains,[{domain:'chrome.example.test',count:1}]);
  assert.deepEqual((await invoke('preview','Firefox:test.default')).domains,[{domain:'fox.example.test',count:1}]);
});
test('Safari parser reads a bounded record and rejects malformed page sizes',()=>{
  const values=['safari.example.test','sid','/','fixture'].map(s=>Buffer.from(s+'\0'));
  const record=Buffer.alloc(48+values.reduce((n,b)=>n+b.length,0));
  record.writeUInt32LE(record.length);record.writeUInt32LE(5,8);
  let cursor=48;values.forEach((item,i)=>{record.writeUInt32LE(cursor,16+4*i);item.copy(record,cursor);cursor+=item.length;});
  const page=Buffer.alloc(16+record.length);page.writeUInt32BE(256);page.writeUInt32LE(1,4);page.writeUInt32LE(16,8);record.copy(page,16);
  const prefix=Buffer.alloc(12);prefix.write('cook');prefix.writeUInt32BE(1,4);prefix.writeUInt32BE(page.length,8);
  assert.deepEqual(decodeSafari(Buffer.concat([prefix,page])).entries.map(clean=>clean.domain),['safari.example.test']);
  prefix.writeUInt32BE(page.length+1,8);
  assert.throws(()=>decodeSafari(Buffer.concat([prefix,page])),/Invalid Safari/);
});

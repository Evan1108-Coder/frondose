import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp,mkdir,readdir,readFile,realpath,rm,stat,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import passwordModule from '../desktop/browser-passwords.cjs';
import importer from '../desktop/browser-import.cjs';
const { loginOrigin, parsePasswordCsv, createPasswordVault } = passwordModule;
const { boundedBytes,createBrowserImport } = importer;

async function setup(t) {
 const home=await realpath(await mkdtemp(join(tmpdir(),'frondose-password-fixture-')));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const key=randomBytes(32);
 const safeStorage={isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=>'keychain',
  encryptString(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([cipher.update(value),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]);},
  decryptString(buffer){const decipher=createDecipheriv('aes-256-gcm',key,buffer.subarray(0,12));decipher.setAuthTag(buffer.subarray(12,28));return Buffer.concat([decipher.update(buffer.subarray(28)),decipher.final()]).toString();}
 };
 const vault=createPasswordVault({userData:home,safeStorage,readBytes:boundedBytes});
 return {home,vault,safeStorage};
}
test('password import parses quoted CSV, drops ignored metadata, and accepts only exact HTTPS origins',()=>{
 const value=parsePasswordCsv('\ufeffname,url,username,password,note\r\nDemo,https://example.test:444/path,"account, test","fake""secret","multi\nline"\r\nUnsafe,http://example.test,user,do-not-import,x');
 assert.deepEqual(value,{total:2,entries:[{origin:'https://example.test:444',username:'account, test',password:'fake"secret'}]});
 assert.equal(loginOrigin('https://password@fictional.test/'),null);
 assert.equal(loginOrigin('about:blank'),null);
 assert.throws(()=>parsePasswordCsv('url,username,password\n"unclosed'),/CSV/);
 assert.throws(()=>parsePasswordCsv('name,value\na,b'),/columns/);
});
test('preview stays redacted, OS confirmation gates writes and vault is isolated and encrypted',async t=>{
 const {home,vault,safeStorage}=await setup(t);
 const file=join(home,'fixture.csv');
 await writeFile(file,'url,username,password\nhttps://example.test/login,user-fixture,password-fixture\nhttps://else.test/,someone,unselected');
 let approve=true;
 const handler=createBrowserImport({vault,chooseFile:async(_owner,passwords)=>{assert.equal(passwords,true);return file;},confirm:async()=>approve,authorize:async()=>{},platform:'linux',home});
 const preview=()=>handler({operation:'preview',sourceId:'file',kind:'passwords',workspaceId:'ws'});
 const commit=(row,fields={})=>handler({operation:'commit',kind:'passwords',workspaceId:'ws',token:row.token,domains:['https://example.test'],...fields});
 const old=await preview();
 assert.doesNotMatch(JSON.stringify(old),/user-fixture|password-fixture|unselected/);
 await assert.rejects(commit(old,{kind:'cookies'}),/expired/);
 const cancelled=await preview();approve=false;assert.equal(await commit(cancelled),null);assert.deepEqual(await vault.read('ws'),[]);
 approve=true;
 assert.deepEqual(await commit(await preview()),{imported:1});
 assert.deepEqual(await vault.read('different'),[]);
 const [row]=await vault.read('ws');
 const directory=join(home,'browser-passwords'),[name]=await readdir(directory),path=join(directory,name);
 assert.doesNotMatch((await readFile(path)).toString(),/password-fixture|user-fixture|example.test/);
 if(process.platform!=='win32')assert.equal((await stat(path)).mode&0o777,0o600);
 await vault.merge('ws',[{origin:row.origin,username:row.username,password:'changed'}]);
 assert.deepEqual((await vault.read('ws')).map(row=>row.password),['changed']);
 await assert.rejects(vault.remove('ws',row.id,'https://different.test'),/no longer/);
 await vault.remove('ws',row.id,row.origin);assert.deepEqual(await vault.read('ws'),[]);
 const unsafe=createPasswordVault({platform:'linux',userData:home,safeStorage:{...safeStorage,getSelectedStorageBackend:()=>'basic_text'},readBytes:boundedBytes});
 await assert.rejects(unsafe.read('ws'),/secure storage/);
});
test('macOS native password discovery finds local and account SQLite stores without cookie databases',async t=>{
 const {home,vault}=await setup(t);
 const dir=join(home,'Library','Application Support','Google','Chrome','Default');
 await mkdir(dir,{recursive:true});
 const key=randomBytes(16), encrypt=text=>{
  const cipher=createCipheriv('aes-128-cbc',key,Buffer.alloc(16,32));
  return Buffer.concat([Buffer.from('v10'),cipher.update(text),cipher.final()]);
 };
 for(const [i,file] of ['Login Data','Login Data For Account'].entries()){
  const db=new DatabaseSync(join(dir,file));
  db.exec('CREATE TABLE logins(origin_url,username_value,password_value,scheme,blacklisted_by_user)');
  const insert=db.prepare('INSERT INTO logins VALUES(?,?,?,?,?)');
  insert.run('https://local'+i+'.test/sign-in','example',encrypt('synthetic'),0,0);
  insert.run('https://ignored.test','ignored',encrypt('not eligible'),1,0);
  insert.run('https://ignored.test','ignored',encrypt('not eligible'),0,1);
  insert.run('https://encrypted.test','ignored',Buffer.from('v20unsupported'),0,0);
  db.close();
 }
 const handler=createBrowserImport({vault,authorize:async()=>{},confirm:async()=>true,platform:'darwin',home,getKey:async()=>Buffer.from(key)});
 const request=(operation,options={})=>handler({operation,kind:'passwords',workspaceId:'ws',...options});
 assert.deepEqual((await request('sources')).map(row=>row.id),['Chrome:Default']);
 const preview=await request('preview',{sourceId:'Chrome:Default'});
 assert.deepEqual(preview.domains.map(row=>row.domain),['https://local0.test','https://local1.test']);
 assert.equal(preview.skipped,2);
 assert.deepEqual(await request('commit',{token:preview.token,domains:['https://local1.test']}),{imported:1});
 assert.equal((await vault.read('ws'))[0].password,'synthetic');
});

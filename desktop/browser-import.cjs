'use strict';
const { createDecipheriv, createHash, pbkdf2Sync, randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { constants } = require('node:fs');
const { lstat, open, readdir, realpath } = require('node:fs/promises');
const { homedir } = require('node:os');
const { join, sep } = require('node:path');
const { promisify } = require('node:util');
const { browserIdentity } = require('./browser-policy.cjs');
const { parsePasswordCsv, readPasswordProfile } = require('./browser-passwords.cjs');
const run = promisify(execFile);
const limit = 5000, fileLimit = 8 * 1024 * 1024, databaseLimit = 64 * 1024 * 1024;
const sources = [
  ['Chrome', 'Google/Chrome', 'Chrome Safe Storage', 'Chrome'],
  ['Edge', 'Microsoft Edge', 'Microsoft Edge Safe Storage', 'Microsoft Edge'],
  ['Brave', 'BraveSoftware/Brave-Browser', 'Brave Safe Storage', 'Brave'],
  ['Arc', 'Arc/User Data', 'Arc Safe Storage', 'Arc'],
  ['Vivaldi', 'Vivaldi', 'Vivaldi Safe Storage', 'Vivaldi'],
  ['Comet', 'Comet', 'Comet Safe Storage', 'Comet'],
  ['Helium', 'net.imput.helium', 'Helium Storage Key', 'Helium'],
];

async function boundedBytes(path, max) {
  const before = await lstat(path);
  if (!before.isFile() || before.size > max) throw Error('Choose a supported file within the import size limit.');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.ino !== before.ino || info.dev !== before.dev || info.size > max) throw Error('The selected file changed. Choose it again.');
    const bytes = Buffer.alloc(info.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== info.size) throw Error('The selected file changed. Choose it again.');
    return bytes.subarray(0, bytesRead);
  } finally { await handle.close(); }
}
const boundedText=async(path,max)=>(await boundedBytes(path,max)).toString('utf8');

// Safari's page and record layout was reviewed against Orca d7c6ab18,
// src/main/browser/cookies/sources/browser-cookie-safari-parser.ts.
// Copyright (c) 2026 Lovecast Inc.; MIT, see ORCA-LICENSE.txt.
function decodeSafari(bytes) {
  if(bytes.length<8||bytes.toString('ascii',0,4)!=='cook')throw Error('Invalid Safari cookie file.');
  const pages=bytes.readUInt32BE(4);
  let cursor=8+4*pages,total=0;
  if(pages>limit||cursor>bytes.length)throw Error('Invalid Safari cookie file.');
  const entries=[];
  for(let i=0;i<pages;i++){
    const size=bytes.readUInt32BE(8+4*i);
    if(size<16||cursor+size>bytes.length)throw Error('Invalid Safari cookie page.');
    const page=bytes.subarray(cursor,cursor+size);cursor+=size;
    const count=page.readUInt32LE(4);
    if(page.readUInt32BE(0)!==256||8+4*count+4>page.length||(total+=count)>limit)throw Error('Invalid or oversized Safari cookie page.');
    for(let j=0;j<count;j++){
      const offset=page.readUInt32LE(8+4*j);
      if(offset<12+4*count||offset+48>page.length)continue;
      const length=page.readUInt32LE(offset);
      if(length<48||offset+length>page.length)continue;
      const record=page.subarray(offset,offset+length), flags=record.readUInt32LE(8);
      const str=field=>{
        const start=record.readUInt32LE(field);
        if(start<48||start>=length)return null;
        const end=record.indexOf(0,start);
        return end<0?null:record.toString('utf8',start,end);
      };
      const domain=str(16), name=str(20), path=str(24), value=str(28), expiry=record.readDoubleLE(40);
      if(!domain||!name||!path||value===null||!Number.isFinite(expiry))continue;
      entries.push({domain,name,path,value,secure:!!(flags&1),httpOnly:!!(flags&4),expirationDate:expiry>0?expiry+978307200:undefined});
    }
  }
  return {entries,total};
}

function cleanCookie(row, now = Date.now() / 1000) {
  if (!row || typeof row.domain !== 'string' || typeof row.name !== 'string' || typeof row.value !== 'string') return null;
  const domain = row.domain.toLowerCase(), host = domain.replace(/^\./,'');
  if (host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(host)) return null;
  // Source-bound accounts and partitioned cookies are never converted into
  // ordinary cookies. The Electron cookie API cannot preserve partition keys.
  if (/(?:^|\.)google\.[a-z.]+$|(?:^|\.)(?:googleusercontent\.com|gstatic\.com|youtube\.com|googleapis\.com|accounts\.firefox\.com|login\.live\.com|login\.microsoftonline\.com|appleid\.apple\.com)$/.test(host) ||
    row.partitionKey || row.partitioned || row.firstPartyDomain || row.storeId && typeof row.storeId !== 'string') return null;
  if (!/^[!#$%&'*+.^_|`~0-9A-Za-z-]{1,256}$/.test(row.name) || row.value.length > 4096 || /[\x00-\x20\x7f;,]/.test(row.value)) return null;
  const path = row.path ?? '/';
  if (typeof path !== 'string' || !path.startsWith('/') || path.length > 2048 || /[\x00-\x20\x7f;?#\\]/.test(path)) return null;
  const secure = row.secure === true, httpOnly = row.httpOnly === true;
  const sameSite = row.sameSite==='none' ? 'no_restriction' : ['lax','strict','no_restriction'].includes(row.sameSite) ? row.sameSite : 'unspecified';
  if ((sameSite === 'no_restriction' || row.name.startsWith('__Secure-') || row.name.startsWith('__Host-')) && !secure) return null;
  if (row.name.startsWith('__Host-') && (domain.startsWith('.') || row.hostOnly === false || path !== '/')) return null;
  const expiry = row.expirationDate;
  if (expiry != null && (!Number.isFinite(expiry) || expiry <= now)) return null;
  return { host, details:{ url:'https://'+host+path, name:row.name, value:row.value, path, secure, httpOnly, sameSite,
    ...(domain.startsWith('.') || row.hostOnly === false ? {domain:'.'+host} : {}), ...(expiry == null ? {} : {expirationDate:expiry}) } };
}

function decryptMacCookie(encrypted, key, host, schema) {
  if (!key || !encrypted?.length || Buffer.from(encrypted.subarray(0,3)).toString() !== 'v10') return null;
  try {
    const decrypt = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
    const plain = Buffer.concat([decrypt.update(encrypted.subarray(3)),decrypt.final()]);
    const matches = plain.subarray(0,32).equals(createHash('sha256').update(host).digest());
    if (schema >= 24 && !matches) return null;
    return new TextDecoder('utf-8',{fatal:true}).decode(matches ? plain.subarray(32) : plain);
  } catch { return null; }
}

async function macKey(service, account) {
  try {
    const { stdout } = await run('/usr/bin/security',['find-generic-password','-s',service,'-a',account,'-w'],{timeout:30000,maxBuffer:8192});
    return stdout.trim() ? pbkdf2Sync(stdout.trim(),'saltysalt',1003,16,'sha1') : null;
  } catch { return null; }
}

async function discover(home, platform, passwords = false) {
  if (platform !== 'darwin') return [];
  const output = [];
  for (const [browser,folder,service,account] of sources) {
    const root = join(home,'Library','Application Support',folder);
    const dirs = await readdir(root,{withFileTypes:true}).catch(()=>[]);
    if (!dirs.length) continue;
    let cache;
    try { cache = JSON.parse(await boundedText(join(root,'Local State'),fileLimit))?.profile?.info_cache; } catch {}
    for (const dir of dirs.filter(d=>d.isDirectory() && /^(Default|Profile \d{1,6})$/.test(d.name)).slice(0,20)) {
      const paths = passwords ? ['Login Data','Login Data For Account'].map(file=>join(root,dir.name,file)) : [join(root,dir.name,'Network','Cookies'),join(root,dir.name,'Cookies')];
      const found=[];
      for (const path of paths) {
        if (await realpath(path).catch(()=>null) !== path || !(await lstat(path).catch(()=>null))?.isFile()) continue;
        found.push(path);
        if(!passwords) break;
      }
      if (!found.length) continue;
      const name = cache?.[dir.name]?.name;
      output.push({id:browser+':'+dir.name,label:browser+' · '+(typeof name==='string'?name.replace(/[\x00-\x1f]/g,' ').slice(0,80):dir.name),path:found[0],loginPaths:found,service,account});
    }
  }
  if (passwords) return output;
  const firefoxRoot=join(home,'Library','Application Support','Firefox','Profiles');
  for(const dir of (await readdir(firefoxRoot,{withFileTypes:true}).catch(()=>[])).slice(0,20)) {
    if(!dir.isDirectory()||!/^[A-Za-z0-9_.-]{1,128}$/.test(dir.name))continue;
    const path=join(firefoxRoot,dir.name,'cookies.sqlite');
    if(await realpath(path).catch(()=>null)===path&&(await lstat(path).catch(()=>null))?.isFile())output.push({id:'Firefox:'+dir.name,label:'Firefox · '+dir.name,path,firefox:true});
  }
  for(const path of [join(home,'Library','Containers','com.apple.Safari','Data','Library','Cookies','Cookies.binarycookies'),join(home,'Library','Cookies','Cookies.binarycookies')]) {
    if(await realpath(path).catch(()=>null)===path&&(await lstat(path).catch(()=>null))?.isFile()){
      output.push({id:'Safari',label:'Safari',path,safari:true});
      break;
    }
  }
  return output;
}

// SQLite's read-only connection sees the source WAL in its own read transaction.
// Keep only bounded, supported rows and do not return any raw values over IPC.
async function openDatabase(path) {
  const info = await lstat(path);
  if (await realpath(path) !== path || !info.isFile() || info.size > databaseLimit) throw Error('The browser database is unavailable or too large to import.');
  const { DatabaseSync } = require('node:sqlite');
  for(const suffix of ['-wal','-shm']) {
    const side=await lstat(path+suffix).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
    if(side&&(!side.isFile()||side.size>databaseLimit))throw Error('The browser database side files are unavailable or too large.');
  }
  const db = new DatabaseSync(path,{readOnly:true});
  try { db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN'); }
  catch(error) { db.close(); throw error; }
  return db;
}
async function readProfile(source, getKey) {
  if(source.safari)return decodeSafari(await boundedBytes(source.path,fileLimit));
  let rows, schema;
  const db = await openDatabase(source.path);
  try {
    if(source.firefox) {
      const rows=db.prepare(`SELECT host AS domain, name, path, value, expiry, isSecure, isHttpOnly, sameSite, originAttributes FROM moz_cookies WHERE length(value)<=4096 LIMIT ${limit+1}`).all();
      if(rows.length>limit)throw Error('This browser profile has too many cookies to import.');
      return {entries:rows.filter(row=>!row.originAttributes).map(row=>({...row,expirationDate:row.expiry||undefined,secure:row.isSecure===1,httpOnly:row.isHttpOnly===1,sameSite:({1:'lax',2:'strict'})[row.sameSite]})),total:rows.length};
    }
    schema = Number(db.prepare("SELECT value FROM meta WHERE key='version'").get()?.value) || 0;
    const columns = new Set(db.prepare('PRAGMA table_info(cookies)').all().map(c=>c.name));
    const partition = columns.has('top_frame_site_key') ? 'top_frame_site_key' : "''";
    const cross = columns.has('has_cross_site_ancestor') ? 'has_cross_site_ancestor' : '0';
    const statement = db.prepare(`SELECT host_key, name, path, value, encrypted_value, is_secure, is_httponly, samesite, expires_utc, ${partition} AS partition_key, ${cross} AS cross_site FROM cookies WHERE length(value)<=4096 AND length(encrypted_value)<=8192 LIMIT ${limit+1}`);
    statement.setReadBigInts(true);
    rows = statement.all();
  } finally { db.close(); }
  if(rows.length>limit)throw Error('This browser profile has too many cookies to import. Try a smaller profile or cookie file.');
  const eligible = rows.filter(r=>!r.partition_key && !Number(r.cross_site) && cleanCookie({domain:r.host_key,name:r.name,value:'',path:r.path,secure:!!Number(r.is_secure)}));
  const key = eligible.some(r=>r.encrypted_value?.length) ? await getKey(source.service,source.account) : null;
  const entries=[];
  try {
    for (const r of eligible) {
      const value = r.encrypted_value?.length ? decryptMacCookie(r.encrypted_value,key,r.host_key,schema) : r.value;
      const expiry = r.expires_utc > 0n ? Number(r.expires_utc - 11644473600000000n)/1e6 : undefined;
      if (value != null) entries.push({domain:r.host_key,name:r.name,value,path:r.path,secure:!!Number(r.is_secure),httpOnly:!!Number(r.is_httponly),expirationDate:expiry,sameSite:({0:'no_restriction',1:'lax',2:'strict'})[Number(r.samesite)]});
    }
  } finally { key?.fill(0); }
  return { entries, total:rows.length };
}

function createBrowserImport({ session, vault, chooseFile, confirm, authorize, home=homedir(), platform=process.platform, getKey=macKey }) {
  let review=null, pending=false;
  return async (input, owner) => {
    const { workspaceId, partition } = browserIdentity({workspaceId:input?.workspaceId,tabId:'data-import'});
    await authorize(workspaceId);
    const passwords=input.kind==='passwords';
    if (input.operation==='sources') return (await discover(home,platform,passwords)).map(({id,label})=>({id,label}));
    if (input.operation==='cancel') { if(review?.workspaceId===workspaceId)review=null; return null; }
    if(pending)throw Error('Another browser import is open.');
    pending=true;
    try {
      if(input.operation==='preview') {
        review=null;
        if(passwords)vault.secure();
        if(!await confirm(owner,passwords?'Read saved passwords?':'Read browser data?', 'Frondose will read the selected source locally and show the sites you can choose to import. It may ask macOS for the browser’s encryption key. Nothing is imported yet.')) return null;
        let data;
        if(input.sourceId==='file') {
          const path=await chooseFile(owner,passwords);
          if(!path)return null;
          try {
            const bytes=await boundedBytes(path,fileLimit);
            if(passwords){try{data=parsePasswordCsv(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{bytes.fill(0);}}
            else if(bytes.toString('ascii',0,4)==='cook') data=decodeSafari(bytes);
            else {
              const entries=JSON.parse(bytes.toString('utf8'));
              if(!Array.isArray(entries)||entries.length>limit)throw Error('Invalid cookie export.');
              data={entries,total:entries.length};
            }
          } catch { throw Error(passwords?'Could not read this password CSV. Choose a supported browser export of up to 8 MB.':'Could not read the selected cookie export. Choose a supported JSON or Safari cookie file within the import limit.'); }
        } else {
          const source=(await discover(home,platform,passwords)).find(row=>row.id===input.sourceId);
          if(!source)throw Error('This browser profile is no longer available.');
          try { data=passwords?await readPasswordProfile(source,{getKey,openDatabase}):await readProfile(source,getKey); } catch { throw Error(passwords?'Could not read saved passwords from this profile. Close the source browser, allow its macOS Keychain prompt if present, or choose a password CSV.':'Could not read this browser profile. Close the source browser and try again, or choose a cookie export.'); }
        }
        const entries=passwords?data.entries:data.entries.map(row=>cleanCookie(row)).filter(Boolean);
        const site=row=>passwords?row.origin:row.host;
        const domains=new Map();
        for(const row of entries) domains.set(site(row),(domains.get(site(row))||0)+1);
        const token=randomUUID(), expires=Date.now()+120000;
        review={token,workspaceId,expires,entries,passwords};
        const timer=setTimeout(()=>{if(review?.token===token)review=null;},120000);timer.unref?.();
        return {token,domains:[...domains].sort(([a],[b])=>a.localeCompare(b)).map(([domain,count])=>({domain,count})),skipped:data.total-entries.length};
      }
      if(input.operation!=='commit')throw Error('Unsupported browser import operation.');
      const snapshot=review;review=null;
      if(!snapshot||snapshot.token!==input.token||snapshot.workspaceId!==workspaceId||snapshot.passwords!==passwords||snapshot.expires<Date.now())throw Error('The import preview expired. Review the source again.');
      if(!Array.isArray(input.domains)||input.domains.length>limit||input.domains.some(d=>typeof d!=='string'||d.length>280))throw Error('Choose the sites to import.');
      const site=row=>passwords?row.origin:row.host;
      const selected=new Set(input.domains), available=new Set(snapshot.entries.map(site));
      if(!selected.size||[...selected].some(d=>!available.has(d)))throw Error('Choose sites from this preview.');
      const sites=[...selected].sort().slice(0,8).join(', ');
      if(passwords){
        if(!await confirm(owner,'Import selected passwords?',`Save logins for ${selected.size} selected site(s) to this workspace’s encrypted vault?\n\n${sites}${selected.size>8 ? ` and ${selected.size-8} more` : ''}\n\nMatching site and username entries may be replaced. The original browser and export file are not changed.`))return null;
        await authorize(workspaceId);
        return {imported:await vault.merge(workspaceId,snapshot.entries.filter(row=>selected.has(site(row))))};
      }
      if(!await confirm(owner,'Import selected sign-ins?',`Copy cookies for ${selected.size} selected site(s) into this workspace’s Browser?\n\n${sites}${selected.size>8 ? ` and ${selected.size-8} more` : ''}\n\nCookies with matching names, sites and paths may be replaced. Other sites and the original browser are not changed.`))return null;
      await authorize(workspaceId);
      const target=session.fromPartition(partition).cookies;
      let imported=0,rejected=0;
      for(const row of snapshot.entries)if(selected.has(row.host)) {
        try { await target.set(row.details);imported++; } catch { rejected++; }
      }
      let saved=true;
      try { await target.flushStore(); } catch { saved=false; }
      return {imported,rejected,saved};
    } finally { pending=false; }
  };
}

module.exports={createBrowserImport,cleanCookie,decryptMacCookie,decodeSafari,boundedBytes};

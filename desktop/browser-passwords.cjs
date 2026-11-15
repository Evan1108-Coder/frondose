'use strict';
const { createDecipheriv, randomUUID } = require('node:crypto');
const { mkdir, lstat, writeFile, rename, unlink } = require('node:fs/promises');
const { join } = require('node:path');
const { browserIdentity, browserUrl } = require('./browser-policy.cjs');

const MAX_LOGINS = 5000, MAX_BYTES = 24 * 1024 * 1024;
function loginOrigin(value) {
  try {
    const url = new URL(browserUrl(value));
    return url.protocol === 'https:' ? url.origin : null;
  } catch { return null; }
}
function cleanLogin(url, username, password) {
  const origin = loginOrigin(url);
  if (!origin || typeof username !== 'string' || typeof password !== 'string' || username.length > 512 || !password.length || password.length > 2048 || /[\0\r\n]/.test(username + password)) return null;
  return { origin, username, password };
}

// Read bounded RFC 4180-style exports, including escaped quotes and commas.
// Neither unknown columns (notes, OTP secrets, etc.) nor values reach React.
function parsePasswordCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false, ended = false;
  function push() { row.push(field); field = ''; ended = false; if (row.length > 64) throw Error('Too many columns.'); }
  function line() { push(); if (row.some(Boolean)) rows.push(row); row = []; if (rows.length > MAX_LOGINS + 1) throw Error('Too many logins.'); }
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; ended = true; }
      else field += c;
    } else if (c === ',') push();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; line(); }
    else if (c === '"' && !field && !ended) quoted = true;
    else if (ended || c === '"') throw Error('Invalid CSV field.');
    else field += c;
    if (field.length > 65_536) throw Error('CSV field is too large.');
  }
  if (quoted) throw Error('Invalid CSV field.');
  if (field || row.length || ended) line();
  const columns = rows.shift()?.map(value => value.trim().toLowerCase()) || [];
  const site = columns.findIndex(c => c === 'url' || c === 'origin' || c === 'website');
  const user = columns.indexOf('username'), secret = columns.indexOf('password');
  if ([site, user, secret].includes(-1)) throw Error('Expected a password CSV with URL, username, and password columns.');
  return { entries: rows.map(fields => cleanLogin(fields[site],fields[user],fields[secret])).filter(Boolean), total: rows.length };
}
function decryptMacPassword(blob,key) {
  if (!key || !blob?.length || Buffer.from(blob.subarray(0,3)).toString() !== 'v10') return null;
  let bytes;
  try {
    const cipher = createDecipheriv('aes-128-cbc',key,Buffer.alloc(16,0x20));
    bytes = Buffer.concat([cipher.update(blob.subarray(3)),cipher.final()]);
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  } catch { return null; }
  finally { bytes?.fill(0); }
}
async function readPasswordProfile(source,{ getKey, openDatabase }) {
  const rows = [];
  for (const path of source.loginPaths) {
    const db = await openDatabase(path);
    try {
      const columns = new Set(db.prepare('PRAGMA table_info(logins)').all().map(c=>c.name));
      const blocked = ['blacklisted_by_user','blocked_by_user'].filter(name=>columns.has(name)).map(name=>` AND ${name}=0`).join('');
      const scheme = columns.has('scheme') ? ' AND scheme=0' : '';
      rows.push(...db.prepare(`SELECT origin_url,username_value,password_value FROM logins WHERE length(password_value) BETWEEN 1 AND 8192 AND length(origin_url)<=4096 AND length(username_value)<=512${blocked}${scheme} LIMIT ${MAX_LOGINS+1}`).all());
      if (rows.length > MAX_LOGINS) throw Error('This profile has too many saved logins.');
    } finally { db.close(); }
  }
  const eligible = rows.filter(row=>loginOrigin(row.origin_url));
  const key = eligible.length ? await getKey(source.service,source.account) : null;
  if (eligible.length && !key) throw Error('The browser’s encryption key was not available.');
  try { return { total: rows.length, entries: eligible.map(row=>cleanLogin(row.origin_url,row.username_value,decryptMacPassword(row.password_value,key))).filter(Boolean) }; }
  finally { key?.fill(0); }
}

function createPasswordVault({ userData, safeStorage, readBytes, platform=process.platform }) {
  const root = join(userData,'browser-passwords');
  const file = workspaceId => join(root,browserIdentity({workspaceId,tabId:'passwords'}).partition.slice(8)+'.enc');
  function secure() {
    if (!safeStorage.isEncryptionAvailable() || platform === 'linux' && (!safeStorage.getSelectedStorageBackend || safeStorage.getSelectedStorageBackend() === 'basic_text')) throw Error('Unlock the operating system’s secure storage before using saved passwords.');
  }
  async function read(workspaceId) {
    secure();
    const target = file(workspaceId);
    const directory = await lstat(root).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if (!directory) return [];
    if (!directory.isDirectory()) throw Error('Saved password storage is unavailable.');
    let bytes;
    try { bytes = await readBytes(target,MAX_BYTES); } catch (error) { if (error.code==='ENOENT') return []; throw Error('Saved passwords could not be read securely.'); }
    try {
      const state = JSON.parse(safeStorage.decryptString(bytes));
      if (state.schema !== 1 || !Array.isArray(state.logins) || state.logins.length > MAX_LOGINS || state.logins.some(row=>!cleanLogin(row?.origin,row?.username,row?.password) || !/^[a-f0-9-]{36}$/.test(row.id))) throw Error();
      return state.logins;
    } catch { throw Error('Saved passwords could not be decrypted.'); }
  }
  async function save(workspaceId,logins) {
    secure();
    if (logins.length > MAX_LOGINS) throw Error('The workspace has reached its saved-password limit.');
    const encrypted = safeStorage.encryptString(JSON.stringify({schema:1,logins}));
    if (encrypted.length > MAX_BYTES) throw Error('The workspace has reached its saved-password storage limit.');
    await mkdir(root,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
    if (!(await lstat(root)).isDirectory()) throw Error('Saved password storage is unavailable.');
    const target = file(workspaceId), temporary = target+'.'+randomUUID();
    try { await writeFile(temporary,encrypted,{flag:'wx',mode:0o600,flush:true}); await rename(temporary,target); }
    finally { await unlink(temporary).catch(()=>{}); }
  }
  let serialized = Promise.resolve();
  const change = (workspaceId, fn) => {
    const work = serialized.then(async()=>{const {logins,result}=fn(await read(workspaceId));await save(workspaceId,logins);return result;});
    serialized = work.catch(()=>{});
    return work;
  };
  const key = ({origin,username}) => JSON.stringify([origin,username]);
  return { secure, read, merge(workspaceId,entries) {
    return change(workspaceId,current=>{
      const merged = new Map(current.map(row=>[key(row),row])), unique = new Map(entries.map(row=>[key(row),row]));
      for(const [identity,row] of unique) merged.set(identity,{...row,id:merged.get(identity)?.id||randomUUID()});
      return {logins:[...merged.values()],result:unique.size};
    });
  }, remove(workspaceId,id,origin) {
    return change(workspaceId,current=>{
      const logins=current.filter(row=>row.id!==id||row.origin!==origin);
      if(logins.length===current.length)throw Error('This saved login is no longer available.');
      return {logins,result:true};
    });
  } };
}

// Runs only in the captured guest main frame, in its own isolated world. A
// form that posts off-origin, a registration form, hidden controls, iframes,
// and ambiguous password fields are deliberately not filled.
function fillLogin(origin,username,password) {
  if (window.top !== window || location.origin !== origin) return false;
  const visible = input=>input.getClientRects().length && getComputedStyle(input).visibility==='visible' && !input.readOnly && !input.matches(':disabled') && !input.value;
  const fields=[...document.querySelectorAll('input[type="password"]')].filter(input=>visible(input)&&input.autocomplete!=='new-password'&&input.form&&
    new URL(input.form.action||location.href).origin===origin&&input.form.method.toLowerCase()==='post'&&
    ![...input.form.elements].some(control=>control.hasAttribute('formaction')&&new URL(control.formAction||location.href).origin!==origin));
  if (fields.length!==1 || fields[0].form.querySelectorAll('input[type="password"]').length!==1) return false;
  const secret=fields[0];
  const candidates=[...secret.form.querySelectorAll('input')].filter(input=>input.form===secret.form && ['email','text','tel'].includes(input.type) && visible(input));
  const matching=candidates.filter(input=>input.autocomplete.split(/\s+/).includes('username'));
  const user=matching.length===1?matching[0]:candidates.length===1?candidates[0]:null;
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
  if (username && user) setter.call(user,username);
  setter.call(secret,password);
  if (username && user) user.dispatchEvent(new Event('input',{bubbles:true}));
  secret.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
}
module.exports={loginOrigin,parsePasswordCsv,readPasswordProfile,decryptMacPassword,createPasswordVault,fillLogin};

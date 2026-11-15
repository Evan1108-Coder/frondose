'use strict';
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, Notification, shell, session, powerMonitor, Menu, safeStorage, clipboard } = require('electron');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { get } = require('node:http');
const { appUrl, browserUrl, isTrustedFrame } = require('./browser-policy.cjs');
const { createBrowserHost } = require('./browser-host.cjs');
const { createBrowserImport, boundedBytes } = require('./browser-import.cjs');
const { createPasswordVault } = require('./browser-passwords.cjs');
const { createNativeNotificationService, notificationSettingsTarget } = require('./notification-service.cjs');
const { createNativeUpdater } = require('./update-runtime.cjs');
const { createAboutWindow } = require('./about-window.cjs');
const { createTerminalShell } = require('./terminal-shell.cjs');
const { runtimeStatus } = require('./runtime-status.cjs');
const {clipboardText}=require('./clipboard-policy.cjs');
const { createLocalIntegrations } = require('./integration-service.cjs');
const { createDesktopWorkstationTools } = require('./workstation-tools.cjs');

app.setName('Frondose');
if (process.env.FRONDOSE_DESKTOP_USER_DATA) app.setPath('userData', resolve(process.env.FRONDOSE_DESKTOP_USER_DATA));
const root = resolve(__dirname, '..');
if (process.platform === 'win32') app.setAppUserModelId('app.frondose.desktop');
// Native macOS branding is independent of the website and other platforms.
const appIcon = process.platform === 'darwin' ? join(__dirname, 'assets/mac/Frondose.png') : join(root, 'public/brand/frondose-frond-icon.png');
const origin = appUrl(process.env.FRONDOSE_DESKTOP_URL || `http://127.0.0.1:${process.env.PORT || 4174}`);
const smoke = process.env.FRONDOSE_DESKTOP_SMOKE === '1';
let mainWindow, browserHost, ownedServer, ownedApi, nativeUpdater, localIntegrations, terminalShell, quotaService, quotaOpening, quotaQuitting=false;
const aboutWindow = createAboutWindow({ BrowserWindow, getParent: () => mainWindow, iconPath: appIcon, getVersion: () => app.getVersion() });
function installMenu() {
  const about = { label: 'About Frondose', click: () => { void aboutWindow.show(); } };
  const application = { label: 'Frondose', submenu: [about, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] };
  Menu.setApplicationMenu(Menu.buildFromTemplate([...(process.platform === 'darwin' ? [application] : []), { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }, ...(process.platform === 'darwin' ? [] : [{ role: 'help', submenu: [about] }])]));
}
const notificationService = createNativeNotificationService({ Notification, platform: process.platform, isPackaged: app.isPackaged,
  onStatus: status => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('frondose-desktop:notification-status', status); },
  onOpen: action => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); if (action) mainWindow.webContents.send('frondose-desktop:notification-open', action); } },
});

function readHealth() {
  return new Promise((yes, no) => {
    const request = get(`${origin}/api/health`, { timeout: 2500 }, response => {
      let body = ''; response.setEncoding('utf8');
      response.on('data', part => { body += part; if (body.length > 16384) { request.destroy(); no(Error('Unexpected server health response.')); } });
      response.on('end', () => { try { const health = JSON.parse(body); if (response.statusCode !== 200 || health.product?.edition !== 'local' || health.product?.singleOwner !== true) throw Error('The port belongs to a different application or edition.'); yes(health); } catch (error) { no(error); } });
    });
    request.on('timeout', () => request.destroy(Error('The local server did not answer.')));
    request.on('error', no);
  });
}
async function ensureServer() {
  if (smoke) {
    try { await readHealth(); return; }
    catch (error) {
      if (error.code !== 'ECONNREFUSED') throw error;
      throw Error('Desktop smoke checks require an already-running Frondose fixture server. No database was opened.');
    }
  }
  // Loopback alone is not proof of ownership: a competing listener can reply
  // with any health JSON. Never load its document with the desktop preload.
  // launchLocal rejects an occupied port before it opens a workspace database.
  const { launchLocal } = await import(pathToFileURL(join(root, 'scripts/start-local.mjs')).href);
  const env = { ...process.env };
  if (app.isPackaged && !env.FRONDOSE_DATA_DIR && !env.TALVORI_DATA_DIR && !env.RUMBO_DATA_DIR) env.FRONDOSE_DATA_DIR = join(app.getPath('userData'), 'workspace-store');
  const local = await launchLocal({ port: new URL(origin).port, env, clientDirectory: join(root, 'dist/client') });
  ownedServer = local.server;
  ownedApi = local.api;
}
function trusted(event) { if (!ownedServer?.listening || !isTrustedFrame(event, mainWindow, origin)) throw Error('Only the trusted Frondose app can use desktop controls.'); }
function registerIpc() {
  const workstationTools = createDesktopWorkstationTools({ authorizeWorkspace: async workspaceId => {
    const response = await mainWindow.webContents.session.fetch(origin + '/api/directory-workspace?workspace_id=' + encodeURIComponent(workspaceId), { credentials: 'include', signal: AbortSignal.timeout(5000) });
    const body = await response.json(); if (!response.ok || body.result?.workspaceId !== workspaceId) throw Error('Unlock and select this local workspace first.');
  } });
  app.once('before-quit', () => workstationTools.close());
  ipcMain.handle('frondose-desktop:workstation-tools', (event, payload) => { trusted(event); if (process.env.FRONDOSE_DESKTOP_SMOKE === '1' && payload?.operation !== 'capabilities') throw Error('Native execution is disabled during smoke checks.'); return workstationTools.releaseCommand(payload); });
  ipcMain.handle('frondose-desktop:clipboard-write',(event,text)=>{trusted(event);clipboard.writeText(clipboardText(text));return {copied:true};});
  ipcMain.handle('frondose-desktop:provider-usage', async(event,payload)=>{trusted(event);
    if(process.env.FRONDOSE_DESKTOP_SMOKE==='1'||process.env.FRONDOSE_DESKTOP_NO_ACCOUNT_READS==='1')throw Error('Provider account reads are disabled for this launch.');
    if(typeof payload?.workspaceId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(payload.workspaceId))throw Error('Choose a local workspace first.');
    const response=await mainWindow.webContents.session.fetch(origin+'/api/directory-workspace?workspace_id='+encodeURIComponent(payload.workspaceId),{credentials:'include',signal:AbortSignal.timeout(5000)});
    const body=await response.json();if(!response.ok||body.result?.workspaceId!==payload.workspaceId)throw Error('Unlock this workspace before reading the local account allowance.');
    if(!quotaOpening)quotaOpening=import(pathToFileURL(join(root,'server/codex-quota.mjs')).href).then(module=>(quotaService=module.createCodexQuotaService()));
    const service=await quotaOpening;return service.read({refresh:payload.refresh===true});
  });
  ipcMain.handle('frondose-desktop:terminal-shell', async (event, payload) => { trusted(event); if (!terminalShell) throw Error('Terminal shell preferences are opening.'); return terminalShell.command(payload); });
  ipcMain.handle('frondose-desktop:runtime-status', async (event, payload) => { trusted(event); return runtimeStatus({ app, ports: payload?.ports === true }); });
  ipcMain.handle('frondose-desktop:integrations', async (event, payload) => { trusted(event); if (!localIntegrations) throw Error('Local integrations are still opening.'); return localIntegrations.command(payload); });
  ipcMain.handle('frondose-desktop:update', async (event, payload) => {
    trusted(event);
    if (!nativeUpdater) throw Error('The updater is still opening.');
    const result = await nativeUpdater.command(payload);
    if (payload?.operation === 'downloads' && result.url) { await shell.openExternal(result.url); return { opened: true }; }
    return result;
  });
  ipcMain.handle('frondose-desktop:update-safety', (event, payload) => { trusted(event); return nativeUpdater?.safety(payload); });
  ipcMain.handle('frondose-desktop:app-info', event => { trusted(event); return { version: app.getVersion(), packaged: app.isPackaged, platform: process.platform }; });
  ipcMain.handle('frondose-desktop:browser', (event, payload) => { trusted(event); return browserHost.command(payload); });
  const authorizeBrowserWorkspace = async workspaceId => {
      const response = await mainWindow.webContents.session.fetch(origin + '/api/directory-workspace?workspace_id=' + encodeURIComponent(workspaceId), { credentials: 'include', signal: AbortSignal.timeout(5000) });
      if (!response.ok || (await response.json()).result?.workspaceId !== workspaceId) throw Error('Unlock and select the destination workspace first.');
  };
  const vault = createPasswordVault({userData:app.getPath('userData'),safeStorage,readBytes:boundedBytes});
  const importBrowser = createBrowserImport({
    session,vault,authorize:authorizeBrowserWorkspace,
    chooseFile: async (owner,passwords) => (await dialog.showOpenDialog(owner, { title:passwords?'Choose a saved password CSV':'Choose a cookie export', properties:['openFile'], filters:passwords?[{name:'Password CSV',extensions:['csv']}]:[{name:'Cookie export',extensions:['json','binarycookies']}] })).filePaths[0],
    confirm: async (owner,message,detail) => (await dialog.showMessageBox(owner,{type:'warning',message,detail,buttons:['Cancel','Continue'],cancelId:0,defaultId:0,noLink:true})).response === 1,
  });
  ipcMain.handle('frondose-desktop:browser-import', (event,payload) => { trusted(event); return importBrowser(payload, mainWindow); });
  let passwordBusy=false;
  ipcMain.handle('frondose-desktop:browser-passwords', async (event,payload) => {
    trusted(event);
    if(passwordBusy)throw Error('A saved-password action is already open.');
    passwordBusy=true;
    try{
      const page=await browserHost.passwordPage(payload);
      await authorizeBrowserWorkspace(page.workspaceId);
      const logins=(await vault.read(page.workspaceId)).filter(row=>row.origin===page.origin);
      if(!logins.length){await dialog.showMessageBox(mainWindow,{message:'No saved logins for this site',detail:page.origin});return null;}
      const label=row=>row.username.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,' ').slice(0,160)||'No username';
      let offset=0;
      while(offset<logins.length){
        const shown=logins.slice(offset,offset+8), more=offset+shown.length<logins.length;
        const {response}=await dialog.showMessageBox(mainWindow,{message:'Choose a saved login',detail:page.origin,buttons:['Cancel',...shown.map(label),...(more?['More logins']:[])],cancelId:0,defaultId:0,noLink:true});
        if(!response)return null;
        if(response===shown.length+1&&more){offset+=shown.length;continue;}
        const target=shown[response-1];
        if(!target)return null;
        const decision=(await dialog.showMessageBox(mainWindow,{type:'warning',message:'Use this saved login?',detail:`${page.origin}\n${label(target)}\n\nFill puts the login in this site’s form without clicking Sign in. Remove deletes it only from this workspace.`,buttons:['Cancel','Fill','Remove saved login'],cancelId:0,defaultId:0,noLink:true})).response;
        if(!decision)return null;
        await authorizeBrowserWorkspace(page.workspaceId);
        if(decision===1){await page.fill(target);return {filled:true};}
        if(decision===2){
          const confirmation=await dialog.showMessageBox(mainWindow,{type:'warning',message:'Remove this saved login?',detail:`${page.origin}\n${label(target)}`,buttons:['Cancel','Remove'],cancelId:0,defaultId:0,noLink:true});
          if(confirmation.response===1){await authorizeBrowserWorkspace(page.workspaceId);await vault.remove(page.workspaceId,target.id,page.origin);return {removed:true};}
        }
        return null;
      }
      return null;
    }finally{passwordBusy=false;}
  });
  ipcMain.handle('frondose-desktop:choose-directory', async event => { trusted(event); const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose a Frondose workspace folder', properties: ['openDirectory', 'createDirectory'] }); return { cancelled: result.canceled, path: result.canceled ? null : result.filePaths[0] || null }; });
  ipcMain.handle('frondose-desktop:notification-status', event => { trusted(event); return notificationService.status(); });
  ipcMain.handle('frondose-desktop:notification-test', (event, options) => {
    trusted(event);
    return notificationService.send({ title: 'Frondose', body: options?.test === true ? 'This is a test notification from Frondose.' : 'Your workspace is ready. Frondose will let you know when work needs attention.', silent: options?.silent === true });
  });
  ipcMain.handle('frondose-desktop:notification', (event, payload) => { trusted(event); return notificationService.send(payload); });
  ipcMain.handle('frondose-desktop:notification-settings', async event => { trusted(event); const target = notificationSettingsTarget(process.platform); if (!target) return { opened: false, error: 'Use your desktop environment’s notification settings.' }; await shell.openExternal(target); return { opened: true }; });
  ipcMain.handle('frondose-desktop:open-external', async (event, payload) => { trusted(event); const url = browserUrl(payload?.url); if (url === 'about:blank') throw Error('Enter a web address first.'); await shell.openExternal(url); return { opened: true }; });
}
async function openWindow() {
  mainWindow = new BrowserWindow({ width: 1440, height: 920, minWidth: 760, minHeight: 520, title: 'Frondose', icon: appIcon, backgroundColor: '#0f1011', show: false, autoHideMenuBar: true, webPreferences: { ...(!smoke && ownedServer?.listening ? { preload: join(__dirname, 'preload.cjs') } : {}), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, navigateOnDragDrop: false } });
  // The app renderer never leaves its fixed loopback origin. Guest pages have
  // separate contents/sessions and never receive this preload or main IPC role.
  mainWindow.webContents.on('will-navigate', (event, target) => { try { if (new URL(target).origin !== origin) event.preventDefault(); } catch { event.preventDefault(); } });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  browserHost = createBrowserHost({ mainWindow, WebContentsView, session, Menu, clipboard });
  mainWindow.webContents.on('did-start-navigation', (event, _url, isInPlace, isMainFrame) => { if ((event.isMainFrame ?? isMainFrame) && !(event.isSameDocument ?? isInPlace)) browserHost?.hideAll(); });
  mainWindow.webContents.on('render-process-gone', () => browserHost?.hideAll());
  mainWindow.on('closed', () => { browserHost?.close(); mainWindow = null; });
  mainWindow.once('ready-to-show', () => { mainWindow.show(); console.log(`Frondose desktop ready: ${origin}`); });
  await mainWindow.loadURL(origin);
  if (process.env.FRONDOSE_DESKTOP_SMOKE === '1') {
    if (mainWindow.webContents.getLastWebPreferences().preload) throw Error('The external smoke renderer must not have a native preload.');
    const proof = await browserHost.command({ operation: 'show', workspaceId: 'desktop-smoke', tabId: 'browser-smoke', bounds: { x: 240, y: 150, width: 640, height: 480 }, url: 'about:blank' });
    const security = browserHost.securityState({ workspaceId: 'desktop-smoke', tabId: 'browser-smoke' });
    if (security.nodeIntegration !== false || security.contextIsolation !== true || security.sandbox !== true || security.webSecurity !== true || security.hasPreload) throw Error('Desktop browser security smoke failed.');
    await browserHost.command({ operation: 'hide', workspaceId: 'desktop-smoke', tabId: 'browser-smoke' });
    if (proof.tabId !== 'browser-smoke' || browserHost.count() !== 1) throw Error('Desktop browser smoke failed.');
    await browserHost.command({ operation: 'close', workspaceId: 'desktop-smoke', tabId: 'browser-smoke' });
    console.log('FRONDOSE_DESKTOP_SMOKE_OK: isolated Chromium guest opened, hidden without destruction and explicitly closed.');
    app.quit();
  }
}
app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock.setIcon(appIcon);
  installMenu();
  await ensureServer();
  if (!smoke) registerIpc();
  await openWindow();
  if (smoke) return;
  terminalShell = await createTerminalShell({
    userData: app.getPath('userData'),
    chooseShell: async () => {
      const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose a terminal shell executable', properties: ['openFile'], ...(process.platform === 'win32' ? { filters: [{ name: 'Shell executable', extensions: ['exe'] }] } : {}) });
      return result.canceled ? null : result.filePaths[0];
    },
  });
  localIntegrations = createLocalIntegrations({ userData: app.getPath('userData'), safeStorage, authorizeWorkspace: async workspaceId => {
    const response = await mainWindow.webContents.session.fetch(origin + '/api/directory-workspace?workspace_id=' + encodeURIComponent(workspaceId), { credentials: 'include', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error('Unlock and select this local workspace before managing integrations.');
    const body = await response.json();
    if (body.result?.workspaceId !== workspaceId) throw Error('Workspace identity could not be verified.');
  } });
  nativeUpdater = await createNativeUpdater({ app, origin, window: () => mainWindow, browserHost: () => browserHost, ownsServer: () => ownedServer?.listening === true, terminalTargets: () => ownedApi?.updaterTerminalTargets() || [], powerMonitor });
  nativeUpdater.start();
}).catch(error => {
  console.error(error);
  browserHost?.close();
  ownedApi?.close();
  ownedServer?.close();
  if (!smoke) dialog.showErrorBox('Frondose could not start', error.message);
  app.exit(1);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => { if(quotaService&&!quotaQuitting){event.preventDefault();quotaQuitting=true;void quotaService.close().finally(()=>app.quit());return;} aboutWindow.close(); nativeUpdater?.close(); browserHost?.close(); notificationService.close(); ownedApi?.close(); ownedServer?.close(); });

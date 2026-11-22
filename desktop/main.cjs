'use strict';
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, Notification, shell, session, powerMonitor, powerSaveBlocker, Menu, Tray, nativeImage, nativeTheme, safeStorage, clipboard } = require('electron');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { get } = require('node:http');
const { appUrl, browserUrl, isTrustedFrame, guardWorkspaceNavigation } = require('./browser-policy.cjs');
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
const { createSystemPresence } = require('./system-presence.cjs');
const { osTarget, documentHtml, fileFilter } = require('./os-open.cjs');

app.setName('Frondose');
if (process.env.FRONDOSE_DESKTOP_USER_DATA) app.setPath('userData', resolve(process.env.FRONDOSE_DESKTOP_USER_DATA));
const root = resolve(__dirname, '..');
if (process.platform === 'win32') app.setAppUserModelId('app.frondose.desktop');
// Native macOS branding is independent of the website and other platforms.
const appIcon = process.platform === 'darwin' ? join(__dirname, 'assets/mac/Frondose.png') : join(root, 'public/brand/frondose-frond-icon.png');
const origin = appUrl(process.env.FRONDOSE_DESKTOP_URL || `http://127.0.0.1:${process.env.PORT || 4174}`);
const smoke = process.env.FRONDOSE_DESKTOP_SMOKE === '1';
let mainWindow, browserHost, ownedServer, ownedApi, nativeUpdater, localIntegrations, terminalShell, quotaService, quotaOpening, quotaQuitting=false;
let presence, desktopReady = false, quitting = false, quitPrompt = false, pendingRoute = null;
const pendingOsTargets = new Map(), previews = new Map();
const aboutWindow = createAboutWindow({ BrowserWindow, getParent: () => mainWindow, iconPath: appIcon, getVersion: () => app.getVersion() });
function reveal() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    // A Finder preview can keep Frondose alive after the workspace closes.
    // Reopen the workspace instead of leaving its tray shortcuts inert.
    if (desktopReady && !quitting) nativeAction(openWindow)();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  presence?.clearAttention();
}
function selectDesktopPage(route) {
  pendingRoute = route;
  reveal();
  sendToWorkspace('system-route');
}
function sendToWorkspace(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(`frondose-desktop:${channel}`, payload);
}
function hideWorkspace() { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide(); }
async function checkUpdates() {
  selectDesktopPage('updates');
  await nativeUpdater?.command({ operation: 'check' });
}
async function requestQuit(confirmAlways = false) {
  if (quitting || quitPrompt) return;
  quitPrompt = true;
  try {
    const work = ownedApi?.desktopActivity();
    if (confirmAlways || ownedApi?.updaterTerminalTargets().length || work?.working.length || work?.waiting.length) {
      reveal();
      const options = { type: 'warning', message: 'Quit Frondose and stop local sessions?', detail: 'Save your drafts first. This ends sessions owned by this Frondose process and does not undo changes they already made.', buttons: ['Cancel', 'Quit and Stop Sessions'], cancelId: 0, defaultId: 0, noLink: true };
      const decision = mainWindow && !mainWindow.isDestroyed() ? await dialog.showMessageBox(mainWindow, options) : await dialog.showMessageBox(options);
      if (decision.response !== 1) return;
    }
    quitting = true;
    app.quit();
  } finally { quitPrompt = false; }
}
async function openDocument(path) {
  path = resolve(path);
  const html = previews.has(path) ? null : await documentHtml(path);
  const current = previews.get(path);
  if (current && !current.isDestroyed()) { current.show(); current.focus(); return; }
  if (!html || previews.size >= 8) throw Error('Close a document preview before opening another one.');
  const view = new BrowserWindow({ width: 740, height: 600, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, navigateOnDragDrop: false } });
  previews.set(path, view);
  view.on('closed', () => previews.delete(path));
  view.webContents.on('will-navigate', event => event.preventDefault());
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  view.once('ready-to-show', () => view.show());
  try { await view.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64')); }
  catch (error) { view.destroy(); throw error; }
}
const nativeAction = fn => () => { void Promise.resolve().then(fn).catch(error => dialog.showErrorBox('Frondose', error.message)); };
async function pickDocument() {
  reveal();
  const options = { title: 'Open a read-only document preview', filters: [fileFilter], properties: ['openFile'] };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (!result.canceled && result.filePaths[0]) await openDocument(result.filePaths[0]);
}
const chooseDocument = nativeAction(pickDocument);
function receiveOsTarget(value) {
  const target = osTarget(value);
  if (!target) return false;
  if (!desktopReady) {
    if (pendingOsTargets.size < 24) pendingOsTargets.set(target.path || target.route, target);
  } else nativeAction(() => target.path ? openDocument(target.path) : selectDesktopPage(target.route))();
  return true;
}
function installMenu() {
  const about = { label: 'About Frondose', click: () => { void aboutWindow.show(); } };
  const settings = { label: 'Desktop Settings…', accelerator: 'CmdOrCtrl+,', click: nativeAction(() => selectDesktopPage('settings')) };
  const updates = { label: 'Check for Updates…', click: nativeAction(checkUpdates) };
  const quit = { label: 'Quit Frondose', accelerator: 'CmdOrCtrl+Q', click: nativeAction(() => requestQuit()) };
  const stop = { label: 'Quit and Stop Sessions…', click: nativeAction(() => requestQuit(true)) };
  const sep = { type: 'separator' };
  const application = { label: 'Frondose', submenu: [about, updates, sep, settings, sep, { role: 'services' }, sep, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, sep, stop, quit] };
  const file = { label: 'File', submenu: [{ label: 'Open Document Preview…', accelerator: 'CmdOrCtrl+O', click: chooseDocument }, sep, { role: 'close' }, ...(process.platform === 'darwin' ? [] : [sep, settings, updates, stop, quit])] };
  Menu.setApplicationMenu(Menu.buildFromTemplate([...(process.platform === 'darwin' ? [application] : []), file, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }, ...(process.platform === 'darwin' ? [] : [{ role: 'help', submenu: [about] }])]));
}
const notificationService = createNativeNotificationService({ Notification, platform: process.platform, isPackaged: app.isPackaged,
  onStatus: status => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('frondose-desktop:notification-status', status); },
  onOpen: action => { reveal(); if (action && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('frondose-desktop:notification-open', action); },
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
  app.once('will-quit', () => workstationTools.close());
  ipcMain.handle('frondose-desktop:presence', (event, payload) => {
    trusted(event);
    if (payload?.operation === 'consume-route') { const route = pendingRoute; pendingRoute = null; return route; }
    if (!presence) throw Error('Desktop settings are still opening.');
    return presence.command(payload);
  });
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
  ipcMain.handle('frondose-desktop:notification', (event, payload) => {
    trusted(event);
    const delivery = notificationService.send(payload);
    presence?.markAttention();
    return delivery;
  });
  ipcMain.handle('frondose-desktop:notification-settings', async event => { trusted(event); const target = notificationSettingsTarget(process.platform); if (!target) return { opened: false, error: 'Use your desktop environment’s notification settings.' }; await shell.openExternal(target); return { opened: true }; });
  ipcMain.handle('frondose-desktop:open-external', async (event, payload) => { trusted(event); const url = browserUrl(payload?.url); if (url === 'about:blank') throw Error('Enter a web address first.'); await shell.openExternal(url); return { opened: true }; });
}
async function openWindow() {
  mainWindow = new BrowserWindow({ width: 1440, height: 920, minWidth: 760, minHeight: 520, title: 'Frondose', icon: appIcon, backgroundColor: '#0f1011', show: false, autoHideMenuBar: true, webPreferences: { ...(!smoke && ownedServer?.listening ? { preload: join(__dirname, 'preload.cjs') } : {}), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, navigateOnDragDrop: false } });
  // The app renderer never leaves its fixed loopback origin. Guest pages have
  // separate contents/sessions and never receive this preload or main IPC role.
  guardWorkspaceNavigation(mainWindow.webContents, origin);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  browserHost = createBrowserHost({ mainWindow, WebContentsView, session, Menu, clipboard, origin });
  mainWindow.webContents.on('did-start-navigation', (event, _url, isInPlace, isMainFrame) => { if ((event.isMainFrame ?? isMainFrame) && !(event.isSameDocument ?? isInPlace)) browserHost?.hideAll(); });
  mainWindow.webContents.on('render-process-gone', () => browserHost?.hideAll());
  mainWindow.webContents.on('will-prevent-unload', () => {
    quitting = false;
    reveal();
    void dialog.showMessageBox(mainWindow, { type: 'info', message: 'Save open work before closing Frondose.', buttons: ['OK'] });
  });
  mainWindow.on('focus', () => presence?.clearAttention());
  mainWindow.on('close', event => {
    if (quitting || nativeUpdater?.critical()) return;
    if (presence?.state().preferences.keepRunning) {
      event.preventDefault();
      if (process.platform === 'darwin' || presence.state().trayVisible) mainWindow.hide();
      else mainWindow.minimize();
    } else if (ownedApi?.updaterTerminalTargets().length || ownedApi?.desktopActivity().working.length || ownedApi?.desktopActivity().waiting.length) {
      event.preventDefault();
      nativeAction(() => requestQuit())();
    }
  });
  mainWindow.on('closed', () => { browserHost?.close(); mainWindow = null; });
  mainWindow.once('ready-to-show', () => { mainWindow.show(); console.log(`Frondose desktop ready: ${origin}`); });
  await mainWindow.loadURL(origin);
  if (process.env.FRONDOSE_DESKTOP_SMOKE === '1') {
    if (mainWindow.webContents.getLastWebPreferences().preload) throw Error('The external smoke renderer must not have a native preload.');
    const guest = { operation: 'show', workspaceId: 'desktop-smoke', tabId: 'browser-smoke', bounds: { x: 240, y: 150, width: 640, height: 480 } };
    await require('node:assert/strict').rejects(browserHost.command({ ...guest, url: origin }), /workspace server/);
    if (browserHost.count() !== 0) throw Error('A rejected guest must not allocate a browser view.');
    const proof = await browserHost.command({ ...guest, url: 'about:blank' });
    const security = browserHost.securityState({ workspaceId: 'desktop-smoke', tabId: 'browser-smoke' });
    if (security.nodeIntegration !== false || security.contextIsolation !== true || security.sandbox !== true || security.webSecurity !== true || security.hasPreload) throw Error('Desktop browser security smoke failed.');
    await browserHost.command({ operation: 'hide', workspaceId: 'desktop-smoke', tabId: 'browser-smoke' });
    if (proof.tabId !== 'browser-smoke' || browserHost.count() !== 1) throw Error('Desktop browser smoke failed.');
    await browserHost.command({ operation: 'close', workspaceId: 'desktop-smoke', tabId: 'browser-smoke' });
    console.log('FRONDOSE_DESKTOP_SMOKE_OK: isolated Chromium guest opened, hidden without destruction and explicitly closed.');
    app.quit();
  }
}
const primary = smoke || app.requestSingleInstanceLock();
if (primary && !smoke) {
  app.on('open-file', (event, path) => { if (receiveOsTarget(path)) event.preventDefault(); });
  app.on('open-url', (event, url) => { if (receiveOsTarget(url)) event.preventDefault(); });
  app.on('second-instance', (_event, argv) => {
    if (desktopReady) reveal();
    for (const arg of argv.slice(1)) receiveOsTarget(arg);
  });
  for (const arg of process.argv.slice(app.isPackaged ? 1 : 2)) receiveOsTarget(arg);
  app.on('activate', reveal);
}
if (!primary) app.quit();
if (primary) app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock.setIcon(appIcon);
  installMenu();
  await ensureServer();
  if (!smoke) {
    registerIpc();
    presence = await createSystemPresence({ app, userData: app.getPath('userData'), platform: process.platform, Tray, Menu, nativeImage, nativeTheme, powerSaveBlocker, iconPath: join(root, 'public/brand/frondose-frond-icon.png'), classicIcon: appIcon,
      allowLogin: app.isPackaged && !process.env.FRONDOSE_DESKTOP_USER_DATA,
      activity: () => ownedApi?.desktopActivity(), onState: state => sendToWorkspace('presence-state', state),
      actions: { open: reveal, settings: () => selectDesktopPage('settings'), updates: checkUpdates, quit: requestQuit,
        hide: hideWorkspace, route: selectDesktopPage, document: pickDocument, about: () => aboutWindow.show(),
        error: error => dialog.showErrorBox('Frondose', error.message),
        visible: () => Boolean(mainWindow?.isVisible() && !mainWindow?.isMinimized() && mainWindow?.isFocused()) },
    });
  }
  if (smoke) { await openWindow(); return; }
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
  await openWindow();
  nativeUpdater.start();
  desktopReady = true;
  for (const target of pendingOsTargets.values()) nativeAction(() => target.path ? openDocument(target.path) : selectDesktopPage(target.route))();
  pendingOsTargets.clear();
}).catch(error => {
  console.error(error);
  browserHost?.close();
  ownedApi?.close();
  ownedServer?.close();
  if (!smoke) dialog.showErrorBox('Frondose could not start', error.message);
  app.exit(1);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (primary && !smoke && desktopReady && mainWindow && !quitting && !nativeUpdater?.critical()) {
    event.preventDefault();
    nativeAction(() => requestQuit())();
    return;
  }
  if (quotaService && !quotaQuitting) {
    event.preventDefault();
    quotaQuitting = true;
    void quotaService.close().finally(() => app.quit());
  }
});
app.on('will-quit', () => { presence?.close(); aboutWindow.close(); nativeUpdater?.close(); browserHost?.close(); notificationService.close(); ownedApi?.close(); ownedServer?.close(); });

'use strict';
const {browserContextMenu}=require('./browser-context-menu.cjs');
const { GUEST_WEB_PREFERENCES, browserUrl, browserIdentity, browserBounds } = require('./browser-policy.cjs');
const { loginOrigin, fillLogin } = require('./browser-passwords.cjs');

/** Main-process-owned Chromium guests. Hiding a React view does not destroy the
 * page. All operations are routed through a checked top-level app IPC caller. */
function createBrowserHost({ mainWindow, WebContentsView, session, Menu, clipboard, maxPages = 12 }) {
  const pages = new Map();
  const applications = new Map();
  const release = key => { for (const [id, owner] of applications) if (owner === key) applications.delete(id); };
  const configured = new Set();
  let closed = false;
  const alive = () => !closed && !mainWindow.isDestroyed();
  const stateOf = row => ({
    workspaceId: row.workspaceId, tabId: row.tabId, url: row.view.webContents.getURL() || 'about:blank',
    title: row.view.webContents.getTitle() || 'Browser', loading: row.view.webContents.isLoading(),
    canGoBack: row.view.webContents.navigationHistory.canGoBack(), canGoForward: row.view.webContents.navigationHistory.canGoForward(),
    error: row.error || null,
    ...(row.applicationId ? { applicationId: row.applicationId } : {}),
  });
  function publish(row, event) { if (alive() && !row.view.webContents.isDestroyed()) mainWindow.webContents.send('frondose-desktop:browser-state', { ...stateOf(row), ...(event ? { event } : {}) }); }
  function hide(row) {
    if (row.attached && alive()) { mainWindow.contentView.removeChildView(row.view); row.attached = false; }
  }
  function close(row) { hide(row); pages.delete(row.key); release(row.key); if (!row.view.webContents.isDestroyed()) row.view.webContents.close(); }
  function configurePartition(partition) {
    if (configured.has(partition)) return;
    const guestSession = session.fromPartition(partition);
    // Browser origin content cannot inherit app/native permissions. Media,
    // filesystem and downloads need an explicit future permission workflow.
    guestSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    guestSession.setPermissionCheckHandler(() => false);
    guestSession.on('will-download', (event, _item, contents) => {
      event.preventDefault();
      for (const row of pages.values()) if (row.view.webContents === contents) { row.error = 'Downloads are not enabled in this browser yet. Open the page in your default browser to download.'; publish(row); }
    });
    configured.add(partition);
  }
  function navigate(row, destination) {
    const generation = ++row.navigationGeneration;
    row.error = null;
    let loading;
    try { loading = row.view.webContents.loadURL(destination); }
    catch (error) { loading = Promise.reject(error); }
    void Promise.resolve(loading).catch(error => {
      // A newer load, history action or explicit close supersedes this result.
      // Electron rejects an aborted older load asynchronously; it must not paint
      // its error over the page the owner has subsequently requested.
      if (closed || pages.get(row.key) !== row || row.view.webContents.isDestroyed() || generation !== row.navigationGeneration || error?.code === 'ERR_ABORTED' || error?.errno === -3) return;
      row.error = String(error?.message || 'Page could not load.').slice(0, 300);
      publish(row);
    });
  }
  function create(identity) {
    if (pages.size >= maxPages) throw Error(`Close an existing browser session before opening more than ${maxPages} pages.`);
    configurePartition(identity.partition);
    const view = new WebContentsView({ webPreferences: { ...GUEST_WEB_PREFERENCES, partition: identity.partition } });
    const row = { ...identity, view, attached: false, error: null, navigationGeneration: 0, documentGeneration: 0 };
    pages.set(row.key, row);
    const contents = view.webContents;
    contents.setWindowOpenHandler(() => { row.error = 'Popup blocked. Open the destination in another Browser tab.'; publish(row); return { action: 'deny' }; });
    const admitNavigation = (event, target) => { try { browserUrl(typeof target === 'string' ? target : target.url); } catch { event.preventDefault(); row.error = 'Only HTTP and HTTPS pages can be opened.'; publish(row); } };
    contents.on('context-menu',(_event,params)=>{if(!Menu||!alive()||!row.attached||contents.isDestroyed())return;const items=browserContextMenu({contents,params,clipboard,navigate:url=>{try{navigate(row,url);}catch(error){row.error=error.message;publish(row);}}});Menu.buildFromTemplate(items).popup({window:mainWindow});});
    contents.on('will-navigate', admitNavigation);
    contents.on('will-redirect', admitNavigation);
    contents.on('did-start-navigation', (_event,url,_inPlace,isMainFrame) => { if (typeof url === 'object' ? url.isMainFrame : isMainFrame) ++row.documentGeneration; });
    for (const name of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) contents.on(name, () => publish(row));
    // Native guest clicks cannot bubble into the application's DOM focus layer.
    // Only a real, currently attached guest focus event selects its split pane.
    contents.on('focus', () => { if (row.attached) publish(row, 'focus'); });
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) { row.error = `Page could not load: ${String(description).slice(0, 160)}`; publish(row); }
    });
    contents.on('render-process-gone', () => { row.error = 'The browser page stopped. Reload to reopen it.'; publish(row); });
    contents.on('destroyed', () => { hide(row); pages.delete(row.key); release(row.key); });
    return row;
  }
  async function command(input) {
    if (!alive()) throw Error('The desktop browser is closed.');
    const identity = browserIdentity(input);
    const operation = input.operation;
    if (!['claim', 'show', 'hide', 'navigate', 'back', 'forward', 'reload', 'state', 'close'].includes(operation)) throw Error('Unsupported browser operation.');
    const applicationId = input.applicationId;
    if (applicationId !== undefined || operation === 'claim') {
      if (!['vscode', 'guacamole', 'parallels-ras', 'web-console'].includes(applicationId)) throw Error('Unsupported embedded application.');
      if (applications.has(applicationId) && applications.get(applicationId) !== identity.key) throw Error('This app is already open in another Frondose tab or workspace. Return to that tab or close it first.');
      if (operation === 'claim') { applications.set(applicationId, identity.key); return { claimed: true }; }
    }
    let row = pages.get(identity.key);
    if (!row && operation !== 'show') {
      if (['hide', 'close'].includes(operation)) { if (operation === 'close') release(identity.key); return { closed: true }; }
      throw Error('Open this browser tab before navigating.');
    }
    // Validate payloads before allocating a guest or hiding the active page.
    let bounds;
    let destination;
    if (operation === 'show') bounds = browserBounds(input.bounds, mainWindow.getContentBounds());
    if (operation === 'navigate' || operation === 'show' && input.url !== undefined) destination = browserUrl(input.url);
    const created = !row;
    row ||= create(identity);
    if (operation === 'show' && applicationId) { applications.set(applicationId, identity.key); row.applicationId = applicationId; }
    if (operation === 'show') {
      row.view.setBounds(bounds);
      if (!row.attached) { mainWindow.contentView.addChildView(row.view); row.attached = true; }
      if (created) navigate(row, destination || 'about:blank');
    } else if (operation === 'hide') hide(row);
    else if (operation === 'close') { close(row); return { closed: true }; }
    else if (operation === 'navigate') navigate(row, destination);
    else if (operation === 'back' && row.view.webContents.navigationHistory.canGoBack()) { ++row.navigationGeneration; row.error = null; row.view.webContents.navigationHistory.goBack(); }
    else if (operation === 'forward' && row.view.webContents.navigationHistory.canGoForward()) { ++row.navigationGeneration; row.error = null; row.view.webContents.navigationHistory.goForward(); }
    else if (operation === 'reload') { ++row.navigationGeneration; row.error = null; row.view.webContents.reload(); }
    return stateOf(row);
  }
  return { command, count: () => pages.size,
    updatePages: () => [...pages.values()].map(({ view }) => ({ kind: 'browser-page', label: view.webContents.isDestroyed() ? '' : view.webContents.getTitle() })),
    updaterBlankPageTargets() {
      const blank = row => {
        const guest = row.view.webContents;
        return alive() && !row.applicationId && row.navigationGeneration === 1 && !guest.isDestroyed() && !guest.isLoading() && guest.getURL() === 'about:blank' && !guest.navigationHistory.canGoBack() && !guest.navigationHistory.canGoForward();
      };
      return [...pages.values()].filter(blank).map(row => {
        const generation = row.navigationGeneration;
        return { key: row.key, identity: row, generation, item: { kind: 'browser-page' }, stop() {
          if (pages.get(row.key) !== row || generation !== row.navigationGeneration || !blank(row)) return false;
          close(row); return true;
        } };
      });
    },
    async passwordPage(input) {
      const row = pages.get(browserIdentity(input).key);
      const contents = row?.view.webContents;
      if (!alive() || row?.applicationId || !row?.attached || !contents || contents.isDestroyed() || contents.isLoadingMainFrame()) throw Error('Open a loaded Browser page before using passwords.');
      const frame = contents.mainFrame, url = frame.url, origin = loginOrigin(url), generation = row.documentGeneration;
      if (!origin) throw Error('Saved passwords require an HTTPS page.');
      const world=1002, stamp=require('node:crypto').randomUUID(), js=value=>JSON.stringify(value);
      // Store a per-document marker in an isolated world; a reload of the
      // same URL must not receive the previously reviewed credential.
      await contents.executeJavaScriptInIsolatedWorld(world,[{code:`globalThis.__frondoseLoginReview=${js(stamp)}; true`}]);
      return { workspaceId:row.workspaceId,origin,async fill(login) {
        if (login.origin!==origin || !alive() || !row.attached || contents.isDestroyed() || contents.isLoadingMainFrame() || contents.mainFrame!==frame || frame.url!==url || row.documentGeneration!==generation) throw Error('The page changed. Choose the saved login again.');
        // The website receives the selected password in its own form. It does
        // not receive the vault or native bridge; no navigation or submit.
        const code = `globalThis.__frondoseLoginReview===${js(stamp)} && location.href===${js(url)} && (${fillLogin.toString()})(...${js([origin,login.username,login.password])})`;
        let filled;
        try { filled = await contents.executeJavaScriptInIsolatedWorld(world,[{code}]); } catch { throw Error('The selected login could not be filled.'); }
        if (filled!==true) throw Error('No supported empty sign-in form was found on this page.');
      } };
    },
    securityState(input) {
      const row = pages.get(browserIdentity(input).key);
      if (!row || row.view.webContents.isDestroyed()) throw Error('Browser page is unavailable.');
      const prefs = row.view.webContents.getLastWebPreferences();
      return { nodeIntegration: prefs.nodeIntegration, contextIsolation: prefs.contextIsolation, sandbox: prefs.sandbox, webSecurity: prefs.webSecurity, hasPreload: Boolean(prefs.preload) };
    },
    hideAll() { for (const row of pages.values()) hide(row); }, close() { closed = true; for (const row of [...pages.values()]) { if (row.attached && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(row.view); row.attached = false; if (!row.view.webContents.isDestroyed()) row.view.webContents.close(); } pages.clear(); applications.clear(); } };
}
module.exports = { createBrowserHost };

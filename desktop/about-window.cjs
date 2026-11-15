'use strict';
const { readFileSync } = require('node:fs');
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
function aboutHtml({ iconBytes, version }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>About Frondose</title><style>:root{color-scheme:dark light}body{margin:0;padding:34px 24px 30px;background:light-dark(#fafafa,#191a1b);color:light-dark(#18191a,#f3f3f4);font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-align:center}img{display:block;width:156px;height:156px;object-fit:contain;margin:0 auto 22px;border:0;background:transparent;box-shadow:none}h1{font-size:24px;letter-spacing:-.6px;margin:0 0 10px}p{line-height:1.6;opacity:.7}small{display:block;margin-top:26px;opacity:.6}</style></head><body><img src="data:image/png;base64,${iconBytes.toString('base64')}" alt="Frondose flower app icon"><h1>Frondose</h1><p>Version ${escape(version)}</p><small>Copyright © 2026 Frondose</small></body></html>`;
}
function createAboutWindow({ BrowserWindow, getParent, iconPath, getVersion }) {
  let window;
  return {
    async show() {
      if (window && !window.isDestroyed()) { window.show(); window.focus(); return; }
      window = new BrowserWindow({ width: 400, height: 420, title: 'About Frondose', parent: getParent(), resizable: false, minimizable: false, maximizable: false, fullscreenable: false, autoHideMenuBar: true, show: false, backgroundColor: '#191a1b', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, navigateOnDragDrop: false } });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.webContents.on('before-input-event', (_event, input) => { if (input.key === 'Escape') window?.close(); });
      window.on('closed', () => { window = null; });
      window.once('ready-to-show', () => window?.show());
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(aboutHtml({ iconBytes: readFileSync(iconPath), version: getVersion() }))}`);
    },
    close() { window?.close(); },
  };
}
module.exports = { aboutHtml, createAboutWindow };

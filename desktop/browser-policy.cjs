/* Adapted from stablyai/orca src/main/window/main-window-webview-security.ts
 * and src/shared/browser-guest-web-preferences.ts at
 * 51dcef8258230ffea85a907130450b0ad676e22b. Copyright (c) 2026 Lovecast Inc.
 * MIT license: desktop/ORCA-LICENSE.txt. Frondose owns guest views in main rather
 * than accepting renderer-supplied Electron preferences or preload scripts. */
'use strict';
const { createHash } = require('node:crypto');

const GUEST_WEB_PREFERENCES = Object.freeze({
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  contextIsolation: true,
  sandbox: true,
  disableHtmlFullscreenWindowResize: true,
  spellcheck: true,
});

function browserUrl(value) {
  if (value === 'about:blank') return value;
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || value.length > 4096 || /[\\\u0000-\u0020\u007f]/.test(value)) throw Error('Enter an HTTP or HTTPS address.');
  let url;
  try { url = new URL(value); } catch { throw Error('Enter a complete HTTP or HTTPS address.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw Error('Only HTTP and HTTPS pages without embedded passwords can be opened.');
  return url.href;
}

function appUrl(value = 'http://127.0.0.1:4174') {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || !url.port || url.pathname !== '/' || url.search || url.hash) throw Error('The desktop host requires an exact loopback Frondose URL.');
  return url.origin;
}

function browserIdentity(input) {
  if (!input || typeof input !== 'object') throw Error('Choose a workspace browser tab.');
  const { workspaceId, tabId } = input;
  for (const value of [workspaceId, tabId]) if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) throw Error('Invalid workspace or browser tab identity.');
  const digest = createHash('sha256').update(workspaceId).digest('hex').slice(0, 32);
  return { workspaceId, tabId, key: `${workspaceId}\0${tabId}`, partition: `persist:frondose-browser-${digest}` };
}

function browserBounds(value, viewport) {
  if (!value || !viewport || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)) throw Error('Browser bounds are unavailable.');
  for (const key of ['x', 'y', 'width', 'height']) if (!Number.isFinite(value[key])) throw Error('Invalid browser bounds.');
  const x = Math.max(0, Math.min(Math.round(value.x), Math.max(0, Math.floor(viewport.width) - 1)));
  const y = Math.max(0, Math.min(Math.round(value.y), Math.max(0, Math.floor(viewport.height) - 1)));
  return { x, y, width: Math.max(1, Math.min(Math.round(value.width), Math.floor(viewport.width) - x)), height: Math.max(1, Math.min(Math.round(value.height), Math.floor(viewport.height) - y)) };
}

function isTrustedFrame(event, mainWindow, origin) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return false;
  try { return new URL(event.senderFrame.url).origin === origin; } catch { return false; }
}

function notificationPayload(input) {
  if (!input || typeof input !== 'object' || typeof input.title !== 'string' || typeof input.body !== 'string') throw Error('A notification title and body are required.');
  let action = null;
  if (input.workspaceId !== undefined || input.runId !== undefined) {
    const identity = browserIdentity({ workspaceId: input.workspaceId, tabId: input.runId });
    action = { workspaceId: identity.workspaceId, runId: identity.tabId };
  }
  const text = (value, limit) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, limit);
  return { title: text(input.title, 100), body: text(input.body, 300), silent: input.silent === true, action };
}

module.exports = { GUEST_WEB_PREFERENCES, browserUrl, appUrl, browserIdentity, browserBounds, isTrustedFrame, notificationPayload };

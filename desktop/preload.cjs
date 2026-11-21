'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const invoke = (name, payload) => ipcRenderer.invoke(`frondose-desktop:${name}`, payload);
const browserCommand = operation => payload => invoke('browser', { ...payload, operation });

// No generic IPC channel, Node API, filesystem, shell or JavaScript evaluator is
// exposed. This bridge is loaded only in the trusted top-level Frondose window.
contextBridge.exposeInMainWorld('frondoseDesktop', Object.freeze({
  version: 1,
  platform: process.platform,
  clipboard: Object.freeze({writeText:text=>invoke('clipboard-write',text)}),
  tools: Object.freeze({ command: payload => invoke('workstation-tools', {
    workspaceId: payload?.workspaceId, operation: payload?.operation, confirmed: payload?.confirmed === true,
    pid: payload?.pid, bundleId: payload?.bundleId, snapshotId: payload?.snapshotId, index: payload?.index, scopeId: payload?.scopeId,
    text: payload?.text, locale: payload?.locale, appId: payload?.appId, windowId: payload?.windowId, direction: payload?.direction,
  }) }),
  appInfo: () => invoke('app-info'),
  presence: Object.freeze({
    status: () => invoke('presence', { operation: 'status' }),
    set: (key, value) => invoke('presence', { operation: 'set', key, value }),
    previewAttention: () => invoke('presence', { operation: 'preview-attention' }),
    consumeRoute: () => invoke('presence', { operation: 'consume-route' }),
    onState(callback) {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('frondose-desktop:presence-state', listener);
      return () => ipcRenderer.removeListener('frondose-desktop:presence-state', listener);
    },
    onRoute(callback) {
      if (typeof callback !== 'function') return () => {};
      const listener = () => callback();
      ipcRenderer.on('frondose-desktop:system-route', listener);
      return () => ipcRenderer.removeListener('frondose-desktop:system-route', listener);
    },
  }),
  chooseDirectory: () => invoke('choose-directory'),
  integrations: Object.freeze({ command: payload => invoke('integrations', { operation: payload?.operation, providerId: payload?.providerId, workspaceId: payload?.workspaceId, confirmed: payload?.confirmed === true, credentials: payload?.credentials ? { token: payload.credentials.token, email: payload.credentials.email, host: payload.credentials.host, organization: payload.credentials.organization, site: payload.credentials.site, cloudId: payload.credentials.cloudId } : undefined, resourceIds: payload?.resourceIds, resourceId: payload?.resourceId, kind: payload?.kind }) }),
  terminalShell: payload => invoke('terminal-shell', { operation: payload?.operation }),
  providerUsage: Object.freeze({ read: options => invoke('provider-usage', { workspaceId: options?.workspaceId, refresh: options?.refresh === true }) }),
  runtimeStatus: options => invoke('runtime-status', { ports: options?.ports === true }),
  updates: Object.freeze({
    command: payload => invoke('update', { operation: payload?.operation, choice: payload?.choice, version: payload?.version, token: payload?.token }),
    respondSafety: payload => invoke('update-safety', { nonce: payload?.nonce, safe: payload?.safe === true, blockers: Array.isArray(payload?.blockers) ? payload.blockers.slice(0, 24) : [] }),
    onState(callback) {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('frondose-desktop:update-state', listener);
      return () => ipcRenderer.removeListener('frondose-desktop:update-state', listener);
    },
    onSafety(callback) {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, request) => callback(request);
      ipcRenderer.on('frondose-desktop:update-safety', listener);
      return () => ipcRenderer.removeListener('frondose-desktop:update-safety', listener);
    },
  }),
  notifications: Object.freeze({
    status: () => invoke('notification-status'),
    test: options => invoke('notification-test', { silent: options?.silent === true, test: options?.test === true }),
    notify: payload => invoke('notification', payload),
    openSettings: () => invoke('notification-settings'),
    onStatus(callback) {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, status) => callback(status);
      ipcRenderer.on('frondose-desktop:notification-status', listener);
      return () => ipcRenderer.removeListener('frondose-desktop:notification-status', listener);
    },
    onOpen(callback) {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, action) => callback(action);
      ipcRenderer.on('frondose-desktop:notification-open', listener);
      return () => ipcRenderer.removeListener('frondose-desktop:notification-open', listener);
    },
  }),
  browser: Object.freeze({
    available: true,
    importData: payload => invoke('browser-import', { operation:payload?.operation, workspaceId:payload?.workspaceId, kind:payload?.kind, sourceId:payload?.sourceId, token:payload?.token, domains:payload?.domains }),
    savedPasswords: payload => invoke('browser-passwords',{workspaceId:payload?.workspaceId,tabId:payload?.tabId}),
    claim: browserCommand('claim'),
    show: browserCommand('show'),
    hide: browserCommand('hide'),
    navigate: browserCommand('navigate'),
    back: browserCommand('back'),
    forward: browserCommand('forward'),
    reload: browserCommand('reload'),
    state: browserCommand('state'),
    close: browserCommand('close'),
    openExternal: payload => invoke('open-external', payload),
    onState(callback) {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('frondose-desktop:browser-state', listener);
      return () => ipcRenderer.removeListener('frondose-desktop:browser-state', listener);
    },
  }),
}));

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('annotator', {
  onInit: (cb) => ipcRenderer.on('init', (_e, data) => cb(data)),
  onHistoryOpen: (cb) => ipcRenderer.on('history:open', (_e, data) => cb(data)),
  onHistoryChanged: (cb) => ipcRenderer.on('history:changed', () => cb()),
  save: (payload) => ipcRenderer.invoke('save', payload),
  cancel: () => ipcRenderer.send('cancel'),
  list: () => ipcRenderer.invoke('history:list'),
  load: (id) => ipcRenderer.invoke('history:load', id),
  remove: (id) => ipcRenderer.invoke('history:delete', id),
  setStatus: (args) => ipcRenderer.invoke('history:status', args),
  // History window
  detail: (id) => ipcRenderer.invoke('history:detail', id),
  edit: (id) => ipcRenderer.invoke('history:edit', id),
  capture: () => ipcRenderer.invoke('capture'),
  reveal: (id) => ipcRenderer.invoke('reveal', id),
  onSelect: (cb) => ipcRenderer.on('dash:select', (_e, data) => cb(data)),
  platform: process.platform,
  setupInfo: () => ipcRenderer.invoke('setup:info'),
  setupDone: (patch) => ipcRenderer.invoke('setup:done', patch),
  saveSettings: (patch) => ipcRenderer.invoke('setup:settings', patch),
  agents: () => ipcRenderer.invoke('agents:list'),
  installClaudeCommand: () => ipcRenderer.invoke('setup:install-claude-command'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onAgents: (cb) => ipcRenderer.on('agents:changed', (_e, data) => cb(data)),
  onSetupOpen: (cb) => ipcRenderer.on('setup:open', () => cb()),
  selftestDone: () => ipcRenderer.invoke('selftest-done'),
});

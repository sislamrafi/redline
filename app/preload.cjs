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
  selftestDone: () => ipcRenderer.invoke('selftest-done'),
});

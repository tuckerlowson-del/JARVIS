const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  info: () => ipcRenderer.invoke('info'),
  system: () => ipcRenderer.invoke('system'),
  db: () => ipcRenderer.invoke('db'),
  config: () => ipcRenderer.invoke('config'),
  saveConfig: p => ipcRenderer.invoke('save-config', p),
  assistant: p => ipcRenderer.invoke('assistant', p),
  action: p => ipcRenderer.invoke('action', { type: p?.type, payload: p?.payload || p || {} }),
  scanNetwork: () => ipcRenderer.invoke('scan-network'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  copy: text => ipcRenderer.invoke('clipboard-write', text),
  addMemory: text => ipcRenderer.invoke('memory-add', text),
  deleteMemory: id => ipcRenderer.invoke('memory-delete', id),
  addAutomation: payload => ipcRenderer.invoke('automation-add', payload),
  deleteAutomation: id => ipcRenderer.invoke('automation-delete', id),
  toggleAutomation: (id, enabled) => ipcRenderer.invoke('automation-toggle', { id, enabled }),
  events: cb => ipcRenderer.on('event', (_, x) => cb(x))
});

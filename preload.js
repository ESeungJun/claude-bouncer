const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  onNotify: (cb) => {
    const listener = (_, data) => cb(data)
    ipcRenderer.on('claude-notify', listener)
    return () => ipcRenderer.removeListener('claude-notify', listener)
  },
  onHistoryUpdate: (cb) => {
    const listener = (_, data) => cb(data)
    ipcRenderer.on('history-update', listener)
    return () => ipcRenderer.removeListener('history-update', listener)
  },
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  openFolder: (cwd) => ipcRenderer.invoke('open-folder', cwd),
  focusTerminal: (entry) => ipcRenderer.invoke('focus-terminal', entry),
  togglePanel: () => ipcRenderer.invoke('toggle-panel'),
  closePanel: () => ipcRenderer.invoke('close-panel'),
  startDrag: (o) => ipcRenderer.invoke('start-drag', o),
  stopDrag: () => ipcRenderer.invoke('stop-drag'),
  setIgnoreMouse: (ignore) => ipcRenderer.invoke('set-ignore-mouse', ignore),
})

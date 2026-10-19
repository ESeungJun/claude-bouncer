const { contextBridge, ipcRenderer, webUtils } = require('electron')

function on(channel) {
  return (cb) => {
    const listener = (_, data) => cb(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('api', {
  // events from main
  onNotify: on('notify'),
  onData: on('data'),
  onSettings: on('settings'),
  onCursor: on('cursor'),
  onIdle: on('idle'),
  onDisplay: on('display'),
  onAction: on('action'),
  onSessionBusy: on('session-busy'),
  onPet: on('pet'),
  onPanelTab: on('panel-tab'),
  onSkin: on('skin'),
  onSkins: on('skins'),
  onSkinProgress: on('skin-progress'),
  onUpdate: on('update'),

  // state
  getState: () => ipcRenderer.invoke('state:get'),
  savePet: (pet) => ipcRenderer.invoke('pet:save', pet),
  savePetNow: (pet) => ipcRenderer.sendSync('pet:save-now', pet),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),

  // overlay plumbing
  setIgnoreMouse: (ignore) => ipcRenderer.send('mouse:ignore', !!ignore),
  showPetMenu: () => ipcRenderer.send('menu:pet'),
  followDisplay: () => ipcRenderer.invoke('display:follow'),
  petAction: (a) => ipcRenderer.invoke('pet:action', a),

  // notifications / sessions
  openNotification: (id) => ipcRenderer.invoke('notif:open', id),
  dismissNotification: (id) => ipcRenderer.invoke('notif:dismiss', id),
  readAll: () => ipcRenderer.invoke('notif:readAll'),
  getHistory: () => ipcRenderer.invoke('history:get'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  focusSession: (id) => ipcRenderer.invoke('session:focus', id),
  openFolder: (cwd) => ipcRenderer.invoke('open-folder', cwd),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  extStatus: () => ipcRenderer.invoke('ext:status'),
  openExtensionFolder: () => ipcRenderer.invoke('ext:open-folder'),
  testNotify: (kind) => ipcRenderer.invoke('test-notify', kind),
  reinstallHook: () => ipcRenderer.invoke('hook:reinstall'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  openUpdate: () => ipcRenderer.invoke('update:open'),
  pauseHotkey: (paused) => ipcRenderer.invoke('hotkey:pause', !!paused),

  // custom looks
  pinPanel: (pinned, reason = 'maker') => ipcRenderer.invoke('panel:pin', !!pinned, reason),
  skinState: () => ipcRenderer.invoke('skin:state'),
  skinPresets: () => ipcRenderer.invoke('skin:presets'),
  sendRequest: (form) => ipcRenderer.invoke('request:send', form),
  higgsfieldLogin: () => ipcRenderer.invoke('skin:mcp-login'),
  higgsfieldLogout: () => ipcRenderer.invoke('skin:mcp-logout'),
  refreshSkinState: () => ipcRenderer.invoke('skin:refresh'),
  estimateSkin: (style) => ipcRenderer.invoke('skin:estimate', style),
  setHiggsfieldKey: (id, secret) => ipcRenderer.invoke('skin:set-key', id, secret),
  pickPhoto: () => ipcRenderer.invoke('skin:pick-photo'),
  previewPhoto: (file) => ipcRenderer.invoke('skin:preview-photo', file),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file) } catch { return '' } },
  generateSkin: (file, style) => ipcRenderer.invoke('skin:generate', file, style),
  saveSkin: (skin, name) => ipcRenderer.invoke('skin:save', skin, name),
  useSkin: (id) => ipcRenderer.invoke('skin:use', id),
  deleteSkin: (id) => ipcRenderer.invoke('skin:delete', id),

  // panel
  togglePanel: (tab) => ipcRenderer.invoke('panel:toggle', tab),
  closePanel: () => ipcRenderer.invoke('panel:close'),
})

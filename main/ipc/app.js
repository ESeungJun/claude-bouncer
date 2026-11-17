// IPC for app-wide state: the first state read, settings, pet saves, the
// panel window, updates, the browser extension, hook reinstall and opening
// links/folders. Registered once from main.js (registerIpc); main.js passes
// in the functions it owns, shared values are read from main/app-state.
const { globalShortcut, shell } = require('electron')
const { PORT } = require('../../lib/server')
const state = require('../app-state')

function registerAppIpc(ipcMain, {
  ext, extensionFolder, openFolderSafely,
  activeSkin, displayInfo, snapshot, send,
  setSetting, registerHotkey, togglePanel, syncHook,
  updateState, runUpdateCheck, installUpdate,
}) {
  ipcMain.handle('ext:status', () => ({
    connected: Date.now() - ext.seenAt < 90000,
    browser: ext.browser,
    folder: extensionFolder(),
  }))
  ipcMain.handle('ext:open-folder', () => openFolderSafely(extensionFolder()))
  ipcMain.handle('state:get', () => ({
    settings: state.store.data.settings,
    hotkeyOk: state.hotkeyOk,
    skin: activeSkin(),
    pet: state.store.data.pet,
    platform: process.platform,
    port: PORT,
    display: displayInfo(),
    update: updateState(),
    ...snapshot(),
  }))
  ipcMain.handle('update:check', () => runUpdateCheck())
  ipcMain.handle('update:open', () => installUpdate())
  // sent synchronously from the overlay's beforeunload, so it lands before we exit
  ipcMain.on('pet:save-now', (e, pet) => {
    if (pet && typeof pet === 'object') {
      state.store.data.pet = { ...state.store.data.pet, ...pet, best: { ...state.store.data.pet.best, ...(pet.best || {}) } }
      state.store.flush()
    }
    e.returnValue = true
  })
  ipcMain.handle('pet:save', (_, pet) => {
    if (!pet || typeof pet !== 'object') return
    state.store.data.pet = { ...state.store.data.pet, ...pet, best: { ...state.store.data.pet.best, ...(pet.best || {}) } }
    state.store.save()
    send(state.panel, 'pet', state.store.data.pet)
  })
  ipcMain.handle('settings:set', (_, key, value) => ({ ...setSetting(key, value), hotkeyOk: state.hotkeyOk }))

  ipcMain.handle('panel:toggle', (_, tab) => togglePanel(tab))
  ipcMain.handle('panel:close', () => state.panel?.hide())
  // while the panel records a new shortcut, the old one must not fire
  ipcMain.handle('hotkey:pause', (_, paused) => { if (paused) globalShortcut.unregisterAll(); else registerHotkey() })
  ipcMain.handle('open-external', (_, url) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url)
  })
  ipcMain.handle('open-folder', (_, cwd) => openFolderSafely(cwd))
  ipcMain.handle('hook:reinstall', () => !!syncHook())
}

module.exports = { registerAppIpc }

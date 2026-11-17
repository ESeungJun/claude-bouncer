'use strict'
// Every IPC channel accepts messages from the app's own windows only: the
// overlay (the pet) and the panel. main.js wraps ipcMain once with guardIpc
// and hands the wrapped one to every main/ipc/*.js file, so a channel added
// there is checked without having to remember it.
//
// The windows are read from main/app-state on every message (the overlay is
// made again after a crash, the panel is let go after a while), never kept.
const state = require('../app-state')

// the webContents of the windows the app made, as they are right now
function appContents() {
  return [state.overlay, state.panel]
    .filter(w => w && !w.isDestroyed())
    .map(w => w.webContents)
}

// A message counts as the app's when it comes from the top frame of one of
// the app's windows. The pages load no frames and cannot navigate away
// (main.js blocks it), so a subframe sender is never ours.
function fromApp(e) {
  if (!e || !e.sender || !appContents().includes(e.sender)) return false
  const frame = e.senderFrame
  if (frame && frame.parent) return false
  return true
}

// Same shape as ipcMain (handle / on), dropping what fromApp turns away.
// A turned-away `handle` resolves to undefined; a turned-away `on` gets a
// returnValue of null so a sendSync caller does not wait forever.
function guardIpc(ipcMain, isAllowed = fromApp) {
  return {
    handle(channel, fn) {
      ipcMain.handle(channel, (e, ...args) => (isAllowed(e) ? fn(e, ...args) : undefined))
    },
    on(channel, fn) {
      ipcMain.on(channel, (e, ...args) => {
        if (isAllowed(e)) return fn(e, ...args)
        e.returnValue = null
      })
    },
  }
}

module.exports = { guardIpc, fromApp }

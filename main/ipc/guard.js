'use strict'
// Every IPC channel accepts messages from the app's own windows only: the
// overlay (the pet) and the panel. main.js wraps ipcMain once with guardIpc
// and hands the wrapped one to every main/ipc/*.js file, so a channel added
// there is checked without having to remember it.
//
// The windows are read from main/app-state on every message (the overlay is
// made again after a crash, the panel is let go after a while), never kept.
//
// `webContents.ipc`와 MessagePort는 쓰지 않는다. 쓰려면 같은 검사를 붙인다.
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
// Each turned-away channel is logged once (channel name and sender id only,
// never the arguments), so a flood of bad messages does not flood the log.
function guardIpc(ipcMain, isAllowed = fromApp) {
  const warned = new Set()
  function turnAway(channel, e) {
    if (warned.has(channel)) return
    warned.add(channel)
    console.warn(`[ipc] turned away ${channel} from sender ${e?.sender?.id}`)
  }
  return {
    handle(channel, fn) {
      ipcMain.handle(channel, (e, ...args) => {
        if (isAllowed(e)) return fn(e, ...args)
        turnAway(channel, e)
        return undefined
      })
    },
    on(channel, fn) {
      ipcMain.on(channel, (e, ...args) => {
        if (isAllowed(e)) return fn(e, ...args)
        turnAway(channel, e)
        e.returnValue = null
      })
    },
  }
}

module.exports = { guardIpc, fromApp }

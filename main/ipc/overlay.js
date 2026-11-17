// IPC from the overlay window: click-through, the small window that follows
// the pet, cursor tracking, moving to the cursor's screen, pet actions and
// the right-click menu. Registered once from main.js (registerIpc). The
// overlay window and its view (workArea / viewEpoch / viewSize) are read from
// main/app-state on every call, since the window is made again after a crash.
const { viewBounds } = require('../../lib/pace')
const state = require('../app-state')

function registerOverlayIpc(ipcMain, { compact, followCursorDisplay, summon, petAction, showPetMenu }) {
  ipcMain.on('mouse:ignore', (_, ignore) => {
    if (!state.overlay || state.overlay.isDestroyed()) return
    if (ignore) state.overlay.setIgnoreMouseEvents(true, { forward: true })
    else state.overlay.setIgnoreMouseEvents(false)
  })

  // The overlay asks for the part of the work area its window should cover.
  // A request made for an earlier work area (the pet has since moved to
  // another screen) is dropped.
  const fromOverlay = (e, v) => compact && state.overlay && !state.overlay.isDestroyed() && e.sender === state.overlay.webContents && v && v.epoch === state.viewEpoch
  ipcMain.handle('overlay:view', (e, v) => {
    if (!fromOverlay(e, v)) return false
    const b = viewBounds(v, state.workArea)
    if (!b) return false
    state.overlay.setBounds(b)
    state.viewSize = b.width === state.workArea.width && b.height === state.workArea.height ? null : { width: b.width, height: b.height }
    return true
  })
  // the small window following the pet (same size, new place)
  ipcMain.on('overlay:move', (e, v) => {
    if (!fromOverlay(e, v) || !state.viewSize) return
    const b = viewBounds({ x: v.x, y: v.y, w: state.viewSize.width, h: state.viewSize.height }, state.workArea)
    if (b) state.overlay.setPosition(b.x, b.y)
  })
  ipcMain.on('cursor:track', (e, on) => {
    if (!state.overlay || e.sender !== state.overlay.webContents) return
    state.cursorTracking = !!on
    if (state.cursorTracking) state.pokeCursor()
  })

  ipcMain.handle('display:follow', () => followCursorDisplay('follow'))
  ipcMain.handle('pet:action', (_, action) => action === 'summon' ? summon() : petAction(String(action)))
  ipcMain.on('menu:pet', () => showPetMenu())
}

module.exports = { registerOverlayIpc }

// IPC for cards and sessions: open / dismiss / snooze a card, the history
// list, going to a session, and the test cards from the settings tab.
// Registered once from main.js (registerIpc), which owns the card logic and
// passes it in; the tracker is read from main/app-state.
const { focusTerminal } = require('../../lib/focus')
const state = require('../app-state')

// "10분 뒤" on a card
const SNOOZE_MS = 10 * 60 * 1000

function registerNotificationIpc(ipcMain, {
  openNotification, saveHistory, broadcastData, snapshot,
  settleSession, focusWebChat, openFolderSafely, testNotification,
}) {
  ipcMain.handle('notif:open', (_, id) => openNotification(String(id)))
  ipcMain.handle('notif:dismiss', (_, id) => {
    if (state.tracker.markRead(String(id))) { saveHistory(); broadcastData() }
  })
  ipcMain.handle('notif:snooze', (_, id) => {
    if (state.tracker.snooze(String(id), SNOOZE_MS)) { saveHistory(); broadcastData() }
  })
  ipcMain.handle('notif:readAll', () => { state.tracker.markAllRead(); saveHistory(); broadcastData() })
  ipcMain.handle('history:get', () => ({ ...snapshot(), history: state.tracker.history }))
  ipcMain.handle('history:clear', () => { state.tracker.clear(); saveHistory(); broadcastData() })
  ipcMain.handle('session:focus', (_, id) => {
    const s = state.tracker.listSessions().find(x => x.id === id)
    if (s) settleSession(s.id)
    if (s?.terminal?.web) return focusWebChat(s.terminal)
    if (s) return focusTerminal({ terminal: s.terminal, cwd: s.cwd }, { openPath: openFolderSafely })
  })
  ipcMain.handle('test-notify', (_, kind) => testNotification(kind === 'done' ? 'done' : 'permission'))
}

module.exports = { registerNotificationIpc }

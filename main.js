const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, shell } = require('electron')
const http = require('http')
const path = require('path')
const fs = require('fs')
const { execFile } = require('child_process')

const PORT = 17891
const HISTORY_MAX = 50

let petWindow = null
let panelWindow = null
let tray = null
let history = []

const historyPath = path.join(app.getPath('userData'), 'history.json')

function loadHistory() {
  try { history = JSON.parse(fs.readFileSync(historyPath, 'utf8')) || [] } catch { history = [] }
}
function saveHistory() {
  try { fs.writeFileSync(historyPath, JSON.stringify(history)) } catch (e) { /* ignore */ }
}

// ---------- Windows ----------

function createPetWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay()
  const W = 340
  const H = 180
  const winOpts = {
    width: W,
    height: H,
    x: workAreaSize.width - W - 20,
    y: workAreaSize.height - H - 40,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    roundedCorners: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  }
  // macOS: 'panel' → NSPanel. NSPanels naturally follow the user across
  // Spaces and show over full-screen apps when the level is high enough.
  // This is the only reliable way to get multi-Space tracking; plain
  // NSWindow + canJoinAllSpaces is flaky for transparent windows.
  if (process.platform === 'darwin') winOpts.type = 'panel'

  petWindow = new BrowserWindow(winOpts)
  petWindow.loadFile('pet.html')
  if (process.platform === 'darwin') {
    // NSPanels need the collection behavior re-asserted + a high window level
    // so they pop over regular (and full-screen) app windows on every Space.
    petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    petWindow.setAlwaysOnTop(true, 'screen-saver')
  }
  petWindow.setBackgroundColor('#00000000')
}

function createPanelWindow() {
  panelWindow = new BrowserWindow({
    width: 380,
    height: 500,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  panelWindow.loadFile('panel.html')
  panelWindow.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); panelWindow.hide() }
  })
}

function positionPanelNearPet() {
  if (!panelWindow || !petWindow) return
  const [px, py] = petWindow.getPosition()
  const display = screen.getDisplayNearestPoint({ x: px, y: py })
  const { x: dX, y: dY, width, height } = display.workArea
  let x = px - 390
  let y = py - 340
  if (x < dX) x = px + 20
  if (x + 380 > dX + width) x = dX + width - 390
  if (y < dY) y = dY + 10
  if (y + 500 > dY + height) y = dY + height - 510
  panelWindow.setPosition(Math.round(x), Math.round(y))
}

// Re-assert that the pet is visible on the current macOS Space + on top.
// With type: 'panel', NSPanels follow the user across Spaces natively —
// we just need to make sure the window is shown and raised so it pops above
// whatever the user is currently looking at.
function ensureOnCurrentSpace() {
  if (!petWindow || petWindow.isDestroyed()) return

  if (process.platform === 'darwin') {
    petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    petWindow.setAlwaysOnTop(true, 'screen-saver')
  } else {
    petWindow.setAlwaysOnTop(true, 'floating')
  }
  if (!petWindow.isVisible()) petWindow.showInactive()
  petWindow.moveTop()
  petWindow.setBackgroundColor('#00000000')
}

// Before a notify fires, make sure the pet is on the same display as the cursor.
// If it already is, respect any manual drag position. If it's on another display,
// teleport to the cursor display's bottom-right. macOS requires disabling
// visibleOnAllWorkspaces temporarily for setPosition to cross physical displays.
function moveToCursorDisplayIfNeeded() {
  if (!petWindow || petWindow.isDestroyed()) return
  const cursor = screen.getCursorScreenPoint()
  const cursorDisplay = screen.getDisplayNearestPoint(cursor)
  const [px, py] = petWindow.getPosition()
  const petDisplay = screen.getDisplayNearestPoint({ x: px, y: py })
  if (cursorDisplay.id === petDisplay.id) return

  const [w, h] = petWindow.getSize()
  const { x: dX, y: dY, width, height } = cursorDisplay.workArea
  const targetX = Math.round(dX + width - w - 20)
  const targetY = Math.round(dY + height - h - 40)

  // macOS: must drop visibleOnAllWorkspaces to move across physical displays.
  // ensureOnCurrentSpace() runs right after and restores it as part of its
  // hide/show cycle, so no setTimeout needed here.
  if (process.platform !== 'win32') petWindow.setVisibleOnAllWorkspaces(false)
  petWindow.setPosition(targetX, targetY)
}

function togglePanel() {
  if (!panelWindow) return
  if (panelWindow.isVisible()) {
    panelWindow.hide()
  } else {
    positionPanelNearPet()
    panelWindow.show()
    panelWindow.focus()
  }
}

// ---------- HTTP server ----------

function startServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/notify') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
        if (body.length > 1_000_000) req.destroy()
      })
      req.on('end', () => {
        let data = {}
        try { data = JSON.parse(body || '{}') } catch { /* ignore */ }
        const cwd = typeof data.cwd === 'string' ? data.cwd : ''
        const rawKind = typeof data.kind === 'string' ? data.kind : ''
        // fall back: infer kind from the hook event name
        const kind = rawKind
          || (data.hook_event_name === 'Notification' ? 'notification' : 'stop')
        const entry = {
          kind,
          message: typeof data.message === 'string' ? data.message : '',
          cwd,
          sessionId: data.session_id || data.sessionId || '',
          transcriptPath: data.transcript_path || '',
          termProgram: typeof data.term_program === 'string' ? data.term_program : '',
          termSessionId: typeof data.term_session_id === 'string' ? data.term_session_id : '',
          tmux: typeof data.tmux === 'string' ? data.tmux : '',
          ppid: typeof data.ppid === 'string' ? data.ppid : '',
          ts: Date.now(),
          projectName: cwd ? path.basename(cwd) : 'unknown',
        }
        history.unshift(entry)
        if (history.length > HISTORY_MAX) history.length = HISTORY_MAX
        saveHistory()
        if (petWindow && !petWindow.isDestroyed()) {
          moveToCursorDisplayIfNeeded()
          ensureOnCurrentSpace()
          setTimeout(() => {
            if (petWindow && !petWindow.isDestroyed()) {
              petWindow.webContents.send('claude-notify', entry)
            }
          }, 60)
        }
        if (panelWindow && !panelWindow.isDestroyed()) {
          panelWindow.webContents.send('history-update', history)
        }
        res.writeHead(204); res.end()
      })
    } else if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok')
    } else {
      res.writeHead(404); res.end()
    }
  })
  server.on('error', (err) => {
    console.error('[claude-bouncer] server error:', err.message)
  })
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[claude-bouncer] listening on 127.0.0.1:${PORT}`)
  })
}

// ---------- Tray ----------

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'claudecode-color.png')
  let icon = nativeImage.createFromPath(iconPath)
  if (process.platform === 'darwin') {
    icon = icon.resize({ width: 18, height: 18 })
  }
  tray = new Tray(icon)
  tray.setToolTip('Claude Bouncer')
  const menu = Menu.buildFromTemplate([
    { label: 'Show panel', click: togglePanel },
    {
      label: 'Test bounce',
      click: () => {
        const entry = {
          cwd: process.cwd(),
          sessionId: 'testsession',
          termProgram: process.env.TERM_PROGRAM || 'test',
          termSessionId: '',
          ts: Date.now(),
          projectName: path.basename(process.cwd()),
        }
        moveToCursorDisplayIfNeeded()
        setTimeout(() => petWindow?.webContents.send('claude-notify', entry), 80)
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => { app.isQuitting = true; app.quit() },
    },
  ])
  tray.setContextMenu(menu)
  tray.on('click', togglePanel)
}

// ---------- App lifecycle ----------

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide()
  }
  loadHistory()
  createPetWindow()
  createPanelWindow()
  createTray()
  startServer()
})

app.on('window-all-closed', (e) => {
  if (!app.isQuitting) e?.preventDefault?.()
})

// ---------- IPC ----------

// ---------- Focus terminal ----------
// Best effort: activate (and when possible, select the exact tab/session) of
// whichever terminal app Claude was running in. iTerm2 is the only one that
// lets us target a specific session by its UUID; for the rest we just
// activate the parent app.

function runAppleScript(script) {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 3000 }, (err) => {
      if (err) console.error('[focus-terminal] osascript:', err.message)
      resolve()
    })
  })
}

function escapeAppleScriptString(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function focusTerminalMac(entry) {
  const term = String(entry.termProgram || '')
  const tsid = String(entry.termSessionId || '')

  // iTerm2 — TERM_SESSION_ID format "w0t1p0:UUID". Target session by unique id.
  if (/iTerm/i.test(term)) {
    const uuid = tsid.includes(':') ? tsid.split(':').pop() : tsid
    if (uuid) {
      const safeUuid = escapeAppleScriptString(uuid)
      const script = `
        tell application "iTerm"
          activate
          repeat with w in windows
            repeat with t in tabs of w
              repeat with s in sessions of t
                if unique id of s is "${safeUuid}" then
                  tell w to select
                  tell t to select
                  select s
                  return
                end if
              end repeat
            end repeat
          end repeat
        end tell`
      return runAppleScript(script)
    }
    return runAppleScript(`tell application "iTerm" to activate`)
  }

  if (/Apple_Terminal/i.test(term)) {
    return runAppleScript(`tell application "Terminal" to activate`)
  }

  if (/vscode|cursor/i.test(term)) {
    // VSCode/Cursor: activate the app; exact terminal pane can't be targeted.
    const appName = /cursor/i.test(term) ? 'Cursor' : 'Visual Studio Code'
    return runAppleScript(`tell application "${appName}" to activate`)
  }

  if (/Warp/i.test(term)) {
    return runAppleScript(`tell application "Warp" to activate`)
  }

  if (/ghostty/i.test(term)) {
    return runAppleScript(`tell application "Ghostty" to activate`)
  }

  // Last resort: open the cwd folder so the user at least has context.
  if (entry.cwd) shell.openPath(entry.cwd)
}

// Windows equivalent — AppActivate by window title. We can't target a specific
// terminal tab like iTerm2, but we can raise the right app. Falls through to
// opening the cwd folder when we don't recognize the terminal.
async function focusTerminalWin(entry) {
  const term = String(entry.termProgram || '')
  let title = null
  if (/WindowsTerminal|wt/i.test(term)) title = 'Windows Terminal'
  else if (/cursor/i.test(term)) title = 'Cursor'
  else if (/vscode|Code/i.test(term)) title = 'Visual Studio Code'
  else if (/Hyper/i.test(term)) title = 'Hyper'

  if (title) {
    const safeTitle = title.replace(/'/g, "''")
    const script = `(New-Object -ComObject WScript.Shell).AppActivate('${safeTitle}') | Out-Null`
    return new Promise((resolve) => {
      execFile('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script],
        { timeout: 3000 }, () => resolve())
    })
  }
  if (entry.cwd) shell.openPath(entry.cwd)
}

ipcMain.handle('focus-terminal', async (_, entry) => {
  if (!entry || typeof entry !== 'object') return
  if (process.platform === 'darwin') return focusTerminalMac(entry)
  if (process.platform === 'win32') return focusTerminalWin(entry)
  // Linux fallback: open the folder
  if (entry.cwd) shell.openPath(entry.cwd)
})

ipcMain.handle('get-history', () => history)
ipcMain.handle('clear-history', () => { history = []; saveHistory(); return history })
ipcMain.handle('open-folder', (_, cwd) => {
  if (typeof cwd === 'string' && cwd.startsWith('/')) shell.openPath(cwd)
})
ipcMain.handle('open-external', (_, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url)
})
ipcMain.handle('toggle-panel', togglePanel)
ipcMain.handle('close-panel', () => panelWindow?.hide())

let dragInterval = null
let dragOffsetX = 0
let dragOffsetY = 0
ipcMain.handle('start-drag', (_, { offsetX, offsetY }) => {
  if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return
  dragOffsetX = offsetX
  dragOffsetY = offsetY
  if (process.platform !== 'win32') {
    petWindow.setVisibleOnAllWorkspaces(false)
  }
  if (dragInterval) clearInterval(dragInterval)
  dragInterval = setInterval(() => {
    if (!petWindow) return
    const cursor = screen.getCursorScreenPoint()
    petWindow.setPosition(cursor.x - dragOffsetX, cursor.y - dragOffsetY)
  }, 16)
})
ipcMain.handle('stop-drag', () => {
  if (dragInterval) { clearInterval(dragInterval); dragInterval = null }
  if (process.platform !== 'win32' && petWindow) {
    petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }
  if (petWindow) petWindow.setBackgroundColor('#00000000')
})

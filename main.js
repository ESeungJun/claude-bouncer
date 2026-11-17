const {
  app, BrowserWindow, ipcMain, nativeImage, screen, shell,
  Notification, powerMonitor, globalShortcut, safeStorage,
} = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { installClaudeHook, hookScriptPath } = require('./scripts/install-hook')
const { SessionTracker } = require('./lib/sessions')
const { JsonStore } = require('./lib/store')
const { focusTerminal, activateApp, frontTerminal, isFrontTerminal, terminalBundle, frontChanged } = require('./lib/focus')
const { cursorPollMs, isQuietDone } = require('./lib/pace')
const { startServer, commandQueue } = require('./lib/server')
const { Higgsfield, MODELS, DEFAULT_MODEL } = require('./lib/higgsfield')
const { PRESETS, presetLoader, resolveSkin } = require('./lib/skins')
const { requestSender } = require('./lib/request')
const { HiggsfieldMcp } = require('./lib/higgsfield-mcp')
const state = require('./main/app-state')
const { registerAppIpc } = require('./main/ipc/app')
const { registerNotificationIpc } = require('./main/ipc/notifications')
const { registerOverlayIpc } = require('./main/ipc/overlay')
const { registerSkinIpc } = require('./main/ipc/skins')
const { createUpdateFlow } = require('./main/update-flow')
const { createMenus } = require('./main/menus')

const IS_MAC = process.platform === 'darwin'

if (!app.requestSingleInstanceLock()) {
  // A second copy would fight over the port and draw a second pet.
  app.quit()
  process.exit(0)
}

// ---------- persistence ----------

const SETTING_RULES = {
  scale: v => [2, 3, 4].includes(v),
  sound: v => typeof v === 'boolean',
  systemNotify: v => typeof v === 'boolean',
  dnd: v => typeof v === 'boolean',
  focus: v => typeof v === 'boolean',
  roam: v => typeof v === 'boolean',
  doneMin: v => DONE_MIN_CHOICES.includes(v),
  launchAtLogin: v => typeof v === 'boolean',
  hotkey: v => typeof v === 'string' && v.length < 60,
  skinModel: v => Object.prototype.hasOwnProperty.call(MODELS, v),
}

const DEFAULT_HOTKEY = 'Alt+Shift+C'
// "완료 알림" — the pet comes over only for tasks that took at least this many
// seconds (0 = always); shorter ones just raise the badge
const DONE_MIN_CHOICES = [0, 30, 120]

const DEFAULTS = {
  settings: { scale: 3, sound: true, systemNotify: false, dnd: false, focus: false, roam: true, doneMin: 30, launchAtLogin: false, hotkey: DEFAULT_HOTKEY, skinModel: DEFAULT_MODEL },
  pet: {
    name: '클로디',
    hunger: 80, fun: 70, energy: 90,
    xp: 0, level: 1,
    best: { catch: 0, tag: 0 },
    fed: 0, played: 0, petted: 0,
    bornAt: 0, lastSeen: 0,
  },
  // looks made from photos; active = '' means the classic orange Claude
  skins: { list: [], active: '' },
  // last version we told the user about, so each release is announced once
  update: { notified: '', installing: '' }, // installing: the version a swap was started for
}

// store, skinsStore, tracker, the windows and the overlay view live in
// main/app-state.js (other files in main/ use them too)
let historyStore
let currentDisplayId = null
// The overlay window covers the whole work area only while it has to (cards,
// menu, games). Otherwise it is a small window that follows the pet; the
// overlay asks for the area it needs, in work-area coordinates.
// (macOS only for now: not tried on Windows. CLAUDE_BOUNCER_FULL_OVERLAY=1
// keeps the old full-size window, for comparing or as a way out.)
const COMPACT_OVERLAY = IS_MAC && !process.env.CLAUDE_BOUNCER_FULL_OVERLAY
let crashes = [] // overlay crash times (last minute)
// Reasons the panel must stay open when it loses focus (photo maker on the
// pet tab, the extension guide, the compose window, a file dialog, a login).
// It auto-hides only when none is set.
const panelPins = new Set()
// claude.ai browser extension: last contact + pending "focus tab" commands
const extCommands = commandQueue()
const ext = { browser: '', seenAt: 0, instances: new Map() } // instance → last seen
const BROWSER_APPS = { 'Google Chrome': 'Google Chrome', 'Microsoft Edge': 'Microsoft Edge', Brave: 'Brave Browser', Opera: 'Opera', Vivaldi: 'Vivaldi', Chromium: 'Chromium', Chrome: 'Google Chrome' }

// Resolve the hook script (send-notify.sh / .ps1) to a real, on-disk file. In a packaged build it sits
// inside app.asar.unpacked (see asarUnpack in package.json); `node` can't
// execute files from inside the asar archive.
// Hook payloads come from any local process, so only ever open real folders
// (never a file or an app bundle, which openPath would launch).
function openFolderSafely(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return
  try {
    // macOS opens package folders (.app, .prefPane, .workflow, …) like files
    const PACKAGE = /\.(app|prefpane|workflow|pkg|mpkg|bundle|saver|plugin|kext|qlgenerator|wdgt|action|service|component|appex|framework|mdimporter|xpc)\/?$/i
    if (!fs.statSync(p).isDirectory() || PACKAGE.test(p)) return
  } catch { return }
  shell.openPath(p)
}

// The claude.ai extension people load into their browser lives in the app's
// data folder: a fresh copy of the bundled files plus token.json (the
// extension authenticates with it). Refreshed on every launch.
function extensionFolder() {
  return path.join(app.getPath('userData'), 'claude-ai-extension')
}

function prepareExtension(token) {
  try {
    const src = path.join(__dirname, 'extension')
      .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    const dst = extensionFolder()
    fs.mkdirSync(dst, { recursive: true })
    for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dst, f))
    fs.writeFileSync(path.join(dst, 'token.json'), JSON.stringify({ token }), { mode: 0o600 })
  } catch (e) {
    console.error('[claude-bouncer] could not prepare the browser extension:', e.message)
  }
}

function sendNotifyPath() {
  return hookScriptPath(path.join(__dirname, 'scripts'))
    .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
}

// Shared secret for the hook → app requests, readable only by this user.
function hookToken() {
  const file = path.join(os.homedir(), '.claude', 'claude-bouncer.token')
  try {
    const t = fs.readFileSync(file, 'utf8').trim()
    if (/^[a-f0-9]{48}$/.test(t)) return t
  } catch {}
  const t = require('crypto').randomBytes(24).toString('hex')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, t, { mode: 0o600 })
  return t
}

// hookToken() wrapper: an unwritable ~/.claude (e.g. created by sudo) must not
// stop the app from starting — fall back to an in-memory token and say so.
function safeHookToken() {
  try {
    const t = hookToken()
    try { fs.chmodSync(path.join(os.homedir(), '.claude', 'claude-bouncer.token'), 0o600) } catch {}
    return t
  } catch (e) {
    console.error('[claude-bouncer] cannot write ~/.claude/claude-bouncer.token:', e.message)
    return require('crypto').randomBytes(24).toString('hex')
  }
}

function syncHook({ uninstall = false } = {}) {
  try {
    return installClaudeHook({ sendNotifyPath: sendNotifyPath(), uninstall })
  } catch (e) {
    console.error('[claude-bouncer] hook sync failed:', e.message)
    return null
  }
}

function saveHistory() {
  historyStore.data.items = state.tracker.history
  historyStore.save()
}

// ---------- windows ----------

const PRELOAD = path.join(__dirname, 'preload.js')

function createOverlay() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  currentDisplayId = display.id
  setWorkArea(display.workArea)
  const opts = {
    ...display.workArea,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    acceptFirstMouse: true,
    roundedCorners: false,
    enableLargerThanScreen: true,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  }
  // NSPanel follows the user across Spaces and floats over full-screen apps.
  if (IS_MAC) opts.type = 'panel'

  state.overlay = new BrowserWindow(opts)
  state.overlay.setIgnoreMouseEvents(true, { forward: true })
  if (IS_MAC) {
    state.overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    state.overlay.setAlwaysOnTop(true, 'screen-saver')
  } else {
    state.overlay.setAlwaysOnTop(true, 'screen-saver')
  }
  state.overlay.loadFile(path.join('renderer', 'overlay.html'))
  state.overlay.once('ready-to-show', () => state.overlay.showInactive())
  state.overlay.webContents.on('render-process-gone', (_, d) => {
    console.error('[claude-bouncer] overlay crashed:', d.reason)
    if (app.isQuitting || d.reason === 'clean-exit') return
    crashes = crashes.filter(t => Date.now() - t < 60000).concat(Date.now())
    if (crashes.length > 3) {
      // keeps crashing: go back to the classic look; stop retrying after a few more
      state.skinsStore.data.active = ''
      state.skinsStore.save()
      if (crashes.length > 5) return
    }
    setTimeout(() => { if (!app.isQuitting) { state.overlay?.destroy(); createOverlay() } }, 1000 * crashes.length)
  })
}

// The window is (back) over the whole work area: requests the overlay made
// for the previous one no longer apply.
function setWorkArea(area) {
  state.workArea = { ...area }
  state.viewEpoch++
  state.viewSize = null
}

function displayInfo() {
  return { ...state.workArea, epoch: state.viewEpoch, compact: COMPACT_OVERLAY }
}

function moveOverlayTo(display, { reason = 'follow' } = {}) {
  if (!state.overlay || state.overlay.isDestroyed() || display.id === currentDisplayId) return false
  currentDisplayId = display.id
  setWorkArea(display.workArea)
  // macOS refuses to move a visible-on-all-workspaces window across displays.
  if (IS_MAC) state.overlay.setVisibleOnAllWorkspaces(false)
  state.overlay.setBounds(display.workArea)
  if (IS_MAC) {
    state.overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    state.overlay.setAlwaysOnTop(true, 'screen-saver')
  }
  const c = screen.getCursorScreenPoint()
  send(state.overlay, 'display', {
    ...displayInfo(), reason,
    cursor: { x: c.x - display.workArea.x, y: c.y - display.workArea.y },
  })
  return true
}

function followCursorDisplay(reason) {
  return moveOverlayTo(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), { reason })
}

function raiseOverlay() {
  if (!state.overlay || state.overlay.isDestroyed()) return
  if (IS_MAC) state.overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  state.overlay.setAlwaysOnTop(true, 'screen-saver')
  if (!state.overlay.isVisible()) state.overlay.showInactive()
  state.overlay.moveTop()
}

function createPanel() {
  state.panel = new BrowserWindow({
    width: 380,
    height: 560,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#1f1a17',
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  })
  const win = state.panel
  win.loadFile(path.join('renderer', 'panel.html'))
  win.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); win.hide() } })
  win.on('blur', () => { if (!panelPins.size && !win.webContents.isDevToolsOpened()) win.hide() })
  win.on('hide', () => retirePanelLater(win))
  win.on('show', () => clearTimeout(panelRetireTimer))
  win.on('closed', () => { if (state.panel === win) { state.panel = null; panelPins.clear() } })
}

// The panel is made the first time it is opened and let go once it has been
// closed for a while: a hidden window still holds about 100 MB. It stays
// while something in it is under way (a look being made, a guide left open).
const PANEL_KEEP_MS = 5 * 60 * 1000
let panelRetireTimer = null
let panelReady = null // the panel window whose page has loaded

function retirePanelLater(win) {
  clearTimeout(panelRetireTimer)
  panelRetireTimer = setTimeout(() => {
    if (win.isDestroyed() || win !== state.panel || app.isQuitting) return
    if (win.isVisible()) return
    if (panelPins.size) return retirePanelLater(win)
    win.destroy()
  }, PANEL_KEEP_MS)
}

function showPanel(tab) {
  if (!state.panel) {
    createPanel()
    const win = state.panel
    // once its page is ready (the tab message would be lost before that)
    win.webContents.once('did-finish-load', () => { panelReady = win; if (win === state.panel) showPanel(tab) })
    return
  }
  if (panelReady !== state.panel) return // still loading: it shows itself when ready
  if (state.panel.isVisible() && state.panel.isFocused()) { if (tab) send(state.panel, 'panel-tab', tab); return }
  const cursor = screen.getCursorScreenPoint()
  const { x, y, width, height } = screen.getDisplayNearestPoint(cursor).workArea
  const [w, h] = state.panel.getSize()
  const px = Math.min(Math.max(cursor.x - w / 2, x + 8), x + width - w - 8)
  const py = Math.min(Math.max(cursor.y - h - 16, y + 8), y + height - h - 8)
  state.panel.setPosition(Math.round(px), Math.round(py))
  if (tab) send(state.panel, 'panel-tab', tab)
  state.panel.show()
  state.panel.focus()
}

// Open (or bring forward) the panel. It only closes when it's already the
// window you're looking at — a panel hidden behind other windows reopens.
function togglePanel(tab) {
  if (state.panel?.isVisible() && state.panel.isFocused() && !tab) state.panel.hide()
  else showPanel(tab)
}

function send(win, channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

// ---------- data fan-out ----------

function snapshot() {
  return {
    pending: state.tracker.pending(),
    sessions: state.tracker.listSessions(),
    working: state.tracker.workingCount(),
  }
}

function broadcastData() {
  const snap = snapshot()
  send(state.overlay, 'data', snap)
  send(state.panel, 'data', { ...snap, history: state.tracker.history })
  updateTray(snap)
  closeHandledSystemNotifications(snap.pending)
  watchFront()
  scheduleSnooze()
}

function broadcastSettings() {
  send(state.overlay, 'settings', state.store.data.settings)
  send(state.panel, 'settings', { ...state.store.data.settings, hotkeyOk: state.hotkeyOk })
  buildTrayMenu()
}

// ---------- hook events ----------

// Tell the person about a card: the pet comes over (unless it should stay
// quiet) and, if asked for, a system notification goes out.
function announce(notification) {
  // a task that finished quickly only raises the badge
  const brief = isQuietDone(notification, state.store.data.settings.doneMin)
  const quiet = state.store.data.settings.dnd || brief
  if (!quiet) {
    // roaming off: the pet stays on its screen and spot, it only alerts there
    if (state.store.data.settings.roam) followCursorDisplay('notify')
    raiseOverlay()
  }
  // tiny delay so a display move (if any) settles before the pet reacts
  setTimeout(() => send(state.overlay, 'notify', brief ? { ...notification, quiet: true } : notification), 60)
  if (state.store.data.settings.systemNotify && !quiet) showSystemNotification(notification)
}

// Files the event needs (transcript, .git) are read off the main thread, so a
// file that never opens can't freeze the app (#58).
function onHookEvent(payload) {
  return state.tracker.handleAsync(payload).then(({ notification, changed, type }) => {
    if (notification) {
      saveHistory()
      announce(notification)
    } else if (changed) {
      saveHistory()
    }
    if (type === 'submit') send(state.overlay, 'session-busy', true)
    broadcastData()
  }).catch((e) => console.error('[claude-bouncer] hook event failed:', e.message))
}

// ---------- "10분 뒤" on a card ----------

let snoozeTimer = null

function scheduleSnooze() {
  clearTimeout(snoozeTimer)
  snoozeTimer = null
  const at = state.tracker.nextSnoozeAt()
  if (!at) return
  snoozeTimer = setTimeout(() => {
    const due = state.tracker.dueSnoozes()
    if (due.length) {
      saveHistory()
      for (const n of due) announce(n)
    }
    broadcastData()
  }, Math.min(Math.max(at - Date.now(), 0), 24 * 3600 * 1000) + 50)
}

const KIND_TITLE = {
  done: '✅ 작업 완료',
  permission: '🔐 권한이 필요해요',
  input: '💬 입력을 기다려요',
  attention: '👀 확인이 필요해요',
}

const liveNotifications = new Map() // keep references so 'click' survives GC

function showSystemNotification(n) {
  if (!Notification.isSupported()) return
  const where = [n.projectName, n.branch && `🌿 ${n.branch}`, n.terminal?.label].filter(Boolean).join(' · ')
  const body = n.kind === 'done' ? (n.prompt || n.summary || '응답을 마쳤어요') : n.message
  const sys = new Notification({ title: `${KIND_TITLE[n.kind] || 'Claude'} — ${n.projectName}`, subtitle: where, body, silent: true })
  liveNotifications.set(n.id, sys)
  const forget = () => liveNotifications.delete(n.id)
  sys.on('click', () => { forget(); openNotification(n.id) })
  sys.on('close', forget)
  sys.show()
  if (liveNotifications.size > 50) liveNotifications.delete(liveNotifications.keys().next().value)
}

// a card answered anywhere takes its Notification Center entry with it
function closeHandledSystemNotifications(pending) {
  const live = new Set(pending.map(n => n.id))
  for (const [id, sys] of liveNotifications) {
    if (!live.has(id)) { liveNotifications.delete(id); sys.close() }
  }
}

// Going to a session answers all of its cards, not just the one clicked.
function settleSession(sessionId) {
  if (state.tracker.settle(sessionId, { read: true })) { saveHistory(); broadcastData() }
}

// ---------- clear cards when you switch to their terminal yourself ----------
// While terminal cards are pending, look at the frontmost app every 3s.
// When it changes to one that has cards, those sessions are settled. Cards
// that arrive while you're already looking at their terminal stay until you
// come back to it (or answer it). A done card left unread for half an hour
// no longer keeps the check running.
// Each look starts a process or two, so: no looks while you're away from the
// keyboard, and the selected tab (an osascript run) is only read when a card
// came from the app in front.

const WATCH_DONE_MS = 30 * 60 * 1000
const WATCH_EVERY_MS = 3000
const WATCH_AWAY_SEC = 30

let frontTimer = null
let frontLast = null // what was in front at the last look
let frontFirst = true

function watchable(n) {
  return !n.terminal?.web && (n.kind !== 'done' || Date.now() - n.ts < WATCH_DONE_MS)
}

function watchFront() {
  if (frontTimer) return
  if (!IS_MAC || !state.tracker.pending().some(watchable)) { frontLast = null; frontFirst = true; return }
  frontTimer = setTimeout(async () => {
    try {
      if (powerMonitor.getSystemIdleTime() < WATCH_AWAY_SEC) {
        const cards = state.tracker.pending().filter(watchable)
        const front = await frontTerminal({ wantTab: (bundleId) => cards.some(n => terminalBundle(n.terminal) === bundleId) })
        if (frontChanged(frontLast, front)) {
          const hit = state.tracker.pending().filter(n => watchable(n) && isFrontTerminal(n.terminal, front))
          for (const id of new Set(hit.map(n => n.sessionId))) settleSession(id)
        }
        if (front) frontLast = front
      }
    } catch (e) {
      console.error('[claude-bouncer] front app check failed:', e.message)
    }
    frontFirst = false
    frontTimer = null
    watchFront()
  }, frontFirst ? 200 : WATCH_EVERY_MS)
}

// claude.ai: ask the extension to bring the tab forward; if it isn't
// listening, just open the conversation in the browser.
function focusWebChat(t) {
  // the browser that owns the tab re-polls every ≤25s while claude.ai is open
  const listening = t.instance && Date.now() - (ext.instances.get(t.instance) || 0) < 40000
  if (listening && t.tabId != null) {
    extCommands.push({ type: 'focus', tabId: t.tabId, windowId: t.windowId, url: t.url, instance: t.instance })
    const appName = BROWSER_APPS[t.browser]
    if (IS_MAC && appName) activateApp(appName)
  } else if (t.url) {
    shell.openExternal(t.url)
  }
}

async function openNotification(id) {
  const n = state.tracker.find(id)
  if (!n) return
  state.tracker.markRead(id)
  state.tracker.settle(n.sessionId, { read: true })
  saveHistory()
  broadcastData()
  if (n.terminal?.web) return focusWebChat(n.terminal)
  await focusTerminal(n, { openPath: openFolderSafely })
}

function testNotification(kind) {
  const cwd = process.cwd() === '/' ? os.homedir() : process.cwd()
  const base = {
    session_id: `demo-${kind}`,
    cwd,
    term_program: process.env.TERM_PROGRAM || '',
    bundle_id: process.env.__CFBundleIdentifier || '',
  }
  if (kind === 'done') {
    onHookEvent({ ...base, kind: 'submit', prompt: '로그인 화면 버그 고쳐줘' })
    onHookEvent({ ...base, kind: 'stop', last_assistant_message: '로그인 버튼이 두 번 눌리던 문제를 고쳤어요.' })
  } else {
    onHookEvent({ ...base, kind: 'submit', prompt: '테스트 돌리고 실패하면 고쳐줘' })
    onHookEvent({ ...base, kind: 'notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' })
  }
}

// ---------- custom looks (photo → pixel skin via Higgsfield) ----------

const credsPath = () => path.join(app.getPath('userData'), 'higgsfield.json')

// Preferred: sign in with the Higgsfield account over MCP (uses account credits).
let hfMcp = null
function mcp() {
  if (!hfMcp) {
    hfMcp = new HiggsfieldMcp({
      file: path.join(app.getPath('userData'), 'higgsfield-mcp.bin'),
      safeStorage,
      openUrl: (url) => shell.openExternal(url),
    })
  }
  return hfMcp
}

function loadCreds() {
  try {
    const d = JSON.parse(fs.readFileSync(credsPath(), 'utf8'))
    const secret = d.enc ? safeStorage.decryptString(Buffer.from(d.secret, 'base64')) : d.secret
    return d.keyId && secret ? { keyId: d.keyId, secret } : null
  } catch { return null }
}

function saveCreds(keyId, secret) {
  if (!keyId || !secret) { try { fs.unlinkSync(credsPath()) } catch {} return false }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('이 컴퓨터에서는 키를 안전하게 저장할 수 없어요 (OS 키체인 사용 불가)')
  const d = { keyId, enc: true, secret: safeStorage.encryptString(secret).toString('base64') }
  fs.writeFileSync(credsPath(), JSON.stringify(d), { mode: 0o600 })
  return true
}

// Built-in looks that work without Higgsfield (assets/presets/*.json).
const presetSkin = presetLoader(path.join(__dirname, 'assets', 'presets'))

function activeSkin() {
  return resolveSkin(state.skinsStore.data, presetSkin)
}

function broadcastSkin() {
  send(state.overlay, 'skin', activeSkin())
  send(state.panel, 'skins', skinState())
}

// The saved key's id is plain text; only the secret needs the keychain.
function credsId() {
  try { return JSON.parse(fs.readFileSync(credsPath(), 'utf8')).keyId || '' } catch { return '' }
}

// Status for the panel. Never decrypts anything (that would ask the keychain
// every time the panel opens); real Higgsfield calls do that when they run.
function skinState() {
  const keyId = credsId()
  return {
    mcp: mcp().hasLogin,
    credits: state.hfCredits,
    hasKey: !!keyId,
    keyId: keyId ? keyId.slice(0, 6) + '…' : '',
    list: state.skinsStore.data.list,
    // names only; the (large, never-changing) pixel data comes once via skin:presets
    presets: PRESETS.filter(p => presetSkin(p.id)).map(p => ({ id: p.id, name: p.name })),
    active: state.skinsStore.data.active,
    model: state.store.data.settings.skinModel,
    models: Object.keys(MODELS),
  }
}

// Any image the OS can open (incl. HEIC on macOS) → JPEG ≤ 1024px
function preparePhoto(file) {
  let img = nativeImage.createFromPath(file)
  if (img.isEmpty()) throw new Error('이미지를 열 수 없어요 (jpg, png, webp, heic)')
  const { width, height } = img.getSize()
  if (Math.max(width, height) > 1024) {
    img = width >= height ? img.resize({ width: 1024, quality: 'best' }) : img.resize({ height: 1024, quality: 'best' })
  }
  return img.toJPEG(90)
}

async function generateSkin(file, style) {
  const photo = preparePhoto(file)
  const template = fs.readFileSync(path.join(__dirname, 'assets', 'skin-template.png'))
  const onProgress = (stage) => send(state.panel, 'skin-progress', stage)
  if (mcp().signedIn) {
    const images = await mcp().makeCharacter({ photo, photoType: 'image/jpeg', template, style, variants: 2, onProgress })
    mcp().balance().then(c => { state.hfCredits = c; send(state.panel, 'skins', skinState()) }).catch(() => {})
    return images.map(b => 'data:image/png;base64,' + b.toString('base64'))
  }
  const creds = loadCreds()
  if (!creds) throw new Error('먼저 Higgsfield 계정을 연결해 주세요')
  const hf = new Higgsfield(creds)
  const images = await hf.makeCharacter({
    photo, photoType: 'image/jpeg', template, style,
    model: state.store.data.settings.skinModel,
    variants: 2,
    onProgress: (stage) => send(state.panel, 'skin-progress', stage),
  })
  return images.map(b => 'data:image/png;base64,' + b.toString('base64'))
}

// ---------- "make one for me" requests ----------
// No Higgsfield account? People can send a photo and a note; FormSubmit
// forwards it (with the photo attached) to the maintainer's inbox.

// JSON endpoint; FormSubmit only accepts posts that name a web page as their
// source (Referer/Origin), otherwise it answers 200 with an error page.
const sendRequestMail = requestSender()

function sendRequest({ email, subject, message, photo, consent }) {
  if (!photo) throw new Error('캐릭터로 만들 사진을 골라 주세요')
  return sendRequestMail({
    email, subject, message, consent,
    photoJpeg: preparePhoto(String(photo)),
    app: `claude-bouncer ${app.getVersion()} · ${process.platform}`,
  })
}

// ---------- summon hotkey ----------

// Bring the pet right in front of the cursor, on whichever screen it's on.
function summon() {
  followCursorDisplay('summon')
  raiseOverlay()
  send(state.overlay, 'action', 'summon')
}

function registerHotkey() {
  globalShortcut.unregisterAll()
  const acc = state.store.data.settings.hotkey
  state.hotkeyOk = false
  if (acc) {
    try { state.hotkeyOk = globalShortcut.register(acc, summon) } catch { state.hotkeyOk = false }
    if (!state.hotkeyOk) console.error(`[claude-bouncer] hotkey ${acc} is taken or invalid`)
  }
  return state.hotkeyOk
}

// ---------- update flow, tray and pet menus ----------

function petAction(action) {
  raiseOverlay()
  send(state.overlay, 'action', action)
}

// main/update-flow.js; the tray menu is rebuilt whenever the update status changes
// onChange must not be called synchronously inside createUpdateFlow:
// buildTrayMenu is a const defined just below, so that call would throw a TDZ
// ReferenceError.
const { updateState, runUpdateCheck, installUpdate, startUpdateChecks } = createUpdateFlow({
  send, onChange: () => buildTrayMenu(),
})

// main/menus.js (made after the update flow: the tray menu shows its status)
const { createTray, buildTrayMenu, updateTray, showPetMenu } = createMenus({
  showPanel, summon, petAction, setSetting, testNotification, syncHook, snapshot,
  updateState, installUpdate, runUpdateCheck,
})

// ---------- settings ----------

function setSetting(key, value) {
  if (!SETTING_RULES[key] || !SETTING_RULES[key](value)) return state.store.data.settings
  const prev = state.store.data.settings[key]
  state.store.data.settings[key] = value
  if (key === 'hotkey' && value && !registerHotkey()) {
    // keep the old, working shortcut instead of leaving none
    state.store.data.settings[key] = prev
    registerHotkey()
    broadcastSettings()
    return { ...state.store.data.settings, hotkeyError: value }
  }
  if (key === 'hotkey' && !value) registerHotkey()
  state.store.save()
  if (key === 'launchAtLogin') {
    try { app.setLoginItemSettings({ openAtLogin: value }) } catch {}
  }
  broadcastSettings()
  return state.store.data.settings
}

// ---------- cursor / idle feed for the pet ----------

function startFeeds() {
  // The cursor is read often only while it matters: every frame while the
  // pet follows it, a few times a second otherwise, once a second when
  // nobody is there. Positions are relative to the work area, not the window
  // (which may be the small one around the pet).
  let last = ''
  let movedAt = 0
  let away = false
  let timer = null
  const tick = () => {
    let delay = 250
    if (state.overlay && !state.overlay.isDestroyed() && state.workArea) {
      const p = screen.getCursorScreenPoint()
      const b = state.workArea
      const inside = p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height
      const key = `${p.x},${p.y},${inside}`
      if (key !== last) {
        last = key
        movedAt = Date.now()
        send(state.overlay, 'cursor', { x: p.x - b.x, y: p.y - b.y, inside })
      }
      delay = cursorPollMs({ tracking: state.cursorTracking, movedAgoMs: Date.now() - movedAt, quiet: away || state.store.data.settings.dnd })
    }
    timer = setTimeout(tick, delay)
  }
  // read right away (the pet just started following the cursor)
  state.pokeCursor = () => { clearTimeout(timer); tick() }
  tick()

  const idle = (sec) => { away = sec > 60; send(state.overlay, 'idle', sec) }
  setInterval(() => idle(powerMonitor.getSystemIdleTime()), 4000)
  powerMonitor.on('lock-screen', () => idle(9999))
  powerMonitor.on('unlock-screen', () => idle(0))
}

// ---------- IPC ----------

// Each area registers its own channels (main/ipc/*.js). They get the
// functions they need from here; shared values come from main/app-state.
function registerIpc() {
  registerAppIpc(ipcMain, {
    ext, extensionFolder, openFolderSafely,
    activeSkin, displayInfo, snapshot, send,
    setSetting, registerHotkey, togglePanel, syncHook,
    updateState, runUpdateCheck, installUpdate,
  })
  registerNotificationIpc(ipcMain, {
    openNotification, saveHistory, broadcastData, snapshot,
    settleSession, focusWebChat, openFolderSafely, testNotification,
  })
  registerOverlayIpc(ipcMain, { compact: COMPACT_OVERLAY, followCursorDisplay, summon, petAction, showPetMenu })
  registerSkinIpc(ipcMain, {
    panelPins, send, mcp, skinState, presetSkin, broadcastSkin,
    saveCreds, preparePhoto, generateSkin, sendRequest,
  })
}

// ---------- lifecycle ----------

app.whenReady().then(() => {
  if (IS_MAC && app.dock) app.dock.hide()

  state.store = new JsonStore(path.join(app.getPath('userData'), 'state.json'), DEFAULTS)
  state.skinsStore = new JsonStore(path.join(app.getPath('userData'), 'skins.json'), { list: [], active: '' })
  // one-time move of looks saved inside state.json by earlier versions
  if (state.store.data.skins.list.length && !state.skinsStore.data.list.length) {
    state.skinsStore.data = { ...state.store.data.skins }
    state.skinsStore.flush()
  }
  state.store.data.skins = { list: [], active: '' }
  historyStore = new JsonStore(path.join(app.getPath('userData'), 'history-v2.json'), { items: [] })
  // all file reads go through handleAsync; the synchronous readers stay unused
  state.tracker = new SessionTracker({
    history: historyStore.data.items, readTranscript: () => ({}), readGit: () => null,
    // which file hung (#58): kept in the app's log folder
    onSlowRead: (key) => {
      const line = `${new Date().toISOString()} slow read (>1.5s), skipped: ${key}\n`
      const dir = app.getPath('logs')
      fs.promises.mkdir(dir, { recursive: true }).then(() => fs.promises.appendFile(path.join(dir, 'slow-reads.log'), line)).catch(() => {})
    },
  })
  if (!state.store.data.pet.bornAt) { state.store.data.pet.bornAt = Date.now(); state.store.save() }

  // Re-register the hook on every launch so it tracks the current binary location.
  syncHook()
  registerIpc()
  createOverlay()
  scheduleSnooze() // cards snoozed before the last quit
  registerHotkey()
  createTray()
  startFeeds()
  startUpdateChecks()
  const token = safeHookToken()
  prepareExtension(token)
  startServer({
    token,
    onEvent: onHookEvent,
    commands: extCommands,
    onHello: (d) => {
      ext.seenAt = Date.now()
      if (d?.instance) ext.instances.set(d.instance, Date.now())
      // a restarted extension comes back under a new id: forget the old ones
      for (const [id, at] of ext.instances) if (Date.now() - at > 5 * 60 * 1000) ext.instances.delete(id)
      if (typeof d?.browser === 'string') ext.browser = d.browser.slice(0, 40)
    },
  })

  screen.on('display-removed', () => {
    const ids = screen.getAllDisplays().map(d => d.id)
    if (!ids.includes(currentDisplayId)) { currentDisplayId = null; followCursorDisplay('display-removed') }
  })
  screen.on('display-metrics-changed', (_, d) => {
    if (d.id === currentDisplayId && state.overlay) {
      setWorkArea(d.workArea)
      state.overlay.setBounds(d.workArea)
      send(state.overlay, 'display', { ...displayInfo(), reason: 'metrics' })
    }
  })
})

// Our windows only ever show local files: block navigation and pop-ups.
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (e) => e.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
})

app.on('second-instance', () => showPanel('inbox'))
app.on('window-all-closed', (e) => { if (!app.isQuitting) e?.preventDefault?.() })
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('before-quit', () => {
  app.isQuitting = true
  state.store?.flush()
  historyStore?.flush()
  state.skinsStore?.flush()
})
// windows have closed by now (their last saves arrived): write again
app.on('will-quit', () => {
  state.store?.flush()
  historyStore?.flush()
  state.skinsStore?.flush()
})

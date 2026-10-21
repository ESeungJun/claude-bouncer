const {
  app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, shell, dialog,
  Notification, powerMonitor, globalShortcut, safeStorage, net,
} = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { installClaudeHook, hookScriptPath } = require('./scripts/install-hook')
const { SessionTracker } = require('./lib/sessions')
const { JsonStore } = require('./lib/store')
const { focusTerminal, activateApp, frontTerminal, isFrontTerminal } = require('./lib/focus')
const { startServer, commandQueue, PORT } = require('./lib/server')
const { Higgsfield, MODELS, DEFAULT_MODEL } = require('./lib/higgsfield')
const { PRESETS, presetLoader, validSkin, resolveSkin } = require('./lib/skins')
const { requestSender } = require('./lib/request')
const { actionMenuItems } = require('./lib/actions')
const { HiggsfieldMcp } = require('./lib/higgsfield-mcp')
const { checkForUpdate, releasePage } = require('./lib/update')

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
  roam: v => typeof v === 'boolean',
  launchAtLogin: v => typeof v === 'boolean',
  hotkey: v => typeof v === 'string' && v.length < 60,
  skinModel: v => Object.prototype.hasOwnProperty.call(MODELS, v),
}

const DEFAULT_HOTKEY = 'Alt+Shift+C'

const DEFAULTS = {
  settings: { scale: 3, sound: true, systemNotify: false, dnd: false, roam: true, launchAtLogin: false, hotkey: DEFAULT_HOTKEY, skinModel: DEFAULT_MODEL },
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
  update: { notified: '' },
}
const SKINS_MAX = 8

let store, historyStore, skinsStore, tracker
let overlay = null
let panel = null
let tray = null
let currentDisplayId = null
let hotkeyOk = false
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
  historyStore.data.items = tracker.history
  historyStore.save()
}

// ---------- windows ----------

const PRELOAD = path.join(__dirname, 'preload.js')

function createOverlay() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  currentDisplayId = display.id
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

  overlay = new BrowserWindow(opts)
  overlay.setIgnoreMouseEvents(true, { forward: true })
  if (IS_MAC) {
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    overlay.setAlwaysOnTop(true, 'screen-saver')
  } else {
    overlay.setAlwaysOnTop(true, 'screen-saver')
  }
  overlay.loadFile(path.join('renderer', 'overlay.html'))
  overlay.once('ready-to-show', () => overlay.showInactive())
  overlay.webContents.on('render-process-gone', (_, d) => {
    console.error('[claude-bouncer] overlay crashed:', d.reason)
    if (app.isQuitting || d.reason === 'clean-exit') return
    crashes = crashes.filter(t => Date.now() - t < 60000).concat(Date.now())
    if (crashes.length > 3) {
      // keeps crashing: go back to the classic look; stop retrying after a few more
      skinsStore.data.active = ''
      skinsStore.save()
      if (crashes.length > 5) return
    }
    setTimeout(() => { if (!app.isQuitting) { overlay?.destroy(); createOverlay() } }, 1000 * crashes.length)
  })
}

function moveOverlayTo(display, { reason = 'follow' } = {}) {
  if (!overlay || overlay.isDestroyed() || display.id === currentDisplayId) return false
  currentDisplayId = display.id
  // macOS refuses to move a visible-on-all-workspaces window across displays.
  if (IS_MAC) overlay.setVisibleOnAllWorkspaces(false)
  overlay.setBounds(display.workArea)
  if (IS_MAC) {
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    overlay.setAlwaysOnTop(true, 'screen-saver')
  }
  const c = screen.getCursorScreenPoint()
  send(overlay, 'display', {
    width: display.workArea.width, height: display.workArea.height, reason,
    cursor: { x: c.x - display.workArea.x, y: c.y - display.workArea.y },
  })
  return true
}

function followCursorDisplay(reason) {
  return moveOverlayTo(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), { reason })
}

function raiseOverlay() {
  if (!overlay || overlay.isDestroyed()) return
  if (IS_MAC) overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlay.setAlwaysOnTop(true, 'screen-saver')
  if (!overlay.isVisible()) overlay.showInactive()
  overlay.moveTop()
}

function createPanel() {
  panel = new BrowserWindow({
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
  panel.loadFile(path.join('renderer', 'panel.html'))
  panel.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); panel.hide() } })
  panel.on('blur', () => { if (!panelPins.size && !panel.webContents.isDevToolsOpened()) panel.hide() })
}

function showPanel(tab) {
  if (!panel) return
  if (panel.isVisible() && panel.isFocused()) { if (tab) send(panel, 'panel-tab', tab); return }
  const cursor = screen.getCursorScreenPoint()
  const { x, y, width, height } = screen.getDisplayNearestPoint(cursor).workArea
  const [w, h] = panel.getSize()
  const px = Math.min(Math.max(cursor.x - w / 2, x + 8), x + width - w - 8)
  const py = Math.min(Math.max(cursor.y - h - 16, y + 8), y + height - h - 8)
  panel.setPosition(Math.round(px), Math.round(py))
  if (tab) send(panel, 'panel-tab', tab)
  panel.show()
  panel.focus()
}

// Open (or bring forward) the panel. It only closes when it's already the
// window you're looking at — a panel hidden behind other windows reopens.
function togglePanel(tab) {
  if (panel?.isVisible() && panel.isFocused() && !tab) panel.hide()
  else showPanel(tab)
}

function send(win, channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

// ---------- data fan-out ----------

function snapshot() {
  return {
    pending: tracker.pending(),
    sessions: tracker.listSessions(),
    working: tracker.workingCount(),
  }
}

function broadcastData() {
  const snap = snapshot()
  send(overlay, 'data', snap)
  send(panel, 'data', { ...snap, history: tracker.history })
  updateTray(snap)
  closeHandledSystemNotifications(snap.pending)
  watchFront()
}

function broadcastSettings() {
  send(overlay, 'settings', store.data.settings)
  send(panel, 'settings', { ...store.data.settings, hotkeyOk })
  buildTrayMenu()
}

// ---------- hook events ----------

function onHookEvent(payload) {
  const { notification, changed, type } = tracker.handle(payload)
  if (notification) {
    saveHistory()
    const quiet = store.data.settings.dnd
    if (!quiet) {
      // roaming off: the pet stays on its screen and spot, it only alerts there
      if (store.data.settings.roam) followCursorDisplay('notify')
      raiseOverlay()
    }
    // tiny delay so a display move (if any) settles before the pet reacts
    setTimeout(() => send(overlay, 'notify', notification), 60)
    if (store.data.settings.systemNotify && !quiet) showSystemNotification(notification)
  } else if (changed) {
    saveHistory()
  }
  if (type === 'submit') send(overlay, 'session-busy', true)
  broadcastData()
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
  if (tracker.settle(sessionId, { read: true })) { saveHistory(); broadcastData() }
}

// ---------- clear cards when you switch to their terminal yourself ----------
// While terminal cards are pending, look at the frontmost terminal every 1.5s.
// When it changes to one that has cards, those sessions are settled. Cards
// that arrive while you're already looking at their terminal stay until you
// come back to it (or answer it). A done card left unread for half an hour
// no longer keeps the check running.

const WATCH_DONE_MS = 30 * 60 * 1000

let frontTimer = null
let frontKey = '' // what was in front at the last look ('' = no look yet)
let frontFirst = true

function watchable(n) {
  return !n.terminal?.web && (n.kind !== 'done' || Date.now() - n.ts < WATCH_DONE_MS)
}

function watchFront() {
  if (frontTimer) return
  if (!IS_MAC || !tracker.pending().some(watchable)) { frontKey = ''; frontFirst = true; return }
  frontTimer = setTimeout(async () => {
    const front = await frontTerminal()
    const key = front ? [front.bundleId, front.session, front.tty].join('|') : ''
    if (frontKey && key && key !== frontKey) {
      const hit = tracker.pending().filter(n => watchable(n) && isFrontTerminal(n.terminal, front))
      for (const id of new Set(hit.map(n => n.sessionId))) settleSession(id)
    }
    if (key) frontKey = key
    frontFirst = false
    frontTimer = null
    watchFront()
  }, frontFirst ? 200 : 1500)
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
  const n = tracker.find(id)
  if (!n) return
  tracker.markRead(id)
  tracker.settle(n.sessionId, { read: true })
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
let hfCredits = null
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
  return resolveSkin(skinsStore.data, presetSkin)
}

function broadcastSkin() {
  send(overlay, 'skin', activeSkin())
  send(panel, 'skins', skinState())
}

function skinState() {
  const c = loadCreds()
  return {
    mcp: mcp().signedIn,
    credits: hfCredits,
    hasKey: !!c,
    keyId: c ? c.keyId.slice(0, 6) + '…' : '',
    list: skinsStore.data.list,
    // names only; the (large, never-changing) pixel data comes once via skin:presets
    presets: PRESETS.filter(p => presetSkin(p.id)).map(p => ({ id: p.id, name: p.name })),
    active: skinsStore.data.active,
    model: store.data.settings.skinModel,
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
  const onProgress = (stage) => send(panel, 'skin-progress', stage)
  if (mcp().signedIn) {
    const images = await mcp().makeCharacter({ photo, photoType: 'image/jpeg', template, style, variants: 2, onProgress })
    mcp().balance().then(c => { hfCredits = c; send(panel, 'skins', skinState()) }).catch(() => {})
    return images.map(b => 'data:image/png;base64,' + b.toString('base64'))
  }
  const creds = loadCreds()
  if (!creds) throw new Error('먼저 Higgsfield 계정을 연결해 주세요')
  const hf = new Higgsfield(creds)
  const images = await hf.makeCharacter({
    photo, photoType: 'image/jpeg', template, style,
    model: store.data.settings.skinModel,
    variants: 2,
    onProgress: (stage) => send(panel, 'skin-progress', stage),
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
  send(overlay, 'action', 'summon')
}

function registerHotkey() {
  globalShortcut.unregisterAll()
  const acc = store.data.settings.hotkey
  hotkeyOk = false
  if (acc) {
    try { hotkeyOk = globalShortcut.register(acc, summon) } catch { hotkeyOk = false }
    if (!hotkeyOk) console.error(`[claude-bouncer] hotkey ${acc} is taken or invalid`)
  }
  return hotkeyOk
}

// ---------- tray ----------

function trayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'))
  if (!img.isEmpty()) return img
  return nativeImage.createFromPath(path.join(__dirname, 'assets', 'claudecode-color.png')).resize({ width: 18, height: 18 })
}

function updateTray(snap) {
  if (!tray) return
  const needs = snap.pending.filter(n => n.kind !== 'done').length
  const done = snap.pending.length - needs
  if (IS_MAC) tray.setTitle(needs ? ` ❗${needs}` : done ? ` ${done}` : '')
  const parts = []
  if (needs) parts.push(`응답 필요 ${needs}`)
  if (done) parts.push(`새 완료 ${done}`)
  if (snap.working) parts.push(`작업 중 ${snap.working}`)
  tray.setToolTip(`Claude Bouncer${parts.length ? ' — ' + parts.join(', ') : ''}`)
}

function petAction(action) {
  raiseOverlay()
  send(overlay, 'action', action)
}

function buildTrayMenu() {
  if (!tray) return
  const s = store.data.settings
  const menu = Menu.buildFromTemplate([
    ...(update.latest ? [{ label: `⬆ 새 버전 v${update.latest} 받기`, click: openUpdatePage }, { type: 'separator' }] : []),
    { label: '알림 · 세션 패널', click: () => showPanel('inbox') },
    { label: '펫 부르기', accelerator: hotkeyOk ? s.hotkey : undefined, registerAccelerator: false, click: summon },
    { type: 'separator' },
    ...actionMenuItems(petAction),
    { type: 'separator' },
    { label: '방해 금지', type: 'checkbox', checked: s.dnd, click: (i) => setSetting('dnd', i.checked) },
    { label: '돌아다니기', type: 'checkbox', checked: s.roam, click: (i) => setSetting('roam', i.checked) },
    {
      label: '테스트 알림',
      submenu: [
        { label: '작업 완료', click: () => testNotification('done') },
        { label: '권한 요청', click: () => testNotification('permission') },
      ],
    },
    {
      label: 'Claude Code 훅',
      submenu: [
        {
          label: '다시 설치',
          click: () => {
            const r = syncHook()
            dialog.showMessageBox({
              type: r ? 'info' : 'error',
              message: r ? `훅 설치 완료: ${r.installed.join(', ')}` : '훅 설치에 실패했어요.',
              detail: r ? r.settingsPath : undefined,
            })
          },
        },
        {
          label: '제거',
          click: async () => {
            const { response } = await dialog.showMessageBox({
              type: 'warning', buttons: ['취소', '제거'], defaultId: 0, cancelId: 0,
              message: 'Claude Code 설정에서 claude-bouncer 훅을 제거할까요?',
              detail: '앱을 다시 켜면 자동으로 다시 설치돼요.',
            })
            if (response !== 1) return
            const r = syncHook({ uninstall: true })
            dialog.showMessageBox({ type: r ? 'info' : 'error', message: r ? `훅 ${r.removed}개를 제거했어요.` : '제거에 실패했어요.' })
          },
        },
      ],
    },
    { label: `업데이트 확인 (v${app.getVersion()})`, click: () => runUpdateCheck({ manual: true }) },
    { type: 'separator' },
    { label: '클로디 종료', click: () => { app.isQuitting = true; app.quit() } },
  ])
  tray.setContextMenu(menu)
}

function createTray() {
  tray = new Tray(trayIcon())
  buildTrayMenu()
  updateTray(snapshot())
}

// ---------- settings ----------

function setSetting(key, value) {
  if (!SETTING_RULES[key] || !SETTING_RULES[key](value)) return store.data.settings
  const prev = store.data.settings[key]
  store.data.settings[key] = value
  if (key === 'hotkey' && value && !registerHotkey()) {
    // keep the old, working shortcut instead of leaving none
    store.data.settings[key] = prev
    registerHotkey()
    broadcastSettings()
    return { ...store.data.settings, hotkeyError: value }
  }
  if (key === 'hotkey' && !value) registerHotkey()
  store.save()
  if (key === 'launchAtLogin') {
    try { app.setLoginItemSettings({ openAtLogin: value }) } catch {}
  }
  broadcastSettings()
  return store.data.settings
}

// ---------- update check ----------

// latest: a newer published version, or null; error: the last check failed
let update = { latest: null, checking: false, error: false, checked: false }
let updateNotice = null // keep a reference so 'click' survives GC

function updateState() {
  return { current: app.getVersion(), latest: update.latest, checking: update.checking, error: update.error, checked: update.checked }
}

function openUpdatePage() {
  shell.openExternal(releasePage(update.latest))
}

// one request at a time; a click during a background check waits for it
let updateRun = null
function fetchUpdate() {
  if (updateRun) return updateRun
  update.checking = true
  send(panel, 'update', updateState())
  updateRun = checkForUpdate(app.getVersion(), { fetchImpl: net.fetch })
    .then((r) => { update = { latest: r.newer ? r.latest : null, checking: false, error: false, checked: true } })
    .catch((e) => {
      console.error('[claude-bouncer] update check failed:', e.message)
      update = { ...update, checking: false, error: true, checked: true }
    })
    .finally(() => {
      updateRun = null
      buildTrayMenu()
      send(panel, 'update', updateState())
    })
  return updateRun
}

async function runUpdateCheck({ manual = false } = {}) {
  await fetchUpdate()
  if (manual) {
    const found = update.latest && !update.error
    const { response } = await dialog.showMessageBox({
      type: update.error ? 'error' : 'info',
      message: update.error ? '업데이트를 확인하지 못했어요.'
        : found ? `새 버전이 나왔어요: v${update.latest}` : `최신 버전이에요 (v${app.getVersion()}).`,
      detail: update.error ? '인터넷 연결을 확인하고 다시 시도해 주세요.' : undefined,
      buttons: found ? ['나중에', '다운로드 페이지 열기'] : ['확인'],
      defaultId: found ? 1 : 0,
    })
    if (found && response === 1) openUpdatePage()
  } else if (update.latest && store.data.update.notified !== update.latest && !store.data.settings.dnd && Notification.isSupported()) {
    // announced once per version; under Do Not Disturb it waits for a later check
    store.data.update.notified = update.latest
    store.save()
    updateNotice = new Notification({ title: 'Claude Bouncer 새 버전', body: `v${update.latest} — 눌러서 다운로드 페이지를 열어요.`, silent: true })
    updateNotice.on('click', openUpdatePage)
    updateNotice.show()
  }
  return updateState()
}

function startUpdateChecks() {
  setTimeout(() => runUpdateCheck(), 15 * 1000)
  setInterval(() => runUpdateCheck(), 6 * 60 * 60 * 1000)
}

// ---------- cursor / idle feed for the pet ----------

function startFeeds() {
  let last = ''
  setInterval(() => {
    if (!overlay || overlay.isDestroyed()) return
    const p = screen.getCursorScreenPoint()
    const b = overlay.getBounds()
    const inside = p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height
    const key = `${p.x},${p.y},${inside}`
    if (key === last) return
    last = key
    send(overlay, 'cursor', { x: p.x - b.x, y: p.y - b.y, inside })
  }, 33)

  setInterval(() => {
    send(overlay, 'idle', powerMonitor.getSystemIdleTime())
  }, 4000)
  powerMonitor.on('lock-screen', () => send(overlay, 'idle', 9999))
  powerMonitor.on('unlock-screen', () => send(overlay, 'idle', 0))
}

// ---------- IPC ----------

function registerIpc() {
  ipcMain.handle('ext:status', () => ({
    connected: Date.now() - ext.seenAt < 90000,
    browser: ext.browser,
    folder: extensionFolder(),
  }))
  ipcMain.handle('ext:open-folder', () => openFolderSafely(extensionFolder()))
  ipcMain.handle('state:get', () => ({
    settings: store.data.settings,
    hotkeyOk,
    skin: activeSkin(),
    pet: store.data.pet,
    platform: process.platform,
    port: PORT,
    update: updateState(),
    ...snapshot(),
  }))
  ipcMain.handle('update:check', () => runUpdateCheck())
  ipcMain.handle('update:open', () => { if (update.latest) openUpdatePage() })
  // sent synchronously from the overlay's beforeunload, so it lands before we exit
  ipcMain.on('pet:save-now', (e, pet) => {
    if (pet && typeof pet === 'object') {
      store.data.pet = { ...store.data.pet, ...pet, best: { ...store.data.pet.best, ...(pet.best || {}) } }
      store.flush()
    }
    e.returnValue = true
  })
  ipcMain.handle('pet:save', (_, pet) => {
    if (!pet || typeof pet !== 'object') return
    store.data.pet = { ...store.data.pet, ...pet, best: { ...store.data.pet.best, ...(pet.best || {}) } }
    store.save()
    send(panel, 'pet', store.data.pet)
  })
  ipcMain.handle('settings:set', (_, key, value) => ({ ...setSetting(key, value), hotkeyOk }))

  ipcMain.on('mouse:ignore', (_, ignore) => {
    if (!overlay || overlay.isDestroyed()) return
    if (ignore) overlay.setIgnoreMouseEvents(true, { forward: true })
    else overlay.setIgnoreMouseEvents(false)
  })

  ipcMain.handle('notif:open', (_, id) => openNotification(String(id)))
  ipcMain.handle('notif:dismiss', (_, id) => {
    if (tracker.markRead(String(id))) { saveHistory(); broadcastData() }
  })
  ipcMain.handle('notif:readAll', () => { tracker.markAllRead(); saveHistory(); broadcastData() })
  ipcMain.handle('history:get', () => ({ ...snapshot(), history: tracker.history }))
  ipcMain.handle('history:clear', () => { tracker.clear(); saveHistory(); broadcastData() })
  ipcMain.handle('session:focus', (_, id) => {
    const s = tracker.listSessions().find(x => x.id === id)
    if (s) settleSession(s.id)
    if (s?.terminal?.web) return focusWebChat(s.terminal)
    if (s) return focusTerminal({ terminal: s.terminal, cwd: s.cwd }, { openPath: openFolderSafely })
  })

  ipcMain.handle('panel:toggle', (_, tab) => togglePanel(tab))
  ipcMain.handle('panel:close', () => panel?.hide())
  ipcMain.handle('display:follow', () => followCursorDisplay('follow'))
  ipcMain.handle('pet:action', (_, action) => action === 'summon' ? summon() : petAction(String(action)))
  // while the panel records a new shortcut, the old one must not fire
  ipcMain.handle('hotkey:pause', (_, paused) => { if (paused) globalShortcut.unregisterAll(); else registerHotkey() })
  ipcMain.handle('open-external', (_, url) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url)
  })
  ipcMain.handle('open-folder', (_, cwd) => openFolderSafely(cwd))
  ipcMain.handle('test-notify', (_, kind) => testNotification(kind === 'done' ? 'done' : 'permission'))
  ipcMain.handle('hook:reinstall', () => !!syncHook())

  // custom looks
  ipcMain.handle('panel:pin', (_, pinned, reason) => {
    const r = String(reason || 'maker').slice(0, 20)
    if (pinned) panelPins.add(r); else panelPins.delete(r)
  })
  ipcMain.handle('skin:state', () => skinState())
  ipcMain.handle('skin:presets', () => Object.fromEntries(PRESETS.map(p => [p.id, presetSkin(p.id)]).filter(([, s]) => s)))
  ipcMain.handle('request:send', async (_, form) => {
    try { await sendRequest(form || {}); return { ok: true } } catch (e) { return { error: e.message } }
  })
  ipcMain.handle('skin:mcp-login', async () => {
    panelPins.add('login')
    try {
      hfCredits = await mcp().login()
      return { ...skinState() }
    } catch (e) {
      return { ...skinState(), error: e.message }
    } finally {
      panelPins.delete('login')
      panel?.show()
    }
  })
  ipcMain.handle('skin:mcp-logout', () => { mcp().logout(); hfCredits = null; return skinState() })
  ipcMain.handle('skin:refresh', async () => {
    if (mcp().signedIn) {
      try { hfCredits = await mcp().balance() } catch (e) { return { ...skinState(), error: e.message } }
    }
    return skinState()
  })
  ipcMain.handle('skin:estimate', async (_, style) => {
    if (!mcp().signedIn) return null
    try { return await mcp().estimate(style === 'claudy' ? 'claudy' : 'pixel', 2) } catch { return null }
  })
  ipcMain.handle('skin:set-key', (_, keyId, secret) => {
    try { saveCreds(String(keyId || '').trim(), String(secret || '').trim()) } catch (e) { return { ...skinState(), error: e.message } }
    return skinState()
  })
  ipcMain.handle('skin:pick-photo', async () => {
    panelPins.add('dialog')
    try {
      const r = await dialog.showOpenDialog(panel, {
        title: '내 사진 고르기',
        properties: ['openFile'],
        filters: [{ name: '사진', extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'] }],
      })
      return r.canceled ? null : r.filePaths[0]
    } finally {
      panelPins.delete('dialog')
      panel?.show()
    }
  })
  ipcMain.handle('skin:preview-photo', (_, file) => {
    try { return 'data:image/jpeg;base64,' + preparePhoto(String(file)).toString('base64') } catch { return null }
  })
  ipcMain.handle('skin:generate', async (_, file, style) => {
    try { return { images: await generateSkin(String(file), style === 'claudy' ? 'claudy' : 'pixel') } } catch (e) { return { error: e.message } }
  })
  ipcMain.handle('skin:save', (_, skin, name) => {
    if (!validSkin(skin)) return skinState()
    const id = Date.now().toString(36)
    const list = skinsStore.data.list
    list.unshift({ id, name: String(name || '내 클로디').slice(0, 20), createdAt: Date.now(), skin })
    if (list.length > SKINS_MAX) list.length = SKINS_MAX
    skinsStore.data.active = id
    skinsStore.save()
    broadcastSkin()
    return skinState()
  })
  ipcMain.handle('skin:use', (_, id) => {
    const ok = !id || skinsStore.data.list.some(s => s.id === id) || !!presetSkin(id)
    if (ok) { skinsStore.data.active = id || ''; skinsStore.save(); broadcastSkin() }
    return skinState()
  })
  ipcMain.handle('skin:delete', (_, id) => {
    skinsStore.data.list = skinsStore.data.list.filter(s => s.id !== id)
    const wasActive = skinsStore.data.active === id
    if (wasActive) skinsStore.data.active = ''
    skinsStore.save()
    if (wasActive) broadcastSkin()
    else send(panel, 'skins', skinState())
    return skinState()
  })

  ipcMain.on('menu:pet', () => {
    const s = store.data.settings
    Menu.buildFromTemplate([
      ...actionMenuItems(petAction, { includeMenuOnly: true }),
      { type: 'separator' },
      { label: '알림 · 세션 패널', click: () => showPanel('inbox') },
      { label: '펫 상태', click: () => showPanel('pet') },
      { label: '방해 금지', type: 'checkbox', checked: s.dnd, click: (i) => setSetting('dnd', i.checked) },
      { label: '돌아다니기', type: 'checkbox', checked: s.roam, click: (i) => setSetting('roam', i.checked) },
      { type: 'separator' },
      { label: '클로디 종료', click: () => { app.isQuitting = true; app.quit() } },
    ]).popup()
  })
}

// ---------- lifecycle ----------

app.whenReady().then(() => {
  if (IS_MAC && app.dock) app.dock.hide()

  store = new JsonStore(path.join(app.getPath('userData'), 'state.json'), DEFAULTS)
  skinsStore = new JsonStore(path.join(app.getPath('userData'), 'skins.json'), { list: [], active: '' })
  // one-time move of looks saved inside state.json by earlier versions
  if (store.data.skins.list.length && !skinsStore.data.list.length) {
    skinsStore.data = { ...store.data.skins }
    skinsStore.flush()
  }
  store.data.skins = { list: [], active: '' }
  historyStore = new JsonStore(path.join(app.getPath('userData'), 'history-v2.json'), { items: [] })
  tracker = new SessionTracker({ history: historyStore.data.items })
  if (!store.data.pet.bornAt) { store.data.pet.bornAt = Date.now(); store.save() }

  // Re-register the hook on every launch so it tracks the current binary location.
  syncHook()
  registerIpc()
  createOverlay()
  createPanel()
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
      if (typeof d?.browser === 'string') ext.browser = d.browser.slice(0, 40)
    },
  })

  screen.on('display-removed', () => {
    const ids = screen.getAllDisplays().map(d => d.id)
    if (!ids.includes(currentDisplayId)) { currentDisplayId = null; followCursorDisplay('display-removed') }
  })
  screen.on('display-metrics-changed', (_, d) => {
    if (d.id === currentDisplayId && overlay) {
      overlay.setBounds(d.workArea)
      send(overlay, 'display', { width: d.workArea.width, height: d.workArea.height, reason: 'metrics' })
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
  store?.flush()
  historyStore?.flush()
  skinsStore?.flush()
})
// windows have closed by now (their last saves arrived): write again
app.on('will-quit', () => {
  store?.flush()
  historyStore?.flush()
  skinsStore?.flush()
})

const {
  app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, shell, dialog,
  Notification, powerMonitor, globalShortcut, safeStorage,
} = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { installClaudeHook } = require('./scripts/install-hook')
const { SessionTracker } = require('./lib/sessions')
const { JsonStore } = require('./lib/store')
const { focusTerminal } = require('./lib/focus')
const { startServer, PORT } = require('./lib/server')
const { Higgsfield, MODELS, DEFAULT_MODEL, PROMPT } = require('./lib/higgsfield')
const { HiggsfieldMcp } = require('./lib/higgsfield-mcp')

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
}
const SKINS_MAX = 8

let store, historyStore, tracker
let overlay = null
let panel = null
let tray = null
let currentDisplayId = null
let hotkeyOk = false
let panelPinned = false

// Resolve send-notify.js to a real, on-disk file. In a packaged build it sits
// inside app.asar.unpacked (see asarUnpack in package.json); `node` can't
// execute files from inside the asar archive.
function sendNotifyPath() {
  return path
    .join(__dirname, 'scripts', 'send-notify.js')
    .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
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
    setTimeout(() => { overlay?.destroy(); createOverlay() }, 1000)
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
  send(overlay, 'display', { width: display.workArea.width, height: display.workArea.height, reason })
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
  panel.on('blur', () => { if (!panelPinned && !panel.webContents.isDevToolsOpened()) panel.hide() })
}

function showPanel(tab) {
  if (!panel) return
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

function togglePanel(tab) {
  if (panel?.isVisible()) panel.hide()
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
      followCursorDisplay('notify')
      raiseOverlay()
    }
    // tiny delay so a display move settles before the pet starts running
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

function showSystemNotification(n) {
  if (!Notification.isSupported()) return
  const where = [n.projectName, n.branch && `🌿 ${n.branch}`, n.terminal?.label].filter(Boolean).join(' · ')
  const body = n.kind === 'done' ? (n.prompt || n.summary || '응답을 마쳤어요') : n.message
  const sys = new Notification({ title: `${KIND_TITLE[n.kind] || 'Claude'} — ${n.projectName}`, subtitle: where, body, silent: true })
  sys.on('click', () => openNotification(n.id))
  sys.show()
}

async function openNotification(id) {
  const n = tracker.find(id)
  if (!n) return
  tracker.markRead(id)
  saveHistory()
  broadcastData()
  await focusTerminal(n, { openPath: p => shell.openPath(p) })
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
  const enc = safeStorage.isEncryptionAvailable()
  const d = { keyId, enc, secret: enc ? safeStorage.encryptString(secret).toString('base64') : secret }
  fs.writeFileSync(credsPath(), JSON.stringify(d), { mode: 0o600 })
  return true
}

function activeSkin() {
  const { list, active } = store.data.skins
  return list.find(s => s.id === active)?.skin || null
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
    list: store.data.skins.list,
    active: store.data.skins.active,
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
    { label: '알림 · 세션 패널', click: () => showPanel('inbox') },
    { label: '펫 부르기', accelerator: hotkeyOk ? s.hotkey : undefined, registerAccelerator: false, click: summon },
    { type: 'separator' },
    { label: '🍪 밥 주기', click: () => petAction('feed') },
    { label: '⚽ 공놀이', click: () => petAction('ball') },
    { label: '🎮 쿠키 받기 게임', click: () => petAction('game:catch') },
    { label: '🏃 술래잡기 게임', click: () => petAction('game:tag') },
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
    { type: 'separator' },
    { label: '종료', click: () => { app.isQuitting = true; app.quit() } },
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
  ipcMain.handle('state:get', () => ({
    settings: store.data.settings,
    hotkeyOk,
    skin: activeSkin(),
    pet: store.data.pet,
    platform: process.platform,
    port: PORT,
    ...snapshot(),
  }))
  ipcMain.handle('pet:save', (_, pet) => {
    if (!pet || typeof pet !== 'object') return
    store.data.pet = { ...store.data.pet, ...pet, best: { ...store.data.pet.best, ...(pet.best || {}) } }
    store.save()
    send(panel, 'pet', store.data.pet)
  })
  ipcMain.handle('settings:set', (_, key, value) => setSetting(key, value))

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
    if (s) return focusTerminal({ terminal: s.terminal, cwd: s.cwd }, { openPath: p => shell.openPath(p) })
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
  ipcMain.handle('open-folder', (_, cwd) => {
    if (typeof cwd === 'string' && path.isAbsolute(cwd)) shell.openPath(cwd)
  })
  ipcMain.handle('test-notify', (_, kind) => testNotification(kind === 'done' ? 'done' : 'permission'))
  ipcMain.handle('hook:reinstall', () => !!syncHook())

  // custom looks
  ipcMain.handle('panel:pin', (_, pinned) => { panelPinned = !!pinned })
  ipcMain.handle('skin:state', () => skinState())
  ipcMain.handle('skin:mcp-login', async () => {
    panelPinned = true
    try {
      hfCredits = await mcp().login()
      return { ...skinState() }
    } catch (e) {
      return { ...skinState(), error: e.message }
    } finally {
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
  ipcMain.handle('skin:estimate', async () => {
    if (!mcp().signedIn) return null
    try { return await mcp().estimate(PROMPT, 2) } catch { return null }
  })
  ipcMain.handle('skin:set-key', (_, keyId, secret) => {
    saveCreds(String(keyId || '').trim(), String(secret || '').trim())
    return skinState()
  })
  ipcMain.handle('skin:pick-photo', async () => {
    panelPinned = true
    try {
      const r = await dialog.showOpenDialog(panel, {
        title: '내 사진 고르기',
        properties: ['openFile'],
        filters: [{ name: '사진', extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'] }],
      })
      return r.canceled ? null : r.filePaths[0]
    } finally {
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
    const valid = skin && (Array.isArray(skin.texture) || (skin.type === 'sheet' && skin.frames?.idle))
    if (!valid) return skinState()
    const id = Date.now().toString(36)
    const list = store.data.skins.list
    list.unshift({ id, name: String(name || '내 클로디').slice(0, 20), createdAt: Date.now(), skin })
    if (list.length > SKINS_MAX) list.length = SKINS_MAX
    store.data.skins.active = id
    store.save()
    broadcastSkin()
    return skinState()
  })
  ipcMain.handle('skin:use', (_, id) => {
    const ok = !id || store.data.skins.list.some(s => s.id === id)
    if (ok) { store.data.skins.active = id || ''; store.save(); broadcastSkin() }
    return skinState()
  })
  ipcMain.handle('skin:delete', (_, id) => {
    store.data.skins.list = store.data.skins.list.filter(s => s.id !== id)
    if (store.data.skins.active === id) store.data.skins.active = ''
    store.save()
    broadcastSkin()
    return skinState()
  })

  ipcMain.on('menu:pet', () => {
    const s = store.data.settings
    Menu.buildFromTemplate([
      { label: '🍪 밥 주기', click: () => petAction('feed') },
      { label: '⚽ 공놀이', click: () => petAction('ball') },
      { label: '🎮 쿠키 받기 게임', click: () => petAction('game:catch') },
      { label: '🏃 술래잡기 게임', click: () => petAction('game:tag') },
      { label: '💤 재우기', click: () => petAction('sleep') },
      { type: 'separator' },
      { label: '알림 · 세션 패널', click: () => showPanel('inbox') },
      { label: '펫 상태', click: () => showPanel('pet') },
      { label: '방해 금지', type: 'checkbox', checked: s.dnd, click: (i) => setSetting('dnd', i.checked) },
      { label: '돌아다니기', type: 'checkbox', checked: s.roam, click: (i) => setSetting('roam', i.checked) },
    ]).popup()
  })
}

// ---------- lifecycle ----------

app.whenReady().then(() => {
  if (IS_MAC && app.dock) app.dock.hide()

  store = new JsonStore(path.join(app.getPath('userData'), 'state.json'), DEFAULTS)
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
  startServer({ onEvent: onHookEvent })

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

app.on('second-instance', () => showPanel('inbox'))
app.on('window-all-closed', (e) => { if (!app.isQuitting) e?.preventDefault?.() })
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('before-quit', () => {
  app.isQuitting = true
  store?.flush()
  historyStore?.flush()
})

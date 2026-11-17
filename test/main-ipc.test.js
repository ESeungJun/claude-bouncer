// Loads main.js with a fake `electron`, runs app.whenReady and checks the
// wiring that the main/ split must keep: the IPC channels, that every handler
// survives a harmless call, and the tray / pet menu items in order.
// Nothing real is touched: HOME and userData point into .work/test-main-ipc,
// the hook installer and the local server are stubbed, every fetch fails, and
// long timers (update checks, idle feed) never run.
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const Module = require('module')

const ROOT = path.join(__dirname, '..')
const SANDBOX = path.join(ROOT, '.work', 'test-main-ipc')
fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(path.join(SANDBOX, 'home'), { recursive: true })
// os.homedir() reads these, so ~/.claude resolves inside the sandbox
process.env.HOME = path.join(SANDBOX, 'home')
process.env.USERPROFILE = process.env.HOME

// ---------- fake electron ----------

// Any electron object we don't model: every property is another fake and
// every call / `new` returns one, so code can chain on it freely.
const wins = []
function fake(name) {
  const kids = new Map()
  return new Proxy(function () {}, {
    get(_, k) {
      if (k === Symbol.toPrimitive) return () => 0
      if (k === 'then') return undefined
      if (k === 'isDestroyed' || k === 'isEmpty' || k === 'isDevToolsOpened' || k === 'isVisible' || k === 'isFocused') return () => false
      if (k === 'getSize') return () => [380, 560]
      if (k === 'isSupported' || k === 'isEncryptionAvailable') return () => true
      if (!kids.has(k)) kids.set(k, fake(`${name}.${String(k)}`))
      return kids.get(k)
    },
    apply: () => fake(`${name}()`),
    construct: () => {
      const w = fake(`new ${name}`)
      wins.push(w)
      return w
    },
  })
}

const noNetwork = () => Promise.reject(new Error('no network in tests'))
const registered = [] // [kind, channel] in registration order
const handlers = new Map()
const listeners = new Map()
const ipcMain = {
  handle: (ch, fn) => { registered.push(['handle', ch]); handlers.set(ch, fn) },
  on: (ch, fn) => { registered.push(['on', ch]); listeners.set(ch, fn) },
}
const menus = [] // every template given to Menu.buildFromTemplate
const Menu = {
  buildFromTemplate: (tpl) => { menus.push(tpl); return { popup: (o) => { o?.callback?.() } } },
  setApplicationMenu: () => {},
}
let readyCb = null
const app = new Proxy({
  requestSingleInstanceLock: () => true,
  whenReady: () => ({ then: (cb) => { readyCb = cb } }),
  getPath: (n) => path.join(SANDBOX, n),
  getVersion: () => '0.5.0',
  isPackaged: false,
  on: () => {},
  quit: () => {},
  setLoginItemSettings: () => {},
  dock: { hide: () => {} },
}, { get: (t, k) => (k in t ? t[k] : fake(`app.${String(k)}`)), set: (t, k, v) => { t[k] = v; return true } })
const display = { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } }
const electron = new Proxy({
  app, ipcMain, Menu,
  screen: {
    getCursorScreenPoint: () => ({ x: 100, y: 100 }),
    getDisplayNearestPoint: () => display,
    getAllDisplays: () => [display],
    on: () => {},
  },
  dialog: {
    showMessageBox: async () => ({ response: 0 }),
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  },
  powerMonitor: { getSystemIdleTime: () => 0, on: () => {} },
  globalShortcut: { register: () => true, unregisterAll: () => {} },
  net: { fetch: noNetwork },
}, { get: (t, k) => (k in t ? t[k] : fake(String(k))) })

// ---------- stubs for what touches the real machine ----------

globalThis.fetch = noNetwork
const realLoad = Module._load
Module._load = function (req, parent, isMain) {
  if (req === 'electron') return electron
  let resolved = ''
  try { resolved = Module._resolveFilename(req, parent, isMain) } catch {}
  // would edit ~/.claude/settings.json
  if (resolved === path.join(ROOT, 'scripts', 'install-hook.js')) {
    return { installClaudeHook: () => ({ installed: ['x'], removed: 0, settingsPath: 's' }), hookScriptPath: (d) => path.join(d, 'send-notify.sh') }
  }
  // would listen on a local port
  if (resolved === path.join(ROOT, 'lib', 'server.js')) {
    return { ...realLoad.apply(this, arguments), startServer: () => {} }
  }
  // would run lsappinfo / osascript against the real terminal apps
  if (resolved === path.join(ROOT, 'lib', 'focus.js')) {
    return { ...realLoad.apply(this, arguments), focusTerminal: async () => false, activateApp: async () => false, frontTerminal: async () => null }
  }
  return realLoad.apply(this, arguments)
}
// Long timers (update checks, feeds) never run; short ones run as usual until
// the tests end. Some short ones re-arm themselves (cursor feed, front-app
// watch), so test.after stops them all and keeps the stub in place: putting
// the real setTimeout back would let them re-arm and keep the process alive.
const real = { setTimeout: global.setTimeout, clearTimeout: global.clearTimeout }
const idleTimer = () => ({ unref() { return this }, ref() { return this }, hasRef: () => false, refresh() { return this } })
const liveTimers = new Set()
let timersStopped = false
global.setTimeout = (fn, ms, ...a) => {
  if (timersStopped || ms > 400) return idleTimer()
  const t = real.setTimeout(() => { liveTimers.delete(t); fn(...a) }, ms)
  liveTimers.add(t)
  return t
}
global.setInterval = () => idleTimer()

// ---------- harmless arguments per channel ----------

const ARGS = {
  'settings:set': [['dnd', true], ['scale', 9], ['hotkey', 'Alt+Shift+X'], ['launchAtLogin', true]],
  'pet:save': [[{ hunger: 10, best: { catch: 3 } }], [null]],
  'pet:save-now': [[{ fun: 5 }]],
  'notif:open': [['nope']], 'notif:dismiss': [['nope']], 'notif:snooze': [['nope']],
  'session:focus': [['nope']],
  'panel:toggle': [['inbox'], [undefined]],
  'pet:action': [['summon'], ['feed']],
  'hotkey:pause': [[true], [false]],
  'open-external': [['https://example.com'], ['file:///etc']],
  'open-folder': [[path.join(SANDBOX, 'nonexistent')]],
  'test-notify': [['done'], ['permission']],
  'panel:pin': [[true, 'maker'], [false, 'maker']],
  'skin:estimate': [['pixel']],
  'skin:set-key': [['', '']],
  'skin:preview-photo': [[path.join(SANDBOX, 'nonexistent.jpg')]],
  'skin:generate': [[path.join(SANDBOX, 'nonexistent.jpg'), 'pixel']],
  'skin:save': [[null, 'x']],
  'skin:use': [[''], ['missing']],
  'skin:delete': [['missing']],
  'request:send': [[{}]],
  'overlay:view': [[{ epoch: 0, x: 0, y: 0, w: 10, h: 10 }], [{ epoch: 1, x: 5, y: 6, w: 100, h: 80 }]],
  'mouse:ignore': [[true], [false]],
  'overlay:move': [[{ epoch: 1, x: 20, y: 30 }]],
  'cursor:track': [[true]],
}
// starts the Higgsfield browser login and a callback server on a fixed port
const SKIP = new Set(['skin:mcp-login'])
// these accept messages from the overlay window only
const FROM_OVERLAY = new Set(['overlay:view', 'overlay:move', 'cursor:track'])

// a promise result gets 300 ms to settle; its outcome is not checked
const settle = (r) => Promise.race([Promise.resolve(r).catch(() => {}), new Promise(res => real.setTimeout(res, 300))])

// '---' for a separator, [label, [...submenu]] for a submenu
const labels = (tpl) => tpl.map(i => (i.type === 'separator' ? '---' : i.submenu ? [i.label, labels(i.submenu)] : i.label))

test.before(async () => {
  require(path.join(ROOT, 'main.js'))
  assert.ok(readyCb, 'main.js waits for app.whenReady')
  await readyCb()
})

test.after(() => {
  timersStopped = true
  for (const t of liveTimers) real.clearTimeout(t)
  liveTimers.clear()
  Module._load = realLoad
})

test('44 IPC channels are registered, none twice', () => {
  const names = registered.map(([kind, ch]) => `${kind} ${ch}`)
  const twice = names.filter((n, i) => names.indexOf(n) !== i)
  assert.deepStrictEqual(twice, [])
  assert.strictEqual(registered.length, 44)
  assert.strictEqual(handlers.size + listeners.size, 44)
})

test('tray and pet menus keep their items in order', async () => {
  const actions = ['🍪 밥 주기', '⚽ 축구하기', '🎮 쿠키 받기 게임', '🏃 술래잡기 게임']
  const toggles = ['방해 금지', '집중 모드', '돌아다니기']
  const tray = menus.find(t => t.some(i => /^업데이트 확인/.test(i.label || '')))
  assert.ok(tray, 'the tray menu is built at start')
  assert.deepStrictEqual(labels(tray), [
    '알림 · 세션 패널', '펫 부르기', '---',
    ...actions, '---',
    ...toggles,
    ['테스트 알림', ['작업 완료', '권한 요청']],
    ['Claude Code 훅', ['다시 설치', '제거']],
    '업데이트 확인 (v0.5.0)', '---',
    '클로디 종료',
  ])

  const before = menus.length
  listeners.get('menu:pet')({ sender: {}, returnValue: undefined })
  assert.strictEqual(menus.length, before + 1, 'menu:pet builds one menu')
  assert.deepStrictEqual(labels(menus[before]), [
    ...actions, '💤 재우기', '---',
    '알림 · 세션 패널', '펫 상태',
    ...toggles, '---',
    '클로디 종료',
  ])
})

test('every handler survives a harmless call without a synchronous throw', async () => {
  const thrown = []
  const all = [...[...handlers].map(([ch, fn]) => ['handle', ch, fn]), ...[...listeners].map(([ch, fn]) => ['on', ch, fn])]
  for (const [kind, ch, fn] of all) {
    if (SKIP.has(ch)) continue
    for (const args of ARGS[ch] || [[]]) {
      const e = { sender: FROM_OVERLAY.has(ch) ? wins[0].webContents : {}, returnValue: undefined }
      let r
      try { r = fn(e, ...args) } catch (err) { thrown.push(`${kind} ${ch} ${JSON.stringify(args)}: ${err.message}`); continue }
      await settle(r)
    }
  }
  assert.deepStrictEqual(thrown, [])
})

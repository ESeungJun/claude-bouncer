// The menu-bar (tray) icon with its menu, and the pet's right-click menu.
// The tray icon is owned here; main.js calls createTray() once at start,
// updateTray(snapshot) when cards change and buildTrayMenu() when settings or
// the update status change. Settings and windows are read from
// main/app-state when a menu is built; actions come in from main.js.
const { app, Tray, Menu, nativeImage, dialog } = require('electron')
const path = require('path')
const { actionMenuItems } = require('../lib/actions')
const state = require('./app-state')

const IS_MAC = process.platform === 'darwin'
const ASSETS = path.join(__dirname, '..', 'assets')

function createMenus({
  showPanel, summon, petAction, setSetting, testNotification, syncHook, snapshot,
  updateState, installUpdate, runUpdateCheck,
}) {
  let tray = null

  // the same switches and quit item sit in both menus
  const settingToggles = (s) => [
    { label: '방해 금지', type: 'checkbox', checked: s.dnd, click: (i) => setSetting('dnd', i.checked) },
    { label: '집중 모드', type: 'checkbox', checked: s.focus, click: (i) => setSetting('focus', i.checked) },
    { label: '돌아다니기', type: 'checkbox', checked: s.roam, click: (i) => setSetting('roam', i.checked) },
  ]
  const quitItem = () => ({ label: '클로디 종료', click: () => { app.isQuitting = true; app.quit() } })

  function trayIcon() {
    const img = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'))
    if (!img.isEmpty()) return img
    return nativeImage.createFromPath(path.join(ASSETS, 'claudecode-color.png')).resize({ width: 18, height: 18 })
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

  function buildTrayMenu() {
    if (!tray) return
    const s = state.store.data.settings
    const u = updateState()
    const menu = Menu.buildFromTemplate([
      ...(u.latest ? [{
        label: u.installing ? `⬆ v${u.latest} 받는 중… ${Math.round(u.progress * 100)}%` : `⬆ 새 버전 v${u.latest}로 업데이트`,
        enabled: !u.installing,
        click: installUpdate,
      }, { type: 'separator' }] : []),
      { label: '알림 · 세션 패널', click: () => showPanel('inbox') },
      { label: '펫 부르기', accelerator: state.hotkeyOk ? s.hotkey : undefined, registerAccelerator: false, click: summon },
      { type: 'separator' },
      ...actionMenuItems(petAction),
      { type: 'separator' },
      ...settingToggles(s),
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
      quitItem(),
    ])
    tray.setContextMenu(menu)
  }

  function createTray() {
    tray = new Tray(trayIcon())
    buildTrayMenu()
    updateTray(snapshot())
  }

  // the pet's right-click menu (asked for by the overlay)
  function showPetMenu() {
    const s = state.store.data.settings
    if (IS_MAC) state.overlay.setAlwaysOnTop(true, 'floating')
    Menu.buildFromTemplate([
      ...actionMenuItems(petAction, { includeMenuOnly: true }),
      { type: 'separator' },
      { label: '알림 · 세션 패널', click: () => showPanel('inbox') },
      { label: '펫 상태', click: () => showPanel('pet') },
      ...settingToggles(s),
      { type: 'separator' },
      quitItem(),
    ]).popup({
      // the overlay sits above menus (screen-saver level); drop it while the
      // menu is open so the menu isn't hidden behind the pet
      window: state.overlay,
      callback: () => { if (state.overlay && !state.overlay.isDestroyed()) state.overlay.setAlwaysOnTop(true, 'screen-saver') },
    })
  }

  return { createTray, buildTrayMenu, updateTray, showPetMenu }
}

module.exports = { createMenus }

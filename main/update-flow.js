'use strict'
// The update flow seen by the person: periodic checks, the "new version"
// notification, the manual check dialog, download + verify + swap-in with
// progress, and the report after a restart when the swap didn't happen.
// lib/update.js does the network/file work; this file drives it from the
// tray, the panel and a timer. The update status (`update`) lives only here;
// others read it through updateState().
//
// Made once by main.js: send = main.js send(win, channel, payload);
// onChange = called when the status changes (main.js rebuilds the tray menu).
const { app, dialog, shell, net, Notification } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { execFile, spawn } = require('child_process')
const { checkForUpdate, isNewer, releasePage, downloadUpdate, macBundle, cannotInstall, MAC_SWAP_SCRIPT } = require('../lib/update')
const state = require('./app-state')
const { IS_MAC } = require('./platform')

function createUpdateFlow({ send, onChange }) {
  // latest: a newer published version, or null; error: the last check failed
  let update = { latest: null, checking: false, error: false, checked: false, installing: false, progress: 0 }
  let updateNotice = null // keep a reference so 'click' survives GC

  function updateState() {
    const { latest, checking, error, checked, installing, progress } = update
    return { current: app.getVersion(), latest, checking, error, checked, installing, progress }
  }

  function openUpdatePage() {
    shell.openExternal(releasePage(update.latest))
  }

  // one request at a time; a click during a background check waits for it
  let updateRun = null
  function fetchUpdate() {
    if (updateRun) return updateRun
    update.checking = true
    send(state.panel, 'update', updateState())
    updateRun = checkForUpdate(app.getVersion(), { fetchImpl: net.fetch })
      .then((r) => { update = { ...update, latest: r.newer ? r.latest : null, checking: false, error: false, checked: true } })
      .catch((e) => {
        console.error('[claude-bouncer] update check failed:', e.message)
        update = { ...update, checking: false, error: true, checked: true }
      })
      .finally(() => {
        updateRun = null
        onChange()
        send(state.panel, 'update', updateState())
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
        detail: update.error ? '인터넷 연결을 확인하고 다시 시도해 주세요.' : found ? '업데이트하면 앱이 잠깐 꺼졌다가 다시 켜져요.' : undefined,
        buttons: found ? ['나중에', '지금 업데이트'] : ['확인'],
        defaultId: found ? 1 : 0,
      })
      if (found && response === 1) installUpdate()
    } else if (update.latest && state.store.data.update.notified !== update.latest && !state.store.data.settings.dnd && Notification.isSupported()) {
      // announced once per version; under Do Not Disturb it waits for a later check
      state.store.data.update.notified = update.latest
      state.store.save()
      updateNotice = new Notification({ title: 'Claude Bouncer 새 버전', body: `v${update.latest} — 눌러서 업데이트해요.`, silent: true })
      updateNotice.on('click', installUpdate)
      updateNotice.show()
    }
    return updateState()
  }

  // Download, verify and swap in the new version, then quit (the new one starts
  // itself). When this copy can't replace itself, open the download page.
  async function installUpdate() {
    if (!update.latest || update.installing) return
    const version = update.latest
    const why = cannotInstall({ packaged: app.isPackaged, writable: dirWritable })
    if (why) {
      const { response } = await dialog.showMessageBox({
        type: 'info', message: '자동으로 설치할 수 없어요', detail: why,
        buttons: ['닫기', '다운로드 페이지 열기'], defaultId: 1,
      })
      if (response === 1) openUpdatePage()
      return
    }
    const setProgress = (installing, progress = 0) => {
      update = { ...update, installing, progress }
      onChange()
      send(state.panel, 'update', updateState())
    }
    setProgress(true)
    let dir = null
    try {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-bouncer-update-'))
      let shown = 0
      const file = await downloadUpdate(version, dir, {
        arch: await cpuArch(),
        fetchImpl: net.fetch,
        onProgress: (p) => { if (p - shown >= 0.02 || p === 1) { shown = p; setProgress(true, p) } },
      })
      if (IS_MAC) {
        const unpacked = path.join(dir, 'unpacked')
        await execFileP('/usr/bin/ditto', ['-x', '-k', file, unpacked])
        const newApp = path.join(unpacked, 'Claude Bouncer.app') // build.productName
        if (!fs.existsSync(newApp)) throw new Error('받은 압축 파일에 앱이 없어요')
        const script = path.join(dir, 'swap.sh')
        fs.writeFileSync(script, MAC_SWAP_SCRIPT, { mode: 0o700 })
        fs.mkdirSync(app.getPath('logs'), { recursive: true })
        const log = fs.openSync(path.join(app.getPath('logs'), 'update.log'), 'a')
        spawn('/bin/sh', [script, String(process.pid), macBundle(), newApp, dir], { detached: true, stdio: ['ignore', log, log] }).unref()
      } else {
        // silent install, then the installer starts the new version
        spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
      }
      // checked on the next launch: still the old version means the swap failed
      state.store.data.update.installing = version
      state.store.flush()
      app.isQuitting = true
      setTimeout(() => app.quit(), 300)
    } catch (e) {
      console.error('[claude-bouncer] update failed:', e.message)
      if (dir) fs.rmSync(dir, { recursive: true, force: true })
      setProgress(false)
      const { response } = await dialog.showMessageBox({
        type: 'error', message: '업데이트하지 못했어요', detail: e.message,
        buttons: ['닫기', '다운로드 페이지 열기'], defaultId: 0,
      })
      if (response === 1) openUpdatePage()
    }
  }

  function dirWritable(dir) {
    try { fs.accessSync(dir, fs.constants.W_OK); return true } catch { return false }
  }

  function execFileP(cmd, args) {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 120000 }, (err) => (err ? reject(err) : resolve()))
    })
  }

  // an Intel build running under Rosetta updates to the Apple chip build
  async function cpuArch() {
    if (process.arch === 'arm64' || !IS_MAC) return process.arch
    const out = await new Promise((resolve) => execFile('/usr/sbin/sysctl', ['-in', 'sysctl.proc_translated'], (err, so) => resolve(err ? '' : String(so).trim())))
    return out === '1' ? 'arm64' : process.arch
  }

  // After an update restart: say if the swap didn't happen (the script only
  // leaves a log line and reopens the old app).
  function reportLastInstall() {
    const wanted = state.store.data.update.installing
    if (!wanted) return
    state.store.data.update.installing = ''
    state.store.save()
    if (!isNewer(wanted, app.getVersion())) return
    dialog.showMessageBox({
      type: 'error',
      message: `v${wanted}로 업데이트하지 못했어요`,
      detail: `지금은 v${app.getVersion()}이에요. 자세한 내용은 ${path.join(app.getPath('logs'), 'update.log')}에 있어요.`,
      buttons: ['닫기', '다운로드 페이지 열기'], defaultId: 0,
    }).then(({ response }) => { if (response === 1) shell.openExternal(releasePage(wanted)) })
  }

  function startUpdateChecks() {
    reportLastInstall()
    setTimeout(() => runUpdateCheck(), 15 * 1000)
    setInterval(() => runUpdateCheck(), 6 * 60 * 60 * 1000)
  }

  return { updateState, runUpdateCheck, installUpdate, startUpdateChecks }
}

module.exports = { createUpdateFlow }

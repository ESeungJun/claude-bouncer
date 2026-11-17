'use strict'
// IPC for custom looks (pet tab): the Higgsfield login/key, picking and
// previewing a photo, making a look, saving / using / deleting looks, and the
// "make one for me" request. Registered once from main.js (registerIpc),
// which owns the Higgsfield and photo helpers and passes them in. panelPins
// is main.js's Set, shared by reference (changed in place, never replaced).
const { dialog } = require('electron')
const { PRESETS, validSkin } = require('../../lib/skins')
const state = require('../app-state')

const SKINS_MAX = 8

function registerSkinIpc(ipcMain, {
  panelPins, send, mcp, skinState, presetSkin, broadcastSkin,
  saveCreds, preparePhoto, generateSkin, sendRequest,
}) {
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
      state.hfCredits = await mcp().login()
      return { ...skinState() }
    } catch (e) {
      return { ...skinState(), error: e.message }
    } finally {
      panelPins.delete('login')
      state.panel?.show()
    }
  })
  ipcMain.handle('skin:mcp-logout', () => { mcp().logout(); state.hfCredits = null; return skinState() })
  ipcMain.handle('skin:refresh', async () => {
    if (mcp().signedIn) {
      try { state.hfCredits = await mcp().balance() } catch (e) { return { ...skinState(), error: e.message } }
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
      const r = await dialog.showOpenDialog(state.panel, {
        title: '내 사진 고르기',
        properties: ['openFile'],
        filters: [{ name: '사진', extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'] }],
      })
      return r.canceled ? null : r.filePaths[0]
    } finally {
      panelPins.delete('dialog')
      state.panel?.show()
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
    const list = state.skinsStore.data.list
    list.unshift({ id, name: String(name || '내 클로디').slice(0, 20), createdAt: Date.now(), skin })
    if (list.length > SKINS_MAX) list.length = SKINS_MAX
    state.skinsStore.data.active = id
    state.skinsStore.save()
    broadcastSkin()
    return skinState()
  })
  ipcMain.handle('skin:use', (_, id) => {
    const ok = !id || state.skinsStore.data.list.some(s => s.id === id) || !!presetSkin(id)
    if (ok) { state.skinsStore.data.active = id || ''; state.skinsStore.save(); broadcastSkin() }
    return skinState()
  })
  ipcMain.handle('skin:delete', (_, id) => {
    state.skinsStore.data.list = state.skinsStore.data.list.filter(s => s.id !== id)
    const wasActive = state.skinsStore.data.active === id
    if (wasActive) state.skinsStore.data.active = ''
    state.skinsStore.save()
    if (wasActive) broadcastSkin()
    else send(state.panel, 'skins', skinState())
    return skinState()
  })
}

module.exports = { registerSkinIpc }

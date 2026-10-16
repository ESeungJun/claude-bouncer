// Looks for the pet: built-in presets and validation of looks coming from
// the renderer (made from a photo).

const fs = require('fs')
const path = require('path')

const PRESETS = [
  { id: 'preset:cat', name: '고양이', file: 'cat.json' },
  { id: 'preset:dog', name: '강아지', file: 'dog.json' },
  { id: 'preset:onigiri', name: '주먹밥', file: 'onigiri.json' },
]

function presetLoader(dir) {
  const cache = new Map()
  return (id) => {
    const p = PRESETS.find(x => x.id === id)
    if (!p) return null
    if (!cache.has(id)) {
      try { cache.set(id, JSON.parse(fs.readFileSync(path.join(dir, p.file), 'utf8'))) } catch { cache.set(id, null) }
    }
    return cache.get(id)
  }
}

// A Claudy-body texture or a drawn sheet whose frames are non-empty
// rectangular grids of '#rrggbb' / null, within size limits. Anything else
// could break drawing (and freeze the pet), so it's refused.
function validSkin(skin) {
  if (!skin || typeof skin !== 'object') return false
  const isGrid = (g, maxW, maxH) => Array.isArray(g) && g.length > 0 && g.length <= maxH &&
    Array.isArray(g[0]) && g[0].length > 0 && g[0].length <= maxW &&
    g.every(r => Array.isArray(r) && r.length === g[0].length && r.every(c => c === null || /^#[0-9a-f]{6}$/i.test(c)))
  if (skin.type === 'sheet') {
    const frames = skin.frames && typeof skin.frames === 'object' ? Object.values(skin.frames) : []
    return frames.length > 0 && frames.length <= 12 && isGrid(skin.frames.idle, 128, 128) && frames.every(f => isGrid(f, 128, 128)) &&
      Number.isInteger(skin.w) && Number.isInteger(skin.h) && skin.w <= 128 && skin.h <= 128
  }
  return isGrid(skin.texture, 18, 20)
}

// The look to draw: a preset id, a saved look id, or '' (classic Claude).
function resolveSkin({ list, active }, preset) {
  if (!active) return null
  if (active.startsWith('preset:')) return preset(active)
  return list.find(s => s.id === active)?.skin || null
}

module.exports = { PRESETS, presetLoader, validSkin, resolveSkin }

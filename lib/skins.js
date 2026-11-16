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
// rectangular grids of '#rrggbb' / null, within size limits. A sheet frame
// may also be an animation (a list of grids). Anything else could break
// drawing (and freeze the pet), so it's refused.
const SHEET_MAX_FRAMES = 24 // named frames (idle, sad, eat, ...)
const SHEET_MAX_GRIDS = 64 // pictures in all, animations included
const ANIM_MAX = 16 // pictures in one animation

// A skin may bring its own lines for what the pet says ({ click: ['...'], ... }).
// Kinds match LINES in renderer/js/pet.js; a missing kind uses the pet's own.
const LINE_KINDS = ['hello', 'click', 'pet', 'hungry', 'bored', 'fed', 'wake', 'welcome', 'decline', 'toss', 'dizzy', 'work']
const LINES_MAX = 12 // lines per kind
const LINE_LEN = 40 // characters per line

function validLines(lines) {
  if (lines === undefined) return true
  if (!lines || typeof lines !== 'object' || Array.isArray(lines)) return false
  return Object.entries(lines).every(([k, v]) => LINE_KINDS.includes(k) && Array.isArray(v) &&
    v.length > 0 && v.length <= LINES_MAX && v.every(t => typeof t === 'string' && t.trim() && t.length <= LINE_LEN))
}

function validSkin(skin) {
  if (!skin || typeof skin !== 'object' || !validLines(skin.lines)) return false
  const isGrid = (g, maxW, maxH) => Array.isArray(g) && g.length > 0 && g.length <= maxH &&
    Array.isArray(g[0]) && g[0].length > 0 && g[0].length <= maxW &&
    g.every(r => Array.isArray(r) && r.length === g[0].length && r.every(c => c === null || /^#[0-9a-f]{6}$/i.test(c)))
  if (skin.type === 'sheet') {
    const frames = skin.frames && typeof skin.frames === 'object' ? Object.values(skin.frames) : []
    const isAnim = (f) => Array.isArray(f) && Array.isArray(f[0]) && Array.isArray(f[0][0])
    const grids = frames.flatMap(f => isAnim(f) ? f : [f])
    const okFrame = (f) => isAnim(f) ? f.length <= ANIM_MAX && f.every(g => isGrid(g, 128, 128)) : isGrid(f, 128, 128)
    return frames.length > 0 && frames.length <= SHEET_MAX_FRAMES && grids.length <= SHEET_MAX_GRIDS &&
      !!skin.frames.idle && frames.every(okFrame) &&
      (skin.fps === undefined || (Number.isFinite(skin.fps) && skin.fps >= 1 && skin.fps <= 30)) &&
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

module.exports = { PRESETS, presetLoader, validSkin, resolveSkin, LINE_KINDS }

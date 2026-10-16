// Tiny JSON-file store with defaults and debounced writes.

const fs = require('fs')
const path = require('path')

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

// Fill missing keys from defaults, recursively. Values from `saved` win, but
// only when their type matches the default (guards against corrupt files).
function mergeDefaults(defaults, saved) {
  if (!isPlainObject(saved)) return structuredClone(defaults)
  const out = {}
  for (const [k, def] of Object.entries(defaults)) {
    const v = saved[k]
    if (isPlainObject(def)) out[k] = mergeDefaults(def, v)
    else if (v !== undefined && typeof v === typeof def && Array.isArray(v) === Array.isArray(def)) out[k] = v
    else out[k] = structuredClone(def)
  }
  return out
}

class JsonStore {
  constructor(file, defaults, { delay = 400 } = {}) {
    this.file = file
    this.delay = delay
    this.timer = null
    let saved = null
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* first run */ }
    this.data = mergeDefaults(defaults, saved)
  }

  save() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.delay)
  }

  flush() {
    clearTimeout(this.timer)
    this.timer = null
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = this.file + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(this.data))
      fs.renameSync(tmp, this.file)
    } catch (e) {
      console.error('[claude-bouncer] save failed:', e.message)
    }
  }
}

module.exports = { JsonStore, mergeDefaults }

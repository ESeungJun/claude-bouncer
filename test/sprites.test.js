const test = require('node:test')
const assert = require('node:assert')
const { loadSprites, POSES } = require('../tools/sprite-sheet')

const S = loadSprites()

test('every pose fits the grid and keeps the body intact', () => {
  for (const [name, opts] of POSES) {
    const g = S.composePet(opts)
    assert.strictEqual(g.length, S.PET_H, name)
    g.forEach(row => assert.strictEqual(row.length, S.PET_W, name))
    const filled = g.flat().filter(Boolean).length
    assert.ok(filled > 120, `${name} looks empty (${filled}px)`)
  }
})

test('eyes stay inside the body for every look direction', () => {
  for (const lx of [-1, 0, 1]) for (const ly of [-1, 0, 1]) {
    const g = S.composePet({ lx, ly })
    const eyes = []
    g.forEach((row, y) => row.forEach((c, x) => { if (c === S.PAL.E) eyes.push([x, y]) }))
    assert.ok(eyes.length >= 6)
    for (const [x, y] of eyes) {
      assert.ok(x >= 3 && x <= 14, `eye x=${x} for look ${lx},${ly}`)
      assert.ok(y >= S.TOP + 1 && y <= S.TOP + 8, `eye y=${y} for look ${lx},${ly}`)
    }
  }
})

test('item sprites are rectangular', () => {
  for (const [name, g] of Object.entries(S.ITEMS)) {
    const w = g[0].length
    g.forEach(row => assert.strictEqual(row.length, w, name))
  }
})

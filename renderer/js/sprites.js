// Pixel sprites, drawn from code so every frame lines up exactly.
//
// The pet is an 18×14 grid: 2 rows of headroom for raised arms, a 14×10
// outlined body (cols 2–15), stubby arms on both sides and four 2-px legs. Faces, arms
// and legs are composed per frame from a small option object and cached.

window.CB = window.CB || {}

;(function () {
  const PAL = {
    O: '#8a361d', // outline
    B: '#d97757', // body (Claude orange)
    H: '#f2a483', // top highlight
    S: '#b65a3c', // bottom shade
    P: '#f6a6a2', // blush
    E: '#2a1612', // eyes / mouth
    W: '#ffffff', // eye glint
    T: '#7cc8ff', // tear
    R: '#ef4b5c', // heart red
    K: '#ff7a8a', // tongue
  }

  const PET_W = 18
  const PET_H = 14
  const TOP = 2 // headroom so raised arms can poke above the body
  const LEG_COLS = [[3, 4], [6, 7], [10, 11], [13, 14]]

  function grid(w, h) {
    return Array.from({ length: h }, () => new Array(w).fill(null))
  }

  function put(g, x, y, c) {
    if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = c
  }

  function rect(g, x0, y0, x1, y1, c) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(g, x, y, c)
  }

  // ---------- pet composition ----------

  function drawArm(g, side, pose, dy) {
    if (pose === 'up') {
      const [x0, inner, joint] = side === 'L' ? [0, 1, 2] : [15, 16, 15]
      rect(g, x0, dy - 2, x0 + 2, dy + 3, PAL.O)
      rect(g, inner, dy - 1, inner, dy + 2, PAL.B)
      rect(g, joint, dy + 1, joint, dy + 2, PAL.B)
      return
    }
    const top = dy + (pose === 'up' ? 1 : pose === 'down' ? 5 : 3)
    const [x0, x1, inner0, inner1, joint] = side === 'L' ? [0, 2, 1, 2, 2] : [15, 17, 15, 16, 15]
    rect(g, x0, top, x1, top + 3, PAL.O)
    rect(g, inner0, top + 1, inner1, top + 2, PAL.B)
    // open the body outline where the arm joins (only if the joint is on the body)
    for (const y of [top + 1, top + 2]) {
      if (y >= dy + 1 && y <= dy + 8) put(g, joint, y, PAL.B)
    }
  }

  function drawEyes(g, expr, lx, ly, dy) {
    const L = 5 + lx
    const R = 11 + lx
    const Y = 3 + ly + dy
    const E = PAL.E
    switch (expr) {
      case 'blink':
      case 'sleep':
        rect(g, L, Y + 1, L + 1, Y + 1, E)
        rect(g, R, Y + 1, R + 1, Y + 1, E)
        return
      case 'happy':
        for (const x of [5, 11]) {
          put(g, x - 1, dy + 4, E); put(g, x, dy + 3, E); put(g, x + 1, dy + 3, E); put(g, x + 2, dy + 4, E)
        }
        return
      case 'wide':
        for (const x of [L, R]) {
          rect(g, x, Y - 1, x + 1, Y + 1, E)
          put(g, x, Y - 1, PAL.W)
        }
        return
      case 'dizzy':
        for (const x of [4, 11]) {
          put(g, x, dy + 3, E); put(g, x + 2, dy + 3, E); put(g, x + 1, dy + 4, E)
          put(g, x, dy + 5, E); put(g, x + 2, dy + 5, E)
        }
        return
      case 'love':
        for (const x of [4, 11]) {
          put(g, x, dy + 3, PAL.R); put(g, x + 2, dy + 3, PAL.R)
          rect(g, x, dy + 4, x + 2, dy + 4, PAL.R)
          put(g, x + 1, dy + 5, PAL.R)
        }
        return
      case 'sad':
        for (const x of [L, R]) {
          rect(g, x, Y + 1, x + 1, Y + 2, E)
          put(g, x, Y + 1, PAL.W)
        }
        put(g, L, Y + 3, PAL.T)
        put(g, R + 1, Y + 3, PAL.T)
        return
      case 'angry':
        for (const [x, dir] of [[L, 1], [R, -1]]) {
          rect(g, x, Y, x + 1, Y + 1, E)
          put(g, dir > 0 ? x : x + 1, Y - 1, E)
        }
        return
      default: // normal
        for (const x of [L, R]) {
          rect(g, x, Y, x + 1, Y + 1, E)
          put(g, x, Y, PAL.W)
        }
    }
  }

  function drawMouth(g, mouth, dy) {
    const E = PAL.E
    const y = dy + 5
    switch (mouth) {
      case 'smile': put(g, 7, y, E); put(g, 8, y + 1, E); put(g, 9, y + 1, E); put(g, 10, y, E); return
      case 'open': rect(g, 8, y, 9, y + 1, E); rect(g, 8, y + 1, 9, y + 1, PAL.K); return
      case 'o': rect(g, 8, y, 9, y + 1, E); return
      case 'flat': rect(g, 8, y + 1, 9, y + 1, E); return
      case 'frown': put(g, 7, y + 1, E); put(g, 8, y, E); put(g, 9, y, E); put(g, 10, y + 1, E); return
      case 'cat': put(g, 7, y, E); put(g, 8, y + 1, E); put(g, 9, y, E); put(g, 10, y + 1, E); put(g, 11, y, E); return
      default: return
    }
  }

  // opts: { expr, mouth, armL, armR, legs:[h,h,h,h], dy, lx, ly, blush }
  function composePet(o) {
    const g = grid(PET_W, PET_H)
    const dy = (o.dy || 0) + TOP
    // body
    rect(g, 2, dy, 15, dy + 9, PAL.O)
    rect(g, 3, dy + 1, 14, dy + 8, PAL.B)
    rect(g, 4, dy + 1, 13, dy + 1, PAL.H)
    rect(g, 3, dy + 8, 14, dy + 8, PAL.S)
    put(g, 3, dy + 2, PAL.H)
    // legs (hidden when sitting: dy pushes them off the grid)
    const legs = o.legs || [2, 2, 2, 2]
    LEG_COLS.forEach(([a, b], i) => {
      const h = legs[i]
      if (h >= 2) { rect(g, a, dy + 10, b, dy + 10, PAL.S); rect(g, a, dy + 11, b, dy + 11, PAL.O) }
      else if (h === 1) rect(g, a, dy + 10, b, dy + 10, PAL.O)
    })
    drawArm(g, 'L', o.armL || 'mid', dy)
    drawArm(g, 'R', o.armR || 'mid', dy)
    if (o.blush !== false) {
      rect(g, 3, dy + 5, 4, dy + 5, PAL.P)
      rect(g, 13, dy + 5, 14, dy + 5, PAL.P)
    }
    drawEyes(g, o.expr || 'normal', o.lx || 0, o.ly || 0, dy)
    drawMouth(g, o.mouth, dy)
    return g
  }

  // ---------- item sprites ----------

  function fromStrings(rows, pal) {
    const g = grid(rows[0].length, rows.length)
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if (pal[ch]) g[y][x] = pal[ch] }))
    return g
  }

  const ITEMS = {
    heart: fromStrings([
      '.RR.RR.',
      'RWRRRRR',
      'RRRRRRR',
      '.RRRRR.',
      '..RRR..',
      '...R...',
    ], { R: '#ef4b5c', W: '#ffd1d6' }),
    cookie: fromStrings([
      '..ooo..',
      '.oCCCo.',
      'oCDCCCo',
      'oCCCDCo',
      'oCDCCCo',
      '.oCCDo.',
      '..ooo..',
    ], { o: '#8a5a2b', C: '#e3a857', D: '#5a3216' }),
    gold: fromStrings([
      '..ooo..',
      '.oCCCo.',
      'oCWCCCo',
      'oCCCDCo',
      'oCDCCCo',
      '.oCCCo.',
      '..ooo..',
    ], { o: '#a77b00', C: '#ffd84d', D: '#d49b00', W: '#fffbe0' }),
    apple: fromStrings([
      '...sL..',
      '..s....',
      '.oRRRo.',
      'oRWRRRo',
      'oRRRRRo',
      'oRRRRRo',
      '.oRRRo.',
      '..ooo..',
    ], { o: '#8f1d2a', R: '#e8454f', W: '#ffb3b8', s: '#6b4423', L: '#5cb85c' }),
    bug: fromStrings([
      'K.....K',
      '.K.K.K.',
      '..KKK..',
      'KGGKGGK',
      '.GGKGG.',
      'KGWKGGK',
      '.GGKGG.',
      '..GGG..',
    ], { K: '#1d1d1d', G: '#7a3ff2', W: '#d9c8ff' }),
    ball: fromStrings([
      '..ooo..',
      '.oYYWo.',
      'oYYWYYo',
      'oYWYYYo',
      'oWYYYWo',
      '.oYYWo.',
      '..ooo..',
    ], { o: '#6c7d16', Y: '#d7ea4f', W: '#ffffff' }),
    star: fromStrings([
      '...Y...',
      '...Y...',
      'YYYWYYY',
      '.YYYYY.',
      '.YY.YY.',
      'Y.....Y',
    ], { Y: '#ffd23f', W: '#fff6c8' }),
    crumb: fromStrings(['CD', 'DC'], { C: '#e3a857', D: '#8a5a2b' }),
    note: fromStrings([
      '..KKK',
      '..K.K',
      '..K.K',
      'KKK.K',
      'KKKKK',
      'KK.KK',
    ], { K: '#2a1612' }),
  }

  // ---------- rendering + cache ----------

  const cache = new Map()

  function toCanvas(g) {
    const c = document.createElement('canvas')
    c.width = g[0].length
    c.height = g.length
    const ctx = c.getContext('2d')
    g.forEach((row, y) => row.forEach((col, x) => {
      if (!col) return
      ctx.fillStyle = col
      ctx.fillRect(x, y, 1, 1)
    }))
    return c
  }

  function petCanvas(o) {
    const key = JSON.stringify(o)
    let c = cache.get(key)
    if (!c) {
      c = toCanvas(composePet(o))
      if (cache.size > 400) cache.clear()
      cache.set(key, c)
    }
    return c
  }

  function itemCanvas(name) {
    const key = 'item:' + name
    let c = cache.get(key)
    if (!c) { c = toCanvas(ITEMS[name] || ITEMS.heart); cache.set(key, c) }
    return c
  }

  // Draw a 1× sprite onto a target canvas at an integer scale, crisp.
  function blit(target, src, scale) {
    const w = src.width * scale
    const h = src.height * scale
    if (target.width !== w || target.height !== h) { target.width = w; target.height = h }
    const ctx = target.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(src, 0, 0, w, h)
  }

  // Make a standalone scaled canvas element for an item.
  function itemElement(name, scale, cls) {
    const c = document.createElement('canvas')
    blit(c, itemCanvas(name), scale)
    c.className = 'px ' + (cls || '')
    return c
  }

  CB.Sprites = { PET_W, PET_H, TOP, PAL, composePet, petCanvas, itemCanvas, itemElement, blit, ITEMS }
})()

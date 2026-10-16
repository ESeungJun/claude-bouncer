// Turn a generated "pixel character" image into a pet skin that fits the
// sprite grid, so every pose and expression keeps working.
//
// Input: RGBA pixels of an image that shows the pet template repainted to
// look like someone (hair on top, skin-tone face, clothing-colored lower body,
// arms and legs) on a plain background. The image is only roughly pixel-art:
// cell size and position are unknown and edges are soft. We
//   1. find the background and the character mask,
//   2. locate the template grid from the four legs (cell size + position),
//   3. sample one color per template cell and flatten near-identical colors,
//   4. read hair / face / clothes / arms / legs from the template regions.
//
// Shared by the panel (browser) and the unit tests (Node).

;(function (root) {
  // Template geometry (must match sprites.js)
  const W = 18
  const TOP = 4 // rows above the body (hair / raised arms)
  const BODY = { x0: 2, x1: 15, y0: TOP, y1: TOP + 9 } // outlined body box
  const LEG_ROW = TOP + 10
  const FIRST_LEG_COL = 3

  const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  const hex = (c) => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('')

  function px(img, x, y) {
    const i = (y * img.width + x) * 4
    return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]
  }

  function median(colors) {
    const ch = [0, 1, 2].map(k => colors.map(c => c[k]).sort((a, b) => a - b)[colors.length >> 1])
    return ch
  }

  function backgroundColor(img) {
    const samples = []
    const { width: w, height: h } = img
    for (let i = 0; i < 64; i++) {
      const t = i / 64
      samples.push(px(img, Math.floor(t * (w - 1)), 0), px(img, Math.floor(t * (w - 1)), h - 1))
      samples.push(px(img, 0, Math.floor(t * (h - 1))), px(img, w - 1, Math.floor(t * (h - 1))))
    }
    return median(samples)
  }

  const isBg = (c, bg) => (c[3] !== undefined && c[3] < 128) || dist(c, bg) < 38

  // Locate the template grid from the legs: the four legs span exactly
  // template columns 3–14 (12 cells) and sit on the character's bottom edge.
  function locateGrid(img, bg) {
    const { width: w, height: h } = img
    const rowSpan = (y) => {
      let l = -1, r = -1, n = 0
      for (let x = 0; x < w; x++) if (!isBg(px(img, x, y), bg)) { if (l < 0) l = x; r = x; n++ }
      return n > 2 ? { l, r, n } : null
    }
    let bottom = -1
    for (let y = h - 1; y >= 0; y--) if (rowSpan(y)) { bottom = y; break }
    if (bottom < 0) throw new Error('그림에서 캐릭터를 찾지 못했어요')
    // look a little above the very bottom edge (soft edges), collect leg spans
    const spans = []
    for (let y = bottom - 2; y > bottom - 14 && y > 0; y--) { const s = rowSpan(y); if (s) spans.push(s) }
    if (!spans.length) throw new Error('다리를 찾지 못했어요')
    const l = spans.map(s => s.l).sort((a, b) => a - b)[spans.length >> 1]
    const r = spans.map(s => s.r).sort((a, b) => a - b)[spans.length >> 1]
    const cell = (r - l + 1) / 12
    if (cell < 6) throw new Error('캐릭터가 너무 작아요')
    return { cell, x0: l - 3 * cell, yBottom: bottom + 1 }
  }

  // Sample one color per template cell (null = background).
  function sampleTemplate(img, bg, grid, rows) {
    const cells = []
    for (let y = 0; y < rows; y++) {
      const row = []
      for (let x = 0; x < W; x++) {
        const cx0 = grid.x0 + x * grid.cell
        const cy0 = grid.yBottom - (rows - y) * grid.cell
        const got = []
        let bgCount = 0
        for (let sy = 0.25; sy <= 0.75; sy += 0.125) {
          for (let sx = 0.25; sx <= 0.75; sx += 0.125) {
            const X = Math.floor(cx0 + sx * grid.cell)
            const Y = Math.floor(cy0 + sy * grid.cell)
            if (X < 0 || Y < 0 || X >= img.width || Y >= img.height) { bgCount++; continue }
            const c = px(img, X, Y)
            if (isBg(c, bg)) bgCount++
            else got.push(c)
          }
        }
        row.push(got.length > bgCount ? median(got) : null)
      }
      cells.push(row)
    }
    return cells
  }

  // Merge near-identical colors so the sprite stays flat and crisp.
  function flatten(cells, tolerance = 26) {
    const centers = []
    const pick = (c) => {
      for (const k of centers) if (dist(k.c, c) < tolerance) return k.c
      centers.push({ c })
      return c
    }
    return cells.map(row => row.map(c => (c ? pick(c) : null)))
  }

  function mode(colors) {
    const groups = []
    for (const c of colors) {
      if (!c) continue
      const g = groups.find(g => dist(g.c, c) < 30)
      if (g) g.n++
      else groups.push({ c, n: 1 })
    }
    groups.sort((a, b) => b.n - a.n)
    return groups[0]?.c || null
  }

  function darken(c, f = 0.72) { return [c[0] * f, c[1] * f, c[2] * f] }

  // cells (template-aligned, rows 0..LEG_ROW+1) → skin object for sprites.js
  function fitSkin(cells) {
    const at = (x, y) => (cells[y] && cells[y][x]) || null

    const face = mode([TOP + 3, TOP + 4, TOP + 5].flatMap(y => [5, 6, 7, 8, 9, 10, 11, 12].map(x => at(x, y))))
    if (!face) throw new Error('얼굴 영역을 찾지 못했어요')

    // outline: darkest common color on the body border
    const border = []
    for (let y = BODY.y0; y <= BODY.y1; y++) border.push(at(BODY.x0, y), at(BODY.x1, y))
    for (let x = BODY.x0; x <= BODY.x1; x++) border.push(at(x, BODY.y1))
    const darkBorder = border.filter(Boolean).sort((p, q) => lum(p) - lum(q))
    const outline = darkBorder.length ? mode(darkBorder.slice(0, Math.max(3, darkBorder.length >> 1))) : [42, 22, 18]

    const clothes = mode([TOP + 7, TOP + 8].flatMap(y => [4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(x => at(x, y)))) || face
    const arm = mode([at(1, TOP + 4), at(1, TOP + 5), at(16, TOP + 4), at(16, TOP + 5), at(0, TOP + 4), at(17, TOP + 4)].filter(c => c && dist(c, outline) > 40)) || clothes
    const legCells = [3, 4, 6, 7, 10, 11, 13, 14].map(x => at(x, LEG_ROW)).concat([3, 4, 6, 7, 10, 11, 13, 14].map(x => at(x, LEG_ROW + 1)))
    const leg = mode(legCells.filter(c => c && dist(c, outline) > 30)) || darken(clothes)

    // texture: everything inside the body box plus the hair above it
    const tex = []
    for (let y = 0; y <= BODY.y1; y++) {
      const row = []
      for (let x = 0; x < W; x++) {
        const inBody = x >= BODY.x0 && x <= BODY.x1 && y >= BODY.y0
        const c = at(x, y)
        if (!c) { row.push(null); continue }
        if (!inBody && y >= TOP + 2) { row.push(null); continue } // arms are drawn by the engine
        row.push(c)
      }
      tex.push(row)
    }
    // the engine draws the face: wipe anything eye/mouth-like the model added
    for (let y = TOP + 2; y <= TOP + 6; y++) {
      for (let x = 4; x <= 13; x++) {
        const c = tex[y][x]
        if (c && dist(c, face) > 60 && Math.abs(lum(c) - lum(face)) > 45 && !(y <= TOP + 3 && x <= 4) && !(y <= TOP + 3 && x >= 13)) tex[y][x] = face
      }
    }
    // keep a clean outline down the body sides below the hair
    for (let y = TOP + 3; y <= BODY.y1; y++) {
      for (const x of [BODY.x0, BODY.x1]) if (!tex[y][x] || lum(tex[y][x]) > lum(outline) + 60) tex[y][x] = outline
    }
    for (let x = BODY.x0; x <= BODY.x1; x++) tex[BODY.y1][x] = outline

    return {
      v: 1,
      texture: tex.map(row => row.map(c => (c ? hex(c) : null))),
      outline: hex(outline),
      face: hex(face),
      arm: hex(arm),
      leg: hex(leg),
      legOutline: hex(darken(outline, 0.9)),
      glasses: false,
      blush: true,
    }
  }

  function pixelize(img) {
    const bg = backgroundColor(img)
    const grid = locateGrid(img, bg)
    const cells = flatten(sampleTemplate(img, bg, grid, LEG_ROW + 2))
    const skin = fitSkin(cells)
    skin.debug = { cell: Math.round(grid.cell * 10) / 10, bg: hex(bg) }
    return skin
  }

  const api = { pixelize, fitSkin, locateGrid, sampleTemplate, backgroundColor, TOP }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else { root.CB = root.CB || {}; root.CB.Pixelize = api }
})(typeof window !== 'undefined' ? window : globalThis)

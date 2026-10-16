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

  // ---------- free-form character: a 3×2 sheet of poses ----------
  // Frame order in the sheet (see the prompt in lib/higgsfield.js).
  // Sheet layouts, in reading order. 'walk' (current): front poses on top, a
  // 4-frame side-view walk cycle below. 'classic': the first 3×2 layout.
  const SHEET_LAYOUTS = {
    walk: { cols: 4, rows: 2, frames: ['idle', 'blink', 'happy', 'sleep', 'walk1', 'walk2', 'walk3', 'walk4'] },
    classic: { cols: 3, rows: 2, frames: ['idle', 'blink', 'walkA', 'walkB', 'happy', 'sleep'] },
  }
  const SHEET_FRAMES = SHEET_LAYOUTS.classic.frames
  const SHEET_ROWS_FALLBACK = 40 // idle height in pixels when the native pixel size can't be read
  const SHEET_ROWS_MAX = 64

  // Connected blobs of non-background pixels, on a coarse block grid.
  function blobs(img, bg, block) {
    const bw = Math.ceil(img.width / block)
    const bh = Math.ceil(img.height / block)
    const on = new Uint8Array(bw * bh)
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        let n = 0, hit = 0
        for (let y = by * block; y < Math.min(img.height, (by + 1) * block); y += 2) {
          for (let x = bx * block; x < Math.min(img.width, (bx + 1) * block); x += 2) { n++; if (!isBg(px(img, x, y), bg)) hit++ }
        }
        on[by * bw + bx] = hit / n > 0.25 ? 1 : 0
      }
    }
    const seen = new Uint8Array(bw * bh)
    const out = []
    for (let i = 0; i < on.length; i++) {
      if (!on[i] || seen[i]) continue
      const stack = [i]
      seen[i] = 1
      const b = { x0: Infinity, y0: Infinity, x1: -1, y1: -1, n: 0 }
      while (stack.length) {
        const j = stack.pop()
        const x = j % bw, y = (j - x) / bw
        b.n++
        b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y)
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue
          const k = ny * bw + nx
          if (on[k] && !seen[k]) { seen[k] = 1; stack.push(k) }
        }
      }
      out.push({ x0: b.x0 * block, y0: b.y0 * block, x1: (b.x1 + 1) * block, y1: (b.y1 + 1) * block, n: b.n })
    }
    return out
  }

  // Group blobs into the 3×2 layout by where their centers fall.
  function sheetFrames(img, bg, cols = 3, rows = 2) {
    const block = Math.max(2, Math.round(Math.min(img.width, img.height) / 160))
    const all = blobs(img, bg, block)
    const biggest = Math.max(1, ...all.map(b => b.n))
    const parts = all.filter(b => b.n >= biggest * 0.04)
    const frames = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const inCell = parts.filter(b => {
          const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2
          return Math.floor(cx / (img.width / cols)) === c && Math.floor(cy / (img.height / rows)) === r
        })
        if (!inCell.length) { frames.push(null); continue }
        frames.push({
          x0: Math.min(...inCell.map(b => b.x0)), y0: Math.min(...inCell.map(b => b.y0)),
          x1: Math.max(...inCell.map(b => b.x1)), y1: Math.max(...inCell.map(b => b.y1)),
        })
      }
    }
    return frames
  }

  function sampleBox(img, bg, box, cell) {
    const cols = Math.max(1, Math.round((box.x1 - box.x0) / cell))
    const rows = Math.max(1, Math.round((box.y1 - box.y0) / cell))
    const ox = (box.x0 + box.x1) / 2 - (cols * cell) / 2
    const oy = box.y1 - rows * cell
    const g = []
    for (let y = 0; y < rows; y++) {
      const row = []
      for (let x = 0; x < cols; x++) {
        const got = []
        const bgLike = []
        let outside = 0
        const N = 7
        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) {
            const X = Math.floor(ox + (x + (j + 0.5) / N) * cell), Y = Math.floor(oy + (y + (i + 0.5) / N) * cell)
            if (X < 0 || Y < 0 || X >= img.width || Y >= img.height) { outside++; continue }
            const c = px(img, X, Y)
            if (isBg(c, bg)) bgLike.push(c)
            else got.push(c)
          }
        }
        if (got.length < (bgLike.length + outside) * 0.8) {
          // looks like background — but it may be a white part of the character
          // (rice, a white chest); decided below by whether it touches the outside
          row.push(bgLike.length ? { maybe: median(bgLike) } : null)
          continue
        }
        // dark detail (eyes, outline) wins when it covers a good part of the cell,
        // otherwise take the most common color
        const dark = got.filter(c => lum(c) < 70)
        row.push(dark.length >= got.length * 0.3 ? median(dark) : mode(got))
      }
      g.push(row)
    }
    return keepEnclosedWhite(g, bg)
  }

  // Background-coloured cells connected to the frame's edge are background.
  // Enclosed ones are usually part of the character (cream rice, a white
  // chest) — unless the whole enclosed patch is the exact background colour,
  // which means a real gap (between an arm and the body, inside a handle).
  function keepEnclosedWhite(g, bg) {
    const h = g.length, w = g[0].length
    const isMaybe = (c) => c === null || (c && c.maybe)
    const outside = g.map(row => row.map(() => false))
    const stack = []
    for (let x = 0; x < w; x++) stack.push([x, 0], [x, h - 1])
    for (let y = 0; y < h; y++) stack.push([0, y], [w - 1, y])
    while (stack.length) {
      const [x, y] = stack.pop()
      if (x < 0 || y < 0 || x >= w || y >= h || outside[y][x] || !isMaybe(g[y][x])) continue
      outside[y][x] = true
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
    }
    // group the remaining (enclosed) maybe-cells into patches
    const patch = g.map(row => row.map(() => -1))
    const holes = new Set()
    let id = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (outside[y][x] || patch[y][x] >= 0 || !g[y][x] || !g[y][x].maybe) continue
      const cells = []
      const st = [[x, y]]
      while (st.length) {
        const [cx, cy] = st.pop()
        if (cx < 0 || cy < 0 || cx >= w || cy >= h || patch[cy][cx] >= 0 || outside[cy][cx]) continue
        const c = g[cy][cx]
        if (!c || !c.maybe) continue
        patch[cy][cx] = id
        cells.push(c.maybe)
        st.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
      }
      if (bg && dist(median(cells), bg) < 6) holes.add(id)
      id++
    }
    return g.map((row, y) => row.map((c, x) => {
      if (!isMaybe(c)) return c
      if (outside[y][x] || c === null || holes.has(patch[y][x])) return null
      return c.maybe
    }))
  }

  // The generated art is drawn on its own pixel grid (each "pixel" is a few
  // image pixels). Read that size from color run lengths inside the idle frame:
  // runs are multiples of it, so pick the largest size that explains them.
  function nativePixelSize(img, box) {
    const runs = []
    const step = Math.max(1, Math.floor((box.y1 - box.y0) / 120))
    for (let y = box.y0; y < box.y1; y += step) {
      let run = 1
      for (let x = box.x0 + 1; x < box.x1; x++) {
        if (dist(px(img, x, y), px(img, x - 1, y)) < 30) run++
        else { if (run >= 3 && run < 60) runs.push(run); run = 1 }
      }
    }
    if (runs.length < 20) return 0
    const score = (p) => runs.reduce((a, r) => a + Math.cos((2 * Math.PI * r) / p), 0) / runs.length
    let best = 0
    const scores = []
    for (let p = 3; p <= 24; p += 0.05) { const sc = score(p); scores.push([p, sc]); best = Math.max(best, sc) }
    if (best < 0.1) return 0
    const ok = scores.filter(([, sc]) => sc >= best * 0.9)
    return ok[ok.length - 1][0]
  }

  // Generated sheet (3×2 poses) → { type: 'sheet', w, h, frames: { idle: grid, ... } }
  // layout: 'walk' | 'classic' | undefined (guess from the image shape:
  // the 4×2 sheet is generated at 16:9, the 3×2 one at 3:2)
  function pixelizeSheet(img, layout) {
    const L = SHEET_LAYOUTS[layout] || (img.width / img.height > 1.65 ? SHEET_LAYOUTS.walk : SHEET_LAYOUTS.classic)
    const bg = backgroundColor(img)
    const boxes = sheetFrames(img, bg, L.cols, L.rows)
    const idleBox = boxes[0] || boxes.find(Boolean)
    if (!idleBox) throw new Error('그림에서 캐릭터를 찾지 못했어요')
    const height = idleBox.y1 - idleBox.y0
    let cell = nativePixelSize(img, idleBox)
    if (!cell || height / cell > SHEET_ROWS_MAX) cell = height / SHEET_ROWS_FALLBACK
    const grids = boxes.map(b => (b ? flatten(sampleBox(img, bg, b, cell), 22) : null))
    const w = Math.max(...grids.filter(Boolean).map(g => g[0].length)) + 2
    const h = Math.max(...grids.filter(Boolean).map(g => g.length))
    const frames = {}
    L.frames.forEach((name, i) => {
      const g = grids[i] || grids[0] || grids.find(Boolean)
      // bottom-aligned, centered on a common canvas so frames don't jitter
      const out = Array.from({ length: h }, () => new Array(w).fill(null))
      const ox = Math.floor((w - g[0].length) / 2)
      const oy = h - g.length
      g.forEach((row, y) => row.forEach((c, x) => { if (c) out[oy + y][ox + x] = hex(c) }))
      frames[name] = out
    })
    return { v: 2, type: 'sheet', w, h, frames, found: grids.filter(Boolean).length, debug: { cell: Math.round(cell * 10) / 10, bg: hex(bg) } }
  }

  const api = { pixelize, pixelizeSheet, fitSkin, locateGrid, sampleTemplate, backgroundColor, TOP, SHEET_FRAMES, SHEET_LAYOUTS }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else { root.CB = root.CB || {}; root.CB.Pixelize = api }
})(typeof window !== 'undefined' ? window : globalThis)

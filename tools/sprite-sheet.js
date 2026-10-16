#!/usr/bin/env node
// Render the pet's poses to a PNG sheet without Electron, using the same
// sprites.js the app ships. `node tools/sprite-sheet.js out.png [scale]`

const fs = require('fs')
const path = require('path')
const vm = require('vm')
const zlib = require('zlib')

function loadSprites() {
  const ctx = { window: {}, document: {} }
  ctx.window.CB = {}
  ctx.CB = ctx.window.CB
  vm.createContext(ctx)
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'sprites.js'), 'utf8')
  vm.runInContext(src, ctx)
  return ctx.window.CB.Sprites
}

const POSES = [
  ['idle', {}],
  ['blink', { expr: 'blink' }],
  ['look', { lx: 1, ly: -1 }],
  ['walk A', { legs: [2, 1, 2, 1] }],
  ['walk B', { legs: [1, 2, 1, 2] }],
  ['happy', { expr: 'happy', mouth: 'open', armL: 'up', armR: 'up', legs: [1, 1, 1, 1] }],
  ['wave', { expr: 'happy', mouth: 'smile', armR: 'up' }],
  ['sit', { dy: 2 }],
  ['sleep', { expr: 'sleep', dy: 2, blush: true }],
  ['eat', { expr: 'happy', mouth: 'open', dy: 2 }],
  ['chew', { expr: 'happy', mouth: 'flat', dy: 2 }],
  ['love', { expr: 'love', mouth: 'cat' }],
  ['alert', { expr: 'wide', mouth: 'o', armL: 'up', armR: 'up' }],
  ['sad', { expr: 'sad', mouth: 'frown', armL: 'down', armR: 'down' }],
  ['dizzy', { expr: 'dizzy', mouth: 'o' }],
  ['work', { ly: 1, dy: 2, armL: 'down', armR: 'mid' }],
  ['angry', { expr: 'angry', mouth: 'flat' }],
  ['held', { expr: 'wide', mouth: 'o', armL: 'up', armR: 'up', legs: [1, 1, 1, 1] }],
]

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function render(grids, { scale, cols, pad, bg }) {
  const cw = grids[0][0].length, ch = grids[0].length
  const rows = Math.ceil(grids.length / cols)
  const W = (cw + pad * 2) * cols * scale
  const H = (ch + pad * 2) * rows * scale
  const img = Buffer.alloc(W * H * 4)
  const bgc = bg ? hexToRgb(bg) : null
  for (let i = 0; i < W * H; i++) {
    if (bgc) { img[i * 4] = bgc[0]; img[i * 4 + 1] = bgc[1]; img[i * 4 + 2] = bgc[2]; img[i * 4 + 3] = 255 }
  }
  grids.forEach((g, i) => {
    const ox = (i % cols) * (cw + pad * 2) + pad
    const oy = Math.floor(i / cols) * (ch + pad * 2) + pad
    g.forEach((row, y) => row.forEach((col, x) => {
      if (!col) return
      const [r, gg, b] = hexToRgb(col)
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const px = (ox + x) * scale + sx
        const py = (oy + y) * scale + sy
        const o = (py * W + px) * 4
        img[o] = r; img[o + 1] = gg; img[o + 2] = b; img[o + 3] = 255
      }
    }))
  })
  return encodePng(W, H, img)
}

// The reference image sent to Higgsfield when making a skin from a photo.
function writeSkinTemplate(out) {
  const S = loadSprites()
  fs.writeFileSync(out, render([S.composePet({})], { scale: 40, cols: 1, pad: 4, bg: '#ffffff' }))
}

if (require.main === module && process.argv[2] === '--template') {
  writeSkinTemplate(process.argv[3] || 'assets/skin-template.png')
  console.log('wrote skin template')
} else if (require.main === module) {
  const out = process.argv[2] || 'sprite-sheet.png'
  const scale = Number(process.argv[3]) || 8
  const S = loadSprites()
  const grids = POSES.map(([, o]) => S.composePet(o))
  fs.writeFileSync(out, render(grids, { scale, cols: 6, pad: 2, bg: '#f3efe9' }))
  console.log(`wrote ${out} (${POSES.map(p => p[0]).join(', ')})`)
}

module.exports = { loadSprites, render, encodePng, POSES, writeSkinTemplate }

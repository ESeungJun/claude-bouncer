// Minimal PNG decoder (8-bit RGB/RGBA/grey, non-interlaced) for tools and tests.
const zlib = require('zlib')

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let off = 8
  let width, height, depth, type
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const kind = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      depth = data[8]; type = data[9]
      if (depth !== 8 || data[12] !== 0) throw new Error('unsupported PNG')
    } else if (kind === 'IDAT') idat.push(data)
    else if (kind === 'IEND') break
    off += 12 + len
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[type]
  if (!ch) throw new Error('unsupported PNG color type ' + type)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * ch
  const out = Buffer.alloc(width * height * 4)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0
      const b = prev[i]
      const c = i >= ch ? prev[i - ch] : 0
      let v = line[i]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      line[i] = v & 255
    }
    for (let x = 0; x < width; x++) {
      const s = x * ch, d = (y * width + x) * 4
      if (ch === 1 || ch === 2) { out[d] = out[d + 1] = out[d + 2] = line[s]; out[d + 3] = ch === 2 ? line[s + 1] : 255 }
      else { out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2]; out[d + 3] = ch === 4 ? line[s + 3] : 255 }
    }
    prev = line
  }
  return { width, height, data: out }
}

module.exports = { decodePng }

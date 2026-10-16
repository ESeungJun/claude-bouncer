const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { decodePng } = require('../tools/png')
const { pixelize } = require('../renderer/js/pixelize')
const { loadSprites } = require('../tools/sprite-sheet')
const { Higgsfield } = require('../lib/higgsfield')

const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) }
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255] }

test('pixelize maps a generated character onto the sprite grid', () => {
  // fixture: Higgsfield output for a person with dark curly hair and a mint hoodie
  const skin = pixelize(decodePng(fs.readFileSync(path.join(__dirname, 'fixtures', 'skin-curly.png'))))
  const S = loadSprites()
  assert.strictEqual(skin.texture.length, S.TOP + 10)
  skin.texture.forEach(row => assert.strictEqual(row.length, S.PET_W))
  // hair is dark, face is light skin, clothes are greenish
  const hair = skin.texture[S.TOP - 1][8]
  assert.ok(hair && lum(hair) < 90, `hair ${hair}`)
  assert.ok(lum(skin.face) > 150, `face ${skin.face}`)
  const [r, g] = rgb(skin.arm)
  assert.ok(g > r, `arm/clothes should be green-ish: ${skin.arm}`)
  // face area is clean (the engine draws eyes)
  for (let x = 5; x <= 12; x++) assert.ok(lum(skin.texture[S.TOP + 4][x]) > 120, 'no stray eyes in the face')
})

test('a skin keeps every pose drawable', () => {
  const S = loadSprites()
  const skin = pixelize(decodePng(fs.readFileSync(path.join(__dirname, 'fixtures', 'skin-curly.png'))))
  for (const o of [{}, { dy: 2, expr: 'sleep' }, { armL: 'up', armR: 'up', expr: 'happy' }, { legs: [1, 2, 1, 2] }]) {
    const g = S.composePet(o, { ...skin, glasses: true })
    assert.strictEqual(g.length, S.PET_H)
    assert.ok(g.flat().filter(Boolean).length > 150)
    assert.ok(g.flat().includes(S.PAL.E) || o.expr === 'sleep', 'eyes are drawn by the engine')
  }
})

test('pixelize rejects an empty image', () => {
  const img = { width: 64, height: 64, data: Buffer.alloc(64 * 64 * 4, 255) }
  assert.throws(() => pixelize(img), /찾지 못했어요/)
})

function fakeFetch(script) {
  const calls = []
  const fn = async (url, opts = {}) => {
    calls.push({ url, ...opts })
    const step = script.find(s => s.match(url, opts))
    if (!step) throw new Error('unexpected ' + url)
    const body = typeof step.body === 'function' ? step.body(url, opts) : step.body
    return {
      ok: (step.status || 200) < 400,
      status: step.status || 200,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      arrayBuffer: async () => Buffer.from(body),
    }
  }
  fn.calls = calls
  return fn
}

test('Higgsfield client: upload → submit → poll → download', async () => {
  let polls = 0
  const fetch = fakeFetch([
    { match: (u) => u.endsWith('/files/generate-upload-url'), body: (u, o) => ({ upload_url: 'https://up/' + JSON.parse(o.body).content_type, public_url: 'https://pub/' + JSON.parse(o.body).content_type, upload_headers: { 'Content-Type': 'x', 'x-amz-tagging': 't' } }) },
    { match: (u) => u.startsWith('https://up/'), body: '' },
    { match: (u, o) => u.endsWith('/marketing-studio/image') && o.method === 'POST', body: { request_id: 'r1', status_url: 'https://api.higgsfield.ai/requests/r1/status' } },
    { match: (u) => u.endsWith('/requests/r1/status'), body: () => (++polls < 3 ? { status: 'in_progress' } : { status: 'completed', images: [{ url: 'https://cdn/out.png' }] }) },
    { match: (u) => u === 'https://cdn/out.png', body: 'PNGDATA' },
  ])
  const hf = new Higgsfield({ keyId: 'id', secret: 'sec', fetchImpl: fetch, sleep: async () => {} })
  const stages = []
  const out = await hf.makeCharacter({ photo: Buffer.from('jpg'), photoType: 'image/jpeg', template: Buffer.from('png'), variants: 1, onProgress: s => stages.push(s) })
  assert.strictEqual(out[0].toString(), 'PNGDATA')
  assert.deepStrictEqual(stages, ['upload', 'generate', 'download'])
  const submit = fetch.calls.find(c => c.url.endsWith('/marketing-studio/image'))
  const body = JSON.parse(submit.body)
  assert.deepStrictEqual(body.image_urls, ['https://pub/image/png', 'https://pub/image/jpeg'])
  assert.strictEqual(body.enhance_prompt, false)
  assert.strictEqual(submit.headers.Authorization, 'Key id:sec')
  // credentials never go to the storage URL
  const put = fetch.calls.find(c => c.url.startsWith('https://up/'))
  assert.ok(!JSON.stringify(put.headers).includes('sec'))
})

test('Higgsfield client: friendly errors', async () => {
  const auth = fakeFetch([{ match: () => true, status: 401, body: { detail: 'bad key' } }])
  await assert.rejects(new Higgsfield({ keyId: 'a', secret: 'b', fetchImpl: auth }).upload(Buffer.from('x'), 'image/png'), /API 키/)
  const nsfw = fakeFetch([{ match: () => true, body: { status: 'nsfw' } }])
  await assert.rejects(new Higgsfield({ keyId: 'a', secret: 'b', fetchImpl: nsfw, sleep: async () => {} }).wait({ request_id: 'x' }), /정책/)
  assert.throws(() => new Higgsfield({ keyId: '', secret: '' }), /API 키/)
})

test('Higgsfield MCP: upload → generate_image → jobs_wait → download', async () => {
  const os = require('os')
  const { HiggsfieldMcp } = require('../lib/higgsfield-mcp')
  const calls = []
  let waits = 0
  const reply = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }] })
  const fakeClient = {
    callTool: async ({ name, arguments: a }) => {
      calls.push({ name, a })
      if (name === 'balance') return { content: [{ type: 'text', text: 'Credits: 5' }], structuredContent: { credits: 5 } }
      if (name === 'media_upload') return reply({ uploads: a.files.map((f, i) => ({ upload_url: 'https://up/' + i, media_id: 'm' + i })) })
      if (name === 'media_confirm') return reply({ results: [] })
      if (name === 'generate_image') return reply({ results: [{ id: 'j1' }, { id: 'j2' }] })
      if (name === 'jobs_wait') return reply(++waits < 2
        ? { all_terminal: false, poll_after_seconds: 0, jobs: [] }
        : { all_terminal: true, jobs: [{ status: 'completed', result_url: 'https://cdn/1.png' }, { status: 'failed' }] })
      throw new Error('unexpected ' + name)
    },
  }
  const fetched = []
  const hf = new HiggsfieldMcp({
    file: path.join(os.tmpdir(), 'cb-mcp-test.bin'),
    safeStorage: null,
    openUrl: () => {},
    fetchImpl: async (url, opts = {}) => { fetched.push({ url, opts }); return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('IMG') } },
  })
  hf.client = fakeClient
  const out = await hf.makeCharacter({ photo: Buffer.from('p'), photoType: 'image/jpeg', template: Buffer.from('t'), prompt: 'P', sleep: async () => {} })
  assert.deepStrictEqual(out.map(b => b.toString()), ['IMG'])
  assert.strictEqual(await hf.balance(), 5) // structuredContent wins over text
  const gen = calls.find(c => c.name === 'generate_image').a.params
  assert.deepStrictEqual(gen.medias, [{ value: 'm0', role: 'image_references' }, { value: 'm1', role: 'image_references' }])
  assert.strictEqual(gen.use_unlim, false)
  assert.strictEqual(gen.count, 2)
  assert.deepStrictEqual(calls.find(c => c.name === 'media_confirm').a.media_ids, ['m0', 'm1'])
  assert.deepStrictEqual(fetched.filter(f => f.opts.method === 'PUT').map(f => f.opts.headers['Content-Type']), ['image/png', 'image/jpeg'])
})

test('Higgsfield MCP: tool errors surface as messages', async () => {
  const os = require('os')
  const { HiggsfieldMcp } = require('../lib/higgsfield-mcp')
  const hf = new HiggsfieldMcp({ file: path.join(os.tmpdir(), 'cb-mcp-test2.bin'), safeStorage: null, openUrl: () => {} })
  hf.client = { callTool: async () => ({ isError: true, content: [{ type: 'text', text: 'Not enough credits' }] }) }
  await assert.rejects(hf.balance(), /Not enough credits/)
  assert.strictEqual(hf.signedIn, false)
})

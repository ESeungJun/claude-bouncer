const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { startServer } = require('../lib/server')
const { JsonStore, mergeDefaults } = require('../lib/store')

function post(port, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/notify', method: 'POST', headers }, (res) => {
      res.resume(); res.on('end', () => resolve(res.statusCode))
    })
    req.on('error', reject)
    req.end(body)
  })
}

test('server accepts JSON hook posts and rejects browser-style requests', async () => {
  const events = []
  const server = startServer({ onEvent: (d) => events.push(d), port: 0 })
  await new Promise(r => server.once('listening', r))
  const { port } = server.address()
  try {
    assert.strictEqual(await post(port, '{"kind":"stop"}', { 'Content-Type': 'application/json' }), 204)
    assert.strictEqual(await post(port, '{"kind":"stop"}', { 'Content-Type': 'text/plain' }), 403)
    assert.strictEqual(await post(port, '{"kind":"stop"}', { 'Content-Type': 'application/json', Origin: 'https://evil.example' }), 403)
    assert.strictEqual(await post(port, '[1,2]', { 'Content-Type': 'application/json' }), 400)
    assert.strictEqual(await post(port, 'not json', { 'Content-Type': 'application/json' }), 400)
    assert.deepStrictEqual(events, [{ kind: 'stop' }])
  } finally {
    server.close()
  }
})

test('send-notify.js posts to the app and never fails the hook', async () => {
  const { execFileSync } = require('child_process')
  const script = path.join(__dirname, '..', 'scripts', 'send-notify.js')
  // Nothing listening on the port in the test environment → must still exit 0 quickly.
  const t0 = Date.now()
  execFileSync(process.execPath, [script, 'stop'], { input: '{"session_id":"x"}', timeout: 5000 })
  assert.ok(Date.now() - t0 < 4000)
})

test('mergeDefaults keeps saved values of the right type only', () => {
  const d = { a: 1, b: { c: true, d: 'x' }, list: [] }
  assert.deepStrictEqual(mergeDefaults(d, { a: 5, b: { c: 'nope' }, extra: 1, list: {} }), { a: 5, b: { c: true, d: 'x' }, list: [] })
  assert.deepStrictEqual(mergeDefaults(d, null), d)
})

test('JsonStore round-trips through disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-store-'))
  const file = path.join(dir, 's.json')
  const s = new JsonStore(file, { n: 0 })
  s.data.n = 7
  s.flush()
  assert.strictEqual(new JsonStore(file, { n: 0 }).data.n, 7)
  fs.writeFileSync(file, '{corrupt')
  assert.strictEqual(new JsonStore(file, { n: 0 }).data.n, 0)
  fs.rmSync(dir, { recursive: true })
})

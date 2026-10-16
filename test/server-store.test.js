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
  // Nothing listening → must still exit 0 quickly.
  const t0 = Date.now()
  // point it at a closed port so the test never reaches a running app
  execFileSync(process.execPath, [script, 'stop'], { input: '{"session_id":"x"}', timeout: 5000, env: { ...process.env, CLAUDE_BOUNCER_PORT: '9' } })
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

test('extension origin is allowed; focus commands flow through the long poll', async () => {
  const { commandQueue } = require('../lib/server')
  const events = []
  const hellos = []
  const commands = commandQueue()
  const server = startServer({ onEvent: (d) => events.push(d), onHello: (d) => hellos.push(d), commands, port: 0 })
  await new Promise(r => server.once('listening', r))
  const { port } = server.address()
  const ext = { 'Content-Type': 'application/json', Origin: 'chrome-extension://abcdefghijklmnop' }
  try {
    assert.strictEqual(await post(port, '{"kind":"stop"}', ext), 204)
    assert.strictEqual(events[0].source, 'web')
    // a web page still can't, even claiming to be the extension in the body
    assert.strictEqual(await post(port, '{"source":"web"}', { 'Content-Type': 'application/json', Origin: 'https://evil.example' }), 403)
    // long poll: a command pushed while waiting comes straight back
    const got = new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port, path: '/ext/next', headers: { Origin: 'chrome-extension://abcdefghijklmnop' } }, (res) => {
        let b = ''; res.on('data', c => b += c); res.on('end', () => resolve([res.statusCode, b]))
      })
    })
    await new Promise(r => setTimeout(r, 50))
    commands.push({ type: 'focus', tabId: 7 })
    const [status, body] = await got
    assert.strictEqual(status, 200)
    assert.deepStrictEqual(JSON.parse(body), { type: 'focus', tabId: 7 })
    assert.ok(hellos.length >= 1)
    // without the extension origin the poll endpoint is closed
    const plain = await new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: '/ext/next' }, (res) => { res.resume(); resolve(res.statusCode) }))
    assert.strictEqual(plain, 403)
  } finally {
    server.close()
  }
})

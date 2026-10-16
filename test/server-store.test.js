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

test('send-notify.sh posts the payload with terminal headers and the token', async () => {
  const { execFile } = require('child_process')
  const os = require('os')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-home-'))
  fs.mkdirSync(path.join(home, '.claude'))
  fs.writeFileSync(path.join(home, '.claude', 'claude-bouncer.token'), 'abc123token')
  const events = []
  const server = startServer({ onEvent: (d) => events.push(d), token: 'abc123token', port: 0 })
  await new Promise(r => server.once('listening', r))
  const script = path.join(__dirname, '..', 'scripts', 'send-notify.sh')
  const run = (kind, port, input) => new Promise((resolve) => {
    const child = execFile('/bin/sh', [script, kind], {
      env: { ...process.env, HOME: home, CLAUDE_BOUNCER_PORT: String(port), TERM_PROGRAM: 'iTerm.app', TMUX_PANE: '%3', ORCA_AGENT_PANE: 'tab1:leaf1' },
      timeout: 5000,
    }, (err) => resolve(err ? err.code : 0))
    child.stdin.end(input)
  })
  try {
    assert.strictEqual(await run('submit', server.address().port, '{"session_id":"s1","prompt":"hi"}'), 0)
    assert.strictEqual(events.length, 1)
    assert.deepStrictEqual(
      [events[0].kind, events[0].session_id, events[0].prompt, events[0].term_program, events[0].tmux_pane, events[0].orca_pane],
      ['submit', 's1', 'hi', 'iTerm.app', '%3', 'tab1:leaf1'])
    // nothing listening → still exits 0 quickly (never breaks a Claude turn)
    const t0 = Date.now()
    assert.strictEqual(await run('stop', 9, '{}'), 0)
    assert.ok(Date.now() - t0 < 4000)
  } finally {
    server.close()
    fs.rmSync(home, { recursive: true })
  }
})

test('hook posts need the token; payloads cannot claim to be from claude.ai', async () => {
  const events = []
  const server = startServer({ onEvent: (d) => events.push(d), token: 'tok', port: 0 })
  await new Promise(r => server.once('listening', r))
  const { port } = server.address()
  try {
    assert.strictEqual(await post(port, '{"kind":"stop"}', { 'Content-Type': 'application/json' }), 401)
    assert.strictEqual(await post(port, '{"kind":"stop"}', { 'Content-Type': 'application/json', 'X-Claude-Bouncer-Token': 'nope' }), 401)
    assert.strictEqual(await post(port, '{"kind":"stop","source":"web"}', { 'Content-Type': 'application/json', 'X-Claude-Bouncer-Token': 'tok' }), 204)
    assert.strictEqual(events[0].source, undefined)
    // DNS rebinding: a foreign Host header is refused
    assert.strictEqual(await post(port, '{}', { 'Content-Type': 'application/json', 'X-Claude-Bouncer-Token': 'tok', Host: 'evil.example' }), 403)
  } finally {
    server.close()
  }
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

test('command queue: cancelled polls drop out, requeue wakes a live poll', async () => {
  const { commandQueue } = require('../lib/server')
  const q = commandQueue()
  const dead = q.wait(1000)
  dead.cancel()
  assert.strictEqual(await dead, null)
  assert.strictEqual(q.waiting, 0)
  const live = q.wait(1000)
  q.requeue({ type: 'focus', tabId: 1 })
  assert.deepStrictEqual(await live, { type: 'focus', tabId: 1 })
  q.push({ type: 'focus', tabId: 2 }) // nobody waiting → queued
  assert.deepStrictEqual(await q.wait(10), { type: 'focus', tabId: 2 })
})

test('hook installer only touches its own entries', () => {
  const { isOurs } = require('../scripts/install-hook')
  assert.ok(isOurs('node "/Users/me/claude-bouncer/scripts/send-notify.js" stop'))
  assert.ok(isOurs('node "/Applications/Claude Bouncer.app/Contents/Resources/app.asar.unpacked/scripts/send-notify.js" stop'))
  assert.ok(isOurs('node "C:\\Users\\me\\AppData\\Local\\Programs\\Claude Bouncer\\resources\\app.asar.unpacked\\scripts\\send-notify.js" stop'))
  assert.ok(isOurs('node "/x/renamed/scripts/send-notify.js" stop', '/x/renamed/scripts/send-notify.js'))
  assert.ok(isOurs('curl -s 127.0.0.1:17891/notify'))
  assert.ok(!isOurs('node ~/proj/scripts/send-notify.js slack'))
  assert.ok(!isOurs('echo done'))
})

test('hook installer keeps the user\'s commands in a shared group', () => {
  const os = require('os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-hooks-'))
  const home = os.homedir
  os.homedir = () => dir
  delete require.cache[require.resolve('../scripts/install-hook')]
  const { installClaudeHook } = require('../scripts/install-hook')
  try {
    fs.mkdirSync(path.join(dir, '.claude'))
    const ours = 'node "/old/claude-bouncer/scripts/send-notify.js" stop'
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ hooks: { Stop: [
      { matcher: '', hooks: [{ type: 'command', command: ours }, { type: 'command', command: 'say done' }] },
      { matcher: '', hooks: [{ type: 'command', command: 'node ~/proj/scripts/send-notify.js slack' }] },
    ] } }))
    const r = installClaudeHook({ sendNotifyPath: '/new/claude-bouncer/scripts/send-notify.js' })
    assert.strictEqual(r.removed, 1)
    const stop = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')).hooks.Stop
    const cmds = stop.flatMap(g => g.hooks.map(h => h.command))
    assert.ok(cmds.includes('say done'), 'user command kept')
    assert.ok(cmds.includes('node ~/proj/scripts/send-notify.js slack'), 'unrelated send-notify kept')
    assert.ok(cmds.some(c => c.includes('/new/claude-bouncer/')), 'ours re-added')
    assert.ok(!cmds.includes(ours), 'old ours removed')
  } finally {
    os.homedir = home
    delete require.cache[require.resolve('../scripts/install-hook')]
    fs.rmSync(dir, { recursive: true })
  }
})

test('hook commands need no Node.js and quote the install path safely', () => {
  const { buildHookCommand, isOurs } = require('../scripts/install-hook')
  const mac = buildHookCommand("/Applications/Claude Bouncer.app/Contents/Resources/app.asar.unpacked/scripts/send-notify.sh", 'stop', 'darwin')
  assert.strictEqual(mac, "/bin/sh '/Applications/Claude Bouncer.app/Contents/Resources/app.asar.unpacked/scripts/send-notify.sh' stop")
  assert.ok(isOurs(mac))
  // a quote or $() in the folder name can't break out of the quoting
  assert.strictEqual(buildHookCommand("/tmp/it's $(x)/claude-bouncer/scripts/send-notify.sh", 'end', 'linux'), "/bin/sh '/tmp/it'\\''s $(x)/claude-bouncer/scripts/send-notify.sh' end")
  const win = buildHookCommand('C:\\Program Files\\Claude Bouncer\\resources\\app.asar.unpacked\\scripts\\send-notify.ps1', 'notification', 'win32')
  assert.ok(win.startsWith('powershell -NoProfile -ExecutionPolicy Bypass -File "C:'))
  assert.ok(isOurs(win))
})

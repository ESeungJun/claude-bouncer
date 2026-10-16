// Regression tests for the third review round.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { startServer, commandQueue } = require('../lib/server')
const { validSkin, resolveSkin } = require('../lib/skins')
const { requestSender } = require('../lib/request')
const { PET_ACTIONS } = require('../lib/actions')
const { JsonStore } = require('../lib/store')
const { readGitBranch } = require('../lib/sessions')

function req(port, { method = 'POST', path: p = '/notify', headers = {}, body = '{}' } = {}) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => resolve([res.statusCode, b]))
    })
    r.end(method === 'POST' ? body : undefined)
  })
}

test('a fake extension Origin no longer skips the token', async () => {
  const events = []
  const server = startServer({ onEvent: (d) => events.push(d), commands: commandQueue(), token: 'tok', port: 0 })
  await new Promise(r => server.once('listening', r))
  const { port } = server.address()
  const ext = { 'Content-Type': 'application/json', Origin: 'chrome-extension://abcdefghijklmnop' }
  try {
    assert.strictEqual((await req(port, { headers: ext, body: '{"kind":"stop"}' }))[0], 401)
    assert.strictEqual((await req(port, { method: 'GET', path: '/ext/next', headers: { Origin: ext.Origin } }))[0], 401)
    assert.strictEqual((await req(port, { path: '/ext/hello', headers: ext }))[0], 401)
    assert.strictEqual((await req(port, { headers: { ...ext, 'X-Claude-Bouncer-Token': 'tok' }, body: '{"kind":"stop","instance":"spoof"}' }))[0], 204)
    assert.strictEqual(events[0].source, 'web')
    assert.strictEqual(events[0].instance, '', 'instance comes from the header, never the body')
  } finally { server.close() }
})

test('focus commands go to the browser instance that owns the tab', async () => {
  const q = commandQueue()
  const a = q.wait(1000, 'instance-aaaaaaaa')
  const b = q.wait(1000, 'instance-bbbbbbbb')
  q.push({ type: 'focus', tabId: 1, instance: 'instance-bbbbbbbb' })
  assert.deepStrictEqual(await b, { type: 'focus', tabId: 1, instance: 'instance-bbbbbbbb' })
  // a newer poll from the same instance releases the older one (no busy loop)
  const a2 = q.wait(1000, 'instance-aaaaaaaa')
  assert.strictEqual(await a, null)
  a2.cancel()
  assert.strictEqual(q.waiting, 0)
})

test('validSkin refuses looks that would break drawing', () => {
  const row = ['#ff0000', null]
  assert.ok(validSkin({ type: 'sheet', w: 2, h: 2, frames: { idle: [row, row] } }))
  assert.ok(!validSkin({ type: 'sheet', w: 2, h: 2, frames: { idle: [] } }), 'empty idle frame')
  assert.ok(!validSkin({ type: 'sheet', w: 2, h: 2, frames: { idle: [row, ['#ff0000']] } }), 'ragged rows')
  assert.ok(!validSkin({ type: 'sheet', w: 2, h: 2, frames: { idle: [['red', null]] } }), 'not a hex colour')
  assert.ok(!validSkin({ type: 'sheet', w: 999, h: 2, frames: { idle: [row] } }), 'too big')
  assert.ok(!validSkin(null))
  const preset = (id) => (id === 'preset:cat' ? 'CAT' : null)
  assert.strictEqual(resolveSkin({ list: [], active: 'preset:cat' }, preset), 'CAT')
  assert.strictEqual(resolveSkin({ list: [{ id: 'x', skin: 'MINE' }], active: 'x' }, preset), 'MINE')
  assert.strictEqual(resolveSkin({ list: [], active: '' }, preset), null)
})

test('request sender: only success:true counts as delivered', async () => {
  let reply = { success: 'false', message: 'This form needs Activation.' }
  let now = 1e6
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => reply })
  const send = requestSender({ fetchImpl, now: () => now })
  const ok = { email: 'a@b.co', consent: true, photoJpeg: Buffer.from('jpg') }
  await assert.rejects(send(ok), /준비 중/)
  reply = { success: 'true' }
  assert.strictEqual(await send(ok), true)
  await assert.rejects(send(ok), /잠시 후/) // rate limit
  now += 61000
  await assert.rejects(send({ ...ok, email: 'nope' }), /이메일/)
  await assert.rejects(send({ ...ok, consent: false }), /동의/)
})

test('action ids are the same everywhere', () => {
  const overlay = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'overlay.js'), 'utf8')
  const panel = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'panel.html'), 'utf8')
  for (const a of PET_ACTIONS) assert.ok(overlay.includes(`'${a.id}'`) || overlay.includes(`${a.id}:`), `overlay handles ${a.id}`)
  for (const m of panel.matchAll(/data-act="([^"]+)"/g)) {
    if (m[1] === 'summon') continue
    assert.ok(PET_ACTIONS.some(a => a.id === m[1]), `panel action ${m[1]} is a known action`)
  }
})

test('a corrupt state file is kept aside, not silently overwritten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-corrupt-'))
  const file = path.join(dir, 'state.json')
  fs.writeFileSync(file, '{oops')
  const s = new JsonStore(file, { n: 1 })
  assert.strictEqual(s.data.n, 1)
  assert.ok(fs.readdirSync(dir).some(f => f.startsWith('state.json.corrupt-')))
  fs.rmSync(dir, { recursive: true })
})

test('git branch lookup ignores a FIFO named HEAD', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-fifo-'))
  fs.mkdirSync(path.join(dir, '.git'))
  require('child_process').execFileSync('mkfifo', [path.join(dir, '.git', 'HEAD')])
  assert.strictEqual(readGitBranch(dir), '')
  fs.rmSync(dir, { recursive: true })
})

test('hook installer keeps a symlinked settings.json a symlink', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-link-'))
  const home = os.homedir
  os.homedir = () => dir
  delete require.cache[require.resolve('../scripts/install-hook')]
  const { installClaudeHook } = require('../scripts/install-hook')
  try {
    fs.mkdirSync(path.join(dir, '.claude'))
    const real = path.join(dir, 'dotfiles-settings.json')
    fs.writeFileSync(real, '{}', { mode: 0o600 })
    fs.symlinkSync(real, path.join(dir, '.claude', 'settings.json'))
    installClaudeHook({ sendNotifyPath: '/x/claude-bouncer/scripts/send-notify.sh', platform: 'darwin' })
    assert.ok(fs.lstatSync(path.join(dir, '.claude', 'settings.json')).isSymbolicLink(), 'still a symlink')
    assert.ok(JSON.parse(fs.readFileSync(real, 'utf8')).hooks.Stop, 'hooks written to the real file')
    assert.strictEqual(fs.statSync(real).mode & 0o777, 0o600, 'permissions kept')
  } finally {
    os.homedir = home
    delete require.cache[require.resolve('../scripts/install-hook')]
    fs.rmSync(dir, { recursive: true })
  }
})

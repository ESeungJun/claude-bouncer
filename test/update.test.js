const test = require('node:test')
const assert = require('node:assert')
const { parseVersion, isNewer, releasePage, checkForUpdate } = require('../lib/update')

test('versions are compared number by number', () => {
  assert.deepStrictEqual(parseVersion('v0.3.10'), [0, 3, 10])
  assert.strictEqual(parseVersion('0.4.0-beta.1'), null)
  assert.strictEqual(isNewer('0.3.10', '0.3.9'), true)
  assert.strictEqual(isNewer('v1.0.0', '0.9.9'), true)
  assert.strictEqual(isNewer('0.3.1', '0.3.1'), false)
  assert.strictEqual(isNewer('0.3.0', '0.3.1'), false)
  assert.strictEqual(isNewer('garbage', '0.3.1'), false)
})

test('the download link is always on the repo releases page', () => {
  assert.strictEqual(releasePage('0.3.2'), 'https://github.com/ESeungJun/claude-bouncer/releases/tag/v0.3.2')
  assert.strictEqual(releasePage('https://evil.example'), 'https://github.com/ESeungJun/claude-bouncer/releases/latest')
})

const reply = (status, body) => async () => ({ ok: status === 200, status, json: async () => body })

test('checkForUpdate reads the latest release tag', async () => {
  assert.deepStrictEqual(await checkForUpdate('0.3.1', { fetchImpl: reply(200, { tag_name: 'v0.3.2' }) }), { latest: '0.3.2', newer: true })
  assert.deepStrictEqual(await checkForUpdate('0.3.2', { fetchImpl: reply(200, { tag_name: 'v0.3.2' }) }), { latest: '0.3.2', newer: false })
  await assert.rejects(checkForUpdate('0.3.1', { fetchImpl: reply(404, {}) }))
  await assert.rejects(checkForUpdate('0.3.1', { fetchImpl: reply(200, { tag_name: '<script>' }) }))
})

// ---------- in-app install ----------

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const { assetName, expectedSum, downloadUpdate, macBundle, cannotInstall, MAC_SWAP_SCRIPT } = require('../lib/update')

test('the installer file for each platform', () => {
  assert.strictEqual(assetName('0.3.2', 'darwin', 'arm64'), 'Claude-Bouncer-0.3.2-mac-arm64.zip')
  assert.strictEqual(assetName('v0.3.2', 'darwin', 'x64'), 'Claude-Bouncer-0.3.2-mac-x64.zip')
  assert.strictEqual(assetName('0.3.2', 'win32', 'x64'), 'Claude-Bouncer-0.3.2-win-setup.exe')
  assert.strictEqual(assetName('0.3.2', 'linux', 'x64'), null)
  assert.strictEqual(assetName('../../x', 'darwin', 'arm64'), null)
})

test('expectedSum reads sha256sum output', () => {
  const h = 'a'.repeat(64)
  const sums = `${'b'.repeat(64)}  other.zip\n${h}  Claude-Bouncer-0.3.2-mac-arm64.zip\n`
  assert.strictEqual(expectedSum(sums, 'Claude-Bouncer-0.3.2-mac-arm64.zip'), h)
  assert.strictEqual(expectedSum(`${h} *x.exe`, 'x.exe'), h)
  assert.strictEqual(expectedSum(sums, 'missing.zip'), null)
  assert.strictEqual(expectedSum('garbage', 'x'), null)
})

function fakeRelease(files) {
  const asked = []
  const fetchImpl = async (url) => {
    asked.push(url)
    const name = decodeURIComponent(url.split('/').pop())
    if (!(name in files)) return { ok: false, status: 404 }
    const buf = Buffer.from(files[name])
    return {
      ok: true, status: 200,
      headers: { get: (k) => (k === 'content-length' ? String(buf.length) : null) },
      text: async () => buf.toString(),
      body: new Blob([buf]).stream(),
    }
  }
  return { fetchImpl, asked }
}

test('downloadUpdate keeps the file only when its hash matches SHA256SUMS', async () => {
  const name = 'Claude-Bouncer-0.3.2-mac-arm64.zip'
  const data = 'zip bytes'
  const sha = crypto.createHash('sha256').update(data).digest('hex')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-update-test-'))
  try {
    const good = fakeRelease({ SHA256SUMS: `${sha}  ${name}\n`, [name]: data })
    const progress = []
    const file = await downloadUpdate('0.3.2', dir, { platform: 'darwin', arch: 'arm64', fetchImpl: good.fetchImpl, onProgress: (p) => progress.push(p) })
    assert.strictEqual(fs.readFileSync(file, 'utf8'), data)
    assert.strictEqual(progress.at(-1), 1)
    // URLs are built from the version, on the repo's releases
    assert.ok(good.asked.every(u => u.startsWith('https://github.com/ESeungJun/claude-bouncer/releases/download/v0.3.2/')))

    fs.rmSync(file)
    const bad = fakeRelease({ SHA256SUMS: `${'0'.repeat(64)}  ${name}\n`, [name]: data })
    await assert.rejects(downloadUpdate('0.3.2', dir, { platform: 'darwin', arch: 'arm64', fetchImpl: bad.fetchImpl }), /체크섬/)
    assert.ok(!fs.existsSync(path.join(dir, name)), 'a mismatching download is deleted')

    const unlisted = fakeRelease({ SHA256SUMS: '', [name]: data })
    await assert.rejects(downloadUpdate('0.3.2', dir, { platform: 'darwin', arch: 'arm64', fetchImpl: unlisted.fetchImpl }), /SHA256SUMS/)
    await assert.rejects(downloadUpdate('0.3.2', dir, { platform: 'linux', fetchImpl: good.fetchImpl }))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('cannotInstall explains when this copy can not replace itself', () => {
  const exe = '/Applications/Claude Bouncer.app/Contents/MacOS/Claude Bouncer'
  assert.strictEqual(macBundle(exe), '/Applications/Claude Bouncer.app')
  const yes = () => true
  assert.strictEqual(cannotInstall({ packaged: true, platform: 'darwin', execPath: exe, writable: yes }), '')
  assert.strictEqual(cannotInstall({ packaged: true, platform: 'win32', execPath: 'C:\\x.exe', writable: yes }), '')
  assert.match(cannotInstall({ packaged: false, platform: 'darwin', execPath: exe, writable: yes }), /소스/)
  assert.match(cannotInstall({ packaged: true, platform: 'darwin', execPath: exe, writable: () => false }), /권한/)
  assert.match(cannotInstall({ packaged: true, platform: 'darwin', execPath: '/private/var/folders/x/AppTranslocation/y/d/Claude Bouncer.app/Contents/MacOS/Claude Bouncer', writable: yes }), /응용 프로그램/)
  assert.match(cannotInstall({ packaged: true, platform: 'darwin', execPath: '/Volumes/Claude Bouncer/Claude Bouncer.app/Contents/MacOS/Claude Bouncer', writable: yes }), /응용 프로그램/)
  assert.match(cannotInstall({ packaged: true, platform: 'linux', execPath: '/opt/x', writable: yes }), /지원/)
})

test('the macOS swap script replaces the bundle and reopens it', { skip: process.platform !== 'darwin' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-swap-test-'))
  try {
    // paths with a quote and a $ must reach the script as plain arguments
    const target = path.join(root, `Apps "$HOME"`, 'Claude Bouncer.app')
    const work = path.join(root, 'work')
    const newApp = path.join(work, 'unpacked', 'Claude Bouncer.app')
    fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, 'v'), 'old')
    fs.mkdirSync(newApp, { recursive: true }); fs.writeFileSync(path.join(newApp, 'v'), 'new')
    const bin = path.join(root, 'bin')
    fs.mkdirSync(bin)
    fs.writeFileSync(path.join(bin, 'open'), `#!/bin/sh\nprintf '%s' "$1" > "${path.join(root, 'opened')}"\n`, { mode: 0o755 })
    const script = path.join(root, 'swap.sh')
    fs.writeFileSync(script, MAC_SWAP_SCRIPT)
    // pid 999999 is not running, so it swaps right away
    execFileSync('/bin/sh', [script, '999999', target, newApp, work], { env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` } })
    assert.strictEqual(fs.readFileSync(path.join(target, 'v'), 'utf8'), 'new')
    assert.ok(!fs.existsSync(`${target}.old`))
    assert.ok(!fs.existsSync(work), 'download folder removed')
    assert.strictEqual(fs.readFileSync(path.join(root, 'opened'), 'utf8'), target)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('a download that stops sending data gives up; a slow one does not', async () => {
  const name = 'Claude-Bouncer-0.3.2-mac-arm64.zip'
  const chunks = ['a', 'b', 'c']
  const sha = crypto.createHash('sha256').update(chunks.join('')).digest('hex')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-update-stall-'))
  // sends `chunks` every `gapMs`, then hangs if `hang`
  const release = (gapMs, hang) => async (url, opts) => {
    if (url.endsWith('SHA256SUMS')) return { ok: true, status: 200, text: async () => `${sha}  ${name}\n` }
    const body = new ReadableStream({
      async start(c) {
        opts.signal.addEventListener('abort', () => c.error(new Error('aborted')))
        for (const x of chunks) { await new Promise(r => setTimeout(r, gapMs)); if (opts.signal.aborted) return; c.enqueue(Buffer.from(x)) }
        if (!hang) c.close()
      },
    })
    return { ok: true, status: 200, headers: { get: () => null }, body }
  }
  try {
    const opts = { platform: 'darwin', arch: 'arm64', stallMs: 80 }
    // 3 × 50ms is longer than stallMs overall, but never 80ms without data
    assert.ok(await downloadUpdate('0.3.2', dir, { ...opts, fetchImpl: release(50, false) }))
    await assert.rejects(downloadUpdate('0.3.2', dir, { ...opts, fetchImpl: release(10, true) }), /멈췄어요/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

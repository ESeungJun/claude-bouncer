// "Is there a newer version?" — asks GitHub for the latest published release,
// and installs it in place. The builds are only ad-hoc signed, so Squirrel
// (electron-updater) is out; instead the installer for this OS / chip is
// downloaded, checked against the release's SHA256SUMS and swapped in:
//   macOS   — unzip, then a detached sh script replaces the .app once we quit
//   Windows — run the NSIS installer silently, which restarts the app

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')

const REPO = 'ESeungJun/claude-bouncer'
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`

// '0.3.1' / 'v0.3.1' → [0, 3, 1]; anything else (pre-releases included) → null
function parseVersion(v) {
  const m = /^v?(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/.exec(String(v ?? '').trim())
  return m ? m.slice(1).map(Number) : null
}

function isNewer(latest, current) {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

// built from the checked version, never from a URL in the response
function releasePage(version) {
  return parseVersion(version)
    ? `https://github.com/${REPO}/releases/tag/v${parseVersion(version).join('.')}`
    : `https://github.com/${REPO}/releases/latest`
}

// → { latest: '0.3.2', newer: true }; throws on network / API errors
async function checkForUpdate(current, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const res = await fetchImpl(API_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'claude-bouncer' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`GitHub ${res.status}`)
  const body = await res.json()
  const v = parseVersion(body?.tag_name)
  if (!v) throw new Error('unexpected release tag')
  const latest = v.join('.')
  return { latest, newer: isNewer(latest, current) }
}

// ---------- download + verify ----------

// the release file this platform installs from (names come from package.json build.*.artifactName)
function assetName(version, platform = process.platform, arch = process.arch) {
  const v = parseVersion(version)
  if (!v) return null
  if (platform === 'darwin') return `Claude-Bouncer-${v.join('.')}-mac-${arch === 'arm64' ? 'arm64' : 'x64'}.zip`
  if (platform === 'win32') return `Claude-Bouncer-${v.join('.')}-win-setup.exe`
  return null
}

function downloadUrl(version, name) {
  return `https://github.com/${REPO}/releases/download/v${parseVersion(version).join('.')}/${encodeURIComponent(name)}`
}

// the hash listed for `name` in a `sha256sum` output, or null
function expectedSum(sums, name) {
  for (const line of String(sums || '').split('\n')) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim())
    if (m && m[2] === name) return m[1].toLowerCase()
  }
  return null
}

// Downloads the installer for `version` into `dir` and checks it against the
// release's SHA256SUMS. Resolves to the file path; throws (and deletes the
// file) on any mismatch. onProgress(fraction 0..1)
async function downloadUpdate(version, dir, { platform = process.platform, arch = process.arch, fetchImpl = fetch, onProgress = () => {}, stallMs = 60000 } = {}) {
  const name = assetName(version, platform, arch)
  if (!name) throw new Error('이 운영체제용 설치 파일이 없어요')
  const headers = { 'User-Agent': 'claude-bouncer' }

  const sumsRes = await fetchImpl(downloadUrl(version, 'SHA256SUMS'), { headers, signal: AbortSignal.timeout(15000) })
  if (!sumsRes.ok) throw new Error(`SHA256SUMS를 받지 못했어요 (${sumsRes.status})`)
  const expected = expectedSum(await sumsRes.text(), name)
  if (!expected) throw new Error(`SHA256SUMS에 ${name}이 없어요`)

  // a slow line is fine; only give up when nothing arrives for stallMs
  const stall = new AbortController()
  let timer = setTimeout(() => stall.abort(), stallMs)
  const alive = () => { clearTimeout(timer); timer = setTimeout(() => stall.abort(), stallMs) }
  try {
    return await fetchAndCheck(fetchImpl, downloadUrl(version, name), { headers, signal: stall.signal }, path.join(dir, name), expected, alive, onProgress)
  } catch (e) {
    if (stall.signal.aborted) throw new Error('다운로드가 멈췄어요. 인터넷 연결을 확인해 주세요')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

async function fetchAndCheck(fetchImpl, url, opts, file, expected, alive, onProgress) {
  const res = await fetchImpl(url, opts)
  if (!res.ok || !res.body) throw new Error(`다운로드에 실패했어요 (${res.status})`)
  const total = Number(res.headers.get('content-length')) || 0
  const hash = crypto.createHash('sha256')
  let got = 0
  const body = Readable.fromWeb(res.body)
  body.on('data', (c) => {
    alive()
    hash.update(c)
    got += c.length
    if (total) onProgress(Math.min(got / total, 1))
  })
  await pipeline(body, fs.createWriteStream(file))
  if (hash.digest('hex') !== expected) {
    fs.rmSync(file, { force: true })
    throw new Error('받은 파일이 릴리즈 체크섬과 달라서 설치하지 않았어요')
  }
  return file
}

// ---------- swap in (macOS) ----------

// Runs detached after the app quits: wait for our pid, replace the bundle
// (restoring the old one if the copy fails), reopen it, clean up. Paths come
// in as arguments, never pasted into the script text.
const MAC_SWAP_SCRIPT = `#!/bin/sh
pid="$1"; target="$2"; new="$3"; dir="$4"
echo "[$(date)] update: $new -> $target"
while kill -0 "$pid" 2>/dev/null; do sleep 0.3; done
if mv "$target" "$target.old"; then
  if ditto "$new" "$target"; then
    rm -rf "$target.old"
  else
    echo "copy failed, restoring"; rm -rf "$target"; mv "$target.old" "$target"
  fi
fi
xattr -dr com.apple.quarantine "$target" 2>/dev/null
open "$target"
rm -rf "$dir"
`

// The running .app (…/Claude Bouncer.app) from the executable path
function macBundle(execPath = process.execPath) {
  return path.resolve(path.dirname(execPath), '..', '..')
}

// Why this copy can't replace itself, or '' when it can.
function cannotInstall({ packaged, platform = process.platform, execPath = process.execPath, writable }) {
  if (!packaged) return '소스로 실행 중이라 자동 설치를 하지 않아요 (git pull 후 다시 실행)'
  if (platform === 'win32') return ''
  if (platform !== 'darwin') return '이 운영체제는 자동 설치를 지원하지 않아요'
  const bundle = macBundle(execPath)
  if (!bundle.endsWith('.app')) return '앱 위치를 알 수 없어요'
  // opened straight from Downloads / the dmg: macOS runs it from a read-only copy
  if (bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')) {
    return '앱을 응용 프로그램 폴더로 옮긴 뒤 다시 실행해야 자동 설치할 수 있어요'
  }
  if (!writable(path.dirname(bundle))) return `${path.dirname(bundle)} 폴더에 쓸 권한이 없어요`
  return ''
}

module.exports = {
  parseVersion, isNewer, releasePage, checkForUpdate,
  assetName, expectedSum, downloadUpdate, macBundle, cannotInstall, MAC_SWAP_SCRIPT,
}

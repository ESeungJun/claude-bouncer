// "Is there a newer version?" — asks GitHub for the latest published release.
// No auto-install: the builds are unsigned, so we only point to the download page.

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

module.exports = { parseVersion, isNewer, releasePage, checkForUpdate }

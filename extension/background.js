// Forwards claude.ai events to the Claude Bouncer app (http://127.0.0.1:17891)
// and listens for "bring this tab back" requests from it.

const APP = 'http://127.0.0.1:17891'
// one id per running browser (profile), so the app sends "show this tab"
// to the browser that actually has the tab
const INSTANCE = crypto.randomUUID()

// The app writes its token into this folder (token.json) when it copies the
// extension; every request carries it.
let tokenPromise = null
function token() {
  if (!tokenPromise) {
    tokenPromise = fetch(chrome.runtime.getURL('token.json'))
      .then(r => r.json()).then(j => String(j.token || ''))
      .catch(() => { tokenPromise = null; return '' })
  }
  return tokenPromise
}
async function headers(extra = {}) {
  return { 'X-Claude-Bouncer-Token': await token(), 'X-CB-Instance': INSTANCE, ...extra }
}

function browserName() {
  const brands = (navigator.userAgentData?.brands || []).map(b => b.brand)
  return ['Microsoft Edge', 'Brave', 'Opera', 'Vivaldi', 'Google Chrome', 'Chromium'].find(b => brands.includes(b)) || 'Chrome'
}

async function post(path, body) {
  try {
    await fetch(APP + path, {
      method: 'POST',
      headers: await headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })
    return true
  } catch { return false } // app not running — that's fine
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!sender.tab || !msg || !['submit', 'stop', 'end'].includes(msg.kind)) return
  post('/notify', {
    kind: msg.kind,
    source: 'web',
    session_id: 'web:' + (msg.sessionKey || msg.conversationId || sender.tab.id),
    title: msg.title,
    url: msg.url,
    prompt: msg.prompt,
    last_assistant_message: msg.kind === 'stop' ? msg.summary : undefined,
    visible: !!msg.visible,
    browser: browserName(),
    tab_id: sender.tab.id,
    window_id: sender.tab.windowId,
  })
})

chrome.runtime.onConnect.addListener((port) => {
  port.onMessage.addListener(() => {}) // pings keep this worker alive
  startPolling()
})

// Long-poll the app for focus requests (card clicked → show this tab).
let polling = false
async function startPolling() {
  if (polling) return
  polling = true
  post('/ext/hello', { browser: browserName() })
  while (polling) {
    try {
      const res = await fetch(APP + '/ext/next', { headers: await headers() })
      if (res.status === 200) {
        const cmd = await res.json()
        if (cmd.type === 'focus' && Number.isInteger(cmd.tabId)) {
          const tab = await chrome.tabs.update(cmd.tabId, { active: true }).catch(() => null)
          if (tab) {
            if (Number.isInteger(cmd.windowId)) await chrome.windows.update(cmd.windowId, { focused: true }).catch(() => {})
          } else if (/^https:\/\/claude\.ai\//.test(cmd.url || '')) {
            // the tab is gone: open the conversation again
            await chrome.tabs.create({ url: cmd.url }).catch(() => {})
          }
        }
      } else if (res.status === 401) {
        tokenPromise = null // the app was reinstalled / token changed: re-read it
        await new Promise(r => setTimeout(r, 5000))
      } else if (res.status !== 204) {
        await new Promise(r => setTimeout(r, 5000))
      }
    } catch {
      await new Promise(r => setTimeout(r, 5000)) // app not running
    }
  }
}

chrome.runtime.onStartup.addListener(startPolling)
chrome.runtime.onInstalled.addListener(startPolling)
startPolling()

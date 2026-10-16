// Watches claude.ai for "Claude started answering" / "Claude finished answering"
// and hands those moments to the background worker, which forwards them to the
// Claude Bouncer app on this computer. Nothing leaves your machine.

const STREAMING = '[data-testid="assistant-message"][data-is-streaming="true"], [data-perf-row-streaming="true"]'
const SETTLE_MS = 1200 // streaming has to stay off this long before we call it done

let streaming = false
let offSince = 0
let promptAtStart = ''

const clip = (s, n = 300) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)

function lastText(selector) {
  const all = document.querySelectorAll(selector)
  return all.length ? clip(all[all.length - 1].innerText) : ''
}

function conversation() {
  const m = /\/chat\/([0-9a-f-]{8,})/i.exec(location.pathname)
  return {
    id: m ? m[1] : '',
    title: document.title.replace(/\s*[-–]\s*Claude\s*$/, '').trim() || '새 채팅',
    url: location.href,
  }
}

function send(kind, extra = {}) {
  const c = conversation()
  try {
    chrome.runtime.sendMessage({
      kind,
      conversationId: c.id,
      title: c.title,
      url: c.url,
      visible: !document.hidden && document.hasFocus(),
      ...extra,
    })
  } catch { /* extension reloaded; the page will pick up the new one on refresh */ }
}

function check() {
  const now = !!document.querySelector(STREAMING)
  if (now && !streaming) {
    streaming = true
    offSince = 0
    promptAtStart = lastText('[data-testid="user-message"]')
    send('submit', { prompt: promptAtStart })
  } else if (!now && streaming) {
    if (!offSince) offSince = Date.now()
    if (Date.now() - offSince >= SETTLE_MS) {
      streaming = false
      offSince = 0
      send('stop', { prompt: promptAtStart, summary: lastText('[data-testid="assistant-message"]') })
    }
  } else if (now) {
    offSince = 0
  }
}

new MutationObserver(check).observe(document.documentElement, {
  subtree: true, attributes: true, childList: true, attributeFilter: ['data-is-streaming', 'data-perf-row-streaming'],
})
setInterval(check, 700)

// Keep the background worker awake while claude.ai is open, so clicking a card
// in the app can bring this tab back right away.
let port = null
function keepAlive() {
  try {
    port = chrome.runtime.connect({ name: 'claude-tab' })
    port.onDisconnect.addListener(() => setTimeout(keepAlive, 1000))
  } catch { /* extension gone */ }
}
keepAlive()
setInterval(() => { try { port?.postMessage({ ping: Date.now() }) } catch {} }, 20000)

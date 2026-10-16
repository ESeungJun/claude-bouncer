// Localhost receiver for hook events.
//
// Only accepts JSON bodies and rejects anything carrying a web page Origin, so
// a site in the browser can't POST fake notifications to 127.0.0.1 (a
// cross-origin JSON POST needs a CORS preflight, which we never answer).
// Our browser extension is allowed: its Origin is chrome-extension://…, which
// no web page can fake.
//
// Extension endpoints:
//   POST /ext/hello  — the claude.ai extension is installed and running
//   GET  /ext/next   — long-poll for "focus this tab" commands

const http = require('http')

const PORT = 17891
const BODY_MAX = 2_000_000

const EXT_ORIGIN = /^(chrome|moz|safari-web)-extension:\/\/[a-z0-9-]+$/i
const POLL_MS = 25000

function startServer({ onEvent, onHello = () => {}, commands = null, port = PORT, host = '127.0.0.1' }) {
  const server = http.createServer((req, res) => {
    const origin = req.headers.origin
    const fromExtension = !!origin && EXT_ORIGIN.test(origin)
    if (origin && !fromExtension) { res.writeHead(403); res.end(); return }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok')
      return
    }
    if (req.method === 'GET' && req.url === '/ext/next') {
      if (!fromExtension || !commands) { res.writeHead(403); res.end(); return }
      onHello({ polling: true })
      commands.wait(POLL_MS).then((cmd) => {
        // the extension went away mid-poll: keep the command for the next poll
        if (res.writableEnded || res.destroyed) { if (cmd) commands.requeue(cmd); return }
        if (cmd) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(cmd)) }
        else { res.writeHead(204); res.end() }
      })
      return
    }
    const route = req.url === '/notify' ? 'notify' : req.url === '/ext/hello' ? 'hello' : null
    if (req.method !== 'POST' || !route || (route === 'hello' && !fromExtension)) {
      res.writeHead(404); res.end(); return
    }
    const type = String(req.headers['content-type'] || '')
    if (!type.startsWith('application/json')) {
      res.writeHead(403); res.end(); return
    }
    let body = ''
    let tooBig = false
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > BODY_MAX) { tooBig = true; req.destroy() }
    })
    req.on('end', () => {
      if (tooBig) return
      let data = null
      try { data = JSON.parse(body || '{}') } catch { /* fallthrough */ }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        res.writeHead(400); res.end(); return
      }
      res.writeHead(204); res.end()
      try {
        if (route === 'hello') onHello(data)
        else onEvent(fromExtension ? { ...data, source: 'web' } : data)
      } catch (e) { console.error('[claude-bouncer] event error:', e) }
    })
  })
  server.on('error', (err) => {
    console.error('[claude-bouncer] server error:', err.message)
  })
  server.listen(port, host, () => {
    console.log(`[claude-bouncer] listening on ${host}:${server.address().port}`)
  })
  return server
}

// A tiny queue the long-poll endpoint waits on.
function commandQueue() {
  const queue = []
  const waiters = []
  return {
    push(cmd) {
      const w = waiters.shift()
      if (w) w(cmd); else { queue.push(cmd); if (queue.length > 10) queue.shift() }
    },
    wait(ms) {
      if (queue.length) return Promise.resolve(queue.shift())
      return new Promise((resolve) => {
        const done = (cmd) => { clearTimeout(t); resolve(cmd) }
        const t = setTimeout(() => { const i = waiters.indexOf(done); if (i >= 0) waiters.splice(i, 1); resolve(null) }, ms)
        waiters.push(done)
      })
    },
    requeue(cmd) { queue.unshift(cmd) },
    get waiting() { return waiters.length },
  }
}

module.exports = { startServer, commandQueue, PORT }

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
const crypto = require('crypto')

const PORT = 17891
const BODY_MAX = 2_000_000

const EXT_ORIGIN = /^(chrome|moz|safari-web)-extension:\/\/[a-z0-9-]+$/i
const POLL_MS = 25000

// Terminal info the hook scripts send as headers → payload fields.
const HOOK_HEADERS = {
  'x-cb-kind': 'kind',
  'x-cb-term-program': 'term_program',
  'x-cb-term-session': 'term_session_id',
  'x-cb-bundle-id': 'bundle_id',
  'x-cb-terminal-emulator': 'terminal_emulator',
  'x-cb-wt-session': 'wt_session',
  'x-cb-tmux': 'tmux',
  'x-cb-tmux-pane': 'tmux_pane',
  'x-cb-orca-pane': 'orca_pane',
  'x-cb-orca-tab': 'orca_tab',
  'x-cb-tty': 'tty',
}
// What the claude.ai extension may report.
const WEB_FIELDS = ['kind', 'session_id', 'title', 'url', 'prompt', 'last_assistant_message', 'visible', 'browser', 'tab_id', 'window_id']

function sameToken(a, b) {
  const x = Buffer.from(String(a || ''))
  const y = Buffer.from(String(b || ''))
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y)
}

// token: shared secret the hook scripts read from ~/.claude/claude-bouncer.token.
// Without it any local process could inject cards. (null = no check, for tests.)
function startServer({ onEvent, onHello = () => {}, commands = null, token = null, port = PORT, host = '127.0.0.1' }) {
  const server = http.createServer((req, res) => {
    const origin = req.headers.origin
    const fromExtension = !!origin && EXT_ORIGIN.test(origin)
    if (origin && !fromExtension) { res.writeHead(403); res.end(); return }
    // DNS rebinding: only answer requests addressed to the loopback host
    const hostHeader = String(req.headers.host || '').replace(/:\d+$/, '')
    if (hostHeader && !['127.0.0.1', 'localhost', '[::1]'].includes(hostHeader)) { res.writeHead(403); res.end(); return }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok')
      return
    }
    if (req.method === 'GET' && req.url === '/ext/next') {
      if (!fromExtension || !commands) { res.writeHead(403); res.end(); return }
      onHello({ polling: true })
      const pending = commands.wait(POLL_MS)
      res.on('close', () => { if (!res.writableEnded) pending.cancel() })
      pending.then((cmd) => {
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
    if (route === 'notify' && !fromExtension && token && !sameToken(req.headers['x-claude-bouncer-token'], token)) {
      res.writeHead(401); res.end(); return
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
        else if (fromExtension) {
          // the extension can only report claude.ai chats
          if (!['submit', 'stop'].includes(data.kind)) return
          const web = { source: 'web' }
          for (const k of WEB_FIELDS) if (data[k] !== undefined) web[k] = data[k]
          onEvent(web)
        } else {
          const hook = { ...data }
          delete hook.source // only the extension speaks for claude.ai
          for (const [h, field] of Object.entries(HOOK_HEADERS)) {
            const v = req.headers[h]
            if (typeof v === 'string' && v) hook[field] = v.slice(0, 300)
          }
          onEvent(hook)
        }
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
    // → promise of the next command (or null on timeout) with .cancel()
    wait(ms) {
      if (queue.length) { const p = Promise.resolve(queue.shift()); p.cancel = () => {}; return p }
      while (waiters.length >= 2) waiters[0](null) // keep only the newest polls
      let done
      const p = new Promise((resolve) => {
        const t = setTimeout(() => finish(null), ms)
        const finish = (cmd) => {
          clearTimeout(t)
          const i = waiters.indexOf(done)
          if (i >= 0) waiters.splice(i, 1)
          resolve(cmd)
        }
        done = finish
        waiters.push(done)
      })
      p.cancel = () => done(null)
      return p
    },
    requeue(cmd) {
      const w = waiters.shift()
      if (w) w(cmd); else queue.unshift(cmd)
    },
    get waiting() { return waiters.length },
  }
}

module.exports = { startServer, commandQueue, PORT }

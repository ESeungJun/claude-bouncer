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
const SAFE_INSTANCE = /^[A-Za-z0-9-]{8,64}$/

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
    // Every route except /health needs the token. The browser extension
    // reads it from the token.json the app writes into its folder; the
    // Origin header alone proves nothing (any local program can set it).
    const authed = !token || sameToken(req.headers['x-claude-bouncer-token'], token)
    const instance = SAFE_INSTANCE.test(String(req.headers['x-cb-instance'] || '')) ? String(req.headers['x-cb-instance']) : ''

    if (req.method === 'GET' && req.url === '/ext/next') {
      if (!fromExtension || !commands) { res.writeHead(403); res.end(); return }
      if (!authed) { res.writeHead(401); res.end(); return }
      onHello({ polling: true, instance })
      const pending = commands.wait(POLL_MS, instance)
      res.on('close', () => { if (!res.writableEnded) pending.cancel() })
      pending.then((cmd) => {
        // the extension went away mid-poll: keep the command for the next poll
        if (res.writableEnded || res.destroyed) { if (cmd) commands.requeue(cmd, instance); return }
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
    if (!authed) { res.writeHead(401); res.end(); return }
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
        if (route === 'hello') onHello({ ...data, instance })
        else if (fromExtension) {
          // the extension can only report claude.ai chats
          if (!['submit', 'stop', 'end'].includes(data.kind)) return
          const web = { source: 'web', instance }
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
// Focus commands, per browser-extension instance (each browser/profile that
// has the extension polls with its own random id). Each instance keeps one
// open long-poll; a newer poll from the same instance replaces the older one.
function commandQueue() {
  const queues = new Map() // instance → [cmd]
  const waiters = new Map() // instance → finish(cmd|null)
  const key = (i) => String(i || '-')
  return {
    push(cmd, instance = cmd && cmd.instance) {
      const k = key(instance)
      const w = waiters.get(k)
      if (w) return w(cmd)
      const q = queues.get(k) || []
      q.push(cmd)
      if (q.length > 10) q.shift()
      queues.set(k, q)
    },
    // → promise of the next command for this instance (or null on timeout) with .cancel()
    wait(ms, instance) {
      const k = key(instance)
      const q = queues.get(k)
      if (q && q.length) { const p = Promise.resolve(q.shift()); p.cancel = () => {}; return p }
      const old = waiters.get(k)
      if (old) old(null) // the same instance re-polled: release its older poll
      let done
      const p = new Promise((resolve) => {
        const t = setTimeout(() => done(null), ms)
        done = (cmd) => {
          clearTimeout(t)
          if (waiters.get(k) === done) waiters.delete(k)
          resolve(cmd)
        }
        waiters.set(k, done)
      })
      p.cancel = () => done(null)
      return p
    },
    requeue(cmd, instance = cmd && cmd.instance) {
      const k = key(instance)
      const w = waiters.get(k)
      if (w) return w(cmd)
      queues.set(k, [cmd, ...(queues.get(k) || [])])
    },
    get waiting() { return waiters.size },
    isWaiting(instance) { return waiters.has(key(instance)) },
  }
}

module.exports = { startServer, commandQueue, PORT }

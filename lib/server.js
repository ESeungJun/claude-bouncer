// Localhost receiver for hook events.
//
// Only accepts JSON bodies and rejects anything carrying an Origin header, so
// a web page in the browser can't POST fake notifications to 127.0.0.1
// (a cross-origin JSON POST needs a CORS preflight, which we never answer).

const http = require('http')

const PORT = 17891
const BODY_MAX = 2_000_000

function startServer({ onEvent, port = PORT, host = '127.0.0.1' }) {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok')
      return
    }
    if (req.method !== 'POST' || req.url !== '/notify') {
      res.writeHead(404); res.end(); return
    }
    const type = String(req.headers['content-type'] || '')
    if (req.headers.origin || !type.startsWith('application/json')) {
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
      try { onEvent(data) } catch (e) { console.error('[claude-bouncer] event error:', e) }
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

module.exports = { startServer, PORT }

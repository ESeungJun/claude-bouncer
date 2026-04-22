#!/usr/bin/env node
// Cross-platform hook dispatcher. Claude Code invokes this via `node send-notify.js <kind>`.
// Reads the hook JSON payload from stdin, merges in terminal/session env vars,
// and POSTs to the running claude-bouncer app. Silent on failure so a missing
// app never breaks a Claude session.

const http = require('http')

const PORT = 17891
const HOST = '127.0.0.1'
const TIMEOUT_MS = 2000

const kind = process.argv[2] === 'notification' ? 'notification' : 'stop'

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  raw += chunk
  if (raw.length > 1_000_000) process.exit(0)
})
process.stdin.on('end', () => send())
process.stdin.on('error', () => process.exit(0))

// If no stdin is piped (e.g. manual test), end on its own after a tick.
setTimeout(() => { if (!raw) send() }, 50)

let sent = false
function send() {
  if (sent) return
  sent = true

  let data = {}
  try { data = raw ? JSON.parse(raw) : {} } catch { data = {} }

  const termSid = process.env.TERM_SESSION_ID || process.env.ITERM_SESSION_ID || ''
  const payload = Object.assign({}, data, {
    kind,
    term_program: process.env.TERM_PROGRAM || '',
    term_session_id: termSid,
    tmux: process.env.TMUX || '',
    ppid: process.env.PPID || '',
  })

  const body = JSON.stringify(payload)
  const req = http.request({
    hostname: HOST,
    port: PORT,
    path: '/notify',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    timeout: TIMEOUT_MS,
  }, (res) => { res.resume() })

  req.on('error', () => process.exit(0))
  req.on('timeout', () => { req.destroy(); process.exit(0) })
  req.write(body)
  req.end()
}

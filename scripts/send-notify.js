#!/usr/bin/env node
// Cross-platform hook dispatcher. Claude Code invokes this as
// `node send-notify.js <stop|notification|submit|end>`.
// Reads the hook JSON payload from stdin, adds where-is-this-terminal info
// (terminal app, tab tty, tmux pane) and POSTs it to the running app.
// Prints nothing and always exits 0 so it can never disturb a Claude session.

const http = require('http')
const { execFileSync } = require('child_process')

const PORT = Number(process.env.CLAUDE_BOUNCER_PORT) || 17891
const HOST = '127.0.0.1'
const TIMEOUT_MS = 1500
const KINDS = ['stop', 'notification', 'submit', 'end']

const kind = KINDS.includes(process.argv[2]) ? process.argv[2] : 'stop'

// The tty Claude Code runs on identifies the exact terminal tab. The hook's
// own shell may be detached from it, so walk up a few parents until one has it.
function controllingTty() {
  if (process.platform === 'win32') return ''
  let pid = process.ppid
  for (let i = 0; i < 5 && pid > 1; i++) {
    try {
      const out = execFileSync('ps', ['-o', 'tty=,ppid=', '-p', String(pid)], {
        encoding: 'utf8', timeout: 500, stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      const [tty, parent] = out.split(/\s+/)
      if (tty && tty !== '??' && tty !== '?') return tty.startsWith('/dev/') ? tty : `/dev/${tty}`
      pid = Number(parent)
    } catch { return '' }
  }
  return ''
}

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  raw += chunk
  if (raw.length > 2_000_000) process.exit(0)
})
process.stdin.on('end', () => send())
process.stdin.on('error', () => process.exit(0))
// Run by hand in a terminal (stdin is a TTY, nothing piped) → send right away.
// When Claude Code pipes the payload we always wait for 'end', even if it's slow.
if (process.stdin.isTTY) send()
// Hard stop: never hang a Claude turn.
setTimeout(() => process.exit(0), 3000).unref()

let sent = false
function send() {
  if (sent) return
  sent = true

  let data = {}
  try { data = raw ? JSON.parse(raw) : {} } catch { data = {} }

  const env = process.env
  const payload = Object.assign({}, data, {
    kind,
    term_program: env.TERM_PROGRAM || '',
    term_session_id: env.ITERM_SESSION_ID || env.TERM_SESSION_ID || '',
    bundle_id: env.__CFBundleIdentifier || '',
    terminal_emulator: env.TERMINAL_EMULATOR || '',
    wt_session: env.WT_SESSION || '',
    tmux: env.TMUX || '',
    tmux_pane: env.TMUX_PANE || '',
    // the tab's tty only matters for cards (stop / notification); the app keeps
    // the last one per session, so prompt submits stay fast
    tty: kind === 'stop' || kind === 'notification' ? controllingTty() : '',
  })
  // The prompt text is only needed for submit events; keep other payloads small.
  if (kind !== 'submit') delete payload.prompt

  const body = JSON.stringify(payload)
  const req = http.request({
    hostname: HOST,
    port: PORT,
    path: '/notify',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-Claude-Bouncer': '1',
    },
    timeout: TIMEOUT_MS,
  }, (res) => { res.resume(); res.on('end', () => process.exit(0)) })

  req.on('error', () => process.exit(0))
  req.on('timeout', () => { req.destroy(); process.exit(0) })
  req.write(body)
  req.end()
}

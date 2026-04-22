#!/usr/bin/env node
// Idempotently install (or remove) the Stop hook that POSTs to claude-bouncer.
// Usage:
//   node scripts/install-hook.js             # install
//   node scripts/install-hook.js --uninstall # remove

const fs = require('fs')
const path = require('path')
const os = require('os')

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
const MARKER = '127.0.0.1:17891/notify'

// Enrich the hook JSON with terminal info ($TERM_PROGRAM, session id, tmux, ppid)
// so the app can tell apart multiple terminals sitting in the same cwd.
// `kind` tells the UI whether this is a finish ("stop") or a blocking prompt
// ("notification" — Claude is waiting on the user for permission/input).
// jq --arg treats unset env vars as "". curl -m 2 caps the request at 2s.
// || true so the hook never fails a Claude session, even if the app isn't running.
function buildHookCommand(kind) {
  return (
    `jq -c ` +
    `--arg kind "${kind}" ` +
    `--arg tp "$TERM_PROGRAM" ` +
    `--arg tsid "$TERM_SESSION_ID" ` +
    `--arg itsid "$ITERM_SESSION_ID" ` +
    `--arg tmux "$TMUX" ` +
    `--arg ppid "$PPID" ` +
    `'. + {kind: $kind, term_program: $tp, term_session_id: (if $tsid != "" then $tsid else $itsid end), tmux: $tmux, ppid: $ppid}' ` +
    `2>/dev/null | ` +
    `curl -sS -m 2 -X POST -H 'Content-Type: application/json' ` +
    `--data-binary @- http://${MARKER} >/dev/null 2>&1 || true`
  )
}

// Map of hook event name -> command; re-run this script to update both.
const HOOKS = {
  Stop: buildHookCommand('stop'),
  Notification: buildHookCommand('notification'),
}

const uninstall = process.argv.includes('--uninstall')

let settings = {}
if (fs.existsSync(settingsPath)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) || {}
  } catch (e) {
    console.error(`Failed to parse ${settingsPath}: ${e.message}`)
    process.exit(1)
  }
}

settings.hooks = settings.hooks || {}
let totalRemoved = 0

for (const eventName of Object.keys(HOOKS)) {
  const current = Array.isArray(settings.hooks[eventName]) ? settings.hooks[eventName] : []
  const before = current.length
  // strip any previous claude-bouncer entry so re-running is safe
  const cleaned = current.filter(group => {
    const cmds = Array.isArray(group?.hooks) ? group.hooks : []
    return !cmds.some(h => typeof h?.command === 'string' && h.command.includes(MARKER))
  })
  totalRemoved += before - cleaned.length

  if (!uninstall) {
    cleaned.push({
      matcher: '',
      hooks: [{ type: 'command', command: HOOKS[eventName] }],
    })
  }

  if (cleaned.length === 0) delete settings.hooks[eventName]
  else settings.hooks[eventName] = cleaned
}

if (Object.keys(settings.hooks).length === 0) delete settings.hooks

fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')

if (uninstall) {
  console.log(`Removed ${totalRemoved} claude-bouncer hook(s) from ${settingsPath}`)
} else {
  console.log(`Installed hooks: ${Object.keys(HOOKS).join(', ')} → ${settingsPath}`)
  if (totalRemoved > 0) console.log(`(replaced ${totalRemoved} existing claude-bouncer entr${totalRemoved === 1 ? 'y' : 'ies'})`)
  console.log(`Make sure the app is running, then finish a Claude Code turn (or trigger a permission prompt) to test.`)
}

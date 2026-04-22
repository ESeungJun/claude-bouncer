#!/usr/bin/env node
// Idempotently install (or remove) the Stop hook that POSTs to claude-bouncer.
// Usage:
//   node scripts/install-hook.js             # install
//   node scripts/install-hook.js --uninstall # remove

const fs = require('fs')
const path = require('path')
const os = require('os')

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
const sendNotifyPath = path.resolve(__dirname, 'send-notify.js')
// Unique substring used to find & remove any previous claude-bouncer hook entry.
const MARKER = 'claude-bouncer/scripts/send-notify.js'

// The hook just calls Node with our cross-platform dispatcher. No jq/curl needed,
// no shell-specific env var syntax — same command works on macOS, Linux, Windows.
function buildHookCommand(kind) {
  // Normalize to forward slashes so the same MARKER matches on Windows too.
  const p = sendNotifyPath.replace(/\\/g, '/')
  return `node "${p}" ${kind}`
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
  // Match both the current marker and the legacy one ('127.0.0.1:17891/notify'
  // used pre-0.2 when the hook piped through jq+curl) so re-running cleans up
  // upgrades from old installs.
  const isOurs = (cmd) => typeof cmd === 'string' && (
    cmd.includes(MARKER) || cmd.includes('127.0.0.1:17891/notify')
  )
  const cleaned = current.filter(group => {
    const cmds = Array.isArray(group?.hooks) ? group.hooks : []
    return !cmds.some(h => isOurs(h?.command))
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

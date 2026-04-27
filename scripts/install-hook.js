#!/usr/bin/env node
// Idempotently install (or remove) the Stop / Notification hooks that POST
// to claude-bouncer. Importable from the Electron main process AND runnable
// as a CLI (`npm run install-hook`, `npm run uninstall-hook`) for source-mode.

const fs = require('fs')
const path = require('path')
const os = require('os')

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
// Unique substring used to find & remove any previous claude-bouncer hook entry.
// Matches every variant: source dir (claude-bouncer/scripts/send-notify.js),
// packaged macOS (Claude Bouncer.app/.../scripts/send-notify.js — note the
// capitals, which is why we don't key off the app name), packaged Windows.
const SEND_NOTIFY_TAIL = 'scripts/send-notify.js'

function buildHookCommand(sendNotifyPath, kind) {
  // Normalize to forward slashes so the same matcher works on Windows too.
  const p = String(sendNotifyPath).replace(/\\/g, '/')
  return `node "${p}" ${kind}`
}

function isOurs(cmd) {
  if (typeof cmd !== 'string') return false
  // Current dispatcher OR the legacy curl/jq hook from pre-0.2.
  return cmd.includes(SEND_NOTIFY_TAIL) ||
    cmd.includes('127.0.0.1:17891/notify')
}

// Core entry point. Pass the absolute path to send-notify.js for installs;
// it's ignored when uninstall:true. Returns { installed, removed }.
function installClaudeHook({ sendNotifyPath, uninstall = false } = {}) {
  if (!uninstall && !sendNotifyPath) {
    throw new Error('installClaudeHook: sendNotifyPath is required for install')
  }

  const HOOKS = uninstall ? {} : {
    Stop: buildHookCommand(sendNotifyPath, 'stop'),
    Notification: buildHookCommand(sendNotifyPath, 'notification'),
  }

  let settings = {}
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) || {}
  }
  settings.hooks = settings.hooks || {}

  let removed = 0
  // Walk every hook event so a stale entry on an old event name still gets cleaned.
  const eventNames = new Set([...Object.keys(settings.hooks), ...Object.keys(HOOKS)])
  for (const eventName of eventNames) {
    const current = Array.isArray(settings.hooks[eventName]) ? settings.hooks[eventName] : []
    const before = current.length
    const cleaned = current.filter(group => {
      const cmds = Array.isArray(group?.hooks) ? group.hooks : []
      return !cmds.some(h => isOurs(h?.command))
    })
    removed += before - cleaned.length

    if (HOOKS[eventName]) {
      cleaned.push({
        matcher: '',
        hooks: [{ type: 'command', command: HOOKS[eventName] }],
      })
    }

    if (cleaned.length === 0) delete settings.hooks[eventName]
    else settings.hooks[eventName] = cleaned
  }

  if (Object.keys(settings.hooks).length === 0) delete settings.hooks

  // Skip the disk write when nothing actually changed — avoids touching the file
  // on every app startup if the hook is already current.
  const before = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : ''
  const after = JSON.stringify(settings, null, 2) + '\n'
  if (before !== after) {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(settingsPath, after)
  }

  return {
    installed: uninstall ? [] : Object.keys(HOOKS),
    removed,
    changed: before !== after,
    settingsPath,
  }
}

module.exports = { installClaudeHook }

// --- CLI ---
if (require.main === module) {
  const uninstall = process.argv.includes('--uninstall')
  const sendNotifyPath = path.resolve(__dirname, 'send-notify.js')
  try {
    const result = installClaudeHook({ sendNotifyPath, uninstall })
    if (uninstall) {
      console.log(`Removed ${result.removed} claude-bouncer hook(s) from ${result.settingsPath}`)
    } else {
      console.log(`Installed hooks: ${result.installed.join(', ')} → ${result.settingsPath}`)
      if (result.removed > 0) {
        console.log(`(replaced ${result.removed} existing claude-bouncer entr${result.removed === 1 ? 'y' : 'ies'})`)
      }
      console.log(`Make sure the app is running, then finish a Claude Code turn (or trigger a permission prompt) to test.`)
    }
  } catch (e) {
    console.error(`Failed: ${e.message}`)
    process.exit(1)
  }
}

#!/usr/bin/env node
// Idempotently install (or remove) the Stop / Notification / UserPromptSubmit /
// SessionEnd hooks that POST
// to claude-bouncer. Importable from the Electron main process AND runnable
// as a CLI (`npm run install-hook`, `npm run uninstall-hook`) for source-mode.

const fs = require('fs')
const path = require('path')
const os = require('os')

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
// Any previous claude-bouncer hook: scripts/send-notify.(js|sh|ps1) inside a
// claude-bouncer checkout or the packaged app (Claude Bouncer.app, …).
const SEND_NOTIFY_RE = /scripts\/send-notify\.(js|sh|ps1)/

// The hook script for this platform (needs no Node.js):
//   macOS / Linux → /bin/sh send-notify.sh   (sh + ps + curl)
//   Windows       → powershell send-notify.ps1
function hookScriptPath(dir, platform = process.platform) {
  return path.join(dir, platform === 'win32' ? 'send-notify.ps1' : 'send-notify.sh')
}

function buildHookCommand(scriptPath, kind, platform = process.platform) {
  if (platform === 'win32') {
    // Windows paths can't contain double quotes, so plain quoting is safe
    return `powershell -NoProfile -ExecutionPolicy Bypass -File "${String(scriptPath)}" ${kind}`
  }
  // single-quote for the shell; a ' in the install path becomes '\''
  const quoted = "'" + String(scriptPath).replace(/'/g, "'\\''") + "'"
  return `/bin/sh ${quoted} ${kind}`
}

// Ours = a send-notify script that lives inside a claude-bouncer checkout or
// the packaged app (or the exact path we're installing now), or the legacy
// curl/jq hook from pre-0.2. Someone else's scripts/send-notify.* is left alone.
function isOurs(cmd, currentPath) {
  if (typeof cmd !== 'string') return false
  const norm = (x) => String(x).replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  const c = norm(cmd)
  if (currentPath && c.includes(norm(currentPath))) return true
  if (c.includes('127.0.0.1:17891/notify')) return true
  return SEND_NOTIFY_RE.test(c) && /claude[- ]?bouncer/i.test(c)
}

// Core entry point. Pass the absolute path to the hook script for installs;
// it's ignored when uninstall:true. Returns { installed, removed }.
function installClaudeHook({ sendNotifyPath, platform = process.platform, uninstall = false } = {}) {
  if (!uninstall && !sendNotifyPath) {
    throw new Error('installClaudeHook: sendNotifyPath is required for install')
  }

  const HOOKS = uninstall ? {} : {
    Stop: buildHookCommand(sendNotifyPath, 'stop', platform),
    Notification: buildHookCommand(sendNotifyPath, 'notification', platform),
    // submit/end let the app track which sessions are busy and clear
    // notifications you've already answered.
    UserPromptSubmit: buildHookCommand(sendNotifyPath, 'submit', platform),
    SessionEnd: buildHookCommand(sendNotifyPath, 'end', platform),
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
    // drop only our command; keep the rest of a group the user may have added to
    let cleaned = []
    for (const group of current) {
      const cmds = Array.isArray(group?.hooks) ? group.hooks : null
      if (!cmds) { cleaned.push(group); continue }
      const kept = cmds.filter(h => !isOurs(h?.command, sendNotifyPath))
      removed += cmds.length - kept.length
      if (kept.length === cmds.length) cleaned.push(group)
      else if (kept.length) cleaned.push({ ...group, hooks: kept })
    }

    if (HOOKS[eventName]) {
      cleaned.push({
        matcher: '',
        hooks: [{ type: 'command', command: HOOKS[eventName], timeout: 5 }],
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
    // write-then-rename so a crash can never leave a half-written settings.json;
    // follow a symlink (dotfiles setups) and keep the file's permissions
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    let target = settingsPath
    let mode = 0o644
    try { target = fs.realpathSync(settingsPath); mode = fs.statSync(target).mode & 0o777 } catch {}
    const tmp = `${target}.claude-bouncer-${process.pid}.tmp`
    fs.writeFileSync(tmp, after, { mode })
    fs.renameSync(tmp, target)
  }

  return {
    installed: uninstall ? [] : Object.keys(HOOKS),
    removed,
    changed: before !== after,
    settingsPath,
  }
}

module.exports = { installClaudeHook, isOurs, buildHookCommand, hookScriptPath }

// --- CLI ---
if (require.main === module) {
  const uninstall = process.argv.includes('--uninstall')
  const sendNotifyPath = hookScriptPath(__dirname)
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

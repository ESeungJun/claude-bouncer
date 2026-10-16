// Bring the terminal that produced a notification to the front.
// macOS: iTerm2 and Terminal.app are targeted down to the exact tab (by
// session id or tty); tmux panes are selected; every other app is activated
// by its bundle id. Windows: best-effort AppActivate by window title.

const { execFile } = require('child_process')

function run(cmd, args, timeout = 3000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout) => {
      if (err) console.error(`[focus] ${cmd}:`, err.message.split('\n')[0])
      resolve(err ? null : String(stdout || '').trim())
    })
  })
}

const osa = (script) => run('osascript', ['-e', script])

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function isTty(s) { return /^\/dev\/ttys?\d+$/.test(String(s || '')) }

const BUNDLE_RE = /^[A-Za-z0-9.-]+$/

async function selectTmuxPane(pane) {
  if (!/^%\d+$/.test(pane)) return
  // tmux may not be on Electron's PATH when launched from Finder.
  for (const bin of ['tmux', '/opt/homebrew/bin/tmux', '/usr/local/bin/tmux']) {
    const ok = await run(bin, ['select-window', '-t', pane], 1500)
    if (ok !== null) { await run(bin, ['select-pane', '-t', pane], 1500); return }
  }
}

async function focusMac(t) {
  if (t.tmuxPane) await selectTmuxPane(t.tmuxPane)
  const name = t.name || ''

  if (name === 'iTerm2') {
    const uuid = t.termSessionId.includes(':') ? t.termSessionId.split(':').pop() : t.termSessionId
    const cond = uuid
      ? `unique id of s is "${esc(uuid)}"`
      : isTty(t.tty) ? `tty of s is "${esc(t.tty)}"` : null
    if (cond) {
      return osa(`
        tell application "iTerm"
          activate
          repeat with w in windows
            repeat with tb in tabs of w
              repeat with s in sessions of tb
                if ${cond} then
                  tell w to select
                  tell tb to select
                  select s
                  return
                end if
              end repeat
            end repeat
          end repeat
        end tell`)
    }
    return osa('tell application "iTerm" to activate')
  }

  if (name === '터미널') {
    if (isTty(t.tty)) {
      return osa(`
        tell application "Terminal"
          activate
          repeat with w in windows
            repeat with tb in tabs of w
              if tty of tb is "${esc(t.tty)}" then
                set selected of tb to true
                set index of w to 1
                return
              end if
            end repeat
          end repeat
        end tell`)
    }
    return osa('tell application "Terminal" to activate')
  }

  if (t.bundleId && BUNDLE_RE.test(t.bundleId)) {
    return osa(`tell application id "${esc(t.bundleId)}" to activate`)
  }
  const byName = {
    'VS Code': 'Visual Studio Code', Cursor: 'Cursor', Warp: 'Warp', Ghostty: 'Ghostty',
    WezTerm: 'WezTerm', kitty: 'kitty', Alacritty: 'Alacritty', Hyper: 'Hyper',
  }[name]
  if (byName) return osa(`tell application "${byName}" to activate`)
  return null
}

async function focusWin(t) {
  const title = {
    'Windows Terminal': 'Windows Terminal', 'VS Code': 'Visual Studio Code',
    Cursor: 'Cursor', Hyper: 'Hyper', WezTerm: 'WezTerm',
  }[t.name]
  if (!title) return null
  const script = `(New-Object -ComObject WScript.Shell).AppActivate('${title.replace(/'/g, "''")}') | Out-Null`
  return run('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script])
}

// Returns true when we at least tried a terminal-specific path.
async function focusTerminal(notification, { openPath } = {}) {
  const t = (notification && notification.terminal) || {}
  let result = null
  if (process.platform === 'darwin') result = await focusMac(t)
  else if (process.platform === 'win32') result = await focusWin(t)
  if (result === null && notification && notification.cwd && openPath) {
    openPath(notification.cwd)
    return false
  }
  return true
}

module.exports = { focusTerminal }

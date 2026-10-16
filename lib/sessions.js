// Session + notification bookkeeping. Pure Node (no Electron) so it can be
// unit-tested. Every hook event goes through `SessionTracker.handle()`, which
// keeps a live view of each Claude Code session and turns Stop/Notification
// events into notification records that say *where* they came from.

const fs = require('fs')
const path = require('path')

const HISTORY_MAX = 100
const TEXT_MAX = 90
const TRANSCRIPT_TAIL_BYTES = 256 * 1024

// ---------- small helpers ----------

function str(v) { return typeof v === 'string' ? v : '' }

function clip(s, max = TEXT_MAX) {
  const flat = String(s || '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

// Messages the CLI injects as "user" turns (slash commands, hook output,
// interrupts) are not what the person actually asked for.
function isRealPrompt(text) {
  const t = String(text || '').trim()
  if (!t) return false
  if (t.startsWith('<')) return false
  if (/^\[Request interrupted/i.test(t)) return false
  if (/^Caveat:/i.test(t)) return false
  return true
}

function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(c => c && c.type === 'text' && typeof c.text === 'string')
    .map(c => c.text)
    .join(' ')
}

// Read the tail of a transcript .jsonl and pull out the last real user
// prompt and the last assistant text. Best effort: returns {} on any error.
function readTranscriptTail(transcriptPath) {
  const out = {}
  if (!transcriptPath || typeof transcriptPath !== 'string') return out
  let fd
  try {
    fd = fs.openSync(transcriptPath, 'r')
    const { size } = fs.fstatSync(fd)
    const len = Math.min(size, TRANSCRIPT_TAIL_BYTES)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, size - len)
    const lines = buf.toString('utf8').split('\n')
    // first line may be cut in half — parse failures are skipped anyway
    for (let i = lines.length - 1; i >= 0; i--) {
      if (out.prompt && out.summary) break
      let row
      try { row = JSON.parse(lines[i]) } catch { continue }
      if (!row || row.isMeta || row.isSidechain) continue
      const msg = row.message || {}
      if (row.type === 'assistant' && !out.summary) {
        const t = textOf(msg.content)
        if (t.trim()) out.summary = clip(t)
      } else if (row.type === 'user' && !out.prompt) {
        const t = textOf(msg.content)
        if (isRealPrompt(t)) out.prompt = clip(t)
      }
    }
  } catch { /* unreadable transcript — fine */ } finally {
    if (fd !== undefined) try { fs.closeSync(fd) } catch {}
  }
  return out
}

// Walk up from cwd looking for .git/HEAD. Handles worktrees (.git file).
function readGitBranch(cwd) {
  if (!cwd || typeof cwd !== 'string') return ''
  let dir = cwd
  for (let i = 0; i < 25; i++) {
    const dotGit = path.join(dir, '.git')
    try {
      let gitDir = dotGit
      const st = fs.statSync(dotGit)
      if (st.isFile()) {
        const m = /gitdir:\s*(.+)/.exec(fs.readFileSync(dotGit, 'utf8'))
        if (!m) return ''
        gitDir = path.resolve(dir, m[1].trim())
      }
      const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim()
      const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head)
      return ref ? ref[1] : head.slice(0, 7)
    } catch { /* keep walking */ }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return ''
}

// ---------- terminal identification ----------

const BUNDLE_NAMES = {
  'com.googlecode.iterm2': 'iTerm2',
  'com.apple.Terminal': '터미널',
  'com.microsoft.VSCode': 'VS Code',
  'com.microsoft.VSCodeInsiders': 'VS Code Insiders',
  'com.todesktop.230313mzl4w4u92': 'Cursor',
  'dev.warp.Warp-Stable': 'Warp',
  'com.mitchellh.ghostty': 'Ghostty',
  'net.kovidgoyal.kitty': 'kitty',
  'io.alacritty': 'Alacritty',
  'com.github.wez.wezterm': 'WezTerm',
  'co.zeit.hyper': 'Hyper',
  'dev.zed.Zed': 'Zed',
  'com.exafunction.windsurf': 'Windsurf',
}

function terminalName(t) {
  if (BUNDLE_NAMES[t.bundleId]) return BUNDLE_NAMES[t.bundleId]
  if (/^com\.jetbrains\./.test(t.bundleId) || /JetBrains/i.test(t.emulator)) return 'JetBrains'
  const p = t.program
  if (/iTerm/i.test(p)) return 'iTerm2'
  if (/Apple_Terminal/i.test(p)) return '터미널'
  if (/vscode/i.test(p)) return 'VS Code'
  if (/cursor/i.test(p)) return 'Cursor'
  if (/WarpTerminal|Warp/i.test(p)) return 'Warp'
  if (/ghostty/i.test(p)) return 'Ghostty'
  if (/WezTerm/i.test(p)) return 'WezTerm'
  if (t.wtSession) return 'Windows Terminal'
  if (p) return p.replace(/\.app$/i, '')
  return t.tmux ? 'tmux' : '터미널'
}

function buildTerminal(data) {
  const t = {
    program: str(data.term_program),
    bundleId: str(data.bundle_id),
    emulator: str(data.terminal_emulator),
    termSessionId: str(data.term_session_id),
    tty: str(data.tty),
    tmux: str(data.tmux),
    tmuxPane: str(data.tmux_pane),
    wtSession: str(data.wt_session),
  }
  const parts = [terminalName(t)]
  if (t.tmuxPane) parts.push(`tmux ${t.tmuxPane}`)
  if (t.tty) parts.push(t.tty.replace(/^\/dev\//, ''))
  t.name = parts[0]
  t.label = parts.join(' · ')
  return t
}

// ---------- notification classification ----------

// Returns 'permission' | 'input' | 'attention'
function classifyNotification(data) {
  const type = str(data.notification_type)
  const msg = str(data.message)
  if (type === 'permission_prompt' || /permission/i.test(msg)) return 'permission'
  if (type === 'idle_prompt' || /waiting for your input/i.test(msg)) return 'input'
  if (type === 'elicitation_dialog') return 'input'
  return 'attention'
}

function koreanMessage(kind, msg) {
  const m = /permission to use (.+)$/i.exec(msg || '')
  if (m) return `${m[1].trim()} 사용 권한이 필요해요`
  if (kind === 'input') return '입력을 기다리고 있어요'
  return clip(msg)
}

// Map the hook's raw kind argument + payload to a normalized event type.
function eventType(data) {
  const k = str(data.kind)
  if (['stop', 'notification', 'submit', 'end', 'start'].includes(k)) return k
  switch (str(data.hook_event_name)) {
    case 'Notification': return 'notification'
    case 'UserPromptSubmit': return 'submit'
    case 'SessionEnd': return 'end'
    case 'SessionStart': return 'start'
    default: return 'stop'
  }
}

// ---------- tracker ----------

class SessionTracker {
  constructor({ history = [], now = () => Date.now(), readTranscript = readTranscriptTail, readBranch = readGitBranch } = {}) {
    this.sessions = new Map()
    this.history = Array.isArray(history) ? history.slice(0, HISTORY_MAX) : []
    this.now = now
    this.readTranscript = readTranscript
    this.readBranch = readBranch
    this.seq = 0
  }

  sessionFor(data) {
    const cwd = str(data.cwd)
    const id = str(data.session_id) || str(data.sessionId) || `cwd:${cwd}`
    let s = this.sessions.get(id)
    if (!s) {
      s = {
        id,
        cwd,
        projectName: cwd ? path.basename(cwd) : '알 수 없음',
        branch: '',
        status: 'idle',
        prompt: '',
        startedAt: this.now(),
        updatedAt: this.now(),
        terminal: buildTerminal(data),
      }
      this.sessions.set(id, s)
    }
    if (cwd && cwd !== s.cwd) { s.cwd = cwd; s.projectName = path.basename(cwd) }
    // the terminal info can be missing on some events; only overwrite when present
    const term = buildTerminal(data)
    if (term.program || term.tty || term.bundleId) s.terminal = term
    s.branch = this.readBranch(s.cwd) || s.branch
    s.transcriptPath = str(data.transcript_path) || s.transcriptPath || ''
    s.updatedAt = this.now()
    return s
  }

  // Resolve the outstanding "needs you" notifications of a session — the
  // person evidently went back to it (or it moved on by itself).
  settle(sessionId, { read = false } = {}) {
    const changed = []
    for (const n of this.history) {
      if (n.sessionId !== sessionId) continue
      if (n.kind !== 'done' && !n.resolved) { n.resolved = true; changed.push(n) }
      if (read && !n.read) { n.read = true; changed.push(n) }
    }
    return changed.length > 0
  }

  // Returns { session, notification|null, changed:boolean }
  handle(data) {
    if (!data || typeof data !== 'object') data = {}
    const type = eventType(data)
    const s = this.sessionFor(data)
    let notification = null
    let changed = false

    if (type === 'start') {
      s.status = 'idle'
    } else if (type === 'submit') {
      s.status = 'working'
      s.workStartedAt = this.now()
      const p = str(data.prompt)
      if (isRealPrompt(p)) s.prompt = clip(p)
      changed = this.settle(s.id, { read: true })
    } else if (type === 'end') {
      changed = this.settle(s.id)
      this.sessions.delete(s.id)
      s.status = 'ended'
    } else if (type === 'stop') {
      const tail = this.readTranscript(s.transcriptPath)
      if (tail.prompt) s.prompt = tail.prompt
      changed = this.settle(s.id)
      s.status = 'done'
      const startedAt = s.workStartedAt || 0
      s.workStartedAt = 0
      notification = this.record({
        kind: 'done',
        session: s,
        summary: str(data.last_assistant_message) ? clip(data.last_assistant_message) : (tail.summary || ''),
        message: '',
        durationMs: startedAt ? this.now() - startedAt : 0,
      })
    } else if (type === 'notification') {
      const kind = classifyNotification(data)
      if (!s.prompt) {
        const tail = this.readTranscript(s.transcriptPath)
        if (tail.prompt) s.prompt = tail.prompt
      }
      s.status = 'waiting'
      // one live "needs you" card per session is enough
      changed = this.settle(s.id)
      notification = this.record({
        kind,
        session: s,
        summary: '',
        message: koreanMessage(kind, str(data.message)),
        rawMessage: clip(str(data.message), 160),
      })
    }
    return { session: { ...s }, notification, changed, type }
  }

  record({ kind, session: s, summary, message, rawMessage = '', durationMs = 0 }) {
    const ts = this.now()
    const n = {
      id: `${ts.toString(36)}-${(++this.seq).toString(36)}`,
      kind,
      sessionId: s.id,
      projectName: s.projectName,
      cwd: s.cwd,
      branch: s.branch,
      prompt: s.prompt,
      summary,
      message,
      rawMessage,
      durationMs,
      terminal: { ...s.terminal },
      ts,
      read: false,
      resolved: false,
    }
    this.history.unshift(n)
    if (this.history.length > HISTORY_MAX) this.history.length = HISTORY_MAX
    return n
  }

  find(id) { return this.history.find(n => n.id === id) || null }

  markRead(id) {
    const n = this.find(id)
    if (!n) return false
    n.read = true
    if (n.kind !== 'done') n.resolved = true
    return true
  }

  markAllRead() {
    for (const n of this.history) { n.read = true; if (n.kind !== 'done') n.resolved = true }
  }

  clear() { this.history = [] }

  // Notifications still asking for attention: unresolved prompts + unread completions.
  pending() {
    return this.history.filter(n => (n.kind === 'done' ? !n.read : !n.resolved))
  }

  listSessions() {
    // Sessions that went quiet for 6h are probably dead terminals.
    const cutoff = this.now() - 6 * 3600 * 1000
    for (const [id, s] of this.sessions) if (s.updatedAt < cutoff) this.sessions.delete(id)
    return [...this.sessions.values()]
      .map(s => ({ ...s }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  workingCount() {
    let n = 0
    for (const s of this.sessions.values()) if (s.status === 'working') n++
    return n
  }
}

module.exports = {
  SessionTracker,
  readTranscriptTail,
  readGitBranch,
  buildTerminal,
  classifyNotification,
  koreanMessage,
  eventType,
  clip,
  isRealPrompt,
}

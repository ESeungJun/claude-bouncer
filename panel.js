const list = document.getElementById('list')

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
}

function formatTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  if (sameDay) return `${hh}:${mm}:${ss}`
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const dy = String(d.getDate()).padStart(2, '0')
  return `${mo}/${dy} ${hh}:${mm}`
}

function terminalLabel(entry) {
  if (!entry) return ''
  const parts = []
  if (entry.termProgram) {
    parts.push(String(entry.termProgram).replace(/\.app$/i, ''))
  } else if (entry.tmux) {
    parts.push('tmux')
  }
  const sid = entry.termSessionId || entry.sessionId
  if (sid) parts.push(String(sid).slice(-6))
  return parts.join(' · ')
}

function render(history) {
  if (!history || history.length === 0) {
    list.innerHTML = `
      <div class="empty">
        아직 알림이 없어요.<br>
        <strong>Claude Code</strong>에서 답변이 끝나면<br>
        여기에 쌓입니다.
      </div>`
    return
  }
  list.innerHTML = history.map((entry, i) => {
    const term = terminalLabel(entry)
    const isPrompt = entry.kind === 'notification'
    const badge = isPrompt ? '<span class="badge prompt">prompt</span>' : '<span class="badge">stop</span>'
    const message = isPrompt && entry.message
      ? `<div class="msg">${escapeHtml(entry.message)}</div>`
      : ''
    return `
    <div class="entry ${isPrompt ? 'is-prompt' : ''}" data-idx="${i}" title="Click to jump to this terminal">
      <div class="row1">
        <div class="name">${badge}${escapeHtml(entry.projectName || 'unknown')}</div>
        <div class="time">${formatTime(entry.ts)}</div>
      </div>
      ${message}
      <div class="cwd-row">
        <span class="cwd">${escapeHtml(entry.cwd || '')}</span>
        <button class="folder-btn" data-cwd="${escapeHtml(entry.cwd)}" title="Open folder in Finder">📁</button>
      </div>
      ${term ? `<div class="term">${escapeHtml(term)}</div>` : ''}
    </div>
  `}).join('')
  list.querySelectorAll('.entry').forEach((el) => {
    el.addEventListener('click', (e) => {
      // if the user clicked the folder button, that handler handles it.
      if (e.target.closest('.folder-btn')) return
      const idx = Number(el.getAttribute('data-idx'))
      const entry = history[idx]
      if (entry) window.api.focusTerminal(entry)
    })
  })
  list.querySelectorAll('.folder-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const cwd = btn.getAttribute('data-cwd')
      if (cwd) window.api.openFolder(cwd)
    })
  })
}

async function load() {
  const h = await window.api.getHistory()
  render(h)
}

window.api.onHistoryUpdate(render)
document.getElementById('clear').addEventListener('click', async () => {
  const h = await window.api.clearHistory()
  render(h)
})
document.getElementById('close').addEventListener('click', () => window.api.closePanel())

load()

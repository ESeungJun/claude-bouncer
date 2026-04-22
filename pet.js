const pet = document.getElementById('pet')
const bubble = document.getElementById('bubble')
const bubbleLabel = document.getElementById('bubble-label')
const bubbleName = document.getElementById('bubble-name')
const bubbleMessage = document.getElementById('bubble-message')
const bubbleTerm = document.getElementById('bubble-term')
const bubbleSub = document.getElementById('bubble-sub')

let hideTimer = null
let currentEntry = null

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

function showNotify(entry) {
  currentEntry = entry
  const isPrompt = entry.kind === 'notification'

  bubbleLabel.textContent = isPrompt ? '⏳ Claude needs you' : '✓ Claude finished'
  bubbleName.textContent = entry.projectName || 'unknown'
  bubbleMessage.textContent = isPrompt ? (entry.message || '') : ''
  bubbleTerm.textContent = terminalLabel(entry)
  bubbleSub.textContent = formatTime(entry.ts)

  bubble.classList.toggle('prompt', isPrompt)
  pet.classList.toggle('prompt', isPrompt)

  bubble.classList.add('visible')

  pet.classList.remove('bouncing')
  void pet.offsetWidth  // restart animation on repeat
  pet.classList.add('bouncing')

  clearTimeout(hideTimer)
  // prompts linger longer — user may still be away from the keyboard
  const duration = isPrompt ? 20000 : 4000
  hideTimer = setTimeout(() => bubble.classList.remove('visible'), duration)
}

function formatTime(ts) {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

// --- drag ---
// match the pattern used in poketmon_idle: main-process cursor polling
pet.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  const rect = pet.getBoundingClientRect()
  // window.screenX/Y gives window top-left in screen coords;
  // rect.left/top gives pet top-left within the window.
  // offset from window origin to cursor at drag start:
  const offsetX = e.clientX
  const offsetY = e.clientY
  window.api.startDrag({ offsetX, offsetY })
  e.preventDefault()
})
document.addEventListener('mouseup', () => window.api.stopDrag())
window.addEventListener('blur', () => window.api.stopDrag())

// right-click pet to toggle panel
pet.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  window.api.togglePanel()
})

// double-click pet to dismiss the current bubble immediately
pet.addEventListener('dblclick', () => {
  bubble.classList.remove('visible')
})

// click the bubble to jump to the terminal that fired it
bubble.addEventListener('click', () => {
  if (!currentEntry) return
  window.api.focusTerminal(currentEntry)
  bubble.classList.remove('visible')
})

window.api.onNotify(showNotify)

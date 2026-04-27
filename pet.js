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

// --- click-through for the transparent empty area ---
// Window-level ignoreMouseEvents is on by default so the empty pixels around
// the pet pass clicks through to whatever's underneath. Flip it off only
// while the cursor is actually over the pet image or the visible bubble.
let petHovered = false
let bubbleHovered = false
let dragging = false
function syncIgnoreMouse() {
  // Keep clicks routed to us while dragging — if mouseleave fires on a fast
  // drag and we flip ignore back on, mouseup never reaches the window and the
  // drag gets stuck.
  window.api.setIgnoreMouse(!(petHovered || bubbleHovered || dragging))
}
pet.addEventListener('mouseenter', () => { petHovered = true; syncIgnoreMouse() })
pet.addEventListener('mouseleave', () => { petHovered = false; syncIgnoreMouse() })
bubble.addEventListener('mouseenter', () => { bubbleHovered = true; syncIgnoreMouse() })
bubble.addEventListener('mouseleave', () => { bubbleHovered = false; syncIgnoreMouse() })

// If the bubble disappears while the cursor is still over it, the resulting
// pointer-events:none can swallow the mouseleave — clear the flag manually
// when the .visible class drops.
new MutationObserver(() => {
  if (!bubble.classList.contains('visible') && bubbleHovered) {
    bubbleHovered = false
    syncIgnoreMouse()
  }
}).observe(bubble, { attributes: true, attributeFilter: ['class'] })

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
  dragging = true
  syncIgnoreMouse()
  window.api.startDrag({ offsetX, offsetY })
  e.preventDefault()
})
function endDrag() {
  if (!dragging) return
  dragging = false
  window.api.stopDrag()
  syncIgnoreMouse()
}
document.addEventListener('mouseup', endDrag)
window.addEventListener('blur', endDrag)

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

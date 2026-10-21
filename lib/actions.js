// The pet's play actions in one place. The tray menu, the pet's right-click
// menu, the overlay's double-click menu and the panel all use these ids, so a
// new action is added here (+ its handler in renderer/js/overlay.js).

const PET_ACTIONS = [
  { id: 'feed', label: '🍪 밥 주기' },
  { id: 'ball', label: '⚽ 축구하기' },
  { id: 'game:catch', label: '🎮 쿠키 받기 게임', short: '🎮 쿠키 받기' },
  { id: 'game:tag', label: '🏃 술래잡기 게임', short: '🏃 술래잡기' },
  { id: 'sleep', label: '💤 재우기', menuOnly: true },
]

// Electron menu items for the actions (menuOnly ones only where wanted)
function actionMenuItems(run, { includeMenuOnly = false } = {}) {
  return PET_ACTIONS
    .filter(a => includeMenuOnly || !a.menuOnly)
    .map(a => ({ label: a.label, click: () => run(a.id) }))
}

module.exports = { PET_ACTIONS, actionMenuItems }

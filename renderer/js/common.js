// Small helpers shared by the overlay and the panel.

window.CB = window.CB || {}

;(function () {
  // createElement + class + text in one call (text via textContent, never HTML)
  CB.el = function el(tag, cls, text) {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text !== undefined) e.textContent = text
    return e
  }

  // Notification kinds: card label, short label for lists, CSS class
  CB.KINDS = {
    done: { icon: '✓', label: '작업 완료', short: '✓ 완료', cls: 'k-done' },
    permission: { icon: '🔐', label: '권한 요청', short: '🔐 권한', cls: 'k-need' },
    input: { icon: '💬', label: '입력 대기', short: '💬 입력 대기', cls: 'k-wait' },
    attention: { icon: '👀', label: '확인 필요', short: '👀 확인', cls: 'k-info' },
  }
})()

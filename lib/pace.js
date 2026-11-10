// main 프로세스의 주기·알림 판단 (Electron 없이 테스트할 수 있는 순수 함수)

// 커서를 다음에 읽을 때까지의 간격(ms).
//   tracking: 펫이 커서를 따라가는 중 (다가가기·축구·술래잡기·끌기)
//   movedAgoMs: 커서가 마지막으로 움직인 뒤 지난 시간
//   quiet: 방해 금지이거나 자리를 비움
function cursorPollMs({ tracking = false, movedAgoMs = Infinity, quiet = false } = {}) {
  if (tracking) return 33
  if (movedAgoMs < 1500) return 66
  return quiet ? 1000 : 250
}

// 완료 알림을 조용히(배지만) 올릴지. 걸린 시간을 모르면(0) 평소대로 알린다.
function isQuietDone(notification, minSeconds) {
  if (!notification || notification.kind !== 'done' || !(minSeconds > 0)) return false
  const ms = notification.durationMs
  return ms > 0 && ms < minSeconds * 1000
}

module.exports = { cursorPollMs, isQuietDone }

// main 프로세스의 주기·창 크기 판단 (Electron 없이 테스트할 수 있는 순수 함수)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

// 커서를 다음에 읽을 때까지의 간격(ms).
//   tracking: 펫이 커서를 따라가는 중 (다가가기·축구·술래잡기·끌기)
//   movedAgoMs: 커서가 마지막으로 움직인 뒤 지난 시간
//   quiet: 방해 금지이거나 자리를 비움
function cursorPollMs({ tracking = false, movedAgoMs = Infinity, quiet = false } = {}) {
  if (tracking) return 33
  if (movedAgoMs < 1500) return 66
  return quiet ? 1000 : 250
}

// 오버레이가 보여 달라는 영역(작업 영역 기준 좌표)을 화면 좌표의 창 크기로 바꾼다.
// 값이 이상하면 null. 작업 영역 밖으로 나가지 않게 자른다.
const VIEW_MIN = 120

function viewBounds(view, workArea) {
  if (!view || !workArea) return null
  const { x, y, w, h } = view
  if (![x, y, w, h].every(Number.isFinite)) return null
  const width = clamp(Math.round(w), Math.min(VIEW_MIN, workArea.width), workArea.width)
  const height = clamp(Math.round(h), Math.min(VIEW_MIN, workArea.height), workArea.height)
  return {
    x: workArea.x + clamp(Math.round(x), 0, workArea.width - width),
    y: workArea.y + clamp(Math.round(y), 0, workArea.height - height),
    width, height,
  }
}

// 완료 알림을 조용히(배지만) 올릴지. 걸린 시간을 모르면(0) 평소대로 알린다.
function isQuietDone(notification, minSeconds) {
  if (!notification || notification.kind !== 'done' || !(minSeconds > 0)) return false
  const ms = notification.durationMs
  return ms > 0 && ms < minSeconds * 1000
}

module.exports = { cursorPollMs, viewBounds, isQuietDone }

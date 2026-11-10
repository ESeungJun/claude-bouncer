// 프레임 루프를 언제 돌리고 언제 쉬게 할지, 오버레이 창을 얼마나 크게 둘지 정한다.
// DOM 을 쓰지 않는 순수 함수라 node 에서도 불러 테스트한다(test/pace.test.js).

;(function (root) {
  // 위치가 매 프레임 바뀌는 동작. 여기 없는 이름도 계속 그린다(모르는 동작은 안전한 쪽).
  const STILL = new Set(['idle', 'sit', 'sleep', 'attend', 'sad'])
  // 제자리에서 포즈만 일정 주기로 바뀌는 동작 (초)
  const POSE_PERIOD = { work: 0.12, wave: 0.22, love: 0.25, eat: 0.18 }
  // 손으로 다루는 동작은 프레임 상한을 두지 않는다
  const HANDS_ON = new Set(['dragged', 'tossed', 'chase', 'game'])
  // 커서를 따라가야 하는 동작 (main 이 커서를 빠르게 읽는다)
  const FOLLOWS_CURSOR = new Set(['approach', 'dragged', 'chase', 'game'])

  const BREATH_STEP = 0.75 // 잠든 동안 숨쉬기 한 단계 (초)
  const BREATH = [-0.015, 0.01, 0.03, 0.01]
  const MAX_REST = 4 // 아무 일 없어도 이 간격으로 한 번은 깬다 (초)
  const MIN_REST = 0.05 // 이보다 짧게 쉴 바에는 다음 프레임을 그린다
  const NEED_TICK = 10
  const WALK_FRAME_MS = 33

  // t 가 period 의 다음 배수에 닿을 때까지 남은 시간
  function untilNext(t, period) {
    const left = period - (t % period)
    return left < 1e-4 ? period : left
  }

  // 다음 프레임이 필요하면 0, 아니면 쉬어도 되는 시간(초).
  // s: { act, z, vz, squash, blinkAt, blinkT, sayTimer, t, busy, menuOpen, pressing, needTick }
  function restDelay(s) {
    if (s.busy || s.menuOpen || s.pressing) return 0
    if (s.z > 0 || s.vz > 0 || Math.abs(s.squash || 0) > 0) return 0
    const act = s.act
    if (!act || !act.name) return 0
    let wait = MAX_REST
    const period = POSE_PERIOD[act.name]
    if (period) wait = Math.min(wait, untilNext(act.t || 0, period))
    else if (!STILL.has(act.name)) return 0
    if (typeof act.dur === 'number') wait = Math.min(wait, act.dur - (act.t || 0))
    if (act.name === 'attend' && act.hopEvery > 0) wait = Math.min(wait, act.hopT)
    if (act.name === 'sleep') {
      wait = Math.min(wait, untilNext(s.t || 0, BREATH_STEP))
      if (typeof act.zT === 'number') wait = Math.min(wait, act.zT)
    }
    wait = Math.min(wait, s.blinkT > 0 ? s.blinkT : s.blinkAt)
    if (s.sayTimer > 0) wait = Math.min(wait, s.sayTimer)
    wait = Math.min(wait, NEED_TICK - (s.needTick || 0))
    return wait >= MIN_REST ? wait : 0
  }

  // 프레임 사이 최소 간격(ms). 걷기·점프는 30fps, 손으로 다루는 동안은 제한 없음.
  function frameGap(s) {
    if (s.busy || s.menuOpen || s.pressing) return 0
    if (s.act && HANDS_ON.has(s.act.name)) return 0
    return WALK_FRAME_MS
  }

  // 펫이 커서를 따라가는 중인가
  function followsCursor(s) {
    return !!(s.busy || s.pressing || (s.act && FOLLOWS_CURSOR.has(s.act.name)))
  }

  // 잠든 동안의 숨쉬기 (몸 가로 배율에 더하는 값). 0.75초마다 한 단계.
  function breath(t) {
    return BREATH[Math.floor((t || 0) / BREATH_STEP) % BREATH.length]
  }

  // ---------- 오버레이 창 크기 ----------
  // 펫만 있을 때는 펫 둘레의 작은 창을 쓰고 창이 펫을 따라다닌다.
  // 카드·메뉴·놀이처럼 넓은 면적이 필요하면 화면 전체로 키운다.

  const VIEW_SIDE = 150 // 펫 좌우 여유 (말풍선·배지·작업 중 표시)
  const VIEW_TOP = 190 // 머리 위 여유 (점프 + 말풍선 + 떠오르는 이모트)
  const VIEW_BOTTOM = 30 // 발 아래 여유 (그림자)

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

  // p: { x, y, pw, ph } (발 사이 점과 펫 크기), world: { w, h } → 창이 보여줄 영역
  function compactView(p, world) {
    const w = Math.min(world.w, Math.ceil(p.pw) + VIEW_SIDE * 2)
    const h = Math.min(world.h, Math.ceil(p.ph) + VIEW_TOP + VIEW_BOTTOM)
    return {
      x: clamp(Math.round(p.x - w / 2), 0, world.w - w),
      y: clamp(Math.round(p.y - p.ph - VIEW_TOP), 0, world.h - h),
      w, h,
    }
  }

  // s: { expanded, menuOpen, busy, bubbleW } → 화면 전체가 필요한가
  function needsFullView(s, view) {
    if (s.expanded || s.menuOpen || s.busy) return true
    return !!(s.bubbleW && view && s.bubbleW > view.w - 8)
  }

  const Pace = { restDelay, frameGap, followsCursor, breath, compactView, needsFullView, untilNext, MAX_REST, MIN_REST, BREATH_STEP, POSE_PERIOD }
  if (typeof module === 'object' && module.exports) module.exports = Pace
  if (root) { root.CB = root.CB || {}; root.CB.Pace = Pace }
})(typeof window !== 'undefined' ? window : null)

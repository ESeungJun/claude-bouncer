const test = require('node:test')
const assert = require('node:assert')
const Pace = require('../renderer/js/pace')
const { cursorPollMs, isQuietDone } = require('../lib/pace')

// 가만히 서 있는 펫 (아무것도 예정되지 않은 상태)
function still(extra = {}) {
  return {
    act: { name: 'idle', t: 0, dur: 100 },
    z: 0, vz: 0, squash: 0, blinkAt: 100, blinkT: 0, sayTimer: 0, t: 0,
    busy: false, menuOpen: false, pressing: false, needTick: 0,
    ...extra,
  }
}

test('a still pet rests instead of drawing frames', () => {
  assert.strictEqual(Pace.restDelay(still()), Pace.MAX_REST)
  for (const name of ['idle', 'sit', 'attend', 'sad']) {
    assert.ok(Pace.restDelay(still({ act: { name, t: 0, dur: 100 } })) > 0, name)
  }
})

test('the rest ends at whatever is due first', () => {
  assert.strictEqual(Pace.restDelay(still({ act: { name: 'idle', t: 1, dur: 3 } })), 2)
  assert.strictEqual(Pace.restDelay(still({ blinkAt: 1.5 })), 1.5)
  assert.strictEqual(Pace.restDelay(still({ sayTimer: 0.8 })), 0.8)
  assert.strictEqual(Pace.restDelay(still({ needTick: 9 })), 1)
  // the eyes are closed: wake to open them again
  assert.strictEqual(Pace.restDelay(still({ blinkAt: 3, blinkT: 0.12 })), 0.12)
  // waiting next to a card: the next hop
  assert.strictEqual(Pace.restDelay(still({ act: { name: 'attend', t: 0, dur: 60, hopEvery: 60, hopT: 2.5 } })), 2.5)
})

test('anything due within a frame or two keeps the loop running', () => {
  assert.strictEqual(Pace.restDelay(still({ act: { name: 'idle', t: 2.98, dur: 3 } })), 0)
  assert.strictEqual(Pace.restDelay(still({ act: { name: 'idle', t: 5, dur: 3 } })), 0)
})

test('moving, jumping and playing draw every frame', () => {
  for (const name of ['walk', 'run', 'approach', 'chase', 'tossed', 'dragged', 'game', 'happy', 'dizzy', 'something-new']) {
    assert.strictEqual(Pace.restDelay(still({ act: { name, t: 0, dur: 100 } })), 0, name)
  }
  assert.strictEqual(Pace.restDelay(still({ z: 12 })), 0)
  assert.strictEqual(Pace.restDelay(still({ vz: 300 })), 0)
  assert.strictEqual(Pace.restDelay(still({ squash: 0.1 })), 0)
  assert.strictEqual(Pace.restDelay(still({ squash: -0.1 })), 0)
  assert.strictEqual(Pace.restDelay(still({ busy: true })), 0)
  assert.strictEqual(Pace.restDelay(still({ menuOpen: true })), 0)
  assert.strictEqual(Pace.restDelay(still({ pressing: true })), 0)
  assert.strictEqual(Pace.restDelay(still({ act: null })), 0)
})

test('poses that flip on a beat are drawn once per flip', () => {
  const d = Pace.restDelay(still({ act: { name: 'work', t: 0.03, dur: 10 } }))
  assert.ok(Math.abs(d - 0.09) < 1e-9, String(d))
  // right on the beat: a whole period, not zero
  assert.ok(Math.abs(Pace.untilNext(0.24, 0.12) - 0.12) < 1e-6)
  assert.ok(Pace.restDelay(still({ act: { name: 'wave', t: 0, dur: 2 } })) > 0.2)
})

test('a sleeping pet breathes in steps and wakes for its next z', () => {
  const d = Pace.restDelay(still({ act: { name: 'sleep', t: 5, dur: 200, zT: 6 }, t: 0.25 }))
  assert.ok(Math.abs(d - 0.5) < 1e-9, String(d))
  assert.strictEqual(Pace.restDelay(still({ act: { name: 'sleep', t: 5, dur: 200, zT: 0.3 }, t: 0 })), 0.3)
  // four steps, then the same again
  const steps = [0, 0.75, 1.5, 2.25].map(Pace.breath)
  assert.strictEqual(new Set(steps).size >= 3, true)
  assert.strictEqual(Pace.breath(3), Pace.breath(0))
  assert.strictEqual(Pace.breath(0.1), Pace.breath(0.7))
})

test('frames are capped at 30 a second unless the pet is being handled', () => {
  assert.strictEqual(Pace.frameGap(still({ act: { name: 'walk' } })), 33)
  assert.strictEqual(Pace.frameGap(still({ act: { name: 'run' } })), 33)
  assert.strictEqual(Pace.frameGap(still({ act: { name: 'attend' }, z: 20 })), 33)
  for (const name of ['dragged', 'tossed', 'chase', 'game']) assert.strictEqual(Pace.frameGap(still({ act: { name } })), 0, name)
  assert.strictEqual(Pace.frameGap(still({ busy: true })), 0)
  assert.strictEqual(Pace.frameGap(still({ menuOpen: true })), 0)
  assert.strictEqual(Pace.frameGap(still({ pressing: true })), 0)
})

test('the cursor is followed closely only while the pet goes after it', () => {
  assert.strictEqual(Pace.followsCursor(still()), false)
  assert.strictEqual(Pace.followsCursor(still({ act: { name: 'walk' } })), false)
  assert.strictEqual(Pace.followsCursor(still({ act: { name: 'approach' } })), true)
  assert.strictEqual(Pace.followsCursor(still({ busy: true })), true)
  assert.strictEqual(Pace.followsCursor(still({ pressing: true })), true)
})

test('main reads the cursor fast only when it has to', () => {
  assert.strictEqual(cursorPollMs({ tracking: true, movedAgoMs: 99999, quiet: true }), 33)
  assert.strictEqual(cursorPollMs({ movedAgoMs: 200 }), 66)
  assert.strictEqual(cursorPollMs({ movedAgoMs: 200, quiet: true }), 66)
  assert.strictEqual(cursorPollMs({ movedAgoMs: 5000 }), 250)
  assert.strictEqual(cursorPollMs({ movedAgoMs: 5000, quiet: true }), 1000)
  assert.strictEqual(cursorPollMs(), 250)
})

test('a quickly finished task is announced quietly', () => {
  const done = (durationMs) => ({ kind: 'done', durationMs })
  assert.strictEqual(isQuietDone(done(5000), 30), true)
  assert.strictEqual(isQuietDone(done(30000), 30), false)
  assert.strictEqual(isQuietDone(done(90000), 30), false)
  assert.strictEqual(isQuietDone(done(90000), 120), true)
  // "always": never quiet
  assert.strictEqual(isQuietDone(done(5000), 0), false)
  // unknown duration: announce as usual
  assert.strictEqual(isQuietDone(done(0), 30), false)
  assert.strictEqual(isQuietDone({ kind: 'done' }, 30), false)
  // cards that need an answer are never quiet
  assert.strictEqual(isQuietDone({ kind: 'permission', durationMs: 10 }, 30), false)
  assert.strictEqual(isQuietDone(null, 30), false)
})

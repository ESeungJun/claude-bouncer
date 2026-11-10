// Overlay bootstrap: world state, the frame loop, mouse handling
// (click-through except over interactive bits), and wiring to main.

;(async function () {
  const api = window.api
  const { Pet, Notify, Play, Sound, Pace } = CB
  const { clamp, pick, rand } = CB.util
  const layer = document.getElementById('layer')

  const state = await api.getState()

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

  const world = {
    w: window.innerWidth,
    h: window.innerHeight,
    layer,
    settings: state.settings,
    data: { pending: state.pending || [], sessions: state.sessions || [], working: state.working || 0 },
    cursor: { x: window.innerWidth / 2, y: window.innerHeight / 2, inside: false, movedAt: 0 },
    idleSec: 0,
    uptime: 0,
    reducedMotion: motionQuery.matches,
  }
  // the pet walks over to you only when roaming is on and motion isn't reduced
  world.canRoam = () => world.settings.roam && !world.reducedMotion
  motionQuery.addEventListener('change', (e) => { world.reducedMotion = e.matches })
  CB.world = world
  Sound.setEnabled(state.settings.sound)
  CB.Sprites.setSkin(state.skin)

  const pet = new Pet(world)
  pet.load(state.pet)
  const notify = new Notify(world, pet)
  const play = new Play(world, pet)
  world.play = play
  world.notify = notify
  notify.onData(world.data)

  // ---------- click-through ----------
  // The window ignores the mouse (clicks fall through to the desktop) except
  // while the cursor is over something marked [data-hit], or while a mode
  // needs every click (dragging the pet, holding a snack).

  const captures = new Set()
  let ignoring = true
  function syncHit() {
    const c = world.cursor
    let hit = captures.size > 0
    if (!hit && c.inside) {
      const node = document.elementFromPoint(c.x, c.y)
      hit = !!(node && node.closest('[data-hit]'))
    }
    if (hit === ignoring) {
      ignoring = !hit
      api.setIgnoreMouse(ignoring)
    }
  }
  // The cursor feed from main and the DOM event often report the same spot:
  // test what is under the cursor once per spot, not once per report.
  const tested = { x: NaN, y: NaN, inside: false }
  function hitTest() {
    const c = world.cursor
    if (c.x === tested.x && c.y === tested.y && c.inside === tested.inside) return
    tested.x = c.x; tested.y = c.y; tested.inside = c.inside
    syncHit()
  }
  world.captureAll = (key) => { captures.add(key); syncHit() }
  world.releaseCapture = (key) => { captures.delete(key); syncHit() }

  // ---------- persistence ----------

  let saveTimer = null
  world.saveSoon = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { api.savePet(pet.exportStats()); pet.dirtyStats = false }, 800)
  }
  setInterval(() => { if (pet.dirtyStats) world.saveSoon() }, 30000)
  window.addEventListener('beforeunload', () => { try { api.savePetNow(pet.exportStats()) } catch {} })

  // ---------- invitation / quick menu bubble ----------

  const menu = document.createElement('div')
  menu.className = 'menu'
  menu.dataset.hit = 'menu'
  layer.appendChild(menu)
  let menuOpen = false
  let menuTimer = null
  let menuShownAt = 0
  let menuSide = null
  let menuKind = null

  // Action ids match lib/actions.js (tray / right-click menus) and the panel.
  const ACTIONS = {
    feed: () => play.feed(),
    ball: () => play.startBall(),
    'game:catch': () => play.startGame('catch'),
    'game:tag': () => play.startGame('tag'),
    sleep: () => { play.stop(); pet.sleep(rand(60, 120)) },
    panel: () => api.togglePanel('pet'),
  }

  function openMenu(kind) {
    const title = {
      hungry: pick(Pet.LINES.hungry),
      play: pick(Pet.LINES.bored),
      menu: `Lv.${pet.stats.level} 클로디 — 뭐 할까?`,
    }[kind]
    const items = [
      ['feed', '🍪 밥 주기'],
      ['ball', '⚽ 축구하기'],
      ['game:catch', '🎮 쿠키 받기'],
      ['game:tag', '🏃 술래잡기'],
    ]
    if (kind === 'menu') items.push(['sleep', '💤 재우기'], ['panel', '📋 상태'])
    const head = document.createElement('div')
    head.className = 'm-title'
    head.textContent = title
    const grid = document.createElement('div')
    grid.className = 'm-grid'
    for (const [key, label] of items) {
      const b = document.createElement('button')
      b.textContent = label
      if (kind === 'hungry' && key === 'feed') b.classList.add('hl')
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        if (performance.now() - menuShownAt < CB.ARM_MS) return
        closeMenu(); ACTIONS[key]()
      })
      grid.appendChild(b)
    }
    const later = document.createElement('button')
    later.className = 'm-later'
    // "닫기" only closes the popup (the pet waits a while before asking again)
    later.textContent = '닫기'
    later.addEventListener('click', (e) => {
      e.stopPropagation()
      if (performance.now() - menuShownAt < CB.ARM_MS) return
      closeMenu()
    })
    menu.replaceChildren(head, grid, later)
    menu.classList.add('show')
    menuOpen = true
    menuShownAt = performance.now()
    menuSide = null
    menuKind = kind
    pet.bubble.classList.remove('show')
    clearTimeout(menuTimer)
    menuTimer = setTimeout(() => {
      if (!menuOpen) return
      closeMenu()
      if (kind !== 'menu') pet.sad(1.6, '바쁜가 보다…')
    }, kind === 'menu' ? 12000 : 16000)
    Sound.play('pop')
  }

  function closeMenu() {
    menuOpen = false
    clearTimeout(menuTimer)
    menu.classList.remove('show')
  }

  world.invite = (kind) => {
    // the pet may already be on its way when focus mode is switched on
    if (world.settings.focus) return pet.idle(1)
    pet.wave(16)
    openMenu(kind)
  }

  // ---------- pointer handling ----------

  let press = null // { x, y, t, ox, oy, dragging }
  let lastClickAt = 0
  let lastSample = null
  const strokes = { dir: 0, flips: 0, since: 0 }

  // cursor speed (px/s), so the ball can be kicked by just swiping into it
  function moveCursor(x, y) {
    const c = world.cursor
    const now = performance.now()
    const dt = (now - (c.at || 0)) / 1000
    // the same spot arrives twice (main's feed + the DOM event): not a stop
    if (x === c.x && y === c.y && dt < 0.05) return
    if (dt > 0 && dt < 0.2) {
      c.vx = ((x - c.x) / dt) * 0.6 + (c.vx || 0) * 0.4
      c.vy = ((y - c.y) / dt) * 0.6 + (c.vy || 0) * 0.4
    } else if (dt >= 0.2) { c.vx = 0; c.vy = 0 }
    if (dt > 0) c.at = now
    c.x = x
    c.y = y
  }

  function cursorFromEvent(e) {
    moveCursor(e.clientX, e.clientY)
    world.cursor.inside = true
    return { x: e.clientX, y: e.clientY }
  }

  document.addEventListener('mousemove', (e) => {
    const { x, y } = cursorFromEvent(e)
    hitTest()
    if (press) {
      wake()
      if (!press.dragging && Math.hypot(x - press.x, y - press.y) > 5) {
        press.dragging = true
        play.stop()
        closeMenu()
        pet.dragged()
      }
      if (press.dragging) {
        const now = performance.now()
        if (lastSample) {
          const dt = Math.max(1, now - lastSample.t) / 1000
          pet.act.vx = (x - lastSample.x) / dt * 0.6 + (pet.act.vx || 0) * 0.4
          pet.act.vy = (y - lastSample.y) / dt * 0.6 + (pet.act.vy || 0) * 0.4
        }
        lastSample = { x, y, t: now }
        pet.x = x - press.ox
        pet.y = y - press.oy
        pet.clampPos()
      }
      return
    }
    nudge()
    // petting: rubbing back and forth over the pet
    if (pet.contains(x, y) && !play.busy()) {
      const dir = Math.sign(e.movementX)
      const now = performance.now()
      if (now - strokes.since > 1400) { strokes.flips = 0; strokes.since = now }
      if (dir && dir !== strokes.dir) { strokes.flips++; strokes.dir = dir }
      if (strokes.flips >= 5) {
        strokes.flips = 0
        strokes.since = now
        if (pet.act?.name === 'sleep') pet.wake()
        else if (pet.act?.name !== 'love') { pet.love(); pet.sayLine('pet', 1400) }
      }
    }
  })

  document.addEventListener('mousedown', (e) => {
    wake()
    const { x, y } = cursorFromEvent(e)
    if (play.mode === 'holding') { play.dropFood(); return }
    if (play.game) {
      if (e.target.closest('button')) return
      play.onGameClick(x, y)
      return
    }
    if (e.button !== 0) return
    if (!pet.contains(x, y)) return
    press = { x, y, t: performance.now(), ox: x - pet.x, oy: y - pet.y, dragging: false }
    lastSample = null
    world.captureAll('press')
  })

  document.addEventListener('mouseup', (e) => {
    if (!press) return
    wake()
    const p = press
    press = null
    world.releaseCapture('press')
    if (p.dragging) {
      const vx = clamp(pet.act.vx || 0, -2200, 2200)
      const vy = clamp(pet.act.vy || 0, -2200, 2200)
      if (Math.hypot(vx, vy) > 160) pet.tossed(vx, vy)
      else { pet.squash = 0.2; Sound.play('land'); pet.idle(0.8) }
      pet.boost({ fun: 2 })
      return
    }
    // click
    const now = performance.now()
    const double = now - lastClickAt < 320
    lastClickAt = now
    if (pet.act?.name === 'sleep') { pet.wake(); return }
    if (double) { openMenu('menu'); return }
    if (notify.pending.length && !notify.expanded) { notify.expand(); pet.hop(200); return }
    pet.hop(260)
    pet.sayLine('click', 1300)
    pet.boost({ fun: 1, xp: 1 })
    if (Math.random() < 0.3) pet.emote('heart')
  })

  document.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    if (pet.contains(e.clientX, e.clientY)) api.showPetMenu()
  })

  // ---------- events from main ----------

  api.onCursor((c) => {
    const moved = Math.abs(c.x - world.cursor.x) + Math.abs(c.y - world.cursor.y) > 2
    moveCursor(c.x, c.y)
    world.cursor.inside = c.inside
    if (moved) world.cursor.movedAt = world.uptime
    if (!press) hitTest()
    nudge()
  })

  let wasAway = false
  api.onIdle((sec) => {
    wake()
    const prev = world.idleSec
    world.idleSec = sec
    if (sec > 240) wasAway = true
    if (wasAway && sec < 5 && prev >= 5) {
      wasAway = false
      if (world.settings.dnd) return
      const n = notify.pending.length
      if (pet.act?.name === 'sleep') pet.act.dur = 0
      const greet = () => {
        if (n) {
          pet.wave(3, `자리 비운 사이 알림 ${n}개 왔어!`)
          notify.expand()
        } else pet.wave(2.4, pick(Pet.LINES.welcome))
      }
      if (world.canRoam()) pet.approachUser({ then: greet })
      else greet()
    }
  })

  api.onNotify((n) => {
    wake()
    notify.onNotify(n)
    // a short task that just finished: the badge is enough
    if (world.settings.dnd || n.quiet) return
    closeMenu()
    if (play.game) return // don't yank the pet out of a game; the card still shows
    play.stop()
    const need = n.kind !== 'done'
    Sound.play(need ? 'need' : 'done')
    if (pet.act?.name === 'sleep') pet.wake()
    pet.emote(need ? '!' : '♪')
    const arrive = () => {
      if (need) pet.attend({ dur: 6, hopEvery: 1.6, expr: 'wide' })
      else pet.celebrate(1.6, { emote: 'star' })
    }
    // roaming off: alert from where it stands instead of running to the cursor
    if (world.canRoam() && world.cursor.inside) pet.approachUser({ run: true, then: arrive, giveUp: 6 })
    else arrive()
  })

  api.onData((d) => {
    wake()
    world.data = d
    notify.onData(d)
  })

  api.onSkin((skin) => {
    wake()
    CB.Sprites.setSkin(skin)
    pet.setScale(world.settings.scale)
    if (world.settings.dnd) return
    play.stop()
    pet.emote('star', 5)
    Sound.play('levelup')
    pet.celebrate(1.6, { line: skin ? '새 모습 어때?' : '원래대로 돌아왔어!', emote: 'heart' })
  })

  api.onSessionBusy(() => {
    wake()
    if (pet.act?.name === 'idle' && Math.random() < 0.5) pet.work()
  })

  api.onSettings((s) => {
    wake()
    const scaleChanged = s.scale !== world.settings.scale
    world.settings = s
    Sound.setEnabled(s.sound)
    if (scaleChanged) pet.setScale(s.scale)
    if (s.dnd && pet.act?.name !== 'sleep') { play.stop(); closeMenu(); pet.sit(20) }
    else if (s.focus && menuOpen && menuKind !== 'menu') closeMenu()
    notify.renderBadge()
  })

  api.onDisplay((d) => {
    wake()
    world.w = d.width
    world.h = d.height
    // the cursor feed for the new screen is ~33 ms away; use the position main sent
    if (d.cursor) { world.cursor.x = d.cursor.x; world.cursor.y = d.cursor.y; world.cursor.inside = true }
    if (d.reason === 'notify' || d.reason === 'summon' || d.reason === 'follow') {
      // arrive from the bottom edge, under the cursor
      pet.x = clamp(world.cursor.x, pet.pw, world.w - pet.pw)
      pet.y = world.h - 6
    }
    play.stop()
    pet.clampPos()
  })

  api.onAction((a) => {
    wake()
    closeMenu()
    if (a === 'summon') return summon()
    if (ACTIONS[a] && a !== 'panel') ACTIONS[a]()
  })

  // Hotkey / tray summon: pop right in front of the cursor. Far away → teleport
  // with a puff; close by → just hop over. Pressing again while the cards are
  // open closes them.
  let lastSummon = 0
  function summon() {
    const now = performance.now()
    if (now - lastSummon < 1500 && notify.expanded) { notify.collapse(); return }
    lastSummon = now
    if (play.game) return
    play.stop()
    closeMenu()
    const wasAsleep = pet.act?.name === 'sleep'
    const spot = pet.spotNearCursor()
    const arrive = () => {
      if (notify.pending.length) {
        notify.expand()
        const need = notify.pending.filter(n => n.kind !== 'done').length
        pet.attend({ dur: 4, expr: need ? 'wide' : 'normal', line: need ? `응답 기다리는 세션 ${need}개!` : `새 알림 ${notify.pending.length}개!` })
      } else {
        pet.wave(2.2, wasAsleep ? '으음… 불렀어?' : pick(['불렀어?', '여기 있어!', '짠!', '왔다!']))
      }
    }
    if (!world.cursor.inside) { arrive(); return }
    if (pet.distTo(spot.x, spot.y) > 260) {
      pet.emote('star', 3)
      pet.x = spot.x
      pet.y = spot.y
      pet.z = 40
      pet.vz = 0
      pet.emote('star', 4)
      Sound.play('levelup')
      arrive()
    } else {
      Sound.play('pop')
      pet.walkTo(spot.x, spot.y, { run: true, then: arrive })
    }
  }

  window.addEventListener('resize', () => {
    wake()
    world.w = window.innerWidth
    world.h = window.innerHeight
    pet.clampPos()
  })

  // ---------- frame loop ----------
  // Frames are drawn only while something moves. When the pet is still, the
  // loop stops and one timer wakes it for the next thing due (the end of the
  // current activity, a blink, a speech bubble going away). Anything that
  // changes the scene from outside calls wake() first.

  const REST_DT_MAX = 30
  let last = performance.now()
  let lastDrawn = 0 // when the last step ran (wall clock, for pacing)
  let needTick = 0
  let frameErrors = 0
  let rafOn = false
  let resting = false
  let restTimer = null
  let tracking = false

  const paceState = () => ({
    act: pet.act, z: pet.z, vz: pet.vz, squash: pet.squash,
    blinkAt: pet.blinkAt, blinkT: pet.blinkT, sayTimer: pet.sayTimer, t: pet.t,
    busy: play.busy(), menuOpen, pressing: !!press, needTick,
  })

  // Ask for the next frame. Walking and hopping are drawn 30 times a second.
  // Most of the gap is waited out on a timer, so a 120 Hz display doesn't call
  // back four times for every frame that is drawn; the timer ends early
  // enough to catch the screen refresh the frame is meant for, and frame()
  // skips a refresh that comes too soon.
  function schedule() {
    if (rafOn) return
    rafOn = true
    const wait = Pace.frameGap(paceState()) - (performance.now() - lastDrawn) - 12
    if (wait > 2) setTimeout(() => requestAnimationFrame(frame), wait)
    else requestAnimationFrame(frame)
  }

  // One bad frame (e.g. a broken skin) must not freeze the pet for good:
  // contain errors per step and keep the loop going.
  function safeStep(now, maxDt) {
    try { step(now, maxDt); return true } catch (e) {
      if (frameErrors++ < 5) console.error('[claude-bouncer] frame error:', e)
      if (frameErrors === 20 && CB.Sprites.getSkin()) {
        // a look that can't be drawn: fall back to the classic Claude
        CB.Sprites.setSkin(null)
        pet.setScale(world.settings.scale)
      }
      return false
    }
  }

  // Stop drawing until something is due.
  function settle() {
    if (rafOn) return
    const wait = Pace.restDelay(paceState())
    if (!(wait > 0)) return schedule()
    resting = true
    restTimer = setTimeout(() => {
      if (!resting) return
      resting = false
      if (safeStep(performance.now(), REST_DT_MAX)) settle(); else schedule()
    }, wait * 1000)
  }

  // Bring the scene up to now (the time spent resting counts for the activity
  // that was resting) and draw again from the next frame.
  function wake() {
    if (resting) {
      resting = false
      clearTimeout(restTimer)
      safeStep(performance.now(), REST_DT_MAX)
    }
    schedule()
  }
  world.wake = wake

  // The cursor moved. A resting pet only needs a new frame when its eyes
  // would turn to follow it.
  function nudge() {
    if (resting && pet.act?.look && pet.gaze() !== pet.lastGaze) wake()
  }

  function frame(now) {
    rafOn = false
    if (resting) { resting = false; clearTimeout(restTimer) }
    if (now - last < Pace.frameGap(paceState()) - 3) return schedule()
    if (safeStep(now, 0.05)) settle(); else schedule()
  }

  function step(now, maxDt) {
    const dt = clamp((now - last) / 1000, 0, maxDt)
    last = now
    lastDrawn = performance.now()
    world.uptime += dt
    needTick += dt
    if (needTick >= 10) { pet.tickNeeds(needTick / 60); needTick = 0 }

    // keep the pet put while you're reading its cards or menu
    if ((notify.expanded || menuOpen) && ['walk', 'idle', 'sit'].includes(pet.act?.name)) {
      pet.attend({ dur: 2, expr: notify.hasFreshNeed() ? 'wide' : 'normal' })
    }

    pet.update(dt)
    play.update(dt)
    pet.render()
    notify.render()
    if (menuOpen && !menu.matches(':hover')) {
      const pos = CB.place(world, pet, menu.offsetWidth, menu.offsetHeight, menuSide)
      menuSide = pos.side
      menu.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`
    }

    // main reads the cursor fast only while the pet has to follow it
    const follow = Pace.followsCursor(paceState())
    if (follow !== tracking) { tracking = follow; api.trackCursor(follow) }
  }
  schedule()

  // first hello
  setTimeout(() => {
    if (world.settings.dnd) return
    pet.celebrate(1.4, { line: state.pet.lastSeen ? pick(Pet.LINES.welcome) : '안녕! 나는 클로디야', emote: 'heart' })
  }, 600)
})()

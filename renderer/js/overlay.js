// Overlay bootstrap: world state, the frame loop, mouse handling
// (click-through except over interactive bits), and wiring to main.

;(async function () {
  const api = window.api
  const { Pet, Notify, Play, Sound } = CB
  const { clamp, pick, rand } = CB.util
  const layer = document.getElementById('layer')

  const state = await api.getState()

  const world = {
    w: window.innerWidth,
    h: window.innerHeight,
    layer,
    settings: state.settings,
    data: { pending: state.pending || [], sessions: state.sessions || [], working: state.working || 0 },
    cursor: { x: window.innerWidth / 2, y: window.innerHeight / 2, inside: false, movedAt: 0 },
    idleSec: 0,
    uptime: 0,
  }
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
  world.captureAll = (key) => { captures.add(key); syncHit() }
  world.releaseCapture = (key) => { captures.delete(key); syncHit() }

  // ---------- persistence ----------

  let saveTimer = null
  world.saveSoon = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { api.savePet(pet.exportStats()); pet.dirtyStats = false }, 800)
  }
  setInterval(() => { if (pet.dirtyStats) world.saveSoon() }, 30000)
  window.addEventListener('beforeunload', () => api.savePet(pet.exportStats()))

  // ---------- invitation / quick menu bubble ----------

  const menu = document.createElement('div')
  menu.className = 'menu'
  menu.dataset.hit = 'menu'
  layer.appendChild(menu)
  let menuOpen = false
  let menuTimer = null
  let menuShownAt = 0
  let menuSide = null

  const ACTIONS = {
    feed: () => play.feed(),
    ball: () => play.startBall(),
    catch: () => play.startGame('catch'),
    tag: () => play.startGame('tag'),
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
      ['ball', '⚽ 공놀이'],
      ['catch', '🎮 쿠키 받기'],
      ['tag', '🏃 술래잡기'],
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
    later.textContent = kind === 'menu' ? '닫기' : '나중에'
    later.addEventListener('click', (e) => {
      e.stopPropagation()
      if (performance.now() - menuShownAt < CB.ARM_MS) return
      closeMenu()
      if (kind !== 'menu') pet.sad(1.6, pick(Pet.LINES.decline))
    })
    menu.replaceChildren(head, grid, later)
    menu.classList.add('show')
    menuOpen = true
    menuShownAt = performance.now()
    menuSide = null
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
    pet.wave(16)
    openMenu(kind)
  }

  // ---------- pointer handling ----------

  let press = null // { x, y, t, ox, oy, dragging }
  let lastClickAt = 0
  let lastSample = null
  const strokes = { dir: 0, flips: 0, since: 0 }

  function cursorFromEvent(e) {
    world.cursor.x = e.clientX
    world.cursor.y = e.clientY
    world.cursor.inside = true
  }

  document.addEventListener('mousemove', (e) => {
    cursorFromEvent(e)
    syncHit()
    if (press) {
      if (!press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) {
        press.dragging = true
        play.stop()
        closeMenu()
        pet.dragged()
      }
      if (press.dragging) {
        const now = performance.now()
        if (lastSample) {
          const dt = Math.max(1, now - lastSample.t) / 1000
          pet.act.vx = (e.clientX - lastSample.x) / dt * 0.6 + (pet.act.vx || 0) * 0.4
          pet.act.vy = (e.clientY - lastSample.y) / dt * 0.6 + (pet.act.vy || 0) * 0.4
        }
        lastSample = { x: e.clientX, y: e.clientY, t: now }
        pet.x = e.clientX - press.ox
        pet.y = e.clientY - press.oy
        pet.clampPos()
      }
      return
    }
    // petting: rubbing back and forth over the pet
    if (pet.contains(e.clientX, e.clientY) && !play.busy()) {
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
    cursorFromEvent(e)
    if (play.mode === 'holding') { play.dropFood(); return }
    if (play.game) {
      if (e.target.closest('button')) return
      play.onGameClick(e.clientX, e.clientY)
      return
    }
    if (e.button !== 0) return
    if (!pet.contains(e.clientX, e.clientY)) return
    press = { x: e.clientX, y: e.clientY, t: performance.now(), ox: e.clientX - pet.x, oy: e.clientY - pet.y, dragging: false }
    lastSample = null
    world.captureAll('press')
  })

  document.addEventListener('mouseup', (e) => {
    if (!press) return
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
    world.cursor.x = c.x
    world.cursor.y = c.y
    world.cursor.inside = c.inside
    if (moved) world.cursor.movedAt = world.uptime
    if (!press) syncHit()
  })

  let wasAway = false
  api.onIdle((sec) => {
    const prev = world.idleSec
    world.idleSec = sec
    if (sec > 240) wasAway = true
    if (wasAway && sec < 5 && prev >= 5) {
      wasAway = false
      if (world.settings.dnd) return
      const n = notify.pending.length
      if (pet.act?.name === 'sleep') pet.act.dur = 0
      pet.approachUser({
        then: () => {
          if (n) {
            pet.wave(3, `자리 비운 사이 알림 ${n}개 왔어!`)
            notify.expand()
          } else pet.wave(2.4, pick(Pet.LINES.welcome))
        },
      })
    }
  })

  api.onNotify((n) => {
    notify.onNotify(n)
    if (world.settings.dnd) return
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
    if (world.cursor.inside) pet.approachUser({ run: true, then: arrive, giveUp: 6 })
    else arrive()
  })

  api.onData((d) => {
    world.data = d
    notify.onData(d)
  })

  api.onSkin((skin) => {
    CB.Sprites.setSkin(skin)
    pet.setScale(world.settings.scale)
    if (world.settings.dnd) return
    play.stop()
    pet.emote('star', 5)
    Sound.play('levelup')
    pet.celebrate(1.6, { line: skin ? '새 모습 어때?' : '원래대로 돌아왔어!', emote: 'heart' })
  })

  api.onSessionBusy(() => {
    if (pet.act?.name === 'idle' && Math.random() < 0.5) pet.work()
  })

  api.onSettings((s) => {
    const scaleChanged = s.scale !== world.settings.scale
    world.settings = s
    Sound.setEnabled(s.sound)
    if (scaleChanged) pet.setScale(s.scale)
    if (s.dnd && pet.act?.name !== 'sleep') { play.stop(); closeMenu(); pet.sit(20) }
    notify.renderBadge()
  })

  api.onDisplay((d) => {
    world.w = d.width
    world.h = d.height
    if (d.reason === 'notify' || d.reason === 'summon' || d.reason === 'follow') {
      // arrive from the bottom edge, under the cursor
      pet.x = clamp(world.cursor.x, pet.pw, world.w - pet.pw)
      pet.y = world.h - 6
    }
    play.stop()
    pet.clampPos()
  })

  api.onAction((a) => {
    closeMenu()
    if (a === 'summon') return summon()
    if (a === 'feed') return play.feed()
    if (a === 'ball') return play.startBall()
    if (a === 'game:catch') return play.startGame('catch')
    if (a === 'game:tag') return play.startGame('tag')
    if (a === 'sleep') { play.stop(); pet.sleep(rand(60, 120)) }
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
    world.w = window.innerWidth
    world.h = window.innerHeight
    pet.clampPos()
  })

  // ---------- frame loop ----------

  let last = performance.now()
  let needTick = 0
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    world.uptime += dt
    needTick += dt
    if (needTick >= 10) { pet.tickNeeds(needTick / 60); needTick = 0 }

    // keep the pet put while you're reading its cards or menu
    if ((notify.expanded || menuOpen) && ['walk', 'idle', 'sit'].includes(pet.act?.name)) {
      pet.attend({ dur: 2, expr: notify.pending.some(n => n.kind !== 'done') ? 'wide' : 'normal' })
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
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  // first hello
  setTimeout(() => {
    if (world.settings.dnd) return
    pet.celebrate(1.4, { line: state.pet.lastSeen ? pick(Pet.LINES.welcome) : '안녕! 나는 클로디야', emote: 'heart' })
  }, 600)
})()

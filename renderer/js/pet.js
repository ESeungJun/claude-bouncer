// The pet: position/physics, an activity state machine, needs (hunger/fun/
// energy), affection levels, speech bubbles and little emotes.
//
// Coordinates: (x, y) is the point between the pet's feet, in overlay-window
// pixels. z is the jump height above that point.

window.CB = window.CB || {}

;(function () {
  const { Sprites, Sound } = CB
  const rand = (a, b) => a + Math.random() * (b - a)
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
  const GRAVITY = 1500

  const LINES = {
    click: ['헤헤', '왜~?', '!', '히히', '간지러워!', '응?', '뀨'],
    pet: ['좋아…♥', '더 해줘!', '헤헤헤', '♥'],
    hungry: ['배고파…', '꼬르륵…', '밥 줘…!'],
    bored: ['놀아줘!', '심심해…', '같이 놀자!', '나랑 놀자~'],
    fed: ['냠냠!', '맛있다!', '최고야!', '배불러~'],
    wake: ['으음…', '잘 잤다!', '하암…'],
    welcome: ['어서와!', '왔구나!', '보고싶었어!'],
    decline: ['칫…', '알겠어…', '나중에 꼭!'],
    toss: ['우와아!', '꺄아!', '날아간다!'],
    dizzy: ['어지러워…', '빙글빙글…'],
    work: ['열일 중…', '코딩 코딩', '뚝딱뚝딱'],
  }

  class Pet {
    constructor(world) {
      this.w = world
      this.x = world.w - 90
      this.y = world.h - 24
      this.z = 0
      this.vz = 0
      this.squash = 0
      this.tilt = 0
      this.stats = { hunger: 80, fun: 70, energy: 90, xp: 0, level: 1, best: { catch: 0, tag: 0 }, fed: 0, played: 0, petted: 0 }
      this.act = null
      this.blinkAt = rand(1.5, 4)
      this.blinkT = 0
      this.lookX = 0
      this.lookY = 0
      this.t = 0
      this.lastPose = ''
      this.sayTimer = 0
      this.nextInviteAt = 60 // seconds of uptime before the first "let's play"
      this.dirtyStats = false

      const el = this.el = document.createElement('div')
      el.className = 'pet'
      el.dataset.hit = 'pet'
      this.shadow = document.createElement('div')
      this.shadow.className = 'shadow'
      this.body = document.createElement('div')
      this.body.className = 'pet-body'
      this.canvas = document.createElement('canvas')
      this.canvas.className = 'px'
      this.body.appendChild(this.canvas)
      el.append(this.shadow, this.body)
      this.bubble = document.createElement('div')
      this.bubble.className = 'say'
      world.layer.append(el, this.bubble)

      this.setScale(world.settings.scale || 3)
      this.idle(rand(1, 2))
    }

    // ---------- geometry ----------

    setScale(s) {
      this.baseScale = s
      const d = Sprites.dims()
      this.scale = Sprites.pixelScale(s)
      this.pw = d.w * this.scale
      this.ph = d.h * this.scale
      this.el.style.width = this.pw + 'px'
      this.el.style.height = this.ph + 'px'
      this.shadow.style.width = Math.round(this.pw * 0.7) + 'px'
      this.shadow.style.height = Math.max(4, s * 2) + 'px'
      this.lastPose = ''
      this.clampPos()
    }

    clampPos() {
      const m = 6
      this.x = clamp(this.x, this.pw / 2 + m, this.w.w - this.pw / 2 - m)
      this.y = clamp(this.y, this.ph + m, this.w.h - m)
    }

    // head (top-center) in window coords, for bubbles and emotes
    // rows of empty headroom above the visible pet (hair fills some with a skin)
    headroom() {
      const skin = Sprites.getSkin()
      return Sprites.isSheet(skin) ? 0 : skin ? 1 : Sprites.TOP
    }

    head() { return { x: this.x, y: this.y - this.z - this.ph + this.headroom() * this.scale } }

    contains(px, py) {
      const left = this.x - this.pw / 2
      const top = this.y - this.z - this.ph + this.headroom() * this.scale
      return px >= left && px <= left + this.pw && py >= top && py <= this.y - this.z
    }

    distTo(x, y) { return Math.hypot(this.x - x, this.y - y) }

    // a comfy spot near the cursor (beside and below it, never under it)
    // A comfy spot near the cursor: beside and below it, never under it,
    // so the pet doesn't get in the way of whatever you were clicking.
    spotNearCursor() {
      const c = this.w.cursor
      const side = this.x < c.x ? -1 : 1
      return {
        x: clamp(c.x + side * (this.pw / 2 + 60), this.pw, this.w.w - this.pw),
        y: clamp(c.y + this.ph + 50, this.ph + 10, this.w.h - 8),
      }
    }

    randomSpot(radius = 420) {
      const w = this.w
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2
        const r = rand(80, radius)
        const x = this.x + Math.cos(a) * r
        const y = this.y + Math.sin(a) * r * 0.7
        if (x > this.pw && x < w.w - this.pw && y > this.ph + 30 && y < w.h - 8) return { x, y }
      }
      return { x: rand(this.pw, w.w - this.pw), y: rand(w.h * 0.3, w.h - 10) }
    }

    // ---------- needs ----------

    load(saved) {
      if (!saved) return
      const s = this.stats
      for (const k of Object.keys(s)) if (saved[k] !== undefined) s[k] = saved[k]
      s.best = { catch: 0, tag: 0, ...(saved.best || {}) }
      // time passes while the app is closed (gently, capped at 8h)
      if (saved.lastSeen) {
        const min = Math.min(480, (Date.now() - saved.lastSeen) / 60000)
        s.hunger = clamp(s.hunger - min * 0.15, 15, 100)
        s.fun = clamp(s.fun - min * 0.2, 15, 100)
        s.energy = clamp(s.energy + min * 1.5, 0, 100)
      }
    }

    tickNeeds(dtMin) {
      const s = this.stats
      const asleep = this.act?.name === 'sleep'
      s.hunger = clamp(s.hunger - dtMin * 0.3, 0, 100)
      s.fun = clamp(s.fun - dtMin * (asleep ? 0.1 : 0.45), 0, 100)
      s.energy = clamp(s.energy + dtMin * (asleep ? 4 : this.act?.name === 'sit' ? 0.5 : -0.3), 0, 100)
      this.dirtyStats = true
    }

    boost(changes) {
      const s = this.stats
      for (const [k, v] of Object.entries(changes)) {
        if (k === 'xp') this.addXp(v)
        else if (k in s && typeof s[k] === 'number') s[k] = clamp(s[k] + v, 0, k === 'fed' || k === 'played' || k === 'petted' ? 1e9 : 100)
      }
      this.dirtyStats = true
      this.w.onStats?.()
    }

    xpNeeded(level = this.stats.level) { return 30 + level * 20 }

    addXp(n) {
      const s = this.stats
      s.xp += Math.max(0, Math.round(n))
      while (s.xp >= this.xpNeeded()) {
        s.xp -= this.xpNeeded()
        s.level++
        setTimeout(() => {
          this.say(`레벨 업! Lv.${s.level} ✨`, 3000)
          this.hop(380)
          this.emote('star', 5)
          Sound.play('levelup')
        }, 400)
      }
    }

    mood() {
      const s = this.stats
      if (s.energy < 12) return 'sleepy'
      if (s.hunger < 25) return 'hungry'
      if (s.fun < 30) return 'bored'
      return 'ok'
    }

    // ---------- speech + emotes ----------

    say(text, ms = 2200) {
      this.bubble.textContent = text
      this.bubble.classList.add('show')
      this.sayTimer = ms / 1000
    }

    sayLine(kind, ms) { this.say(pick(LINES[kind]), ms) }

    emote(kind, count = 1) {
      const h = this.head()
      for (let i = 0; i < count; i++) {
        let el
        if (kind === 'z' || kind === '!' || kind === '?' || kind === '♪') {
          el = document.createElement('div')
          el.className = 'emote-text emote-' + (kind === '!' ? 'bang' : kind === '?' ? 'q' : kind === 'z' ? 'z' : 'note')
          el.textContent = kind
        } else {
          el = Sprites.itemElement(kind, Math.max(2, this.scale - 1), 'emote')
        }
        el.style.left = (h.x + rand(-this.pw * 0.4, this.pw * 0.4)) + 'px'
        el.style.top = (h.y - 6) + 'px'
        el.style.animationDelay = (i * 0.12) + 's'
        this.w.layer.appendChild(el)
        setTimeout(() => el.remove(), 1600 + i * 120)
      }
    }

    // ---------- physics helpers ----------

    hop(v = 300) {
      if (this.z > 1) return
      this.vz = v
      this.squash = -0.12
      Sound.play('jump')
    }

    // ---------- activities ----------
    // Each activity: { name, t, update(dt) -> true when finished, pose() }

    setAct(act) {
      this.act?.exit?.()
      act.t = 0
      this.act = act
      return act
    }

    idle(dur = rand(1.5, 5)) {
      return this.setAct({
        name: 'idle', dur,
        update: (dt) => this.act.t >= this.act.dur,
        pose: () => ({}),
        look: true,
      })
    }

    walkTo(x, y, { run = false, then = null, speed, tolerance = 4 } = {}) {
      const sp = speed || (run ? 170 : 55)
      const target = { x, y }
      return this.setAct({
        name: run ? 'run' : 'walk',
        target, then,
        update: (dt) => {
          const dx = target.x - this.x
          const dy = target.y - this.y
          const d = Math.hypot(dx, dy)
          if (d <= tolerance) { then ? then() : this.idle(); return false }
          const step = Math.min(d, sp * dt)
          this.x += (dx / d) * step
          this.y += (dy / d) * step
          this.lookX = Math.abs(dx) > 2 ? Math.sign(dx) : 0
          this.lookY = Math.abs(dy) > Math.abs(dx) ? Math.sign(dy) : 0
          this.clampPos()
          return false
        },
        pose: () => {
          const f = Math.floor(this.t / (run ? 0.08 : 0.15)) % 2
          return { legs: f ? [2, 1, 2, 1] : [1, 2, 1, 2], bob: f, lx: this.lookX, ly: this.lookY, ...(run ? { armL: f ? 'mid' : 'down', armR: f ? 'down' : 'mid' } : {}) }
        },
      })
    }

    sit(dur = rand(5, 14)) {
      return this.setAct({
        name: 'sit', dur,
        update: () => this.act.t >= this.act.dur,
        pose: () => ({ dy: 2 }),
        look: true,
      })
    }

    sleep(dur = 120) {
      Sound.play('pop')
      return this.setAct({
        name: 'sleep', dur, zT: 0,
        update: (dt) => {
          const a = this.act
          a.zT -= dt
          if (a.zT <= 0) { this.emote('z'); a.zT = 2.2 }
          if (this.stats.energy >= 99 && a.t > 20) return true
          return a.t >= a.dur && !(this.w.idleSec > 120)
        },
        pose: () => ({ dy: 2, expr: 'sleep', breathe: true }),
        exit: () => {},
      })
    }

    wake(line = 'wake') {
      if (this.act?.name !== 'sleep') return
      this.sayLine(line)
      this.hop(220)
      this.idle(1.5)
    }

    work(dur = rand(8, 16)) {
      return this.setAct({
        name: 'work', dur,
        update: () => this.act.t >= this.act.dur || this.w.data.working === 0,
        pose: () => {
          const f = Math.floor(this.act.t / 0.12) % 2
          return { dy: 2, ly: 1, armL: f ? 'down' : 'mid', armR: f ? 'mid' : 'down' }
        },
      })
    }

    celebrate(dur = 1.4, { line, emote = 'star' } = {}) {
      if (line) this.say(line)
      if (emote) this.emote(emote, 3)
      return this.setAct({
        name: 'happy', dur, hops: 0,
        update: (dt) => {
          if (this.z <= 0 && this.act.hops < 2 && this.act.t > this.act.hops * 0.5) { this.act.hops++; this.hop(300) }
          return this.act.t >= this.act.dur
        },
        pose: () => ({ expr: 'happy', mouth: 'open', armL: 'up', armR: 'up', legs: this.z > 0 ? [1, 1, 1, 1] : undefined }),
      })
    }

    love(dur = 1.6) {
      Sound.play('love')
      this.emote('heart', 3)
      this.boost({ fun: 6, petted: 1, xp: 2 })
      return this.setAct({
        name: 'love', dur,
        update: () => this.act.t >= this.act.dur,
        pose: () => ({ expr: 'love', mouth: 'cat', armR: Math.floor(this.act.t / 0.25) % 2 ? 'up' : 'mid' }),
      })
    }

    wave(dur = 2.2, line) {
      if (line) this.say(line, dur * 1000)
      return this.setAct({
        name: 'wave', dur,
        update: () => this.act.t >= this.act.dur,
        pose: () => ({ expr: 'happy', mouth: 'smile', armR: Math.floor(this.act.t / 0.22) % 2 ? 'up' : 'mid' }),
      })
    }

    sad(dur = 2, line) {
      if (line) this.say(line)
      return this.setAct({
        name: 'sad', dur,
        update: () => this.act.t >= this.act.dur,
        pose: () => ({ expr: 'sad', mouth: 'frown', armL: 'down', armR: 'down' }),
      })
    }

    dizzy(dur = 1.8) {
      this.sayLine('dizzy')
      return this.setAct({
        name: 'dizzy', dur,
        update: () => this.act.t >= this.act.dur,
        pose: () => ({ expr: 'dizzy', mouth: 'o', tilt: Math.sin(this.act.t * 14) * 8 }),
      })
    }

    eat(item, done) {
      Sound.play('eat')
      return this.setAct({
        name: 'eat', dur: 2.4, crumbs: 0,
        update: (dt) => {
          const a = this.act
          if (a.t > a.crumbs * 0.6) { a.crumbs++; Sound.play('eat'); item?.nibble?.(a.crumbs) }
          if (a.t >= a.dur) { done?.(); return true }
          return false
        },
        pose: () => ({ dy: 2, expr: 'happy', mouth: Math.floor(this.act.t / 0.18) % 2 ? 'open' : 'flat' }),
      })
    }

    // picked up by the mouse
    dragged() {
      this.sayLine('toss', 1200)
      this.vz = 0
      this.z = 0
      return this.setAct({
        name: 'dragged', vx: 0, vy: 0, maxSpeed: 0,
        update: () => false,
        pose: () => ({ expr: 'wide', mouth: 'o', armL: 'up', armR: 'up', legs: [1, 1, 1, 1], tilt: clamp(this.act.vx / 60, -18, 18) }),
      })
    }

    tossed(vx, vy) {
      const speed = Math.hypot(vx, vy)
      this.vz = Math.min(420, speed * 0.25)
      return this.setAct({
        name: 'tossed', vx, vy, peak: speed,
        update: (dt) => {
          const a = this.act
          this.x += a.vx * dt
          this.y += a.vy * dt
          const f = Math.pow(0.08, dt) // strong friction
          a.vx *= f; a.vy *= f
          const minX = this.pw / 2 + 6, maxX = this.w.w - this.pw / 2 - 6
          if (this.x < minX || this.x > maxX) { a.vx *= -0.6; Sound.play('land') }
          if (this.y < this.ph + 6 || this.y > this.w.h - 6) { a.vy *= -0.6; Sound.play('land') }
          this.clampPos()
          if (Math.hypot(a.vx, a.vy) < 25 && this.z <= 0) {
            if (a.peak > 1400) this.dizzy()
            else if (a.peak > 500) this.celebrate(1, { line: '한 번 더!', emote: null })
            else this.idle(1)
          }
          return false
        },
        pose: () => ({ expr: 'wide', mouth: 'open', armL: 'up', armR: 'up', legs: [1, 1, 1, 1], tilt: clamp(this.act.vx / 40, -25, 25) }),
      })
    }

    // Come over to the person (follows the cursor), then do `then`.
    approachUser({ run = true, then, giveUp = 12 } = {}) {
      const spot = this.spotNearCursor()
      const act = this.walkTo(spot.x, spot.y, { run, then, tolerance: 8 })
      const baseUpdate = act.update
      let retarget = 0
      act.name = 'approach'
      act.update = (dt) => {
        retarget -= dt
        if (retarget <= 0) {
          retarget = 0.4
          const s = this.spotNearCursor()
          act.target.x = s.x; act.target.y = s.y
        }
        if (act.t > giveUp) { then ? then() : this.idle(); return false }
        return baseUpdate(dt)
      }
      return act
    }

    // Waiting next to the person, looking at them (optionally hopping).
    attend({ dur = 6, hopEvery = 0, expr = 'normal', line } = {}) {
      if (line) this.say(line, dur * 1000)
      return this.setAct({
        name: 'attend', dur, hopT: hopEvery,
        update: (dt) => {
          const a = this.act
          if (hopEvery) { a.hopT -= dt; if (a.hopT <= 0) { a.hopT = hopEvery; this.hop(260) } }
          return a.t >= a.dur
        },
        pose: () => ({ expr, mouth: expr === 'wide' ? 'o' : undefined, armL: this.z > 0 ? 'up' : 'mid', armR: this.z > 0 ? 'up' : 'mid' }),
        look: true,
      })
    }

    // ---------- brain ----------

    think() {
      const w = this.w
      const s = this.stats
      const mood = this.mood()
      const quiet = w.settings.dnd
      const userActive = w.idleSec < 30 && w.cursor.inside
      const needsYou = w.data.pending.some(n => n.kind !== 'done')

      if (w.play?.busy()) return this.idle(1)
      if (w.idleSec > 240 || (mood === 'sleepy' && !needsYou)) return this.sleep(rand(90, 240))
      if (quiet) return Math.random() < 0.7 ? this.sit(rand(10, 30)) : this.idle(rand(3, 8))

      // a notification is still waiting for an answer: stay close and keep nudging
      if (needsYou) {
        if (this.distTo(w.cursor.x, w.cursor.y) > 260 && userActive) return this.approachUser({ then: () => this.attend({ dur: 4, hopEvery: 2, expr: 'wide' }) })
        return this.attend({ dur: 5, hopEvery: 2.5, expr: 'wide' })
      }

      if (w.data.working > 0 && Math.random() < 0.3) {
        if (Math.random() < 0.3) this.sayLine('work', 1800)
        return this.work()
      }

      const wantsCompany = mood === 'hungry' || mood === 'bored' || Math.random() < 0.04
      if (wantsCompany && userActive && w.uptime > this.nextInviteAt) {
        this.nextInviteAt = w.uptime + rand(10, 18) * 60
        return this.approachUser({ then: () => w.invite(mood === 'hungry' ? 'hungry' : 'play') })
      }

      if (!w.settings.roam) return Math.random() < 0.4 ? this.sit() : this.idle(rand(3, 7))

      const r = Math.random()
      if (r < 0.5) {
        const p = this.randomSpot()
        return this.walkTo(p.x, p.y)
      }
      if (r < 0.62) return this.sit()
      if (r < 0.7) { this.hop(240); return this.idle(1.2) }
      if (r < 0.75 && mood === 'ok') { this.emote('♪'); return this.wave(1.4) }
      return this.idle()
    }

    // ---------- frame ----------

    update(dt) {
      this.t += dt
      if (this.act) {
        this.act.t += dt
        if (this.act.update(dt)) this.think()
      } else this.think()

      // vertical physics (hops)
      if (this.z > 0 || this.vz > 0) {
        this.vz -= GRAVITY * dt
        this.z += this.vz * dt
        if (this.z <= 0) {
          this.z = 0
          this.vz = 0
          this.squash = 0.18
        }
      }
      this.squash *= Math.pow(0.0008, dt)

      // blinking
      this.blinkAt -= dt
      if (this.blinkAt <= 0) { this.blinkT = 0.12; this.blinkAt = rand(2, 5.5) }
      if (this.blinkT > 0) this.blinkT -= dt

      if (this.sayTimer > 0) {
        this.sayTimer -= dt
        if (this.sayTimer <= 0) this.bubble.classList.remove('show')
      }
    }

    currentPose() {
      const p = { ...(this.act?.pose?.() || {}) }
      if (this.act?.look) {
        const c = this.w.cursor
        if (c.inside && this.distTo(c.x, c.y) < 500) {
          const dx = c.x - this.x
          const dy = c.y - (this.y - this.ph / 2)
          p.lx = Math.abs(dx) > 30 ? Math.sign(dx) : 0
          p.ly = dy < -60 ? -1 : dy > 40 ? 1 : 0
        }
      }
      if (this.blinkT > 0 && (!p.expr || p.expr === 'normal')) p.expr = 'blink'
      return p
    }

    render() {
      const p = this.currentPose()
      const { bob = 0, tilt = 0, breathe = false, ...spriteOpts } = p
      const key = JSON.stringify(spriteOpts)
      if (key !== this.lastPose) {
        Sprites.blit(this.canvas, Sprites.petCanvas(spriteOpts), this.scale)
        this.lastPose = key
      }
      const left = this.x - this.pw / 2
      const top = this.y - this.ph
      this.el.style.transform = `translate3d(${left}px, ${top}px, 0)`
      let sx = 1 + this.squash
      let sy = 1 - this.squash
      if (breathe) { const b = Math.sin(this.t * 2.2) * 0.03; sx += b; sy -= b }
      this.body.style.transform =
        `translateY(${-this.z - bob * this.scale}px) rotate(${tilt}deg) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`
      const shadowScale = Math.max(0.4, 1 - this.z / 200)
      this.shadow.style.transform = `translateX(-50%) scale(${shadowScale.toFixed(2)})`
      this.shadow.style.opacity = (0.28 * shadowScale).toFixed(2)

      if (this.bubble.classList.contains('show')) {
        const h = this.head()
        const bw = this.bubble.offsetWidth
        const bx = clamp(h.x - bw / 2, 4, this.w.w - bw - 4)
        const by = Math.max(4, h.y - this.bubble.offsetHeight - 2 * this.scale - 26)
        this.bubble.style.transform = `translate3d(${bx}px, ${by}px, 0)`
      }
    }

    exportStats() {
      return { ...this.stats, best: { ...this.stats.best }, lastSeen: Date.now() }
    }
  }

  Pet.LINES = LINES
  CB.Pet = Pet
  CB.util = { rand, pick, clamp }
})()

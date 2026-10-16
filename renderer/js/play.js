// Things to do together: feeding, ball (fetch), and two mini games.
//   - feed:  a snack sticks to the cursor; click anywhere to drop it
//   - ball:  click the ball to kick it; the pet chases and kicks it back to you
//   - catch: steer the pet with the mouse, catch cookies, dodge bugs (30s)
//   - tag:   the pet runs around, click it as often as you can (20s)

window.CB = window.CB || {}

;(function () {
  const { Sprites, Sound } = CB
  const { rand, clamp, pick } = CB.util

  const el = CB.el

  class Play {
    constructor(world, pet) {
      this.w = world
      this.pet = pet
      this.mode = null // null | 'holding' | 'food' | 'ball' | 'game'
      this.item = null
      this.ball = null
      this.game = null
    }

    busy() { return this.mode !== null }

    stop() {
      this.item?.el.remove()
      this.item?.hint?.remove()
      this.item = null
      if (this.mode === 'holding') this.w.releaseCapture('holding')
      this.endBall(false)
      if (this.game) this.endGame(true)
      this.mode = null
    }

    // ---------- feeding ----------

    feed() {
      if (this.mode) this.stop()
      if (this.pet.act?.name === 'sleep') this.pet.wake()
      const kind = Math.random() < 0.25 ? 'apple' : 'cookie'
      const node = Sprites.itemElement(kind, Math.max(3, this.pet.scale), 'item held')
      this.w.layer.appendChild(node)
      const hint = el('div', 'hint', '클릭해서 내려놓기')
      this.w.layer.appendChild(hint)
      this.item = { kind, el: node, hint, x: this.w.cursor.x, y: this.w.cursor.y, z: 0, vz: 0, t: 0, bites: 0 }
      this.mode = 'holding'
      this.w.captureAll('holding')
      this.pet.say(kind === 'apple' ? '사과다!' : '쿠키다!', 1500)
      this.pet.attend({ dur: 8, expr: 'wide' })
    }

    // click while holding → drop at cursor
    dropFood() {
      const it = this.item
      if (!it || this.mode !== 'holding') return
      this.w.releaseCapture('holding')
      it.hint.remove()
      it.el.classList.remove('held')
      it.x = clamp(this.w.cursor.x, 20, this.w.w - 20)
      // keep the snack where the pet can actually stand (it can't go higher than its own height)
      it.y = clamp(this.w.cursor.y + 30, this.pet.ph + 10, this.w.h - 10)
      it.z = 30
      it.vz = 0
      this.mode = 'food'
      Sound.play('pop')
      const p = this.pet
      const side = p.x < it.x ? -1 : 1
      p.walkTo(it.x + side * (p.pw * 0.45), it.y, {
        run: true,
        then: () => p.eat({ nibble: (n) => this.nibble(n) }, () => this.finishFood()),
      })
    }

    nibble(n) {
      const it = this.item
      if (!it) return
      it.el.style.clipPath = `inset(0 0 0 ${Math.min(80, n * 25)}%)`
      const c = Sprites.itemElement('crumb', this.pet.scale, 'crumb')
      c.style.left = (it.x + rand(-10, 10)) + 'px'
      c.style.top = (it.y - 6) + 'px'
      this.w.layer.appendChild(c)
      setTimeout(() => c.remove(), 900)
    }

    finishFood() {
      const it = this.item
      it?.el.remove()
      this.item = null
      this.mode = null
      const p = this.pet
      p.boost({ hunger: it?.kind === 'apple' ? 18 : 25, fun: 4, energy: 3, fed: 1, xp: 5 })
      p.celebrate(1.2, { line: pick(CB.Pet.LINES.fed), emote: 'heart' })
      this.w.saveSoon()
    }

    updateFood(dt) {
      const it = this.item
      if (!it) return
      it.t += dt
      if (this.mode === 'holding') {
        it.x = this.w.cursor.x + 14
        it.y = this.w.cursor.y + 22
        it.hint.style.transform = `translate3d(${it.x - 40}px, ${it.y + 18}px, 0)`
        // nobody clicked (or the cursor left this screen): drop it beside the pet
        if (it.t > 7 || !this.w.cursor.inside) {
          this.w.cursor.x = this.pet.x + 50
          this.w.cursor.y = this.pet.y - 30
          this.dropFood()
        }
      } else {
        if (it.z > 0 || it.vz !== 0) {
          it.vz -= 1400 * dt
          it.z += it.vz * dt
          if (it.z <= 0) { it.z = 0; it.vz = Math.abs(it.vz) > 120 ? -it.vz * 0.35 : 0 }
        }
      }
      const w = it.el.width
      const h = it.el.height
      it.el.style.transform = `translate3d(${it.x - w / 2}px, ${it.y - h - it.z}px, 0)`
    }

    // ---------- ball ----------

    startBall() {
      if (this.mode) this.stop()
      if (this.pet.act?.name === 'sleep') this.pet.wake()
      const s = Math.max(3, this.pet.scale)
      const node = Sprites.itemElement('ball', s, 'item ball')
      node.dataset.hit = 'ball'
      const shadow = el('div', 'ball-shadow')
      this.w.layer.append(shadow, node)
      const p = this.pet
      this.ball = {
        el: node, shadow, r: (7 * s) / 2,
        x: clamp(p.x + 60, 30, this.w.w - 30), y: p.y, z: 120, vx: 0, vy: 0, vz: 0,
        lastUserKick: this.t(), kicks: 0, // timers count from when the ball appears
      }
      node.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        this.kickBall('user')
      })
      this.mode = 'ball'
      p.say('공놀이 하자! 공을 클릭해서 차줘', 2600)
      this.chase()
    }

    kickBall(who) {
      const b = this.ball
      if (!b) return
      const w = this.w
      let dx, dy, speed
      if (who === 'user') {
        dx = b.x - w.cursor.x; dy = (b.y - b.z) - w.cursor.y
        speed = rand(650, 900)
        b.lastUserKick = this.t()
        this.pet.boost({ fun: 2 })
      } else {
        // pet kicks it back toward you (fetch!)
        dx = w.cursor.x - b.x + rand(-60, 60); dy = w.cursor.y - b.y + rand(-40, 40)
        speed = rand(380, 560)
        if (!w.cursor.inside) { dx = rand(-1, 1); dy = rand(-1, 1) }
        this.pet.boost({ fun: 3, xp: 1 })
      }
      const d = Math.hypot(dx, dy) || 1
      b.vx = (dx / d) * speed
      b.vy = (dy / d) * speed
      b.vz = rand(220, 380)
      b.kicks++
      Sound.play('kick')
    }

    chase() {
      const p = this.pet
      const b = this.ball
      const act = p.setAct({
        name: 'chase',
        update: () => {
          if (!this.ball) return true
          const tx = b.x + (p.x < b.x ? -1 : 1) * (p.pw * 0.4)
          const dx = tx - p.x, dy = b.y - p.y
          const d = Math.hypot(dx, dy)
          const ballSpeed = Math.hypot(b.vx, b.vy)
          if (d < 10 && b.z < 14 && ballSpeed < 220) {
            this.kickBall('pet')
            p.hop(200)
            return false
          }
          if (d > 2) {
            const step = Math.min(d, 190 * this.lastDt)
            p.x += (dx / d) * step
            p.y += (dy / d) * step
            p.lookX = Math.sign(dx)
            p.clampPos()
          }
          return false
        },
        pose: () => {
          const f = Math.floor(act.t / 0.08) % 2
          return { expr: 'happy', mouth: 'open', legs: f ? [2, 1, 2, 1] : [1, 2, 1, 2], bob: f, lx: p.lookX }
        },
      })
    }

    updateBall(dt) {
      const b = this.ball
      if (!b) return
      b.x += b.vx * dt
      b.y += b.vy * dt
      const f = Math.pow(0.25, dt)
      b.vx *= f; b.vy *= f
      if (b.x < b.r || b.x > this.w.w - b.r) { b.vx *= -0.8; b.x = clamp(b.x, b.r, this.w.w - b.r) }
      if (b.y < b.r * 2 + 20 || b.y > this.w.h - 4) { b.vy *= -0.8; b.y = clamp(b.y, b.r * 2 + 20, this.w.h - 4) }
      if (b.z > 0 || b.vz) {
        b.vz -= 1400 * dt
        b.z += b.vz * dt
        if (b.z <= 0) { b.z = 0; b.vz = Math.abs(b.vz) > 90 ? -b.vz * 0.5 : 0 }
      }
      const size = b.el.width
      b.el.style.transform = `translate3d(${b.x - size / 2}px, ${b.y - size - b.z}px, 0) rotate(${(b.x * 2) % 360}deg)`
      b.shadow.style.transform = `translate3d(${b.x - size / 2}px, ${b.y - 4}px, 0)`
      // 40s without a kick from you → the game winds down
      if (this.t() - b.lastUserKick > 40 && b.kicks > 0 || this.t() - b.lastUserKick > 60) this.endBall(true)
    }

    endBall(talk) {
      const b = this.ball
      if (!b) return
      b.el.remove(); b.shadow.remove()
      this.ball = null
      if (this.mode === 'ball') this.mode = null
      if (talk) {
        this.pet.boost({ played: 1, xp: 3 })
        this.pet.celebrate(1.2, { line: '재밌었다!', emote: 'heart' })
        this.w.saveSoon()
      }
    }

    // ---------- mini games ----------

    startGame(kind) {
      if (this.mode) this.stop()
      if (this.pet.act?.name === 'sleep') this.pet.wake()
      const w = this.w
      const p = this.pet
      const gw = Math.min(kind === 'tag' ? 620 : 460, w.w - 40)
      const gh = Math.min(kind === 'tag' ? 440 : 420, w.h - 60)
      const cx = clamp(p.x, gw / 2 + 20, w.w - gw / 2 - 20)
      const by = clamp(p.y + 16, gh + 20, w.h - 10)
      const zone = { x: cx - gw / 2, y: by - gh, w: gw, h: gh }

      const box = el('div', 'game')
      box.dataset.hit = 'game'
      box.style.left = zone.x + 'px'; box.style.top = zone.y + 'px'
      box.style.width = gw + 'px'; box.style.height = gh + 'px'
      const hud = el('div', 'g-hud')
      const title = el('span', 'g-title', kind === 'tag' ? '🏃 술래잡기' : '🍪 쿠키 받기')
      const score = el('span', 'g-score', '0')
      const time = el('span', 'g-time', '')
      const close = el('button', 'g-close', '×')
      close.addEventListener('click', (e) => { e.stopPropagation(); this.endGame(true) })
      hud.append(title, score, time, close)
      const help = el('div', 'g-help', kind === 'tag' ? '도망다니는 클로디를 클릭해서 잡아요!' : '마우스로 움직여서 쿠키를 받고 🐛 버그는 피해요!')
      box.append(hud, help)
      w.layer.insertBefore(box, w.layer.firstChild)

      this.game = {
        kind, zone, box, scoreEl: score, timeEl: time, help,
        score: 0, cookies: 0, bugs: 0, t: 0, dur: kind === 'tag' ? 20 : 30,
        items: [], spawn: 0.8, countdown: 3, over: false, speed: 170, retarget: 0,
      }
      this.mode = 'game'
      p.x = cx
      p.y = by - 14
      p.z = 0
      p.setAct({ name: 'game', update: () => false, pose: () => this.gamePose() })
      Sound.play('pop')
    }

    gamePose() {
      const g = this.game
      const p = this.pet
      if (!g) return {}
      if (g.stun > 0) return { expr: 'dizzy', mouth: 'o' }
      if (g.over) return { expr: 'happy', mouth: 'open', armL: 'up', armR: 'up' }
      const moving = Math.abs(g.vx || 0) > 30
      const f = Math.floor(p.t / 0.08) % 2
      if (g.kind === 'tag') return { expr: g.caughtT > 0 ? 'wide' : 'happy', mouth: g.caughtT > 0 ? 'o' : 'smile', legs: f ? [2, 1, 2, 1] : [1, 2, 1, 2], bob: f, lx: Math.sign(g.vx || 0) }
      return { expr: g.happyT > 0 ? 'happy' : 'normal', mouth: g.happyT > 0 ? 'open' : undefined, ly: -1, armL: 'up', armR: 'up', legs: moving ? (f ? [2, 1, 2, 1] : [1, 2, 1, 2]) : undefined }
    }

    onGameClick(px, py) {
      const g = this.game
      if (!g || g.over || g.countdown > 0 || g.kind !== 'tag') return false
      const p = this.pet
      if (p.contains(px, py) || p.distTo(px, py + p.ph / 2) < p.pw * 0.75) {
        g.score++
        g.caughtT = 0.35
        g.speed = Math.min(520, g.speed + 18)
        Sound.play('catch')
        p.emote('star', 2)
        p.hop(240)
        g.retarget = 0
        return true
      }
      return true // clicks inside the zone are swallowed either way
    }

    updateGame(dt) {
      const g = this.game
      if (!g) return
      const p = this.pet
      const z = g.zone
      const c = this.w.cursor

      if (g.over) return
      if (g.countdown > 0) {
        g.countdown -= dt
        g.timeEl.textContent = g.countdown > 0 ? `시작까지 ${Math.ceil(g.countdown)}` : '시작!'
        if (g.countdown <= 0) { g.help.classList.add('fade'); Sound.play('catch') }
        return
      }

      g.t += dt
      const left = Math.max(0, g.dur - g.t)
      g.timeEl.textContent = `${left.toFixed(left < 10 ? 1 : 0)}초`
      g.scoreEl.textContent = String(g.score)
      if (g.stun > 0) g.stun -= dt
      if (g.happyT > 0) g.happyT -= dt
      if (g.caughtT > 0) g.caughtT -= dt

      const minX = z.x + p.pw / 2 + 4
      const maxX = z.x + z.w - p.pw / 2 - 4

      if (g.kind === 'catch') {
        // steer with the mouse
        const tx = clamp(c.x, minX, maxX)
        const prev = p.x
        if (!(g.stun > 0)) {
          const d = tx - p.x
          p.x += clamp(d, -900 * dt, 900 * dt)
        }
        g.vx = (p.x - prev) / Math.max(dt, 0.001)

        // spawn
        g.spawn -= dt
        if (g.spawn <= 0) {
          const progress = g.t / g.dur
          g.spawn = rand(0.35, 0.7) * (1 - progress * 0.45)
          const r = Math.random()
          const kind = r < 0.07 ? 'gold' : r < 0.07 + 0.18 + progress * 0.14 ? 'bug' : 'cookie'
          const node = Sprites.itemElement(kind, 3, 'item')
          g.box.appendChild(node)
          g.items.push({ kind, el: node, x: rand(14, z.w - 14), y: 40, vy: rand(130, 190) + progress * 140, wob: rand(0, 6) })
        }
        const catchTop = p.y - p.ph * 0.9 - z.y
        const catchBottom = p.y - p.ph * 0.2 - z.y
        const px = p.x - z.x
        g.items = g.items.filter((it) => {
          it.y += it.vy * dt
          it.el.style.transform = `translate3d(${it.x - 10 + Math.sin(g.t * 3 + it.wob) * 3}px, ${it.y - 10}px, 0)`
          if (it.y >= catchTop && it.y <= catchBottom && Math.abs(it.x - px) < p.pw / 2 + 4) {
            it.el.remove()
            if (it.kind === 'bug') {
              g.score = Math.max(0, g.score - 3); g.bugs++; g.stun = 0.7
              Sound.play('bug'); this.popText(it.x, it.y, '버그! -3', 'bad')
            } else {
              const pts = it.kind === 'gold' ? 5 : 1
              g.score += pts; g.cookies++; g.happyT = 0.3
              Sound.play('catch'); this.popText(it.x, it.y, `+${pts}`, it.kind === 'gold' ? 'gold' : '')
            }
            return false
          }
          if (it.y > z.h + 10) { it.el.remove(); return false }
          return true
        })
      } else {
        // tag: run around; flee from the cursor when it gets close
        g.retarget -= dt
        const near = Math.hypot(c.x - p.x, c.y - (p.y - p.ph / 2)) < 110
        if (g.retarget <= 0 || near) {
          g.retarget = rand(0.5, 1.1)
          if (near) {
            const a = Math.atan2(p.y - c.y, p.x - c.x) + rand(-0.8, 0.8)
            g.tx = p.x + Math.cos(a) * 200; g.ty = p.y + Math.sin(a) * 200
          } else {
            g.tx = rand(minX, maxX); g.ty = rand(z.y + p.ph + 40, z.y + z.h - 8)
          }
          g.tx = clamp(g.tx, minX, maxX)
          g.ty = clamp(g.ty, z.y + p.ph + 40, z.y + z.h - 8)
        }
        const dx = g.tx - p.x, dy = g.ty - p.y
        const d = Math.hypot(dx, dy)
        if (d > 2) {
          const step = Math.min(d, g.speed * dt)
          g.vx = (dx / d) * g.speed
          p.x += (dx / d) * step; p.y += (dy / d) * step
        } else g.vx = 0
      }

      if (g.t >= g.dur) this.finishGame()
    }

    popText(x, y, text, cls) {
      const t = el('div', 'pop ' + (cls || ''), text)
      t.style.left = x + 'px'; t.style.top = y + 'px'
      this.game.box.appendChild(t)
      setTimeout(() => t.remove(), 800)
    }

    finishGame() {
      const g = this.game
      g.over = true
      g.items.forEach(it => it.el.remove()); g.items = []
      const p = this.pet
      const best = p.stats.best[g.kind] || 0
      const record = g.score > best
      if (record) p.stats.best[g.kind] = g.score
      p.boost({
        fun: g.kind === 'tag' ? 25 : 20,
        hunger: g.kind === 'catch' ? Math.min(20, g.cookies) : -3,
        energy: -6,
        played: 1,
        xp: 5 + g.score * (g.kind === 'tag' ? 2 : 1),
      })
      Sound.play(record ? 'levelup' : 'end')
      const res = el('div', 'g-result')
      res.append(
        el('div', 'r-title', record ? '🏆 신기록!' : '끝!'),
        el('div', 'r-score', `${g.score}점`),
        el('div', 'r-best', `최고 ${Math.max(best, g.score)}점${g.kind === 'catch' ? ` · 쿠키 ${g.cookies}개 · 버그 ${g.bugs}번` : ''}`),
      )
      const row = el('div', 'r-row')
      const again = el('button', 'btn', '다시 하기')
      again.addEventListener('click', (e) => { e.stopPropagation(); const k = g.kind; this.endGame(false); this.startGame(k) })
      const close = el('button', 'btn ghost', '그만')
      close.addEventListener('click', (e) => { e.stopPropagation(); this.endGame(true) })
      row.append(again, close)
      res.append(row)
      g.box.appendChild(res)
      p.emote(record ? 'star' : 'heart', 4)
      this.w.saveSoon()
      g.autoClose = setTimeout(() => { if (this.game === g) this.endGame(true) }, 15000)
    }

    endGame(talk) {
      const g = this.game
      if (!g) return
      clearTimeout(g.autoClose)
      g.box.remove()
      this.game = null
      if (this.mode === 'game') this.mode = null
      if (talk) this.pet.celebrate(1, { line: '또 놀자!', emote: 'heart' })
      else this.pet.idle(0.5)
    }

    // ---------- frame ----------

    t() { return this.w.uptime }

    update(dt) {
      this.lastDt = dt
      if (this.item) this.updateFood(dt)
      if (this.ball) this.updateBall(dt)
      if (this.game) this.updateGame(dt)
    }
  }

  CB.Play = Play
})()

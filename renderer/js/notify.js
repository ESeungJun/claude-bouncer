// Notification cards that ride along with the pet, plus the unread badge on
// its head. Every card says where it came from: project, git branch, the
// prompt that started the work, terminal app and tab — click to jump there.

window.CB = window.CB || {}

;(function () {
  const { clamp } = CB.util

  const KIND = CB.KINDS

  const isNeed = (n) => n.kind !== 'done'
  const snoozed = (n) => n.snoozedUntil > Date.now()
  // 지금 답을 기다리는 알림 (미뤄 둔 것은 뺀다)
  const isActiveNeed = (n) => isNeed(n) && !snoozed(n)
  // 막 온 응답 필요 알림만 깜빡인다. 그 뒤로는 색으로만 구분한다.
  const FRESH_MS = 6000
  const isFresh = (n) => isActiveNeed(n) && Date.now() - (n.nudgedAt || n.ts) < FRESH_MS
  const ARM_MS = 700 // ignore clicks this soon after a popup appears (it may have landed under a click)

  // Place a w×h popup next to the pet. The side is picked once, when the popup
  // appears, to avoid covering the cursor (it might land under a click).
  function place(world, pet, w, h, prev) {
    const hd = pet.head()
    const c = world.cursor
    const gap = 12
    const fits = (r) => r.x >= 4 && r.y >= 4 && r.x + w <= world.w - 4 && r.y + h <= world.h - 4
    const clear = (r) => !c.inside || !(c.x > r.x - 16 && c.x < r.x + w + 16 && c.y > r.y - 16 && c.y < r.y + h + 16)
    const cand = {
      above: { x: clamp(hd.x - w / 2, 4, world.w - w - 4), y: hd.y - h - gap },
      left: { x: pet.x - pet.pw / 2 - w - gap, y: clamp(pet.y - pet.ph / 2 - h / 2, 4, world.h - h - 4) },
      right: { x: pet.x + pet.pw / 2 + gap, y: clamp(pet.y - pet.ph / 2 - h / 2, 4, world.h - h - 4) },
      below: { x: clamp(hd.x - w / 2, 4, world.w - w - 4), y: pet.y + gap },
    }
    // Once a side is chosen, stick to it (only following the pet) so the popup
    // never runs away from a cursor that is heading toward it.
    if (prev && fits(cand[prev])) return { side: prev, ...cand[prev] }
    const order = ['above', c.x > pet.x ? 'left' : 'right', c.x > pet.x ? 'right' : 'left', 'below']
    for (const side of order) if (fits(cand[side]) && clear(cand[side])) return { side, ...cand[side] }
    for (const side of order) if (fits(cand[side])) return { side, ...cand[side] }
    return { side: 'above', x: clamp(cand.above.x, 4, world.w - w - 4), y: clamp(cand.above.y, 4, world.h - h - 4) }
  }
  CB.place = place
  CB.ARM_MS = ARM_MS
  CB.SNOOZE_MS = 10 * 60 * 1000

  function ago(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000)
    if (s < 45) return '방금'
    if (s < 3600) return `${Math.round(s / 60)}분 전`
    if (s < 86400) return `${Math.floor(s / 3600)}시간 전`
    return `${Math.floor(s / 86400)}일 전`
  }

  function duration(ms) {
    if (!ms || ms < 1000) return ''
    const s = Math.round(ms / 1000)
    if (s < 60) return `${s}초`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}분 ${s % 60}초`
    return `${Math.floor(m / 60)}시간 ${m % 60}분`
  }

  const el = CB.el

  class Notify {
    constructor(world, pet) {
      this.w = world
      this.pet = pet
      this.pending = []
      this.expanded = false
      this.collapseTimer = null

      this.badge = el('div', 'badge')
      this.badge.dataset.hit = 'badge'
      this.badge.title = '알림 보기'
      this.badge.addEventListener('click', (e) => { e.stopPropagation(); this.toggle() })

      this.working = el('div', 'working')
      this.working.title = '작업 중인 Claude 세션'

      this.stack = el('div', 'stack')
      this.size = null // 카드 묶음 크기 (바뀔 때만 다시 잰다)
      this.shownIds = new Set()
      world.layer.append(this.badge, this.working, this.stack)
      setInterval(() => this.refreshTimes(), 30000)
      // 글꼴이 늦게 들어오면 크기가 달라진다
      document.fonts?.ready?.then(() => { this.size = null; this.w.wake?.() })
    }

    sorted() {
      return [...this.pending].sort((a, b) => (isActiveNeed(b) - isActiveNeed(a)) || (b.ts - a.ts))
    }

    // ---------- events ----------

    onNotify(n) {
      const i = this.pending.findIndex(p => p.id === n.id)
      if (i < 0) this.pending.unshift(n); else this.pending[i] = n
      // 방해 금지이거나 짧게 끝난 작업이면 배지만 올린다
      if (this.w.settings.dnd || n.quiet) { this.renderBadge(); if (this.expanded) this.renderCards(); return }
      this.expand()
      clearTimeout(this.collapseTimer)
      if (!isNeed(n)) {
        // completions fold into the badge after a while; "needs you" cards stay
        this.collapseTimer = setTimeout(() => {
          if (!this.pending.some(isActiveNeed)) this.collapse()
        }, 9000)
      }
    }

    onData(data) {
      const before = this.pending.length
      this.pending = data.pending || []
      if (this.pending.length === 0) this.collapse()
      else if (this.expanded || this.pending.length !== before) this.renderCards()
      this.renderBadge()
      this.renderWorking(data.working || 0, data.sessions || [])
    }

    toggle() { this.expanded ? this.collapse() : this.expand() }

    hasFreshNeed() { return this.pending.some(isFresh) }

    expand() {
      if (!this.pending.length) return
      this.expanded = true
      this.renderCards()
      this.renderBadge()
    }

    collapse() {
      this.expanded = false
      this.stack.classList.remove('show')
      this.stack.replaceChildren()
      this.shownIds = new Set()
      this.size = null
      this.renderBadge()
    }

    // ---------- rendering ----------

    renderBadge() {
      this.w.wake?.()
      const n = this.pending.length
      this.badge.textContent = n > 9 ? '9+' : String(n)
      this.badge.classList.toggle('show', n > 0 && !this.expanded)
      this.badge.classList.toggle('need', this.pending.some(isActiveNeed))
      this.badge.classList.toggle('fresh', this.pending.some(isFresh))
    }

    // 작업 중 표시: 세션 수와, 가장 오래 걸리고 있는 작업의 분
    renderWorking(count, sessions = this.sessions || []) {
      this.w.wake?.()
      this.sessions = sessions
      this.workingCount = count
      const started = sessions.filter(s => s.status === 'working' && s.workStartedAt).map(s => s.workStartedAt)
      const min = started.length ? Math.floor((Date.now() - Math.min(...started)) / 60000) : 0
      const label = [count > 1 ? String(count) : '', min >= 1 ? `${min}분` : ''].filter(Boolean).join(' · ')
      this.working.classList.toggle('show', count > 0)
      // the dots blink once a second, only while something is working
      if (count > 0 && !this.dotsTimer && !this.w.reducedMotion) this.dotsTimer = setInterval(() => this.working.classList.toggle('dim'), 1000)
      if (!count && this.dotsTimer) { clearInterval(this.dotsTimer); this.dotsTimer = null; this.working.classList.remove('dim') }
      this.working.replaceChildren(el('span', 'dots', '•••'), el('span', 'cnt', label))
    }

    card(n) {
      const k = KIND[n.kind] || KIND.attention
      const c = el('div', `card ${k.cls}`)
      c.dataset.hit = 'card'
      c.dataset.id = n.id
      // 새로 나타난 카드만 들어오는 움직임을 쓴다 (다시 그릴 때마다 튀지 않게)
      if (!this.shownIds.has(n.id)) c.classList.add('in')
      if (isFresh(n)) c.classList.add('fresh')
      if (snoozed(n)) c.classList.add('snoozed')

      const head = el('div', 'c-head')
      head.append(el('span', 'c-kind', `${k.icon} ${k.label}`))
      head.append(el('span', 'c-time', this.timeText(n)))
      if (isActiveNeed(n)) {
        const later = el('button', 'c-later', '10분 뒤')
        later.title = '10분 뒤에 다시 알려 주기'
        later.addEventListener('click', (e) => {
          e.stopPropagation()
          if (performance.now() - this.shownAt < ARM_MS) return
          this.snooze(n.id)
        })
        head.append(later)
      }
      const x = el('button', 'c-x', '×')
      x.title = '확인함'
      x.addEventListener('click', (e) => {
        e.stopPropagation()
        if (performance.now() - this.shownAt < ARM_MS) return
        this.dismiss(n.id)
      })
      head.append(x)
      c.append(head)

      const where = el('div', 'c-where')
      where.append(el('b', 'c-proj', n.projectName || '알 수 없음'))
      if (n.branch) where.append(el('span', 'c-branch', `🌿 ${n.branch}`))
      c.append(where)

      if (n.prompt) c.append(el('div', 'c-prompt', `“${n.prompt}”`))
      if (n.message) c.append(el('div', 'c-msg', n.message))
      else if (n.summary) c.append(el('div', 'c-summary', n.summary))

      const foot = el('div', 'c-foot')
      foot.append(el('span', 'c-term', `▸ ${n.terminal?.label || '터미널'}`))
      foot.append(el('span', 'c-go', isNeed(n) ? '응답하러 가기 ↵' : '열기 ↵'))
      c.append(foot)

      c.addEventListener('click', () => {
        if (performance.now() - this.shownAt < ARM_MS) return
        this.open(n.id)
      })
      return c
    }

    timeText(n) {
      if (snoozed(n)) return `${Math.max(1, Math.ceil((n.snoozedUntil - Date.now()) / 60000))}분 뒤 다시 알림`
      const dur = n.kind === 'done' ? duration(n.durationMs) : ''
      return dur ? `${dur} 걸림 · ${ago(n.ts)}` : ago(n.ts)
    }

    renderCards() {
      if (!this.expanded) return
      this.w.wake?.()
      const list = this.sorted()
      const shown = list.slice(0, 3)
      const nodes = shown.map(n => this.card(n))
      if (list.length > shown.length) {
        const more = el('button', 'more', `+${list.length - shown.length}개 더 · 전체 보기`)
        more.dataset.hit = 'more'
        more.addEventListener('click', () => window.api.togglePanel('inbox'))
        nodes.push(more)
      }
      if (list.length > 1) {
        const all = el('button', 'more', '모두 읽음')
        all.dataset.hit = 'more'
        all.addEventListener('click', () => window.api.readAll())
        nodes.push(all)
      }
      if (!this.stack.classList.contains('show')) { this.shownAt = performance.now(); this.side = null }
      this.stack.replaceChildren(...nodes)
      this.stack.classList.toggle('show', nodes.length > 0)
      this.shownIds = new Set(shown.map(n => n.id))
      this.size = null
    }

    // 30초마다: 카드를 다시 만들지 않고 시간 글자만 바꾼다
    refreshTimes() {
      if (this.workingCount) this.renderWorking(this.workingCount)
      if (!this.expanded) return
      for (const c of this.stack.querySelectorAll('.card')) {
        const n = this.pending.find(p => p.id === c.dataset.id)
        const t = c.querySelector('.c-time')
        if (n && t) t.textContent = this.timeText(n)
      }
      this.size = null
      this.w.wake?.()
    }

    open(id) {
      CB.Sound.play('pop')
      this.pending = this.pending.filter(n => n.id !== id)
      if (!this.pending.length) this.collapse(); else this.renderCards()
      this.renderBadge()
      window.api.openNotification(id)
      // you're off to the terminal: put the ball (or snack) away too
      if (!this.w.play?.game) this.w.play?.stop()
      this.pet.celebrate(0.9, { emote: 'heart' })
    }

    dismiss(id) {
      this.pending = this.pending.filter(n => n.id !== id)
      if (!this.pending.length) this.collapse(); else this.renderCards()
      this.renderBadge()
      window.api.dismissNotification(id)
    }

    // 10분 뒤에 다시: 그동안은 배지만 남는다 (main 이 시간이 되면 다시 알린다)
    snooze(id) {
      const n = this.pending.find(p => p.id === id)
      if (n) n.snoozedUntil = Date.now() + CB.SNOOZE_MS
      if (this.pending.some(isActiveNeed)) this.renderCards(); else this.collapse()
      this.renderBadge()
      window.api.snoozeNotification(id)
    }

    // follow the pet every frame
    render() {
      const p = this.pet
      const h = p.head()
      if (this.badge.classList.contains('show')) {
        this.badge.style.transform = `translate3d(${h.x + p.pw / 2 + 2}px, ${h.y - 2 * p.scale - 16}px, 0)`
      }
      if (this.working.classList.contains('show')) {
        this.working.style.transform = `translate3d(${h.x - p.pw * 0.5 - 30}px, ${h.y - 14}px, 0)`
      }
      if (this.stack.classList.contains('show')) {
        // while the cursor is on the cards, keep them still so they can be clicked
        const c = this.w.cursor
        const r = this.rect
        const hovering = r && c.x >= r.x && c.x <= r.x + r.w && c.y >= r.y && c.y <= r.y + r.h
        if (!hovering) {
          if (!this.size) this.size = { w: this.stack.offsetWidth, h: this.stack.offsetHeight }
          const { w, h: sh } = this.size
          const pos = place(this.w, p, w, sh, this.side)
          this.side = pos.side
          this.rect = { x: pos.x, y: pos.y, w, h: sh }
          this.stack.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`
        }
      } else this.rect = null
    }
  }

  CB.Notify = Notify
})()

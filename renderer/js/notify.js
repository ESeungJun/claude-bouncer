// Notification cards that ride along with the pet, plus the unread badge on
// its head. Every card says where it came from: project, git branch, the
// prompt that started the work, terminal app and tab — click to jump there.

window.CB = window.CB || {}

;(function () {
  const { clamp } = CB.util

  const KIND = {
    done: { icon: '✓', label: '작업 완료', cls: 'k-done' },
    permission: { icon: '🔐', label: '권한 요청', cls: 'k-need' },
    input: { icon: '💬', label: '입력 대기', cls: 'k-wait' },
    attention: { icon: '👀', label: '확인 필요', cls: 'k-info' },
  }

  const isNeed = (n) => n.kind !== 'done'
  const ARM_MS = 700 // ignore clicks this soon after a popup appears (it may have landed under a click)

  // Place a w×h popup next to the pet without covering the cursor.
  // `prev` keeps the last side while it stays valid, so the popup doesn't jump around.
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
    const order = [prev, 'above', c.x > pet.x ? 'left' : 'right', c.x > pet.x ? 'right' : 'left', 'below'].filter(Boolean)
    for (const side of order) if (fits(cand[side]) && clear(cand[side])) return { side, ...cand[side] }
    for (const side of order) if (fits(cand[side])) return { side, ...cand[side] }
    return { side: 'above', x: clamp(cand.above.x, 4, world.w - w - 4), y: clamp(cand.above.y, 4, world.h - h - 4) }
  }
  CB.place = place
  CB.ARM_MS = ARM_MS

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

  function el(tag, cls, text) {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text !== undefined) e.textContent = text
    return e
  }

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
      world.layer.append(this.badge, this.working, this.stack)
      setInterval(() => this.refreshTimes(), 30000)
    }

    sorted() {
      return [...this.pending].sort((a, b) => (isNeed(b) - isNeed(a)) || (b.ts - a.ts))
    }

    // ---------- events ----------

    onNotify(n) {
      if (!this.pending.some(p => p.id === n.id)) this.pending.unshift(n)
      if (this.w.settings.dnd) { this.renderBadge(); return }
      this.expand()
      clearTimeout(this.collapseTimer)
      if (!isNeed(n)) {
        // completions fold into the badge after a while; "needs you" cards stay
        this.collapseTimer = setTimeout(() => {
          if (!this.pending.some(isNeed)) this.collapse()
        }, 9000)
      }
    }

    onData(data) {
      const before = this.pending.length
      this.pending = data.pending || []
      if (this.pending.length === 0) this.collapse()
      else if (this.expanded || this.pending.length !== before) this.renderCards()
      this.renderBadge()
      this.renderWorking(data.working || 0)
    }

    toggle() { this.expanded ? this.collapse() : this.expand() }

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
      this.renderBadge()
    }

    // ---------- rendering ----------

    renderBadge() {
      const n = this.pending.length
      const need = this.pending.some(isNeed)
      this.badge.textContent = n > 9 ? '9+' : String(n)
      this.badge.classList.toggle('show', n > 0 && !this.expanded)
      this.badge.classList.toggle('need', need)
    }

    renderWorking(count) {
      this.working.classList.toggle('show', count > 0)
      this.working.replaceChildren(el('span', 'dots', '•••'), el('span', 'cnt', count > 1 ? String(count) : ''))
    }

    card(n) {
      const k = KIND[n.kind] || KIND.attention
      const c = el('div', `card ${k.cls}`)
      c.dataset.hit = 'card'
      c.dataset.id = n.id

      const head = el('div', 'c-head')
      head.append(el('span', 'c-kind', `${k.icon} ${k.label}`))
      const dur = n.kind === 'done' ? duration(n.durationMs) : ''
      head.append(el('span', 'c-time', dur ? `${dur} 걸림 · ${ago(n.ts)}` : ago(n.ts)))
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

    renderCards() {
      if (!this.expanded) return
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
    }

    refreshTimes() { if (this.expanded) this.renderCards() }

    open(id) {
      CB.Sound.play('pop')
      this.pending = this.pending.filter(n => n.id !== id)
      if (!this.pending.length) this.collapse(); else this.renderCards()
      this.renderBadge()
      window.api.openNotification(id)
      this.pet.celebrate(0.9, { emote: 'heart' })
    }

    dismiss(id) {
      this.pending = this.pending.filter(n => n.id !== id)
      if (!this.pending.length) this.collapse(); else this.renderCards()
      this.renderBadge()
      window.api.dismissNotification(id)
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
          const pos = place(this.w, p, this.stack.offsetWidth, this.stack.offsetHeight, this.side)
          this.side = pos.side
          this.rect = { x: pos.x, y: pos.y, w: this.stack.offsetWidth, h: this.stack.offsetHeight }
          this.stack.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`
        }
      } else this.rect = null
    }
  }

  CB.Notify = Notify
  CB.notifyKinds = KIND
})()

// Inbox / sessions / pet / settings panel.

;(async function () {
  const api = window.api
  const { Sprites } = CB
  const $ = (s) => document.querySelector(s)

  let data = { pending: [], sessions: [], history: [], working: 0 }
  let settings = {}
  let pet = {}

  const KIND = Object.fromEntries(Object.entries(CB.KINDS).map(([k, v]) => [k, [v.short, v.cls]]))
  const STATUS = {
    working: ['⏳ 작업 중', 's-working'],
    waiting: ['❗ 응답 필요', 'k-need'],
    done: ['✓ 끝남', 's-done'],
    idle: ['· 대기', 's-idle'],
  }

  const el = CB.el

  function when(ts) {
    const d = new Date(ts)
    const now = new Date()
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    if (d.toDateString() === now.toDateString()) return hm
    return `${d.getMonth() + 1}/${d.getDate()} ${hm}`
  }

  function since(ts) {
    const m = Math.round((Date.now() - ts) / 60000)
    if (m < 1) return '방금'
    if (m < 60) return `${m}분째`
    return `${Math.floor(m / 60)}시간 ${m % 60}분째`
  }

  function shortPath(p) {
    return String(p || '').replace(/^\/Users\/[^/]+/, '~').replace(/^C:\\Users\\[^\\]+/i, '~')
  }

  // ---------- tabs ----------

  function showTab(name) {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name))
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + name))
  }
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)))
  api.onPanelTab(showTab)
  $('#close').addEventListener('click', () => api.closePanel())

  // ---------- inbox ----------

  function isPending(n) {
    return data.pending.some(p => p.id === n.id)
  }

  function renderInbox() {
    const only = $('#only-pending').checked
    const list = only ? data.pending : data.history
    const box = $('#inbox')
    if (!list.length) {
      box.replaceChildren(el('div', 'empty', only ? '확인할 알림이 없어요 ✨' : 'Claude Code가 일을 끝내거나\n나를 부르면 여기에 쌓여요.'))
      box.firstChild.style.whiteSpace = 'pre-line'
    } else {
      box.replaceChildren(...list.map((n) => {
        const [label, cls] = KIND[n.kind] || KIND.attention
        const r = el('div', `row ${cls}${isPending(n) ? '' : ' read'}`)
        const r1 = el('div', 'r1')
        r1.append(el('span', 'r-kind', label), el('span', 'r-proj', n.projectName))
        if (n.branch) r1.append(el('span', 'r-branch', `🌿 ${n.branch}`))
        r1.append(el('span', 'r-time', when(n.ts)))
        r.append(r1)
        if (n.prompt) r.append(el('div', 'r-prompt', `“${n.prompt}”`))
        if (n.message) r.append(el('div', 'r-msg', n.message))
        else if (n.summary) r.append(el('div', 'r-sum', n.summary))
        const foot = el('div', 'r-foot')
        foot.append(el('span', '', `▸ ${n.terminal?.label || '터미널'}`), el('span', 'r-path', shortPath(n.cwd)))
        const folder = el('button', '', '폴더')
        folder.addEventListener('click', (e) => { e.stopPropagation(); api.openFolder(n.cwd) })
        foot.append(folder)
        r.append(foot)
        r.addEventListener('click', () => api.openNotification(n.id))
        return r
      }))
    }
    const need = data.pending.filter(n => n.kind !== 'done').length
    const c = $('#cnt-inbox')
    c.textContent = data.pending.length ? String(data.pending.length) : ''
    c.classList.toggle('need', need > 0)
  }

  $('#only-pending').addEventListener('change', renderInbox)
  $('#read-all').addEventListener('click', () => api.readAll())
  $('#clear').addEventListener('click', () => api.clearHistory())

  // ---------- sessions ----------

  function renderSessions() {
    const box = $('#sessions')
    const list = data.sessions || []
    $('#cnt-sessions').textContent = list.length ? String(list.length) : ''
    if (!list.length) {
      box.replaceChildren(el('div', 'empty', '아직 본 세션이 없어요.\nClaude Code에 말을 걸면 여기 나타나요.'))
      box.firstChild.style.whiteSpace = 'pre-line'
      return
    }
    box.replaceChildren(...list.map((s) => {
      const [label, cls] = STATUS[s.status] || STATUS.idle
      const r = el('div', `row ${cls}`)
      const r1 = el('div', 'r1')
      r1.append(el('span', 'r-kind', label), el('span', 'r-proj', s.projectName))
      if (s.branch) r1.append(el('span', 'r-branch', `🌿 ${s.branch}`))
      r1.append(el('span', 'r-time', s.status === 'working' && s.workStartedAt ? since(s.workStartedAt) : when(s.updatedAt)))
      r.append(r1)
      if (s.prompt) r.append(el('div', 'r-prompt', `“${s.prompt}”`))
      const foot = el('div', 'r-foot')
      foot.append(el('span', '', `▸ ${s.terminal?.label || '터미널'}`), el('span', 'r-path', shortPath(s.cwd)))
      r.append(foot)
      r.addEventListener('click', () => api.focusSession(s.id))
      return r
    }))
  }

  // ---------- pet ----------

  function meter(id, v) {
    const m = $(id)
    m.style.width = Math.round(v) + '%'
    m.className = v < 25 ? 'low' : v < 50 ? 'mid' : ''
  }

  function renderPet() {
    const mood = pet.hunger < 25 ? 'sad' : pet.fun < 30 ? 'normal' : 'happy'
    Sprites.blit($('#pet-face'), Sprites.petCanvas(mood === 'happy' ? { expr: 'happy', mouth: 'smile' } : mood === 'sad' ? { expr: 'sad', mouth: 'frown' } : {}), 4)
    $('#pet-name').textContent = pet.name || '클로디'
    const need = 30 + (pet.level || 1) * 20
    $('#pet-level').textContent = `Lv.${pet.level || 1} · 경험치 ${pet.xp || 0}/${need}`
    $('#xp-fill').style.width = Math.min(100, ((pet.xp || 0) / need) * 100) + '%'
    meter('#m-hunger', pet.hunger ?? 0)
    meter('#m-fun', pet.fun ?? 0)
    meter('#m-energy', pet.energy ?? 0)
    const days = pet.bornAt ? Math.max(1, Math.ceil((Date.now() - pet.bornAt) / 86400000)) : 1
    $('#records').textContent =
      `함께한 지 ${days}일 · 밥 ${pet.fed || 0}번 · 놀이 ${pet.played || 0}번 · 쓰다듬기 ${pet.petted || 0}번\n` +
      `🏆 쿠키 받기 최고 ${pet.best?.catch || 0}점 · 술래잡기 최고 ${pet.best?.tag || 0}점`
    $('#records').style.whiteSpace = 'pre-line'
  }

  document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
    api.petAction(b.dataset.act)
    api.closePanel()
  }))

  // ---------- settings ----------

  // ---------- summon hotkey ----------

  const IS_MAC = navigator.platform.toLowerCase().includes('mac')
  const MAC_SYM = { Command: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧' }
  let recording = false
  let hotkeyError = ''

  function prettyKey(acc) {
    if (!acc) return '없음'
    const parts = acc.split('+')
    if (!IS_MAC) return parts.join(' + ')
    return parts.map(p => MAC_SYM[p] || (p === 'CommandOrControl' ? '⌘' : p)).join('')
  }

  // KeyboardEvent → Electron accelerator ('Alt+Shift+C'), or null if incomplete
  function toAccelerator(e) {
    const mods = []
    if (e.metaKey) mods.push(IS_MAC ? 'Command' : 'Super')
    if (e.ctrlKey) mods.push('Control')
    if (e.altKey) mods.push('Alt')
    if (e.shiftKey) mods.push('Shift')
    const c = e.code
    let key = null
    if (/^Key[A-Z]$/.test(c)) key = c.slice(3)
    else if (/^Digit\d$/.test(c)) key = c.slice(5)
    else if (/^F\d{1,2}$/.test(c)) key = c
    else key = { Space: 'Space', Period: '.', Comma: ',', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backquote: '`', Minus: '-', Equal: '=', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Enter' }[c] || null
    if (!key) return null
    // needs a real modifier: Shift+C would steal every capital C you type
    const strong = mods.some(m => m !== 'Shift')
    if (!strong && !/^F\d/.test(key)) return null
    return [...mods, key].join('+')
  }

  function renderHotkey() {
    $('#hint-hotkey').textContent = prettyKey(settings.hotkey)
    const b = $('#hotkey')
    b.classList.toggle('rec', recording)
    b.textContent = recording ? '키 입력…' : prettyKey(settings.hotkey)
    const st = $('#hotkey-status')
    st.classList.remove('err')
    if (recording) st.textContent = '원하는 조합을 누르세요 (Esc 취소)'
    else if (hotkeyError) { st.textContent = `${prettyKey(hotkeyError)}는 다른 앱이 쓰고 있어요`; st.classList.add('err') }
    else if (settings.hotkey && settings.hotkeyOk === false) { st.textContent = '등록 실패 — 다른 조합을 골라주세요'; st.classList.add('err') }
    else st.textContent = settings.hotkey ? '어디서든 누르면 클로디가 커서 앞으로 와요' : '단축키가 꺼져 있어요'
  }

  function stopRecording() {
    recording = false
    api.pauseHotkey(false)
    renderHotkey()
  }

  $('#hotkey').addEventListener('click', () => {
    if (recording) return stopRecording()
    recording = true
    hotkeyError = ''
    api.pauseHotkey(true)
    renderHotkey()
  })
  $('#hotkey-off').addEventListener('click', async () => {
    hotkeyError = ''
    settings = await api.setSetting('hotkey', '')
    renderSettings()
  })
  window.addEventListener('keydown', async (e) => {
    if (!recording) return
    e.preventDefault()
    if (e.key === 'Escape') return stopRecording()
    const acc = toAccelerator(e)
    if (!acc) return
    recording = false
    const res = await api.setSetting('hotkey', acc)
    hotkeyError = res.hotkeyError || ''
    settings = { ...settings, ...res, hotkeyOk: !hotkeyError }
    delete settings.hotkeyError
    renderSettings()
  })
  window.addEventListener('blur', () => { if (recording) stopRecording() })

  function renderSettings() {
    renderHotkey()
    document.querySelectorAll('[data-set]').forEach(i => { i.checked = !!settings[i.dataset.set] })
    document.querySelectorAll('#scale button').forEach(b => b.classList.toggle('on', Number(b.dataset.v) === settings.scale))
  }
  document.querySelectorAll('[data-set]').forEach(i => i.addEventListener('change', async () => {
    settings = await api.setSetting(i.dataset.set, i.checked)
    renderSettings()
  }))
  document.querySelectorAll('#scale button').forEach(b => b.addEventListener('click', async () => {
    settings = await api.setSetting('scale', Number(b.dataset.v))
    renderSettings()
  }))
  // claude.ai extension
  async function renderExt() {
    const s = await api.extStatus()
    const el = $('#ext-status')
    el.textContent = s.connected ? `연결됨 · ${s.browser || '브라우저'}` : '브라우저 확장을 설치하면 웹 채팅도 알려줘요'
    el.classList.toggle('ok', s.connected)
  }
  // The guide stays open (and keeps the panel open) while you switch to
  // Finder / Chrome to follow it.
  $('#ext-install').addEventListener('click', async () => {
    const on = $('#ext-guide').classList.toggle('on')
    api.pinPanel(on, 'guide')
    if (on) $('#ext-path').textContent = (await api.extStatus()).folder
  })
  $('#ext-folder').addEventListener('click', () => api.openExtensionFolder())
  $('#ext-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText('chrome://extensions') } catch {}
    $('#ext-copy').textContent = '복사됨 ✓'
    setTimeout(() => { $('#ext-copy').textContent = '주소 복사' }, 1500)
  })
  // leaving the settings tab closes the guide and lets the panel auto-hide again
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.tab !== 'settings' && $('#ext-guide').classList.contains('on')) {
      $('#ext-guide').classList.remove('on')
      api.pinPanel(false, 'guide')
    }
  }))
  document.querySelector('[data-tab=settings]').addEventListener('click', renderExt)
  setInterval(renderExt, 15000)
  renderExt()

  $('#test-done').addEventListener('click', () => api.testNotify('done'))
  $('#test-need').addEventListener('click', () => api.testNotify('permission'))
  $('#reinstall').addEventListener('click', async () => {
    const ok = await api.reinstallHook()
    $('#reinstall').textContent = ok ? '설치됨 ✓' : '실패 ✕'
    setTimeout(() => { $('#reinstall').textContent = '다시 설치' }, 2000)
  })

  // ---------- wiring ----------

  function renderLogo() { Sprites.blit($('#logo'), Sprites.petCanvas({ expr: 'happy', mouth: 'smile' }), 2) }
  renderLogo()
  // maker.js swaps the active look; redraw the faces that show it
  window.CBPanel = { onSkinChanged: () => { renderLogo(); renderPet() } }

  const state = await api.getState()
  settings = { ...state.settings, hotkeyOk: state.hotkeyOk }
  pet = state.pet
  const h = await api.getHistory()
  data = h
  renderInbox(); renderSessions(); renderPet(); renderSettings()
  $('#status').textContent = `127.0.0.1:${state.port} · 작업 중 ${data.working || 0}`

  api.onData((d) => {
    data = d
    renderInbox(); renderSessions()
    $('#status').textContent = `127.0.0.1:${state.port} · 작업 중 ${d.working || 0}`
  })
  api.onSettings((s) => { settings = s; renderSettings() })
  api.onPet((p) => { pet = p; renderPet() })
  setInterval(renderSessions, 30000)
})()

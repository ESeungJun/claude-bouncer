// "나만의 클로디": photo → Higgsfield → pixel skin, with live previews.

;(async function () {
  const api = window.api
  const { Sprites, Pixelize } = CB
  const $ = (s) => document.querySelector(s)

  const PREVIEW_POSES = [
    {}, { legs: [2, 1, 2, 1] }, { legs: [1, 2, 1, 2] }, {},
    { expr: 'happy', mouth: 'open', armL: 'up', armR: 'up', legs: [1, 1, 1, 1] },
    { expr: 'blink' }, { expr: 'love', mouth: 'cat' }, { walkFrame: 1 }, { walkFrame: 2 }, { walkFrame: 3 }, { walkFrame: 4 }, { expr: 'sleep', dy: 2 },
  ]

  let state = await api.skinState()
  const presetSkins = await api.skinPresets() // id → skin, fetched once
  let photoPath = ''
  let busy = false
  let variants = [] // { skin, src } | { error, src }
  let chosen = -1
  let frame = 0
  let showKeyForm = false
  let style = 'pixel'
  document.querySelectorAll('#mk-style button').forEach(b => b.addEventListener('click', () => {
    style = b.dataset.style
    document.querySelectorAll('#mk-style button').forEach(x => x.classList.toggle('on', x === b))
    render()
    loadCost()
  }))
  let cost = null
  const connected = () => state.mcp || state.hasKey

  const el = CB.el

  // ---------- saved looks ----------

  function chip(id, name, skin, { preset = false } = {}) {
    const c = el('div', 'chip' + ((state.active || '') === id ? ' on' : '') + (preset ? ' preset' : ''))
    const cv = el('canvas', 'px')
    Sprites.blit(cv, Sprites.petCanvas({ expr: 'happy', mouth: 'smile' }, skin), Sprites.isSheet(skin) ? 1 : 2)
    c.append(cv, el('span', '', name))
    c.title = name
    c.addEventListener('click', async () => { state = await api.useSkin(id); render() })
    if (id && !preset) {
      const del = el('button', 'del', '×')
      del.title = '이 모습 지우기'
      del.addEventListener('click', async (e) => {
        e.stopPropagation()
        // first click asks, second click deletes
        if (!del.classList.contains('confirm')) {
          del.classList.add('confirm')
          del.textContent = '지우기'
          setTimeout(() => { del.classList.remove('confirm'); del.textContent = '×' }, 2500)
          return
        }
        state = await api.deleteSkin(id)
        render()
      })
      c.appendChild(del)
    }
    return c
  }

  function render() {
    // the active look may be a saved one or a built-in preset
    const activeSkin = presetSkins[state.active] || state.list.find(s => s.id === state.active)?.skin || null
    if (activeSkin !== Sprites.getSkin()) {
      Sprites.setSkin(activeSkin)
      window.CBPanel?.onSkinChanged()
    }
    $('#mk-saved').replaceChildren(
      chip('', '클로디', null),
      ...(state.presets || []).map(p => chip(p.id, p.name, presetSkins[p.id], { preset: true })),
      ...state.list.map(s => chip(s.id, s.name, s.skin)),
    )
    // the request box is for people without Higgsfield
    $('#mk-request').style.display = state.mcp || state.hasKey ? 'none' : 'block'
    $('#mk-connect').style.display = connected() ? 'none' : 'flex'
    $('#mk-key').style.display = showKeyForm ? 'flex' : 'none'
    $('#mk-keyinfo').textContent = state.mcp
      ? `🟢 Higgsfield 연결됨${state.credits != null ? ` · 크레딧 ${state.credits.toLocaleString()}` : ''}`
      : state.hasKey ? `🔑 API 키 ${state.keyId}` : '먼저 Higgsfield를 연결해 주세요'
    $('#mk-key-edit').style.display = state.hasKey && !state.mcp ? '' : 'none'
    $('#hf-logout').style.display = state.mcp ? '' : 'none'
    $('#mk-go').disabled = !connected() || !photoPath || busy
    $('#mk-ask').disabled = !photoPath
    const what = style === 'claudy' ? '클로디' : '캐릭터'
    $('#mk-go').textContent = cost ? `닮은 ${what} 만들기 (약 ${cost} 크레딧)` : `닮은 ${what} 만들기`
  }

  // ---------- API key ----------

  $('#hf-save').addEventListener('click', async () => {
    state = await api.setHiggsfieldKey($('#hf-id').value, $('#hf-secret').value)
    $('#hf-secret').value = ''
    showKeyForm = !state.hasKey
    render()
  })
  $('#hf-use-key').addEventListener('click', () => { showKeyForm = !showKeyForm; render() })
  $('#hf-login').addEventListener('click', async () => {
    const b = $('#hf-login')
    b.disabled = true
    b.textContent = '브라우저에서 로그인해 주세요…'
    pin()
    const r = await api.higgsfieldLogin()
    b.disabled = false
    b.textContent = '🔗 Higgsfield 계정으로 연결'
    state = r
    if (r.error) progress(r.error, true)
    else { progress(''); loadCost() }
    render()
  })
  $('#hf-logout').addEventListener('click', async () => { state = await api.higgsfieldLogout(); cost = null; render() })

  async function loadCost() {
    if (!state.mcp) return
    cost = await api.estimateSkin(style)
    render()
  }
  $('#hf-console').addEventListener('click', () => api.openExternal('https://console.higgsfield.ai'))
  $('#mk-key-edit').addEventListener('click', () => {
    showKeyForm = true
    render()
    $('#hf-id').focus()
  })

  // ---------- photo ----------

  async function setPhoto(file) {
    if (!file) return
    const preview = await api.previewPhoto(file)
    if (!preview) { progress('이 파일은 열 수 없어요 (jpg, png, webp, heic)', true); return }
    photoPath = file
    $('#mk-photo').src = preview
    $('#mk-photo').classList.add('on')
    $('#mk-drop-text').textContent = '다른 사진으로 바꾸려면 다시 눌러요'
    progress('')
    render()
    syncReqPhoto()
  }

  function clearPhoto() {
    photoPath = ''
    $('#mk-photo').removeAttribute('src')
    $('#mk-photo').classList.remove('on')
    $('#mk-drop-text').textContent = '📷 사진을 끌어다 놓거나 눌러서 고르기'
    render()
    syncReqPhoto()
  }

  function syncReqPhoto() {
    $('#req-photo-name').textContent = photoPath ? `📎 ${photoPath.split(/[\\/]/).pop()}` : ''
  }

  function discardResults() {
    variants = []
    chosen = -1
    previewSkins.clear()
    progress('')
    renderVariants()
    render()
    pin()
  }

  $('#mk-photo-clear').addEventListener('click', (e) => { e.stopPropagation(); if (!busy) clearPhoto() })
  $('#mk-discard').addEventListener('click', discardResults)

  const drop = $('#mk-drop')
  drop.addEventListener('click', async () => setPhoto(await api.pickPhoto()))
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over') })
  drop.addEventListener('dragleave', () => drop.classList.remove('over'))
  drop.addEventListener('drop', (e) => {
    e.preventDefault()
    drop.classList.remove('over')
    const f = e.dataTransfer.files[0]
    if (f) setPhoto(api.pathForFile(f))
  })

  // keep the panel open on the pet tab so a photo can be dragged in from Finder
  const pin = () => api.pinPanel(document.querySelector('#tab-pet').classList.contains('on') || busy || variants.length > 0)
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setTimeout(pin, 0)))
  api.onPanelTab(() => setTimeout(pin, 0))

  // ---------- generate ----------

  const STAGES = { upload: '사진 올리는 중…', generate: 'Higgsfield가 그리는 중… (30초~1분)', download: '거의 다 됐어요…' }
  api.onSkinProgress((s) => { if (busy) progress(STAGES[s] || '') })

  function progress(text, error = false) {
    const p = $('#mk-progress')
    p.textContent = text
    p.classList.toggle('err', error)
  }

  function decode(src) {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0)
        resolve(ctx.getImageData(0, 0, c.width, c.height))
      }
      img.onerror = () => reject(new Error('이미지를 읽지 못했어요'))
      img.src = src
    })
  }

  $('#mk-go').addEventListener('click', async () => {
    if (busy || !photoPath) return
    busy = true
    variants = []
    chosen = -1
    previewSkins.clear()
    renderVariants()
    pin()
    render()
    progress(STAGES.upload)
    const r = await api.generateSkin(photoPath, style)
    busy = false
    if (r.error) { progress(r.error, true); render(); pin(); return }
    await showResults(r.images, style)
  })

  // generated images (data URLs) → pixel skins → previews
  async function showResults(images, madeAs) {
    variants = []
    previewSkins.clear()
    for (const src of images) {
      try {
        const img = await decode(src)
        variants.push({ skin: madeAs === 'claudy' ? Pixelize.pixelize(img) : Pixelize.pixelizeSheet(img), src })
      } catch (e) { variants.push({ error: e.message, src }) }
    }
    chosen = variants.findIndex(v => v.skin)
    progress(chosen < 0 ? '도트로 바꾸지 못했어요. 다른 사진(정면, 밝은 곳)으로 다시 해 볼까요?' : '마음에 드는 쪽을 골라주세요', chosen < 0)
    renderVariants()
    render()
    pin()
  }

  function currentSkin() {
    const v = variants[chosen]
    if (!v?.skin) return null
    if (Sprites.isSheet(v.skin)) return { ...v.skin, _id: undefined }
    return { ...v.skin, glasses: $('#mk-glasses').checked, blush: $('#mk-blush').checked, _id: undefined }
  }

  function renderVariants() {
    const box = $('#mk-results')
    box.replaceChildren(...variants.map((v, i) => {
      const card = el('div', 'variant' + (i === chosen ? ' on' : ''))
      if (v.skin) {
        const cv = el('canvas', 'px')
        cv.dataset.i = i
        card.appendChild(cv)
      } else card.appendChild(el('div', 'bad', v.error))
      const src = el('img', 'src')
      src.src = v.src
      src.title = 'Higgsfield 원본'
      card.appendChild(src)
      card.addEventListener('click', () => { if (v.skin) { chosen = i; renderVariants() } })
      return card
    }))
    $('#mk-opts').classList.toggle('on', chosen >= 0)
    // glasses / blush only apply to the Claudy-body style
    const sheet = Sprites.isSheet(variants[chosen]?.skin)
    $('#mk-glasses').closest('label').style.display = sheet ? 'none' : ''
    $('#mk-blush').closest('label').style.display = sheet ? 'none' : ''
    drawPreviews()
  }

  // preview skins rebuild when toggles change (cache key includes glasses/blush)
  const previewSkins = new Map()
  function previewSkin(i) {
    const v = variants[i]
    if (Sprites.isSheet(v.skin)) return v.skin
    const key = `${i}:${$('#mk-glasses').checked}:${$('#mk-blush').checked}`
    if (!previewSkins.has(key)) previewSkins.set(key, { ...v.skin, glasses: $('#mk-glasses').checked, blush: $('#mk-blush').checked })
    return previewSkins.get(key)
  }

  function drawPreviews() {
    document.querySelectorAll('.variant canvas').forEach((cv) => {
      const i = Number(cv.dataset.i)
      const sk = previewSkin(i)
      Sprites.blit(cv, Sprites.petCanvas(PREVIEW_POSES[frame % PREVIEW_POSES.length], sk), Sprites.isSheet(sk) ? 2 : 6)
    })
  }
  setInterval(() => { frame++; if (variants.length) drawPreviews() }, 380)
  $('#mk-glasses').addEventListener('change', drawPreviews)
  $('#mk-blush').addEventListener('change', drawPreviews)

  $('#mk-apply').addEventListener('click', async () => {
    const skin = currentSkin()
    if (!skin) return
    delete skin._id
    delete skin.debug
    state = await api.saveSkin(skin, `내 클로디 ${state.list.length + 1}`)
    discardResults()
    clearPhoto()
    progress('적용했어요! 화면의 클로디를 보세요 ✨')
  })

  api.onSkins((s) => { state = s; render() })
  render()
  if (state.mcp) api.refreshSkinState().then((s) => { state = s; render(); loadCost() })
  // ---------- "make one for me" request (compose window) ----------

  function openCompose() {
    if (!photoPath) return
    $('#cp-photo').src = $('#mk-photo').src
    syncReqPhoto()
    reqStatus('')
    $('#compose').classList.add('on')
    api.pinPanel(true, 'compose')
    setTimeout(() => $('#req-email').focus(), 50)
  }
  function closeCompose() {
    $('#compose').classList.remove('on')
    api.pinPanel(false, 'compose')
  }
  $('#mk-ask').addEventListener('click', openCompose)
  $('#cp-close').addEventListener('click', closeCompose)
  $('#compose').addEventListener('click', (e) => { if (e.target.id === 'compose') closeCompose() })
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#compose').classList.contains('on')) closeCompose() })

  $('#req-send').addEventListener('click', async () => {
    const b = $('#req-send')
    if (!photoPath) { reqStatus('사진을 먼저 골라 주세요', true); return }
    b.disabled = true
    b.textContent = '보내는 중…'
    const r = await api.sendRequest({
      email: $('#req-email').value,
      subject: $('#req-subject').value,
      message: $('#req-message').value,
      photo: photoPath,
      consent: $('#req-consent').checked,
    })
    b.disabled = false
    b.textContent = '보내기'
    if (r.error) { reqStatus(r.error, true); return }
    closeCompose()
    $('#req-message').value = ''
    $('#req-consent').checked = false
    progress('요청을 보냈어요! 만들어지면 메일로 보내드릴게요 💌')
  })

  function reqStatus(text, error = false) {
    const el = $('#req-status')
    el.textContent = text
    el.classList.toggle('err', error)
  }

  window.CBMaker = { setPhoto, showResults } // handy for scripted checks
})()

// "나만의 클로디": photo → Higgsfield → pixel skin, with live previews.

;(async function () {
  const api = window.api
  const { Sprites, Pixelize } = CB
  const $ = (s) => document.querySelector(s)

  const PREVIEW_POSES = [
    {}, { legs: [2, 1, 2, 1] }, { legs: [1, 2, 1, 2] }, {},
    { expr: 'happy', mouth: 'open', armL: 'up', armR: 'up', legs: [1, 1, 1, 1] },
    { expr: 'blink' }, { expr: 'love', mouth: 'cat' }, { expr: 'happy', mouth: 'smile', armR: 'up' },
  ]

  let state = await api.skinState()
  let photoPath = ''
  let busy = false
  let variants = [] // { skin, src } | { error, src }
  let chosen = -1
  let frame = 0

  function el(tag, cls, text) {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text !== undefined) e.textContent = text
    return e
  }

  // ---------- saved looks ----------

  function chip(id, name, skin) {
    const c = el('div', 'chip' + ((state.active || '') === id ? ' on' : ''))
    const cv = el('canvas', 'px')
    Sprites.blit(cv, Sprites.petCanvas({ expr: 'happy', mouth: 'smile' }, skin), 2)
    c.append(cv, el('span', '', name))
    c.title = name
    c.addEventListener('click', async () => { state = await api.useSkin(id); render() })
    if (id) {
      const del = el('button', 'del', '×')
      del.title = '지우기'
      del.addEventListener('click', async (e) => { e.stopPropagation(); state = await api.deleteSkin(id); render() })
      c.appendChild(del)
    }
    return c
  }

  function render() {
    const active = state.list.find(s => s.id === state.active)
    if ((active?.skin || null) !== Sprites.getSkin()) {
      Sprites.setSkin(active?.skin || null)
      window.CBPanel?.onSkinChanged()
    }
    $('#mk-saved').replaceChildren(chip('', '기본', null), ...state.list.map(s => chip(s.id, s.name, s.skin)))
    $('#mk-key').style.display = state.hasKey ? 'none' : 'flex'
    $('#mk-keyinfo').textContent = state.hasKey ? `Higgsfield 키 ${state.keyId}` : 'Higgsfield API 키가 필요해요'
    $('#mk-key-edit').style.display = state.hasKey ? '' : 'none'
    $('#mk-go').disabled = !state.hasKey || !photoPath || busy
  }

  // ---------- API key ----------

  $('#hf-save').addEventListener('click', async () => {
    state = await api.setHiggsfieldKey($('#hf-id').value, $('#hf-secret').value)
    $('#hf-secret').value = ''
    render()
  })
  $('#hf-console').addEventListener('click', () => api.openExternal('https://console.higgsfield.ai'))
  $('#mk-key-edit').addEventListener('click', () => {
    $('#mk-key').style.display = 'flex'
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
  }

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
    renderVariants()
    pin()
    render()
    progress(STAGES.upload)
    const r = await api.generateSkin(photoPath)
    busy = false
    if (r.error) { progress(r.error, true); render(); pin(); return }
    for (const src of r.images) {
      try { variants.push({ skin: Pixelize.pixelize(await decode(src)), src }) } catch (e) { variants.push({ error: e.message, src }) }
    }
    chosen = variants.findIndex(v => v.skin)
    progress(chosen < 0 ? '도트로 바꾸지 못했어요. 다른 사진(정면, 밝은 곳)으로 다시 해 볼까요?' : '마음에 드는 쪽을 골라주세요', chosen < 0)
    renderVariants()
    render()
    pin()
  })

  function currentSkin() {
    const v = variants[chosen]
    if (!v?.skin) return null
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
    drawPreviews()
  }

  // preview skins rebuild when toggles change (cache key includes glasses/blush)
  const previewSkins = new Map()
  function previewSkin(i) {
    const v = variants[i]
    const key = `${i}:${$('#mk-glasses').checked}:${$('#mk-blush').checked}`
    if (!previewSkins.has(key)) previewSkins.set(key, { ...v.skin, glasses: $('#mk-glasses').checked, blush: $('#mk-blush').checked })
    return previewSkins.get(key)
  }

  function drawPreviews() {
    document.querySelectorAll('.variant canvas').forEach((cv) => {
      const i = Number(cv.dataset.i)
      Sprites.blit(cv, Sprites.petCanvas(PREVIEW_POSES[frame % PREVIEW_POSES.length], previewSkin(i)), 6)
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
    variants = []
    chosen = -1
    photoPath = ''
    $('#mk-photo').classList.remove('on')
    $('#mk-drop-text').textContent = '📷 사진을 끌어다 놓거나 눌러서 고르기'
    progress('적용했어요! 화면의 클로디를 보세요 ✨')
    renderVariants()
    render()
    pin()
  })

  api.onSkins((s) => { state = s; render() })
  render()
  window.CBMaker = { setPhoto } // handy for scripted checks
})()

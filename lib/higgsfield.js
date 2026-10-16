// Higgsfield API client for "make Claudy look like me".
// Docs: https://docs.higgsfield.ai — upload → submit → poll status_url → images[].url
//
// The photo and a template sprite go in as references; the model repaints the
// template with the person's hair, skin tone and clothes. The renderer then
// snaps the result back onto the sprite grid (renderer/js/pixelize.js).

const crypto = require('crypto')

// overridable for local testing against a mock server
const API = process.env.CLAUDE_BOUNCER_HF_API || 'https://api.higgsfield.ai'

const MODELS = {
  'marketing-studio/image': (prompt, urls, aspect = '1:1') => ({
    prompt, image_urls: urls, quality: 'high', resolution: '1k', aspect_ratio: aspect, enhance_prompt: false,
  }),
  'xai/grok-imagine-image-2.0': (prompt, urls, aspect = '1:1') => ({
    prompt, image_urls: urls, quality: 'medium', resolution: '1k', aspect_ratio: aspect,
  }),
  'alibaba/qwen-image-3/edit': (prompt, urls, aspect = '1:1') => ({
    prompt, image_urls: urls, resolution: '1k', aspect_ratio: aspect, prompt_extend: false, enable_thinking: false,
  }),
}
const DEFAULT_MODEL = 'marketing-studio/image'

const PROMPT = [
  'Image 1 is a pixel-art sprite template on a pure white background. Image 2 is a photo of a person.',
  'Repaint the sprite from image 1 so it looks like the person in image 2, as a tiny cute pixel character,',
  'while keeping EXACTLY the same pixel grid, cell size, position on the canvas and silhouette',
  '(rectangular body with dark outline, two stubby arms on the sides, four short legs at the bottom).',
  'Rules: top 2-3 rows of the body and up to 3 rows above it = the person\'s hairstyle and hair color in chunky pixels',
  '(a hat or hood instead if they wear one); middle rows of the body = the person\'s skin tone as a flat face area;',
  'bottom 3 rows of the body and the arms = the person\'s clothing color; legs = darker clothing color;',
  'keep a 1-pixel dark outline around everything.',
  'Do NOT draw eyes, mouth, glasses, blush or any facial features — leave the face area flat skin color.',
  'Hard-edged square pixels only, no anti-aliasing, no gradients, no shading noise, no text,',
  'pure white background, nothing else in the image.',
].join(' ')

// Free-form character: six poses of one chibi character on a 3×2 sheet.
// The order must match SHEET_FRAMES in renderer/js/pixelize.js.
const SHEET_PROMPT = [
  'Pixel art sprite sheet of the subject in the reference image (a person, animal, pet, plant, object or character),',
  'redrawn as a cute chibi desktop pet that is still instantly recognizable as THAT exact subject.',
  'It does NOT have to be human-shaped: keep the subject\'s own body type (a cat stays a four-legged cat,',
  'a plant stays a potted plant, a blob stays a blob), only rounder, softer and cuter.',
  'Faithfully keep its distinctive details: exact colors and color placement; silhouette, body and head shape;',
  'hairstyle details (bangs, parting, length, curls) or ears, horns, spikes, fur pattern and tail;',
  'eyebrows, eye shape and eye color, mouth, teeth and typical expression; facial hair, freckles, marks;',
  'accessories (glasses, hats, earrings, headphones, jewelry); clothing details (patterns, stripes, collars, layers, logos simplified).',
  'If the subject has no face, give it a tiny cute face (two dot eyes) in a fitting spot. Do not invent other features, and do not make it realistic.',
  'Proportions: big head and small body for people (about 2 to 2.5 heads tall); other subjects keep their own shape. Big expressive eyes in the subject\'s own eye style.',
  'Low-resolution 16-bit pixel art, each sprite about 48 pixels tall, chunky clearly visible pixels,',
  'flat colors from a limited palette of about 16 colors, thick dark outline, no anti-aliasing, no gradients, no dithering noise.',
  'Exactly 6 frames of the SAME character in a 3 columns x 2 rows grid, evenly spaced, same size, whole body, facing the viewer.',
  'Every pose must fit the subject\'s own body: never add human arms or legs to a non-human subject;',
  'show motion with paws, hops, floating, wiggling, squash, stretch or tilt.',
  'Row 1: (1) idle, relaxed; (2) the same pose with eyes closed (blink); (3) moving, first half of a step or hop;',
  'row 2: (4) moving, second half of the step or hop; (5) happy and excited, jumping or bouncing with arms, paws, ears or leaves up if it has them and a big smile;',
  '(6) asleep with eyes closed, sitting, curled up or lying down.',
  'No ground shadow, no text, no labels, no borders, pure white background.',
].join(' ')

// style → what to send: 'pixel' (free-form sheet, photo only) or 'claudy' (template + photo)
function styleSpec(style) {
  return style === 'claudy'
    ? { prompt: PROMPT, aspect: '1:1', withTemplate: true }
    : { prompt: SHEET_PROMPT, aspect: '3:2', withTemplate: false }
}

class HiggsfieldError extends Error {
  constructor(message, code) { super(message); this.code = code }
}

function friendly(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body || {})
  if (status === 401 || status === 403) return new HiggsfieldError('API 키가 맞지 않아요. 콘솔에서 키 ID와 시크릿을 다시 확인해 주세요.', 'auth')
  if (status === 402 || /credit|balance|insufficient/i.test(text)) return new HiggsfieldError('Higgsfield API 잔액이 부족해요. 콘솔에서 충전해 주세요.', 'credits')
  if (status === 429) return new HiggsfieldError('요청이 너무 많아요. 잠시 후 다시 시도해 주세요.', 'rate')
  return new HiggsfieldError(`Higgsfield 오류 (${status}): ${text.slice(0, 160)}`, 'http')
}

class Higgsfield {
  constructor({ keyId, secret, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise(r => setTimeout(r, ms)) }) {
    if (!keyId || !secret) throw new HiggsfieldError('API 키가 필요해요', 'auth')
    this.auth = `Key ${keyId}:${secret}`
    this.fetch = fetchImpl
    this.sleep = sleep
  }

  async json(method, url, body) {
    const res = await this.fetch(url, {
      method,
      headers: {
        Authorization: this.auth,
        'Content-Type': 'application/json',
        ...(method === 'POST' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    if (!res.ok) throw friendly(res.status, data)
    return data
  }

  // bytes → public URL usable as a model input
  async upload(bytes, contentType) {
    const t = await this.json('POST', `${API}/files/generate-upload-url`, { content_type: contentType })
    if (!t?.upload_url || !t?.public_url) throw new HiggsfieldError('업로드 주소를 받지 못했어요', 'upload')
    const res = await this.fetch(t.upload_url, { method: 'PUT', headers: t.upload_headers || { 'Content-Type': contentType }, body: bytes })
    if (!res.ok) throw new HiggsfieldError(`사진 업로드 실패 (${res.status})`, 'upload')
    return t.public_url
  }

  async submit(model, input) {
    const r = await this.json('POST', `${API}/${model}`, input)
    if (!r?.request_id) throw new HiggsfieldError('요청이 접수되지 않았어요', 'submit')
    return r
  }

  async wait(req, { timeoutMs = 240000, onStatus } = {}) {
    const url = req.status_url || `${API}/requests/${req.request_id}/status`
    const started = Date.now()
    let delay = 2000
    for (;;) {
      const s = await this.json('GET', url)
      onStatus?.(s.status)
      if (s.status === 'completed') return s
      if (s.status === 'nsfw') throw new HiggsfieldError('이미지가 Higgsfield 콘텐츠 정책에 걸렸어요. 유명 캐릭터처럼 저작권이 있는 이미지는 거절될 수 있어요 — 내 사진이나 반려동물, 직접 그린 캐릭터로 해 보세요.', 'nsfw')
      if (s.status === 'failed' || s.status === 'canceled') throw new HiggsfieldError(`생성 실패${s.error ? ': ' + String(s.error).slice(0, 120) : ''}`, 'failed')
      if (Date.now() - started > timeoutMs) throw new HiggsfieldError('시간이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.', 'timeout')
      await this.sleep(delay)
      delay = Math.min(6000, delay * 1.3)
    }
  }

  async download(url) {
    const res = await this.fetch(url)
    if (!res.ok) throw new HiggsfieldError(`결과 이미지를 받지 못했어요 (${res.status})`, 'download')
    return Buffer.from(await res.arrayBuffer())
  }

  // photo + template → [Buffer png, ...] (one per variant)
  async makeCharacter({ photo, photoType, template, style = 'pixel', model = DEFAULT_MODEL, variants = 2, onProgress }) {
    const build = MODELS[model] || MODELS[DEFAULT_MODEL]
    const spec = styleSpec(style)
    onProgress?.('upload')
    const urls = await Promise.all([
      ...(spec.withTemplate ? [this.upload(template, 'image/png')] : []),
      this.upload(photo, photoType),
    ])
    onProgress?.('generate')
    const jobs = await Promise.all(Array.from({ length: variants }, () => this.submit(model, build(spec.prompt, urls, spec.aspect))))
    const results = await Promise.allSettled(jobs.map(j => this.wait(j)))
    const outUrls = results.flatMap(r => (r.status === 'fulfilled' ? (r.value.images || []).map(i => i.url) : [])).filter(Boolean)
    if (!outUrls.length) throw results.find(r => r.status === 'rejected')?.reason || new HiggsfieldError('결과가 비어 있어요', 'empty')
    onProgress?.('download')
    return Promise.all(outUrls.slice(0, variants).map(u => this.download(u)))
  }
}

module.exports = { Higgsfield, HiggsfieldError, MODELS, DEFAULT_MODEL, PROMPT, SHEET_PROMPT, styleSpec }

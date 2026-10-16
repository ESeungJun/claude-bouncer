// "Make one for me": a photo + note sent to the maintainer's inbox through
// FormSubmit (https://formsubmit.co). No server of our own.

const TO = 'https://formsubmit.co/ajax/6951004@gmail.com'
// FormSubmit only accepts posts that name a web page as their source
const FROM = 'https://github.com/ESeungJun/claude-bouncer'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// fields: { email, subject, message, consent, photoJpeg (Buffer), app }
// deps: { fetch, now } (injectable for tests)
function requestSender({ fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  let lastAt = 0
  return async function sendRequest({ email, subject, message, consent, photoJpeg, app = '' }) {
    email = String(email || '').trim()
    subject = String(subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 80) || '캐릭터 제작 요청'
    message = String(message || '').trim().slice(0, 1000)
    if (!EMAIL_RE.test(email)) throw new Error('답장 받을 이메일을 확인해 주세요')
    if (!photoJpeg) throw new Error('캐릭터로 만들 사진을 골라 주세요')
    if (!consent) throw new Error('사진 전송에 동의해 주세요')
    if (now() - lastAt < 60000) throw new Error('잠시 후 다시 보내 주세요')
    const form = new FormData()
    form.append('_subject', `[Claude Bouncer] ${subject}`)
    form.append('_template', 'table')
    form.append('_captcha', 'false')
    form.append('_replyto', email)
    form.append('email', email)
    form.append('message', message || '(메시지 없음)')
    if (app) form.append('app', app)
    form.append('attachment', new Blob([photoJpeg], { type: 'image/jpeg' }), 'photo.jpg')
    const res = await fetchImpl(TO, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(20000),
      headers: { Accept: 'application/json', Referer: FROM, Origin: 'https://github.com' },
    })
    if (!res.ok) throw new Error(`보내지 못했어요 (${res.status}). 잠시 후 다시 시도해 주세요`)
    // FormSubmit answers 200 even when nothing was forwarded (not activated,
    // rejected, …): only {"success":"true"} means it reached the inbox
    let reply = null
    try { reply = await res.json() } catch {}
    if (String(reply?.success) !== 'true') {
      console.error('[claude-bouncer] request not delivered:', String(reply?.message || 'no JSON reply').slice(0, 200))
      throw new Error(/activat/i.test(reply?.message || '')
        ? '요청 창구가 아직 준비 중이에요. 잠시 후 다시 시도해 주세요'
        : '요청을 전달하지 못했어요. 잠시 후 다시 시도해 주세요')
    }
    lastAt = now()
    return true
  }
}

module.exports = { requestSender }

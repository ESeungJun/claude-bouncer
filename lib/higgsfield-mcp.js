// Higgsfield over MCP: sign in with your Higgsfield account (OAuth in the
// browser, same as Claude Code's Higgsfield connector) and generate with your
// account credits — no API key needed.
//
// Flow: media_upload → PUT → media_confirm → generate_image → jobs_wait → download

const http = require('http')
const crypto = require('crypto')
const fs = require('fs')
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js')
const { UnauthorizedError } = require('@modelcontextprotocol/sdk/client/auth.js')
const { styleSpec } = require('./higgsfield')

const MCP_URL = process.env.CLAUDE_BOUNCER_HF_MCP || 'https://mcp.higgsfield.ai/mcp'
const CALLBACK_PORT = 17892
const REDIRECT = `http://localhost:${CALLBACK_PORT}/callback`
const MODEL = 'gpt_image_2_5'

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

class McpError extends Error {
  constructor(message, code) { super(message); this.code = code }
}

// Encrypted JSON blob for OAuth client info + tokens.
class SecretFile {
  constructor(file, safe) { this.file = file; this.safe = safe; this.data = this.read() }
  read() {
    try {
      const raw = fs.readFileSync(this.file)
      const text = this.safe?.isEncryptionAvailable() ? this.safe.decryptString(raw) : raw.toString('utf8')
      return JSON.parse(text) || {}
    } catch { return {} }
  }
  write() {
    const text = JSON.stringify(this.data)
    const raw = this.safe?.isEncryptionAvailable() ? this.safe.encryptString(text) : Buffer.from(text)
    fs.writeFileSync(this.file, raw, { mode: 0o600 })
  }
  set(key, value) { this.data[key] = value; this.write() }
  clear() { this.data = {}; try { fs.unlinkSync(this.file) } catch {} }
}

// Wait for the browser to come back to http://localhost:17892/callback?code=…
// Started before the login URL opens, so a fast redirect can't miss it.
// Returns { promise, close }; getState() is read when the callback arrives.
function waitForCallback(getState, timeoutMs = 5 * 60 * 1000) {
  let server
  let timer
  const promise = new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT)
      const expectedState = getState()
      if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return }
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const error = url.searchParams.get('error')
      const ok = code && (!expectedState || state === expectedState)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><meta charset="utf-8"><title>Claude Bouncer</title>
        <body style="font-family:-apple-system,sans-serif;background:#fffaf2;color:#2a1612;display:grid;place-items:center;height:100vh;margin:0">
        <div style="text-align:center"><div style="font-size:48px">${ok ? '🎉' : '😢'}</div>
        <h2>${ok ? 'Higgsfield 연결 완료!' : '연결하지 못했어요'}</h2>
        <p>${ok ? '이 창을 닫고 클로디에게 돌아가세요.' : escapeHtml(error || '다시 시도해 주세요.')}</p></div>`)
      clearTimeout(timer)
      server.close()
      ok ? resolve(code) : reject(new McpError(error ? `로그인이 취소됐어요 (${error})` : '로그인 응답이 올바르지 않아요', 'oauth'))
    })
    timer = setTimeout(() => { server.close(); reject(new McpError('로그인 시간이 지났어요. 다시 시도해 주세요.', 'timeout')) }, timeoutMs)
    server.on('error', (e) => {
      clearTimeout(timer)
      reject(new McpError(e.code === 'EADDRINUSE' ? `포트 ${CALLBACK_PORT}을 다른 프로그램이 쓰고 있어요` : e.message, 'port'))
    })
    server.listen(CALLBACK_PORT, '127.0.0.1')
  })
  promise.catch(() => {}) // closed without a login is fine
  return { promise, close: () => { clearTimeout(timer); server?.close() } }
}

class HiggsfieldMcp {
  constructor({ file, safeStorage, openUrl, fetchImpl = globalThis.fetch }) {
    this.store = new SecretFile(file, safeStorage)
    this.openUrl = openUrl
    this.fetch = fetchImpl
    this.client = null
    this.pendingState = null
    const self = this
    this.provider = {
      get redirectUrl() { return REDIRECT },
      get clientMetadata() {
        return {
          client_name: 'Claude Bouncer',
          redirect_uris: [REDIRECT],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          scope: 'openid email offline_access',
        }
      },
      state() { self.pendingState = crypto.randomBytes(16).toString('hex'); return self.pendingState },
      clientInformation: () => this.store.data.client,
      saveClientInformation: (c) => this.store.set('client', c),
      tokens: () => this.store.data.tokens,
      saveTokens: (t) => this.store.set('tokens', t),
      saveCodeVerifier: (v) => this.store.set('verifier', v),
      codeVerifier: () => this.store.data.verifier,
      discoveryState: () => this.store.data.discovery,
      saveDiscoveryState: (d) => this.store.set('discovery', d),
      redirectToAuthorization: (url) => {
        self.authUrl = url
        if (self.interactive) self.openUrl(url.toString())
      },
      invalidateCredentials: (scope) => {
        if (scope === 'all') this.store.clear()
        else if (scope === 'tokens') this.store.set('tokens', undefined)
        else if (scope === 'client') this.store.set('client', undefined)
        else if (scope === 'verifier') this.store.set('verifier', undefined)
        else if (scope === 'discovery') this.store.set('discovery', undefined)
      },
    }
  }

  get signedIn() { return !!this.store.data.tokens?.access_token }

  transport() {
    return new StreamableHTTPClientTransport(new URL(MCP_URL), { authProvider: this.provider })
  }

  // interactive=true opens the browser when a login is needed
  // One connection attempt at a time: overlapping calls would each refresh the
  // (rotating) OAuth token and the loser would log the user out.
  connect({ interactive = false } = {}) {
    if (this.client) return Promise.resolve(this.client)
    if (!this.connecting) {
      this.connecting = this.doConnect({ interactive }).finally(() => { this.connecting = null })
    }
    return this.connecting
  }

  async doConnect({ interactive }) {
    this.interactive = interactive
    const callback = interactive ? waitForCallback(() => this.pendingState) : null
    let transport = this.transport()
    let client = new Client({ name: 'claude-bouncer', version: '0.3.0' })
    try {
      await client.connect(transport)
    } catch (e) {
      if (!(e instanceof UnauthorizedError) && !/unauthori[sz]ed|401/i.test(String(e?.message))) throw e
      if (!interactive) throw new McpError('Higgsfield에 다시 로그인해 주세요', 'auth')
      const code = await callback.promise
      await transport.finishAuth(code)
      transport = this.transport()
      client = new Client({ name: 'claude-bouncer', version: '0.3.0' })
      await client.connect(transport)
    } finally {
      this.interactive = false
      callback?.close()
    }
    this.client = client
    return client
  }

  async login() {
    if (this.connecting) await this.connecting.catch(() => {})
    this.client = null
    await this.connect({ interactive: true })
    return this.balance().catch(() => null)
  }

  logout() {
    this.client?.close?.().catch(() => {})
    this.client = null
    this.store.clear()
  }

  async call(name, args) {
    const client = await this.connect()
    const r = await client.callTool({ name, arguments: args })
    if (process.env.CLAUDE_BOUNCER_DEBUG) console.log('[mcp]', name, JSON.stringify(r).slice(0, 600))
    const text = (r.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n')
    if (r.isError) throw new McpError(text.slice(0, 200) || `${name} 실패`, 'tool')
    if (r.structuredContent && typeof r.structuredContent === 'object') return { text, ...r.structuredContent }
    try { return JSON.parse(text) } catch { return { text } }
  }

  async balance() {
    const b = await this.call('balance', {})
    return typeof b.credits === 'number' ? b.credits : null
  }

  params(prompt, refs, variants, extra = {}) {
    return {
      model: MODEL, quality: 'high', aspect_ratio: extra.aspect_ratio || '1:1', background: 'opaque', count: variants,
      prompt, use_unlim: false,
      medias: refs.map(value => ({ value, role: 'image_references' })),
      ...extra,
    }
  }

  async estimate(prompt, variants = 2) {
    // a real media id isn't needed to price the request
    const r = await this.call('generate_image', { params: this.params(prompt, [], 1, { get_cost: true }) })
    const c = r.cost
    const cost = typeof c === 'number' ? c : c?.credits ?? r.credits
    // the preflight prices a single image regardless of count (seen: 1.5 quoted, 3.0 charged for 2)
    return typeof cost === 'number' ? Math.round(cost * variants * 10) / 10 : null
  }

  async upload(files) {
    const r = await this.call('media_upload', { files: files.map(f => ({ filename: f.name, content_type: f.type })) })
    const ups = r.uploads || []
    if (ups.length !== files.length) throw new McpError('업로드 주소를 받지 못했어요', 'upload')
    await Promise.all(ups.map(async (u, i) => {
      const res = await this.fetch(u.upload_url, { method: 'PUT', headers: { 'Content-Type': files[i].type }, body: files[i].bytes })
      if (!res.ok) throw new McpError(`사진 업로드 실패 (${res.status})`, 'upload')
    }))
    await this.call('media_confirm', { type: 'image', media_ids: ups.map(u => u.media_id) })
    return ups.map(u => u.media_id)
  }

  async makeCharacter({ photo, photoType, template, style = 'pixel', variants = 2, onProgress, sleep = (ms) => new Promise(r => setTimeout(r, ms)) }) {
    const spec = styleSpec(style)
    onProgress?.('upload')
    const refs = await this.upload([
      ...(spec.withTemplate ? [{ name: 'template.png', type: 'image/png', bytes: template }] : []),
      { name: 'photo.jpg', type: photoType, bytes: photo },
    ])
    onProgress?.('generate')
    const gen = await this.call('generate_image', {
      params: this.params(spec.prompt, refs, variants, { aspect_ratio: spec.aspect }),
      context: 'Turn a user photo into a pixel-art desktop pet skin.',
    })
    const jobs = (gen.results || []).map((j, index) => ({ index, job_id: j.id }))
    if (!jobs.length) throw new McpError(gen.message || gen.text || '생성 요청이 접수되지 않았어요', 'submit')
    const started = Date.now()
    let state
    for (;;) {
      state = await this.call('jobs_wait', { jobs, timeout_seconds: 15 })
      if (state.all_terminal) break
      if (Date.now() - started > 5 * 60 * 1000) throw new McpError('시간이 너무 오래 걸려요', 'timeout')
      await sleep(Math.max(0, (state.poll_after_seconds || 0) * 1000))
    }
    const done = (state.jobs || []).filter(j => j.status === 'completed' && j.result_url)
    if (!done.length) {
      const bad = (state.jobs || []).find(j => j.status !== 'completed')
      throw new McpError(bad?.status === 'nsfw' ? '이미지가 Higgsfield 콘텐츠 정책에 걸렸어요. 유명 캐릭터처럼 저작권이 있는 이미지는 거절될 수 있어요 — 내 사진이나 반려동물, 직접 그린 캐릭터로 해 보세요.' : `생성 실패 (${bad?.status || '알 수 없음'})`, 'failed')
    }
    onProgress?.('download')
    return Promise.all(done.map(async (j) => {
      const res = await this.fetch(j.result_url)
      if (!res.ok) throw new McpError('결과 이미지를 받지 못했어요', 'download')
      return Buffer.from(await res.arrayBuffer())
    }))
  }
}

module.exports = { HiggsfieldMcp, McpError, REDIRECT, MCP_URL }

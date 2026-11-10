#!/usr/bin/env node
// 상태별 CPU 실측 (릴리스 전 수동 점검용. 창이 뜨므로 CI 에는 넣지 않는다)
//
//   node tools/idle-cpu.js --state idle --runs 3
//   node tools/idle-cpu.js --state walk --electron /path/to/Electron --app /path/to/app
//
// HOME 과 userData 를 임시 폴더로 돌려 실제 ~/.claude/settings.json 은 건드리지 않는다.
// Electron 을 띄워 상태를 만든 뒤 `ps` 누적 CPU 시간 차이를 잰다(코어 1개 대비 %).
// WindowServer 는 시스템 전체 값이라 다른 앱의 영향이 섞인다.
//
// 상태:
//   idle    돌아다니기 끔, 펫 정지
//   walk    계속 걷게 강제
//   notify  권한 카드 1장을 받고 8초 지난 뒤(처음 몇 초의 점프가 끝난 대기 구간)
//   work    작업 중 세션 1개
//   sleep   잠든 상태
//   roam    기본 설정 그대로(돌아다니기 켬)
//   none    앱 없이 WindowServer 기준선만
//
// 기준: 정지 유휴(idle) 10초 평균 2% 이하.

const { spawn, execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const args = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? true : process.argv[++i]
}

const APP = path.resolve(args.app || path.join(__dirname, '..'))
const STATE = String(args.state || 'idle')
const RUNS = Math.max(1, Number(args.runs) || 3)
const SECS = Math.min(20, Math.max(3, Number(args.secs) || 10))
const WARMUP_MS = 6000
const DEBUG_PORT = 9339
const HOOK_PORT = 17891
const STATES = ['idle', 'walk', 'notify', 'work', 'sleep', 'roam', 'none']

function electronPath() {
  if (args.electron && args.electron !== true) return path.resolve(args.electron)
  const base = path.join(APP, 'node_modules', 'electron', 'dist')
  if (process.platform === 'darwin') return path.join(base, 'Electron.app', 'Contents', 'MacOS', 'Electron')
  return path.join(base, process.platform === 'win32' ? 'electron.exe' : 'electron')
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function cpuSec(t) { // [[DD-]HH:]MM:SS.cc
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(t)
  return m ? (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+m[3]) * 60 + parseFloat(m[4]) : 0
}

// 이 실행에 속한 프로세스(userData 경로로 구분)와 WindowServer 의 누적 CPU 시간
function sample(ud) {
  const out = execFileSync('ps', ['-axo', 'pid=,time=,rss=,command='], { encoding: 'utf8', maxBuffer: 1 << 26 })
  const rows = {}
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/.exec(line)
    if (!m) continue
    const cmd = m[4]
    let name = null
    if (ud && cmd.includes(ud)) {
      name = /--type=([a-z-]+)/.exec(cmd)?.[1] || 'main'
      if (name === 'utility') name = /--utility-sub-type=[\w.]*?(\w+)$/.exec(cmd.split(' ').find(s => s.startsWith('--utility-sub-type=')) || '')?.[1] || 'utility'
      if (name === 'renderer') name += '#' + m[1]
    } else if (/\/WindowServer( |$)/.test(cmd)) name = 'WindowServer'
    if (name) rows[name] = { cpu: cpuSec(m[2]), rssMB: Math.round(+m[3] / 1024) }
  }
  return rows
}

function post(body, headers) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body)
    const req = http.request({
      host: '127.0.0.1', port: HOOK_PORT, path: '/notify', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
    }, (res) => { res.resume(); resolve(res.statusCode) })
    req.on('error', (e) => resolve('ERR ' + e.message))
    req.end(data)
  })
}

function portBusy(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 800 }, (res) => { res.resume(); resolve(true) })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

// 오버레이 페이지에서 식을 실행한다(Chrome DevTools Protocol). 실행 뒤 바로 끊는다.
async function evalInOverlay(expression) {
  const list = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: DEBUG_PORT, path: '/json/list' }, (res) => {
      let s = ''
      res.on('data', d => { s += d })
      res.on('end', () => { try { resolve(JSON.parse(s)) } catch { resolve([]) } })
    }).on('error', () => resolve([]))
  })
  const target = list.find(t => /overlay\.html/.test(t.url))
  if (!target || typeof WebSocket === 'undefined') return undefined
  return new Promise((resolve) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    const done = (v) => { try { ws.close() } catch {} resolve(v) }
    const timer = setTimeout(() => done(undefined), 3000)
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.id === 1) { clearTimeout(timer); done(msg.result?.result?.value) }
    }
    ws.onerror = () => { clearTimeout(timer); done(undefined) }
  })
}

const PET = 'CB.world.notify.pet'
const ACT = `${PET}.act && ${PET}.act.name`
const FORCE_WALK = `(() => { const p = ${PET}; setInterval(() => { if (!p.act || p.act.name !== 'walk') { const s = p.randomSpot(); p.walkTo(s.x, s.y) } }, 100); return true })()`
const FORCE_SLEEP = `(() => { const p = ${PET}; CB.world.idleSec = 9999; p.sleep(600); return p.act.name })()`

async function runOnce(i) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-cpu-'))
  const home = path.join(tmp, 'home')
  const ud = path.join(tmp, 'ud')
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
  fs.mkdirSync(ud, { recursive: true })
  const roam = STATE === 'walk' || STATE === 'roam'
  fs.writeFileSync(path.join(ud, 'state.json'), JSON.stringify({ settings: { sound: false, roam } }))

  const child = spawn(electronPath(), [APP, `--user-data-dir=${ud}`, `--remote-debugging-port=${DEBUG_PORT}`], {
    env: { ...process.env, HOME: home, CFFIXED_USER_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', d => { log += d })
  child.stderr.on('data', d => { log += d })
  try {
    await sleep(WARMUP_MS)
    const hdr = () => ({
      'X-Claude-Bouncer-Token': fs.readFileSync(path.join(home, '.claude', 'claude-bouncer.token'), 'utf8').trim(),
      'X-CB-Bundle-Id': 'com.apple.Terminal', 'X-CB-Tty': '/dev/ttys999',
    })
    if (STATE === 'walk') await evalInOverlay(FORCE_WALK)
    if (STATE === 'sleep') { await evalInOverlay(FORCE_SLEEP); await sleep(2000) }
    if (STATE === 'work') {
      await post({ session_id: 'measure-1', cwd: '/tmp', prompt: '측정' }, { ...hdr(), 'X-CB-Kind': 'submit' })
      await sleep(1000)
    }
    if (STATE === 'notify') {
      const code = await post(
        { session_id: 'measure-1', cwd: '/tmp', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' },
        { ...hdr(), 'X-CB-Kind': 'notification' })
      if (code !== 204) throw new Error('POST /notify → ' + code)
      await sleep(8000)
    }
    const actBefore = await evalInOverlay(ACT)
    const a = sample(ud)
    await sleep(SECS * 1000)
    const b = sample(ud)
    const actAfter = await evalInOverlay(ACT)
    const row = { run: i, act: `${actBefore} → ${actAfter}` }
    let total = 0
    for (const k of Object.keys(b)) {
      const pct = (b[k].cpu - (a[k]?.cpu ?? b[k].cpu)) / SECS * 100
      const key = k.startsWith('renderer#') ? (b[k].rssMB && k) : k
      row[key] = +pct.toFixed(1)
      if (k !== 'WindowServer') total += pct
    }
    row.app = +total.toFixed(1)
    row.rssMB = Object.entries(b).filter(([k]) => k !== 'WindowServer').reduce((s, [, v]) => s + v.rssMB, 0)
    return row
  } finally {
    child.kill('SIGTERM')
    await sleep(1200)
    try { process.kill(child.pid, 'SIGKILL') } catch {}
    if (args.verbose) console.error(log.slice(0, 2000))
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

async function baselineOnce(i) {
  const a = sample(null)
  await sleep(SECS * 1000)
  const b = sample(null)
  return { run: i, WindowServer: +((b.WindowServer.cpu - a.WindowServer.cpu) / SECS * 100).toFixed(1) }
}

const median = (xs) => { const s = [...xs].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : +((s[s.length / 2 - 1] + s[s.length / 2]) / 2).toFixed(1) }

;(async () => {
  if (!STATES.includes(STATE)) { console.error(`--state 는 ${STATES.join(' | ')} 중 하나`); process.exit(2) }
  if (STATE !== 'none') {
    if (!fs.existsSync(electronPath())) { console.error('Electron 실행 파일이 없어요: ' + electronPath() + '\n--electron 으로 경로를 주세요.'); process.exit(2) }
    if (await portBusy(HOOK_PORT)) { console.error(`포트 ${HOOK_PORT} 를 쓰는 claude-bouncer 가 이미 떠 있어요. 끄고 다시 실행해 주세요.`); process.exit(2) }
  }
  const rows = []
  for (let i = 1; i <= RUNS; i++) {
    const row = STATE === 'none' ? await baselineOnce(i) : await runOnce(i)
    rows.push(row)
    console.log(JSON.stringify(row))
    if (i < RUNS) await sleep(1500)
  }
  const summary = { state: STATE, runs: RUNS, secs: SECS }
  for (const k of ['main', 'gpu-process', 'app', 'WindowServer']) {
    const xs = rows.map(r => r[k]).filter(v => typeof v === 'number')
    if (xs.length) summary[k] = { median: median(xs), min: Math.min(...xs), max: Math.max(...xs) }
  }
  console.log('요약 ' + JSON.stringify(summary))
})()

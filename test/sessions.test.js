const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  SessionTracker, readTranscriptTail, readGitBranch, classifyNotification, koreanMessage, buildTerminal, isRealPrompt,
} = require('../lib/sessions')

function tracker(extra = {}) {
  let now = 1_000_000
  const t = new SessionTracker({
    now: () => now,
    readTranscript: () => ({}),
    readBranch: () => 'main',
    ...extra,
  })
  t.advance = (ms) => { now += ms }
  return t
}

const base = { session_id: 's1', cwd: '/work/my-app', term_program: 'iTerm.app', tty: '/dev/ttys004' }

test('submit → stop produces a done notification that carries where it came from', () => {
  const t = tracker()
  t.handle({ ...base, kind: 'submit', prompt: '로그인 버그 고쳐줘' })
  assert.strictEqual(t.workingCount(), 1)
  t.advance(95_000)
  const { notification } = t.handle({ ...base, kind: 'stop', last_assistant_message: '고쳤어요' })
  assert.strictEqual(notification.kind, 'done')
  assert.strictEqual(notification.projectName, 'my-app')
  assert.strictEqual(notification.branch, 'main')
  assert.strictEqual(notification.prompt, '로그인 버그 고쳐줘')
  assert.strictEqual(notification.summary, '고쳤어요')
  assert.strictEqual(notification.durationMs, 95_000)
  assert.strictEqual(notification.terminal.name, 'iTerm2')
  assert.match(notification.terminal.label, /ttys004/)
  assert.strictEqual(t.workingCount(), 0)
  assert.strictEqual(t.pending().length, 1)
})

test('permission prompt is resolved once the session moves on', () => {
  const t = tracker()
  t.handle({ ...base, kind: 'submit', prompt: 'run tests' })
  const { notification } = t.handle({ ...base, kind: 'notification', message: 'Claude needs your permission to use Bash' })
  assert.strictEqual(notification.kind, 'permission')
  assert.strictEqual(notification.message, 'Bash 사용 권한이 필요해요')
  assert.strictEqual(t.pending().length, 1)
  const { notification: done } = t.handle({ ...base, kind: 'stop' })
  // the permission card is settled; only the fresh completion is pending
  assert.deepStrictEqual(t.pending().map(n => n.id), [done.id])
})

test('a new prompt in the same session marks its notifications as read', () => {
  const t = tracker()
  t.handle({ ...base, kind: 'stop' })
  t.handle({ ...base, session_id: 's2', kind: 'stop' })
  assert.strictEqual(t.pending().length, 2)
  t.handle({ ...base, kind: 'submit', prompt: 'next' })
  assert.deepStrictEqual(t.pending().map(n => n.sessionId), ['s2'])
})

test('only one live needs-you card per session', () => {
  const t = tracker()
  t.handle({ ...base, kind: 'notification', message: 'Claude needs your permission to use Bash' })
  t.handle({ ...base, kind: 'notification', message: 'Claude is waiting for your input' })
  const pend = t.pending()
  assert.strictEqual(pend.length, 1)
  assert.strictEqual(pend[0].kind, 'input')
})

test('markRead / markAllRead / session end', () => {
  const t = tracker()
  const a = t.handle({ ...base, kind: 'stop' }).notification
  t.handle({ ...base, session_id: 's9', kind: 'notification', message: 'x' })
  assert.ok(t.markRead(a.id))
  assert.strictEqual(t.pending().length, 1)
  t.handle({ ...base, session_id: 's9', kind: 'end' })
  assert.strictEqual(t.pending().length, 0)
  assert.ok(!t.listSessions().some(s => s.id === 's9'))
  t.handle({ ...base, kind: 'stop' })
  t.markAllRead()
  assert.strictEqual(t.pending().length, 0)
})

test('history is capped and survives a reload', () => {
  const t = tracker()
  for (let i = 0; i < 130; i++) t.handle({ ...base, kind: 'stop' })
  assert.strictEqual(t.history.length, 100)
  const t2 = tracker({ history: t.history })
  assert.strictEqual(t2.history.length, 100)
})

test('falls back to hook_event_name and survives garbage payloads', () => {
  const t = tracker()
  assert.strictEqual(t.handle({ hook_event_name: 'Notification', message: 'Claude is waiting for your input' }).notification.kind, 'input')
  assert.strictEqual(t.handle(null).type, 'stop')
  assert.strictEqual(t.handle({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' }).type, 'submit')
})

test('classification and messages', () => {
  assert.strictEqual(classifyNotification({ notification_type: 'permission_prompt' }), 'permission')
  assert.strictEqual(classifyNotification({ notification_type: 'idle_prompt' }), 'input')
  assert.strictEqual(classifyNotification({ message: 'something else' }), 'attention')
  assert.strictEqual(koreanMessage('permission', 'Claude needs your permission to use WebFetch'), 'WebFetch 사용 권한이 필요해요')
  assert.strictEqual(koreanMessage('input', ''), '입력을 기다리고 있어요')
})

test('terminal names from bundle id / TERM_PROGRAM', () => {
  assert.strictEqual(buildTerminal({ bundle_id: 'com.todesktop.230313mzl4w4u92', term_program: 'vscode' }).name, 'Cursor')
  assert.strictEqual(buildTerminal({ term_program: 'Apple_Terminal' }).name, '터미널')
  assert.strictEqual(buildTerminal({ term_program: 'vscode' }).name, 'VS Code')
  assert.strictEqual(buildTerminal({ terminal_emulator: 'JetBrains-JediTerm' }).name, 'JetBrains')
  assert.strictEqual(buildTerminal({ tmux_pane: '%3', term_program: 'tmux', tty: '/dev/ttys001' }).label, 'tmux · tmux %3 · ttys001')
})

test('isRealPrompt skips injected turns', () => {
  assert.ok(isRealPrompt('fix the bug'))
  assert.ok(!isRealPrompt('<command-name>/clear</command-name>'))
  assert.ok(!isRealPrompt('[Request interrupted by user]'))
  assert.ok(!isRealPrompt('   '))
})

test('readTranscriptTail finds the last real prompt and assistant text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-'))
  const file = path.join(dir, 't.jsonl')
  const rows = [
    { type: 'user', message: { role: 'user', content: '첫 질문' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: '중간 답' }] } },
    { type: 'user', message: { role: 'user', content: '두 번째 질문\n여러 줄' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'user', isMeta: true, message: { role: 'user', content: 'meta' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: '다 했어요!' }] } },
  ]
  fs.writeFileSync(file, 'garbage-partial-line\n' + rows.map(r => JSON.stringify(r)).join('\n') + '\n')
  assert.deepStrictEqual(readTranscriptTail(file), { summary: '다 했어요!', prompt: '두 번째 질문 여러 줄' })
  assert.deepStrictEqual(readTranscriptTail(path.join(dir, 'missing.jsonl')), {})
  fs.rmSync(dir, { recursive: true })
})

test('readGitBranch walks up and handles worktree .git files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-git-'))
  fs.mkdirSync(path.join(dir, '.git'))
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/feature/x\n')
  fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true })
  assert.strictEqual(readGitBranch(path.join(dir, 'a', 'b')), 'feature/x')

  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-wt-'))
  const gitdir = path.join(dir, '.git', 'worktrees', 'w1')
  fs.mkdirSync(gitdir, { recursive: true })
  fs.writeFileSync(path.join(gitdir, 'HEAD'), 'ref: refs/heads/wt-branch\n')
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${gitdir}\n`)
  assert.strictEqual(readGitBranch(wt), 'wt-branch')
  fs.rmSync(dir, { recursive: true }); fs.rmSync(wt, { recursive: true })
})

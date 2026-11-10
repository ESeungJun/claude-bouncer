const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  SessionTracker, readTranscriptTail, readGitBranch, readGitInfo, projectLabel, classifyNotification, koreanMessage, buildTerminal, isRealPrompt,
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
  t.handle({ ...base, kind: 'notification', notification_type: 'elicitation_dialog', message: 'pick one' })
  const pend = t.pending()
  assert.strictEqual(pend.length, 1)
  assert.strictEqual(pend[0].kind, 'input')
})

test('"waiting for your input" makes no card and leaves the open ones alone', () => {
  const t = tracker()
  t.handle({ ...base, kind: 'stop' })
  t.handle({ ...base, session_id: 's2', kind: 'notification', message: 'Claude needs your permission to use Bash' })
  for (const data of [{ notification_type: 'idle_prompt' }, { message: 'Claude is waiting for your input' }]) {
    assert.strictEqual(t.handle({ ...base, kind: 'notification', ...data }).notification, null)
    assert.strictEqual(t.handle({ ...base, session_id: 's2', kind: 'notification', ...data }).notification, null)
  }
  assert.deepStrictEqual(t.pending().map(n => n.kind).sort(), ['done', 'permission'])
  assert.strictEqual(t.listSessions().find(s => s.id === 's1').status, 'done')
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
  assert.strictEqual(t.handle({ hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' }).notification.kind, 'permission')
  assert.strictEqual(t.handle(null).type, 'stop')
  assert.strictEqual(t.handle({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' }).type, 'submit')
})

test('classification and messages', () => {
  assert.strictEqual(classifyNotification({ notification_type: 'permission_prompt' }), 'permission')
  assert.strictEqual(classifyNotification({ notification_type: 'idle_prompt' }), 'idle')
  assert.strictEqual(classifyNotification({ notification_type: 'elicitation_dialog' }), 'input')
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
  // Orca started claude without a shell: only its tab ids are set
  const orca = buildTerminal({ orca_tab: 'tab1', orca_pane: 'tab1:leaf1', tty: '/dev/ttys000' })
  assert.strictEqual(orca.name, 'Orca')
  assert.strictEqual(orca.bundleId, 'com.stablyai.orca')
  // another app launched from Orca inherits its ids but keeps its own name
  assert.strictEqual(buildTerminal({ orca_tab: 'tab1', term_program: 'iTerm.app' }).name, 'iTerm2')
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
  const root = dir + path.sep
  assert.deepStrictEqual(readTranscriptTail(file, root), { summary: '다 했어요!', prompt: '두 번째 질문 여러 줄' })
  assert.deepStrictEqual(readTranscriptTail(path.join(dir, 'missing.jsonl'), root), {})
  // outside ~/.claude, or not a regular file (e.g. a FIFO that would block) → ignored
  assert.deepStrictEqual(readTranscriptTail(file, path.join(os.tmpdir(), 'elsewhere') + path.sep), {})
  require('child_process').execFileSync('mkfifo', [path.join(dir, 'fifo')])
  assert.deepStrictEqual(readTranscriptTail(path.join(dir, 'fifo'), root), {})
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

test('claude.ai chats become sessions named by their title', () => {
  const t = tracker()
  const web = { source: 'web', session_id: 'web:abc', title: '여행 일정 짜기', url: 'https://claude.ai/chat/abc', browser: 'Google Chrome', tab_id: 12, window_id: 3 }
  t.handle({ ...web, kind: 'submit', prompt: '도쿄 3박 4일 일정 짜줘' })
  assert.strictEqual(t.workingCount(), 1)
  const { notification } = t.handle({ ...web, kind: 'stop', prompt: '도쿄 3박 4일 일정 짜줘', last_assistant_message: '일정을 정리했어요' })
  assert.strictEqual(notification.projectName, '여행 일정 짜기')
  assert.strictEqual(notification.prompt, '도쿄 3박 4일 일정 짜줘')
  assert.strictEqual(notification.terminal.web, true)
  assert.strictEqual(notification.terminal.tabId, 12)
  assert.strictEqual(notification.terminal.label, 'claude.ai · Google Chrome')
  // finished while you were looking at the tab → no card
  t.handle({ ...web, kind: 'submit', prompt: 'again' })
  assert.strictEqual(t.handle({ ...web, kind: 'stop', visible: true }).notification, null)
  // only claude.ai URLs are kept
  assert.strictEqual(buildTerminal({ source: 'web', url: 'file:///etc/passwd' }).url, '')
})

test('submit without a tty keeps the tab we already know; branch is cached', () => {
  let reads = 0
  const t = tracker({ readBranch: () => { reads++; return 'main' } })
  t.handle({ ...base, kind: 'stop' })
  t.handle({ session_id: 's1', cwd: '/work/my-app', term_program: 'iTerm.app', kind: 'submit', prompt: 'next' })
  const s = t.listSessions().find(x => x.id === 's1')
  assert.strictEqual(s.terminal.tty, '/dev/ttys004')
  assert.strictEqual(reads, 1, 'git branch read once within 30s')
  t.advance(31000)
  t.handle({ ...base, kind: 'stop' })
  assert.strictEqual(reads, 2)
})

test('worktrees and subfolders are named with their repository', () => {
  // real folders: a repository, a linked worktree kept inside it, and one kept elsewhere
  const repo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cb-repo-')), 'haulProject')
  fs.mkdirSync(path.join(repo, '.git', 'worktrees', 'fix-login'), { recursive: true })
  fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  fs.writeFileSync(path.join(repo, '.git', 'worktrees', 'fix-login', 'HEAD'), 'ref: refs/heads/fix/login\n')
  const wt = path.join(repo, '.worktrees', 'fix-login')
  fs.mkdirSync(path.join(wt, 'src'), { recursive: true })
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(repo, '.git', 'worktrees', 'fix-login')}\n`)
  fs.mkdirSync(path.join(repo, 'packages', 'app'), { recursive: true })

  assert.deepStrictEqual(readGitInfo(repo), { branch: 'main', root: repo, repoRoot: repo })
  assert.deepStrictEqual(readGitInfo(path.join(wt, 'src')), { branch: 'fix/login', root: wt, repoRoot: repo })
  assert.deepStrictEqual(readGitInfo(os.tmpdir() + '/cb-no-such-folder'), { branch: '', root: '', repoRoot: '' })

  const t = new SessionTracker({ readTranscript: () => ({}) })
  const name = (cwd) => t.handle({ session_id: cwd, cwd, kind: 'submit', prompt: 'x' }).session
  assert.strictEqual(name(repo).projectName, 'haulProject')
  assert.strictEqual(name(wt).projectName, 'haulProject › fix-login')
  assert.strictEqual(name(path.join(wt, 'src')).projectName, 'haulProject › fix-login')
  assert.strictEqual(name(path.join(repo, 'packages', 'app')).projectName, 'haulProject › app')
  // sessions of one repository share `repo`, so the panel can group them
  const sessions = t.listSessions()
  assert.deepStrictEqual([...new Set(sessions.map(s => s.repo))], [repo])
  assert.strictEqual(sessions.find(s => s.cwd === wt).part, 'fix-login')
  assert.strictEqual(sessions.find(s => s.cwd === wt).branch, 'fix/login')
  // the card carries the same name
  const { notification } = t.handle({ session_id: wt, cwd: wt, kind: 'stop' })
  assert.strictEqual(notification.projectName, 'haulProject › fix-login')
  fs.rmSync(path.dirname(repo), { recursive: true })
})

test('projectLabel: plain folders keep their name', () => {
  assert.deepStrictEqual(projectLabel('/work/my-app', { branch: '', root: '', repoRoot: '' }), { name: 'my-app', repoName: 'my-app', part: '' })
  assert.deepStrictEqual(projectLabel('/work/my-app', null), { name: 'my-app', repoName: 'my-app', part: '' })
  assert.strictEqual(projectLabel('', null).name, '알 수 없음')
  // a worktree folder named like its repository isn't repeated
  assert.strictEqual(projectLabel('/wt/app', { branch: 'x', root: '/wt/app', repoRoot: '/src/app' }).name, 'app')
  // a submodule (.git file pointing into .git/modules) is its own project
  assert.strictEqual(projectLabel('/src/app/vendor/lib', { branch: 'x', root: '/src/app/vendor/lib', repoRoot: '/src/app/vendor/lib' }).name, 'lib')
})

test('a snoozed card stays pending, stops asking, and comes back when due', () => {
  const t = tracker()
  const { notification: n } = t.handle({ ...base, kind: 'notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' })
  assert.strictEqual(t.nextSnoozeAt(), 0)
  assert.strictEqual(t.snooze(n.id, 600_000), true)
  assert.strictEqual(t.pending().length, 1, 'still counted by the badge')
  assert.strictEqual(t.pending()[0].snoozedUntil, 1_000_000 + 600_000)
  assert.strictEqual(t.nextSnoozeAt(), 1_000_000 + 600_000)
  // not yet
  t.advance(599_000)
  assert.deepStrictEqual(t.dueSnoozes(), [])
  // due: asks again, once
  t.advance(1_000)
  const due = t.dueSnoozes()
  assert.deepStrictEqual(due.map(d => d.id), [n.id])
  assert.strictEqual(due[0].snoozedUntil, undefined)
  assert.strictEqual(due[0].nudgedAt, 1_000_000 + 600_000)
  assert.deepStrictEqual(t.dueSnoozes(), [])
  assert.strictEqual(t.nextSnoozeAt(), 0)
})

test('snoozing only applies to cards that still wait for an answer', () => {
  const t = tracker()
  const done = t.handle({ ...base, kind: 'stop' }).notification
  assert.strictEqual(t.snooze(done.id, 600_000), false)
  assert.strictEqual(t.snooze('no-such-id', 600_000), false)
  const need = t.handle({ ...base, kind: 'notification', notification_type: 'permission_prompt', message: 'permission to use Bash' }).notification
  assert.strictEqual(t.snooze(need.id, 0), false)
  assert.strictEqual(t.snooze(need.id, 600_000), true)
  // answered in the terminal meanwhile: nothing comes back
  t.handle({ ...base, kind: 'submit', prompt: 'go on' })
  assert.strictEqual(t.nextSnoozeAt(), 0)
  t.advance(700_000)
  assert.deepStrictEqual(t.dueSnoozes(), [])
  assert.strictEqual(t.find(need.id).snoozedUntil, undefined)
  assert.strictEqual(t.snooze(need.id, 600_000), false, 'already resolved')
  // dismissed by hand: same
  const again = t.handle({ ...base, kind: 'notification', notification_type: 'permission_prompt', message: 'permission to use Bash' }).notification
  t.snooze(again.id, 600_000)
  t.markRead(again.id)
  assert.strictEqual(t.nextSnoozeAt(), 0)
})

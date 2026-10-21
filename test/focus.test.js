const test = require('node:test')
const assert = require('node:assert')
const { isFrontTerminal } = require('../lib/focus')
const { buildTerminal } = require('../lib/sessions')

const front = (bundleId, session = '', tty = '', tab = true) => ({ bundleId, session, tty, tab })

test('iTerm2 and Terminal.app match down to the tab', () => {
  const iterm = buildTerminal({ term_program: 'iTerm.app', term_session_id: 'w0t1p0:ABC-123', tty: '/dev/ttys004' })
  assert.ok(isFrontTerminal(iterm, front('com.googlecode.iterm2', 'ABC-123', '/dev/ttys004')))
  assert.ok(!isFrontTerminal(iterm, front('com.googlecode.iterm2', 'OTHER', '/dev/ttys004')))
  // no session id: fall back to the tab's tty
  const ittyOnly = buildTerminal({ term_program: 'iTerm.app', tty: '/dev/ttys004' })
  assert.ok(isFrontTerminal(ittyOnly, front('com.googlecode.iterm2', 'X', '/dev/ttys004')))
  assert.ok(!isFrontTerminal(ittyOnly, front('com.googlecode.iterm2', 'X', '/dev/ttys009')))

  const term = buildTerminal({ term_program: 'Apple_Terminal', tty: '/dev/ttys008' })
  assert.ok(isFrontTerminal(term, front('com.apple.Terminal', '', '/dev/ttys008')))
  assert.ok(!isFrontTerminal(term, front('com.apple.Terminal', '', '/dev/ttys002')))
})

test('before we may script the app, the whole app counts', () => {
  const term = buildTerminal({ term_program: 'Apple_Terminal', tty: '/dev/ttys008' })
  assert.ok(isFrontTerminal(term, front('com.apple.Terminal', '', '', false)))
  assert.ok(!isFrontTerminal(term, front('com.googlecode.iterm2', '', '', false)))
})

test('other apps match as a whole app, by bundle id', () => {
  const orca = buildTerminal({ bundle_id: 'com.stablyai.orca', orca_pane: 'a:b' })
  assert.ok(isFrontTerminal(orca, front('com.stablyai.orca')))
  assert.ok(!isFrontTerminal(orca, front('com.microsoft.VSCode')))
  // nothing to compare with → never matches
  assert.ok(!isFrontTerminal(buildTerminal({ term_program: 'ghostty' }), front('com.mitchellh.ghostty')))
  assert.ok(!isFrontTerminal(buildTerminal({ source: 'web', browser: 'Chrome' }), front('com.google.Chrome')))
  assert.ok(!isFrontTerminal(orca, null))
})

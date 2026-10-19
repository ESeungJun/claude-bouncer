const test = require('node:test')
const assert = require('node:assert')
const { parseVersion, isNewer, releasePage, checkForUpdate } = require('../lib/update')

test('versions are compared number by number', () => {
  assert.deepStrictEqual(parseVersion('v0.3.10'), [0, 3, 10])
  assert.strictEqual(parseVersion('0.4.0-beta.1'), null)
  assert.strictEqual(isNewer('0.3.10', '0.3.9'), true)
  assert.strictEqual(isNewer('v1.0.0', '0.9.9'), true)
  assert.strictEqual(isNewer('0.3.1', '0.3.1'), false)
  assert.strictEqual(isNewer('0.3.0', '0.3.1'), false)
  assert.strictEqual(isNewer('garbage', '0.3.1'), false)
})

test('the download link is always on the repo releases page', () => {
  assert.strictEqual(releasePage('0.3.2'), 'https://github.com/ESeungJun/claude-bouncer/releases/tag/v0.3.2')
  assert.strictEqual(releasePage('https://evil.example'), 'https://github.com/ESeungJun/claude-bouncer/releases/latest')
})

const reply = (status, body) => async () => ({ ok: status === 200, status, json: async () => body })

test('checkForUpdate reads the latest release tag', async () => {
  assert.deepStrictEqual(await checkForUpdate('0.3.1', { fetchImpl: reply(200, { tag_name: 'v0.3.2' }) }), { latest: '0.3.2', newer: true })
  assert.deepStrictEqual(await checkForUpdate('0.3.2', { fetchImpl: reply(200, { tag_name: 'v0.3.2' }) }), { latest: '0.3.2', newer: false })
  await assert.rejects(checkForUpdate('0.3.1', { fetchImpl: reply(404, {}) }))
  await assert.rejects(checkForUpdate('0.3.1', { fetchImpl: reply(200, { tag_name: '<script>' }) }))
})

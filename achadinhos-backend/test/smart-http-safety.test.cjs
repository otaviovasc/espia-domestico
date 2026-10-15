const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test'
process.env.JWT_SECRET ||= 'smart-http-test-secret-at-least-thirty-two-characters'
process.env.AI_ENABLED = 'false'
const { SmartCampaignIntelligence } = require('../dist/services/SmartCampaignIntelligence.js')
let paidCalls = 0
for (const method of ['keywordPacks', 'analyze', 'standoutCopy']) {
  SmartCampaignIntelligence.prototype[method] = async () => {
    paidCalls++
    throw new Error('Read-only HTTP paths must never invoke intelligence')
  }
}
const { createApp } = require('../dist/app.js')
const { generateToken } = require('../dist/middleware/auth.js')
let server, baseUrl
const token = generateToken({ id: 123, uuid: '00000000-0000-4000-8000-000000000123', role: 'admin' })
before(async () => {
  server = createApp().listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`
})
after(async () => { await new Promise((resolve) => server.close(resolve)) })
test('AI status is authenticated, read-only, and never invokes a provider', async () => {
  assert.equal((await fetch(`${baseUrl}/smart-campaigns/ai-status`)).status, 401)
  for (let i = 0; i < 3; i++) {
    const response = await fetch(`${baseUrl}/smart-campaigns/ai-status`, { headers: { authorization: `Bearer ${token}` } })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.data.enabled, false)
    assert.equal(body.data.limits.batchSize, 4)
    assert.ok(body.data.limits.dailyCostUsd > 0)
  }
  assert.equal(paidCalls, 0)
})
test('large import routes authenticate before attempting to parse JSON', async () => {
  for (const path of ['/campaigns/import-offers', '/smart-campaigns/plans']) {
    const response = await fetch(baseUrl + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{invalid JSON',
    })
    assert.equal(response.status, 401, 'unauthenticated JSON must not reach the parser')
  }
  assert.equal(paidCalls, 0)
})

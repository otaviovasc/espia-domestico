const { test } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-thirty-two-characters'

const { connectionScopeForCredentials } = require('../dist/services/ConnectionService.js')

test('connection scope separates identical instance IDs on different UAZAPI servers', () => {
  const base = { instanceId: 'same-id', instanceToken: 'same-token' }
  const first = connectionScopeForCredentials({ ...base, baseUrl: 'https://one.example/api/' })
  const normalizedFirst = connectionScopeForCredentials({
    ...base,
    baseUrl: 'https://one.example/api',
  })
  const second = connectionScopeForCredentials({ ...base, baseUrl: 'https://two.example/api' })
  assert.equal(first, normalizedFirst)
  assert.notEqual(first, second)
  assert.match(first, /^server:[a-f0-9]{32}:instance:same-id$/)
})

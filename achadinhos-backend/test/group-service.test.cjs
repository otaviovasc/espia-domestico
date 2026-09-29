const { test } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-thirty-two-characters'

const { GroupService } = require('../dist/services/GroupService.js')

test('group validation paginates past 500 and fails closed on a repeated page', async () => {
  const all = Array.from({ length: 501 }, (_, index) => ({
    JID: `${index}@g.us`,
    Name: `Grupo ${index}`,
  }))
  const offsets = []
  const client = {
    async listGroups(_creds, { limit, offset }) {
      offsets.push(offset)
      return all.slice(offset, offset + limit)
    },
  }
  const connection = {
    async requireConnectedCreds() {
      return { baseUrl: 'https://uaz.invalid', token: 'test' }
    },
  }
  const service = new GroupService(client, connection)
  const groups = await service.listForUser(1)
  assert.equal(groups.length, 501)
  assert.deepEqual(offsets, [0, 500, 501])

  const repeated = new GroupService(
    { async listGroups() { return all.slice(0, 500) } },
    connection,
  )
  await assert.rejects(repeated.listForUser(1), /validar toda a lista/)
})

const { test } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-thirty-two-characters'

const { GroupMessage } = require('../dist/database/models/GroupMessage.js')
const { GroupMessageService } = require('../dist/services/GroupMessageService.js')

/** Replace the model's DB methods with in-memory stubs; restore after. */
function withStubbedModel(run) {
  const created = []
  const seen = new Set()
  const origFindOrCreate = GroupMessage.findOrCreate
  const origCreate = GroupMessage.create
  GroupMessage.findOrCreate = async ({ where, defaults }) => {
    const key = `${where.connectionScope}|${where.messageId}`
    if (seen.has(key)) return [defaults, false]
    seen.add(key)
    created.push(defaults)
    return [defaults, true]
  }
  GroupMessage.create = async (row) => {
    created.push(row)
    return row
  }
  return Promise.resolve(run(created)).finally(() => {
    GroupMessage.findOrCreate = origFindOrCreate
    GroupMessage.create = origCreate
  })
}

const service = new GroupMessageService(/* uazapi */ {}, /* connection */ {})

test('ingests a group message and skips a direct chat', async () => {
  await withStubbedModel(async (created) => {
    const body = {
      event: 'messages',
      messages: [
        {
          chatid: '120363000000000000@g.us',
          messageid: 'ABC123',
          fromMe: false,
          pushName: 'Fulano',
          participant: '5511999999999@s.whatsapp.net',
          text: 'Olá grupo',
          messageTimestamp: 1_700_000_000,
          chatName: 'Grupo Teste',
        },
        {
          // Direct message — must be ignored (not @g.us).
          chatid: '5511888888888@s.whatsapp.net',
          messageid: 'DM1',
          text: 'oi direto',
        },
      ],
    }
    const stored = await service.ingestWebhook('scope:test', body)
    assert.equal(stored, 1)
    assert.equal(created.length, 1)
    assert.equal(created[0].groupId, '120363000000000000@g.us')
    assert.equal(created[0].direction, 'in')
    assert.equal(created[0].senderName, 'Fulano')
    assert.equal(created[0].text, 'Olá grupo')
    assert.equal(created[0].groupName, 'Grupo Teste')
    // Seconds timestamp converted to ms.
    assert.equal(created[0].timestamp.getTime(), 1_700_000_000 * 1000)
  })
})

test('dedups the same provider message id within a scope', async () => {
  await withStubbedModel(async (created) => {
    const msg = {
      chatid: '120363000000000000@g.us',
      messageid: 'DUP',
      text: 'repetida',
      messageTimestamp: 1_700_000_100,
    }
    const first = await service.ingestWebhook('scope:test', { message: msg })
    const second = await service.ingestWebhook('scope:test', { message: msg })
    assert.equal(first, 1)
    assert.equal(second, 0)
    assert.equal(created.length, 1)
  })
})

test('reads text nested under message.conversation', async () => {
  await withStubbedModel(async (created) => {
    const body = {
      message: {
        key: { remoteJid: '120363111111111111@g.us', fromMe: false, id: 'NEST1' },
        message: { conversation: 'texto aninhado' },
        messageTimestamp: 1_700_000_200,
      },
    }
    const stored = await service.ingestWebhook('scope:test', body)
    assert.equal(stored, 1)
    assert.equal(created[0].text, 'texto aninhado')
    assert.equal(created[0].groupId, '120363111111111111@g.us')
  })
})

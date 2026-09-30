const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
require('express-async-errors')
require('reflect-metadata')

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test'
process.env.JWT_SECRET ||= 'test-secret-with-at-least-thirty-two-characters'

const { generateToken } = require('../dist/middleware/auth.js')
const { errorHandler } = require('../dist/middleware/Error/errorHandler.js')
const { adProjectRoutes } = require('../dist/routes/adProjectRoutes.js')

let server
let baseUrl
const token = generateToken({
  id: 123,
  uuid: '00000000-0000-4000-8000-000000000123',
  role: 'admin',
})

const body = {
  texts: ['SECOND', 'FIRST\nLINE'],
  output: { width: 360, height: 640 },
  textStyle: {
    fontSize: 72,
    fontColor: '#FFFFFF',
    borderWidth: 6,
    borderColor: '#000000',
    positionY: 52,
  },
}

before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/ad-projects', adProjectRoutes)
  app.use(errorHandler)
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve)
  })
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

test('caption preview route requires authentication', async () => {
  const response = await fetch(`${baseUrl}/api/v1/ad-projects/preview/captions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  assert.equal(response.status, 401)
})

test('caption preview route preserves input order and is not handled as a project id', async () => {
  const response = await fetch(`${baseUrl}/api/v1/ad-projects/preview/captions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.success, true)
  assert.deepEqual(payload.data.captions.map((caption) => caption.text), body.texts)
  for (const caption of payload.data.captions) {
    assert.ok(caption.svg.includes('<path'))
    assert.ok(!caption.svg.includes('<text'))
  }
})

test('caption preview route rejects more than 30 texts', async () => {
  const response = await fetch(`${baseUrl}/api/v1/ad-projects/preview/captions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ...body, texts: Array.from({ length: 31 }, (_, index) => `TEXT ${index}`) }),
  })
  assert.equal(response.status, 400)
})

test('SFX preview route authenticates, validates presets, and returns renderer audio', async () => {
  const url = `${baseUrl}/api/v1/ad-projects/preview/sfx/whoosh`
  assert.equal((await fetch(url)).status, 401)
  const headers = { authorization: `Bearer ${token}` }
  assert.equal((await fetch(`${baseUrl}/api/v1/ad-projects/preview/sfx/unknown`, { headers })).status, 400)
  const response = await fetch(url, { headers })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /audio\/wav/)
  const wav = Buffer.from(await response.arrayBuffer())
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF')
  assert.ok(wav.length > 1000)
})

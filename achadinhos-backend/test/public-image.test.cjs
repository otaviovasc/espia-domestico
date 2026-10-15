const { test } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-thirty-two-characters'
const { resolveUsablePublicImage } = require('../dist/utils/publicImage.js')
const target = [{ address: '8.8.8.8', family: 4 }]
test('image checks reject private targets without making a HEAD request', async () => {
  let requests = 0
  assert.equal(await resolveUsablePublicImage('https://127.0.0.1/admin', {
    resolve: async () => { throw new Error('private network') },
    head: async () => { requests++; return { status: 200, contentType: 'image/png' } },
  }), null)
  assert.equal(requests, 0)
})
test('public image redirect is revalidated and cannot fetch an internal destination', async () => {
  const requested = []
  const resolved = []
  const value = await resolveUsablePublicImage('https://public.example/image', {
    resolve: async url => { resolved.push(url.hostname); if (url.hostname === '127.0.0.1') throw new Error('private'); return target },
    head: async (url, address) => { requested.push([url.hostname, address.address]); return { status: 302, location: 'https://127.0.0.1/internal' } },
  })
  assert.equal(value, null)
  assert.deepEqual(resolved, ['public.example', '127.0.0.1'])
  assert.deepEqual(requested, [['public.example', '8.8.8.8']])
})
test('image checks accept pinned HTTPS images and reject credentials, ports and non-images', async () => {
  const dependencies = { resolve: async () => target, head: async () => ({ status: 200, contentType: 'image/jpeg' }) }
  assert.equal(await resolveUsablePublicImage('https://public.example/a.jpg', dependencies), 'https://public.example/a.jpg')
  for (const url of ['http://public.example/a.jpg', 'https://user:pass@public.example/a.jpg', 'https://public.example:8443/a.jpg']) {
    assert.equal(await resolveUsablePublicImage(url, dependencies), null)
  }
  assert.equal(await resolveUsablePublicImage('https://public.example/page', { ...dependencies, head: async () => ({ status: 200, contentType: 'text/html' }) }), null)
})

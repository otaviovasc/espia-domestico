const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
require('reflect-metadata')

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test'
process.env.JWT_SECRET ||= 'test-secret-with-at-least-thirty-two-characters'
process.env.AD_MAX_MUSIC_MB = '1'

const {
  cleanupImportedMusic,
  downloadDirectMusic,
  isPublicNetworkAddress,
  normalizeDirectAudioUrl,
  resolvePublicTarget,
} = require('../dist/services/AdMusicImport.js')

function response(statusCode, headers, chunks = []) {
  const body = Readable.from(chunks)
  return {
    statusCode,
    headers,
    body,
    discard() {
      body.resume()
    },
  }
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.fail('timed out waiting for the expected import state')
}

function controlledAudioDependencies() {
  const releases = []
  let active = 0
  let maximumActive = 0
  return {
    releases,
    maximumActive: () => maximumActive,
    dependencies: {
      async resolveHost() {
        return [{ address: '1.1.1.1', family: 4 }]
      },
      async request() {
        const body = {
          async *[Symbol.asyncIterator]() {
            active += 1
            maximumActive = Math.max(maximumActive, active)
            await new Promise((resolve) => releases.push(resolve))
            active -= 1
            yield Buffer.from('ID3test')
          },
        }
        return {
          statusCode: 200,
          headers: { 'content-type': 'audio/mpeg', 'content-length': '7' },
          body,
          discard() {},
        }
      },
    },
  }
}

test('direct audio URLs require HTTPS without embedded credentials or private hostnames', () => {
  assert.equal(
    normalizeDirectAudioUrl('https://cdn.example.com/music/song.mp3#preview').toString(),
    'https://cdn.example.com/music/song.mp3',
  )
  assert.throws(() => normalizeDirectAudioUrl('http://cdn.example.com/song.mp3'), /HTTPS/)
  assert.throws(() => normalizeDirectAudioUrl('https://user:pass@cdn.example.com/song.mp3'), /credenciais/)
  assert.throws(() => normalizeDirectAudioUrl('https://cdn.example.com:8443/song.mp3'), /porta/)
  assert.throws(() => normalizeDirectAudioUrl('https://service.internal/song.mp3'), /público/)
  assert.throws(() => normalizeDirectAudioUrl('https://www.youtube.com/watch?v=abc'), /não são arquivos/)
  assert.throws(() => normalizeDirectAudioUrl('https://youtu.be/abc'), /não são arquivos/)
  assert.throws(() => normalizeDirectAudioUrl('https://open.spotify.com/track/abc'), /não são arquivos/)
})

test('network address validation rejects local, private, reserved and transition ranges', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.8',
    '100.64.0.1',
    '169.254.169.254',
    '172.31.0.1',
    '192.168.1.2',
    '198.51.100.10',
    '::1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
    '2002:7f00:1::',
  ]) {
    assert.equal(isPublicNetworkAddress(address), false, address)
  }
  assert.equal(isPublicNetworkAddress('1.1.1.1'), true)
  assert.equal(isPublicNetworkAddress('2606:4700:4700::1111'), true)
})

test('DNS validation rejects a hostname when any resolved address is private', async () => {
  const url = normalizeDirectAudioUrl('https://cdn.example.com/song.mp3')
  await assert.rejects(
    resolvePublicTarget(url, async () => [
      { address: '1.1.1.1', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]),
    /somente para endereços públicos/,
  )
  await assert.rejects(resolvePublicTarget(normalizeDirectAudioUrl('https://127.0.0.1/song.mp3')), /públicos/)
})

test('direct import revalidates redirects and keeps a human filename', async () => {
  const requested = []
  const dependencies = {
    async resolveHost(hostname) {
      return [{ address: hostname === 'private.example' ? '10.0.0.8' : '1.1.1.1', family: 4 }]
    },
    async request(url) {
      requested.push(url.toString())
      if (url.hostname === 'cdn.example.com') {
        return response(302, { location: 'https://files.example.com/final' })
      }
      return response(
        200,
        {
          'content-type': 'audio/mpeg; charset=binary',
          'content-length': '7',
          'content-disposition': `attachment; filename*=UTF-8''Minha%20M%C3%BAsica.mp3`,
        },
        [Buffer.from('ID3test')],
      )
    },
  }
  const imported = await downloadDirectMusic('https://cdn.example.com/start', 101, dependencies)
  try {
    assert.deepEqual(requested, [
      'https://cdn.example.com/start',
      'https://files.example.com/final',
    ])
    assert.equal(imported.originalname, 'Minha Música.mp3')
    assert.equal(imported.mimetype, 'audio/mpeg')
    assert.equal(imported.size, 7)
  } finally {
    await cleanupImportedMusic(imported)
  }

  await assert.rejects(
    downloadDirectMusic('https://cdn.example.com/start', 102, {
      ...dependencies,
      async request() {
        return response(302, { location: 'https://private.example/song.mp3' })
      },
    }),
    /somente para endereços públicos/,
  )
})

test('direct import rejects non-audio MIME types and bodies over the byte limit', async () => {
  const resolveHost = async () => [{ address: '1.1.1.1', family: 4 }]
  await assert.rejects(
    downloadDirectMusic('https://cdn.example.com/page', 201, {
      resolveHost,
      async request() {
        return response(200, { 'content-type': 'text/html' }, [Buffer.from('<html>')])
      },
    }),
    /diretamente para um arquivo de áudio/,
  )
  await assert.rejects(
    downloadDirectMusic('https://cdn.example.com/large.mp3', 202, {
      resolveHost,
      async request() {
        return response(200, {
          'content-type': 'audio/mpeg',
          'content-length': String(1024 * 1024 + 1),
        })
      },
    }),
    /excede o limite/,
  )
})

test('direct imports enforce per-user and process concurrency limits', async () => {
  const sameUser = controlledAudioDependencies()
  const sameUserImports = [1, 2, 3].map(() =>
    downloadDirectMusic('https://cdn.example.com/song.mp3', 301, sameUser.dependencies),
  )
  await waitFor(() => sameUser.releases.length === 2)
  assert.equal(sameUser.maximumActive(), 2)
  sameUser.releases.splice(0, 2).forEach((release) => release())
  await waitFor(() => sameUser.releases.length === 1)
  sameUser.releases.shift()()
  const sameUserFiles = await Promise.all(sameUserImports)
  await Promise.all(sameUserFiles.map(cleanupImportedMusic))
  assert.equal(sameUser.maximumActive(), 2)

  const global = controlledAudioDependencies()
  const globalImports = [401, 402, 403, 404, 405].map((userId) =>
    downloadDirectMusic('https://cdn.example.com/song.mp3', userId, global.dependencies),
  )
  await waitFor(() => global.releases.length === 4)
  assert.equal(global.maximumActive(), 4)
  global.releases.splice(0, 4).forEach((release) => release())
  await waitFor(() => global.releases.length === 1)
  global.releases.shift()()
  const globalFiles = await Promise.all(globalImports)
  await Promise.all(globalFiles.map(cleanupImportedMusic))
  assert.equal(global.maximumActive(), 4)
})

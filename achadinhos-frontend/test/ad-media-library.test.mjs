import test from 'node:test'
import assert from 'node:assert/strict'
import { createLibraryRequestStore, mediaLibraryConfigFingerprint, filterMediaLibrary, hasPossibleMediaCopy, preflightMediaLibrary, appendLibraryAssets, attachMediaLibrarySelection } from '../src/lib/adMediaLibrary.ts'

const media = (kind = 'image', name = 'Produto.jpg') => ({ kind, name, tags: ['Verão', 'oferta'], productIds: [42],
  fingerprint: 'fingerprint', mimeType: kind === 'image' ? 'image/jpeg' : kind === 'music' ? 'audio/mpeg' : 'video/mp4',
  sizeBytes: 500, durationSeconds: kind === 'image' ? 0 : 12, width: kind === 'music' ? null : 1080, height: kind === 'music' ? null : 1920 })
const record = (id, kind = 'image', name) => ({ id, payload: media(kind, name) })
const asset = (id, kind = 'image') => ({ id, ...media(kind), originalName: 'Produto.jpg' })
const config = (kind = 'video') => ({ kind, selectedClipIds: [], carousel: { slides: [], caption: 'Preserve me' },
  clipEdits: { 91: { trimStart: 2 } }, musicTracks: [], musicAssetId: null, musicVolume: 0.4, productIds: [42] })

test('library search combines name, tags and product tokens without changing order or source records', () => {
  const records = [record(1), record(2, 'music', 'Jingle'), record(3, 'clip', 'Demo')]
  assert.deepEqual(filterMediaLibrary(records, '  PRODUTO verão 42 ', 'image').map((r) => r.id), [1])
  assert.deepEqual(filterMediaLibrary(records, '', 'clip').map((r) => r.id), [3])
  assert.deepEqual(filterMediaLibrary(records, 'oferta').map((r) => r.id), [1, 2, 3])
  assert.deepEqual(records.map((r) => r.id), [1, 2, 3])
})

test('possible-copy hint requires matching media metadata; matching names alone never suppress another kind or size', () => {
  assert.equal(hasPossibleMediaCopy(media(), [asset(9)]), true)
  assert.equal(hasPossibleMediaCopy(media(), [asset(9, 'clip')]), false)
  assert.equal(hasPossibleMediaCopy(media(), [{ ...asset(9), sizeBytes: 501 }]), false)
  assert.equal(hasPossibleMediaCopy(media(), [{ ...asset(9), width: 720 }]), false)
})

test('entire selection is checked against slide, clip and music limits before any attachment', async () => {
  assert.throws(() => preflightMediaLibrary({ ...config('carousel'), carousel: { slides: Array(19).fill({}), caption: '' } }, [media(), media()]), /20 slides/)
  assert.throws(() => preflightMediaLibrary({ ...config(), selectedClipIds: Array(50).fill(1) }, [media()]), /50 mídias/)
  assert.throws(() => preflightMediaLibrary({ ...config(), musicTracks: Array(8).fill({}) }, [media('music')]), /8 faixas/)
  let calls = 0
  await assert.rejects(attachMediaLibrarySelection({ project: { revision: 1 }, config: { ...config(), selectedClipIds: Array(50).fill(1) }, records: [record(1)],
    attach: async () => { calls++; return asset(1) }, save: async () => { throw new Error('not reached') }, remove: async () => {}, onSaved: () => {} }), /50 mídias/)
  assert.equal(calls, 0)
})

test('mixed-media append retains caption, source edits, and existing legacy music', () => {
  const initial = { ...config('carousel'), musicAssetId: 5 }
  const next = appendLibraryAssets(initial, [asset(20, 'clip'), asset(21), asset(22, 'music')])
  assert.deepEqual(next.selectedClipIds, [20, 21])
  assert.deepEqual(next.carousel.slides.map((slide) => slide.assetId), [20, 21])
  assert.equal(next.carousel.caption, 'Preserve me')
  assert.deepEqual(next.musicTracks.map((track) => track.assetId), [5, 22])
  assert.equal(next.musicTracks[0].volume, 0.4)
  assert.deepEqual(next.clipEdits, initial.clipEdits)
  assert.deepEqual(initial.selectedClipIds, [])
})

test('bulk attach accumulates each saved config and revision, deduplicates selected records, and preserves chosen order', async () => {
  const events = []; const revisions = []; const configs = []
  const result = await attachMediaLibrarySelection({ project: { id: 4, revision: 7 }, config: config('carousel'), records: [record(2, 'clip'), record(1), record(2, 'clip')],
    attach: async (id) => { events.push(`attach ${id}`); return asset(id + 100, id === 2 ? 'clip' : 'image') },
    save: async (next, revision) => { revisions.push(revision); configs.push(next); return { id: 4, revision: revision + 1, config: next } },
    remove: async () => assert.fail('must not remove success'),
    onSaved: (id) => events.push(`saved ${id}`),
  })
  assert.deepEqual(events, ['attach 2', 'saved 2', 'attach 1', 'saved 1'])
  assert.deepEqual(revisions, [7, 8])
  assert.deepEqual(configs[1].selectedClipIds, [102, 101])
  assert.deepEqual(result.completedIds, [2, 1])
  assert.equal(result.project.revision, 9)
})

test('partial save failure cleans only the unsaved asset and stops before later records; successful media remain selected', async () => {
  const removed = []; const attached = []; const published = []
  const result = await attachMediaLibrarySelection({ project: { revision: 1 }, config: config(), records: [record(1), record(2), record(3)],
    attach: async (id) => { attached.push(id); return asset(id + 100) },
    save: async (next, revision) => { if (revision === 2) throw new Error('conflict'); return { revision: revision + 1, config: next } },
    remove: async (id) => removed.push(id), recoverPersisted: async () => null,
    onSaved: (id) => published.push(id),
  })
  assert.deepEqual(removed, [102])
  assert.deepEqual(attached, [1, 2])
  assert.deepEqual(published, [1])
  assert.deepEqual(result.project.config.selectedClipIds, [101])
  assert.deepEqual(result.completedIds, [1])
  assert.match(result.error.message, /conflict/)
  const retry = await attachMediaLibrarySelection({ project: result.project, config: result.project.config, records: [record(2), record(3)],
    attach: async (id) => asset(id + 200), save: async (next, revision) => ({ revision: revision + 1, config: next }),
    remove: async () => assert.fail('retry successes cannot be removed'), onSaved: () => {},
  })
  assert.deepEqual(retry.project.config.selectedClipIds, [101, 202, 203])
  assert.deepEqual(retry.completedIds, [2, 3])
  assert.equal(retry.project.revision, 4)
})

test('lost save response recovers confirmed server state without removing referenced media', async () => {
  const saved = { revision: 2, config: appendLibraryAssets(config(), [asset(101)]) }
  const result = await attachMediaLibrarySelection({ project: { revision: 1 }, config: config(), records: [record(1)],
    attach: async () => asset(101), save: async () => { throw new Error('response lost') },
    recoverPersisted: async () => saved, remove: async () => assert.fail('persisted media cannot be removed'), onSaved: () => {},
  })
  assert.deepEqual(result.completedIds, [1])
  assert.equal(result.error, undefined)
})

test('a failed state notification does not remove an asset already saved in the server project', async () => {
  const result = await attachMediaLibrarySelection({ project: { revision: 1 }, config: config(), records: [record(1), record(2)],
    attach: async () => asset(101), save: async (next) => ({ revision: 2, config: next }),
    remove: async () => assert.fail('confirmed media cannot be removed'), onSaved: () => { throw new Error('refresh failed') },
  })
  assert.deepEqual(result.completedIds, [1])
  assert.match(result.error.message, /refresh failed/)
})

test('uncertain recovery stops the batch without deleting media that may have been committed', async () => {
  const result = await attachMediaLibrarySelection({ project: { revision: 1 }, config: config(), records: [record(1), record(2)],
    attach: async () => asset(101), save: async () => { throw new Error('response lost') },
    recoverPersisted: async () => { throw new Error('server unreachable') },
    remove: async () => assert.fail('cannot delete until persisted state is known'), onSaved: () => {},
  })
  assert.deepEqual(result.completedIds, [])
  assert.match(result.cleanupError.message, /server unreachable/)
})

function sessionStorageFixture() {
  const values = new Map()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
}
const requestUuid = '231128d7-9f32-4b5f-8752-29281388c32e'

test('accepted attach with lost response reuses its persisted request key after remount and creates one asset', async () => {
  const storage = sessionStorageFixture(); const receipts = new Map(); const received = []
  let server = { id: 4, revision: 1, config: config(), assets: [] }; let lost = true; let creations = 0
  const attach = async (_recordId, key) => {
    received.push(key)
    if (!receipts.has(key)) { const created = asset(101); receipts.set(key, created); server.assets.push(created); creations++ }
    if (lost) { lost = false; throw new Error('POST response lost') }
    return receipts.get(key)
  }
  const common = { project: server, config: config(), records: [record(1)], attach, loadProject: async () => server,
    save: async (next, revision) => { assert.equal(revision, server.revision); server = { ...server, config: next, revision: revision + 1 }; return server },
    remove: async () => assert.fail('successful attached media cannot be deleted'), onSaved: () => {},
  }
  const first = await attachMediaLibrarySelection({ ...common, requestKeys: createLibraryRequestStore(storage, 4, () => requestUuid) })
  assert.match(first.error.message, /POST response lost/)
  const afterRemount = createLibraryRequestStore(storage, 4, () => assert.fail('retry must reuse stored key'))
  const second = await attachMediaLibrarySelection({ ...common, requestKeys: afterRemount })
  assert.deepEqual(received, [requestUuid, requestUuid])
  assert.equal(creations, 1)
  assert.deepEqual(second.project.config.selectedClipIds, [101])
  assert.deepEqual(second.completedIds, [1])
  assert.equal(afterRemount.peek(1), null)
})

test('stale props after failed UI callback recover the selected asset without another attach or duplicate append', async () => {
  const storage = sessionStorageFixture(); const original = { id: 4, revision: 1, config: config(), assets: [] }
  let server = original; let creations = 0; let saves = 0
  const requestKeys = createLibraryRequestStore(storage, 4, () => requestUuid)
  const common = { project: original, config: original.config, records: [record(1)], requestKeys, loadProject: async () => server,
    attach: async () => { creations++; return asset(101) },
    save: async (next, revision) => { saves++; server = { ...server, config: next, revision: revision + 1, assets: [asset(101)] }; return server },
    remove: async () => assert.fail('confirmed media cannot be removed'),
  }
  const first = await attachMediaLibrarySelection({ ...common, onSaved: () => { throw new Error('stale UI refresh') } })
  assert.match(first.error.message, /stale UI refresh/)
  assert.equal(requestKeys.peek(1).assetId, 101)
  let published
  const retry = await attachMediaLibrarySelection({ ...common,
    requestKeys: createLibraryRequestStore(storage, 4, () => assert.fail('existing operation key must survive')),
    onSaved: (_recordId, saved) => { published = saved },
  })
  assert.equal(creations, 1)
  assert.equal(saves, 1)
  assert.deepEqual(published.config.selectedClipIds, [101])
  assert.equal(retry.project.revision, 2)
})

test('durable session key failure stops before an attach mutation', async () => {
  let attached = false
  const storage = { getItem: () => null, setItem: () => { throw new Error('session storage unavailable') }, removeItem: () => {} }
  const result = await attachMediaLibrarySelection({ project: { id: 4, revision: 1 }, config: config(), records: [record(1)],
    requestKeys: createLibraryRequestStore(storage, 4, () => requestUuid),
    attach: async () => { attached = true; return asset(101) }, save: async () => assert.fail('not reached'), remove: async () => {}, onSaved: () => {},
  })
  assert.equal(attached, false)
  assert.match(result.error.message, /session storage unavailable/)
})

test('a committed cleanup with lost DELETE response reconciles absent asset and starts a fresh keyed retry', async () => {
  const storage = sessionStorageFixture(); const firstKeys = createLibraryRequestStore(storage, 4, () => requestUuid)
  let server = { id: 4, revision: 1, config: config(), assets: [] }
  const first = await attachMediaLibrarySelection({ project: server, config: server.config, records: [record(1)], requestKeys: firstKeys,
    attach: async () => { const created = asset(101); server.assets.push(created); return created },
    loadProject: async () => server, save: async () => { throw new Error('save rejected') }, recoverPersisted: async () => null,
    remove: async () => { server = { ...server, assets: [] }; throw new Error('DELETE response lost') }, onSaved: () => {},
  })
  assert.match(first.cleanupError.message, /DELETE response lost/)
  assert.equal(firstKeys.peek(1).assetId, 101)
  const freshUuid = '44693121-9543-40d2-a6dd-22b3e2bf3562'
  let receivedKey
  const second = await attachMediaLibrarySelection({ project: server, config: server.config, records: [record(1)],
    requestKeys: createLibraryRequestStore(storage, 4, () => freshUuid), loadProject: async () => server,
    attach: async (_recordId, key) => { receivedKey = key; const created = asset(102); server.assets.push(created); return created },
    save: async (next, revision) => { server = { ...server, config: next, revision: revision + 1 }; return server },
    remove: async () => assert.fail('successful retry must not clean up'), onSaved: () => {},
  })
  assert.equal(receivedKey, freshUuid)
  assert.deepEqual(second.project.config.selectedClipIds, [102])
})

test('recovery does not overwrite a dirty draft edited after a previous uncertain save', async () => {
  const storage = sessionStorageFixture(); const requestKeys = createLibraryRequestStore(storage, 4, () => requestUuid)
  requestKeys.get(1); requestKeys.recordAsset(1, 101)
  const acknowledged = { id: 4, revision: 1, config: config(), assets: [] }
  requestKeys.recordBaseConfig(1, await mediaLibraryConfigFingerprint(acknowledged.config))
  const dirty = { ...acknowledged.config, carousel: { slides: [], caption: 'New draft copy after the failed request' } }
  const server = { ...acknowledged, revision: 2, assets: [asset(101)], config: appendLibraryAssets(acknowledged.config, [asset(101)]) }
  const result = await attachMediaLibrarySelection({ project: acknowledged, config: dirty, records: [record(1)], requestKeys,
    loadProject: async () => server, attach: async () => assert.fail('dirty recovery cannot mutate'), save: async () => assert.fail('dirty draft cannot be overwritten'),
    remove: async () => assert.fail('confirmed media cannot be removed'), onSaved: () => assert.fail('dirty draft cannot be replaced'),
  })
  assert.match(result.error.message, /alterações locais/)
  assert.equal(dirty.carousel.caption, 'New draft copy after the failed request')
  assert.equal(requestKeys.peek(1).assetId, 101)
})

test('unchanged preexisting dirty draft recovers a committed save using the captured source fingerprint', async () => {
  const storage = sessionStorageFixture(); const requestKeys = createLibraryRequestStore(storage, 4, () => requestUuid)
  const acknowledged = { id: 4, revision: 1, config: config(), assets: [] }
  const originalDraft = { ...acknowledged.config, texts: ['Original verified offer'] }
  let server = acknowledged
  const first = await attachMediaLibrarySelection({ project: acknowledged, config: originalDraft, records: [record(1)], requestKeys,
    loadProject: async () => server, attach: async () => { server = { ...server, assets: [asset(101)] }; return asset(101) },
    save: async (next) => { server = { ...server, revision: 2, config: next }; throw new Error('save response lost') },
    recoverPersisted: async () => { throw new Error('recovery GET also lost') }, remove: async () => assert.fail('unknown committed asset cannot be removed'), onSaved: () => {},
  })
  assert.match(first.cleanupError.message, /recovery GET also lost/)
  assert.equal(requestKeys.peek(1).baseConfigFingerprint, await mediaLibraryConfigFingerprint(originalDraft))
  let published
  const second = await attachMediaLibrarySelection({ project: acknowledged, config: originalDraft, records: [record(1)],
    requestKeys: createLibraryRequestStore(storage, 4, () => assert.fail('existing request must survive remount')), loadProject: async () => server,
    attach: async () => assert.fail('committed selected asset cannot be attached twice'), save: async () => assert.fail('committed save cannot repeat'),
    remove: async () => assert.fail('confirmed asset cannot be removed'), onSaved: (_id, saved) => { published = saved },
  })
  assert.equal(second.error, undefined)
  assert.deepEqual(published.config.texts, ['Original verified offer'])
  assert.deepEqual(published.config.selectedClipIds, [101])
})

test('undoing a pending offer back to the acknowledged draft is preserved during recovery', async () => {
  const storage = sessionStorageFixture(); const requestKeys = createLibraryRequestStore(storage, 4, () => requestUuid)
  const acknowledged = { id: 4, revision: 1, config: { ...config(), texts: ['Original verified copy'] }, assets: [] }
  const submittedDraft = { ...acknowledged.config, texts: ['Offer submitted before the failure'] }
  requestKeys.get(1); requestKeys.recordBaseConfig(1, await mediaLibraryConfigFingerprint(submittedDraft)); requestKeys.recordAsset(1, 101)
  const server = { ...acknowledged, revision: 2, assets: [asset(101)], config: appendLibraryAssets(submittedDraft, [asset(101)]) }
  const result = await attachMediaLibrarySelection({ project: acknowledged, config: acknowledged.config, records: [record(1)], requestKeys,
    loadProject: async () => server, attach: async () => assert.fail('undone draft cannot mutate'), save: async () => assert.fail('undone draft cannot be overwritten'),
    remove: async () => assert.fail('confirmed media cannot be removed'), onSaved: () => assert.fail('undo cannot be discarded'),
  })
  assert.match(result.error.message, /alterações locais/)
  assert.deepEqual(acknowledged.config.texts, ['Original verified copy'])
})

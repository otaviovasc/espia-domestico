import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyImportSession, createImportSession, importResult, importSummary, saveInChunks } from '../src/lib/importWorkflow.ts'
import { applyFileRead, importInputError, MAX_IMPORT_BYTES, prepareImportPayloads, readImportFile } from '../src/lib/importFiles.ts'

const profile = { id: 'family', name: 'Família', nicheDescription: 'Casa', weights: { relevance: 70, discount: 20, commission: 10 } }
const offer = (id) => ({ title: `Produto ${id}`, productId: String(id), affiliateUrl: `https://example.com/${id}`, discountedPrice: 10 })
const parsed = (size, skipped = 0) => ({
  source: 'generic', totalSeen: size + skipped,
  offers: Array.from({ length: size }, (_, index) => offer(index)),
  offerIndexes: Array.from({ length: size }, (_, index) => index + skipped),
  errors: [{ index: 4, message: 'Aviso que não impede importar um produto válido' }],
  categorization: { method: 'pending', profileSnapshot: profile },
})
const success = (offers) => ({ offers: offers.map((item) => ({ ...item, category: 'B' })), offerIndexes: offers.map((_, index) => index) })
const options = (onProgress = () => {}) => ({ cancelled: () => false, onProgress, errorMessage: (cause) => cause.message })

test('a 125-item file completes bounded batches and counts warnings separately from skipped items', async () => {
  const snapshots = []
  const batchSizes = []
  let active = 0
  const session = await classifyImportSession(createImportSession(parsed(125, 2)), async (offers, frozenProfile) => {
    assert.equal(++active, 1)
    assert.equal(frozenProfile, profile)
    batchSizes.push(offers.length)
    await Promise.resolve()
    active--
    return success(offers)
  }, options((snapshot) => snapshots.push(snapshot)))
  assert.equal(batchSizes.length, 32)
  assert.ok(batchSizes.every((size) => size <= 4))
  assert.deepEqual(importSummary(session), { classified: 125, failed: 0, pending: 0, skipped: 2 })
  assert.equal(importSummary(snapshots[0]).classified, 4, 'prior snapshots stay immutable')
  assert.equal(importResult(session).offers.length, 125)
  assert.equal(importResult(session).offerIndexes[124], 126)
})

test('targeted retry evaluates only failed items, keeping the original profile and source positions', async () => {
  const initial = createImportSession(parsed(9, 3))
  let failedOnce = false
  const calls = []
  const request = async (offers, snapshot) => {
    assert.equal(snapshot, profile)
    calls.push(offers.map((item) => item.productId))
    if (!failedOnce) {
      failedOnce = true
      return {
        offers: offers.slice(1).map((item) => ({ ...item, category: 'A' })), offerIndexes: [1, 2, 3],
        categorization: { errors: [{ index: 0, code: 'JEV_TIMEOUT', message: 'Timeout', retryable: true }] },
      }
    }
    return success(offers)
  }
  const first = await classifyImportSession(initial, request, options())
  assert.deepEqual(importSummary(first), { classified: 8, failed: 1, pending: 0, skipped: 3 })
  const second = await classifyImportSession(first, request, { ...options(), retryFailed: true })
  assert.deepEqual(calls.at(-1), ['0'])
  assert.equal(second.items[0].sourceIndex, 3)
  assert.deepEqual(importSummary(second), { classified: 9, failed: 0, pending: 0, skipped: 3 })
})

test('cancellation completes its in-flight batch then resumes only pending offers', async () => {
  let cancel = false
  const first = await classifyImportSession(createImportSession(parsed(14)), async (offers) => { cancel = true; return success(offers) }, { ...options(), cancelled: () => cancel })
  assert.deepEqual(importSummary(first), { classified: 4, failed: 0, pending: 10, skipped: 0 })
  const calls = []
  const second = await classifyImportSession(first, async (offers) => { calls.push(...offers.map((item) => item.productId)); return success(offers) }, options())
  assert.equal(importSummary(second).classified, 14)
  assert.deepEqual(calls, Array.from({ length: 10 }, (_, index) => String(index + 4)))
})

test('transport errors retain completed results, leave pending items, and prevent unknown paid outcomes from retrying', async () => {
  let count = 0
  const first = await classifyImportSession(createImportSession(parsed(12)), async (offers) => {
    if (++count === 2) throw new Error('Connection lost')
    return success(offers)
  }, options())
  assert.deepEqual(importSummary(first), { classified: 4, failed: 4, pending: 4, skipped: 0 })
  const calls = []
  const second = await classifyImportSession(first, async (offers) => { calls.push(...offers.map((item) => item.productId)); return success(offers) }, options())
  assert.deepEqual(calls, ['8', '9', '10', '11'])
  assert.deepEqual(importSummary(second), { classified: 8, failed: 4, pending: 0, skipped: 0 })
})

test('continuing pending products does not retry failed paid evaluations, and explicit retry excludes pending products', async () => {
  const initial = createImportSession(parsed(8))
  initial.items[0] = { ...initial.items[0], status: 'failed', retryable: true }
  initial.items[1] = { ...initial.items[1], status: 'classified', offer: { ...initial.items[1].offer, category: 'A' } }
  const continuedCalls = []
  const continued = await classifyImportSession(initial, async (offers) => {
    continuedCalls.push(...offers.map((item) => item.productId)); return success(offers)
  }, options())
  assert.deepEqual(continuedCalls, ['2', '3', '4', '5', '6', '7'])
  assert.equal(importSummary(continued).failed, 1)
  const retriedCalls = []
  await classifyImportSession(initial, async (offers) => {
    retriedCalls.push(...offers.map((item) => item.productId)); return success(offers)
  }, { ...options(), retryFailed: true })
  assert.deepEqual(retriedCalls, ['0'])
  assert.equal(importResult(continued).offerIndexes[0], 1, 'selection keys use stable source positions after gap recovery')
})

test('501 saves use chunks of 100; completed chunks are removed and only failed chunks need retry', async () => {
  const entries = Array.from({ length: 501 }, (_, index) => index)
  const pending = new Set(entries)
  const sizes = []
  let failures = 0
  await saveInChunks(entries, async (batch) => {
    sizes.push(batch.length)
    if (batch[0] === 200) throw new Error('Save failed')
  }, (batch) => batch.forEach((id) => pending.delete(id)), (batch) => { failures += batch.length }, () => false)
  assert.deepEqual(sizes, [100, 100, 100, 100, 100, 1])
  assert.equal(failures, 100)
  assert.deepEqual([...pending], Array.from({ length: 100 }, (_, index) => index + 200))
  await saveInChunks([...pending], async () => {}, (batch) => batch.forEach((id) => pending.delete(id)), () => assert.fail('unexpected failure'), () => false)
  assert.equal(pending.size, 0)
})

test('save cancellation leaves unstarted chunks selected', async () => {
  let cancelled = false
  let saved = 0
  await saveInChunks(Array.from({ length: 250 }, (_, index) => index), async () => { cancelled = true }, (batch) => { saved += batch.length }, () => assert.fail('unexpected failure'), () => cancelled)
  assert.equal(saved, 100)
})

test('zero valid products still report every skipped item without a paid request', async () => {
  const session = await classifyImportSession(createImportSession(parsed(0, 150)), async () => assert.fail('should not classify'), options())
  assert.deepEqual(importSummary(session), { classified: 0, failed: 0, pending: 0, skipped: 150 })
})

test('125 unique offers from mixed files retain provenance, skips, warnings and duplicate counts through targeted retry', async () => {
  const payload = parsed(125)
  payload.totalSeen = 129
  payload.duplicateCount = 2
  payload.offerIndexes = Array.from({ length: 125 }, (_, index) => index < 63 ? index : index + 2)
  payload.provenance = payload.offerIndexes.map((index, position) => ({ index, fileIndex: position < 63 ? 0 : 1, itemIndex: position < 63 ? index : index - 65, fileName: position < 63 ? 'cards.json' : 'generic.json' }))
  payload.files = [
    { fileIndex: 0, name: 'cards.json', source: 'mercadolivre', totalSeen: 65, imported: 63, invalid: 1, duplicates: 1, warnings: 2 },
    { fileIndex: 1, name: 'generic.json', source: 'generic', totalSeen: 64, imported: 62, invalid: 1, duplicates: 1, warnings: 1 },
  ]
  payload.duplicates = [{ index: 63, fileIndex: 0, itemIndex: 63, fileName: 'cards.json', duplicateOf: 0 }, { index: 128, fileIndex: 1, itemIndex: 63, fileName: 'generic.json', duplicateOf: 0 }]
  payload.errors = [{ index: 64, fileIndex: 0, itemIndex: 64, fileName: 'cards.json', message: 'Inválido' }, { index: 127, fileIndex: 1, itemIndex: 62, fileName: 'generic.json', message: 'Inválido' }, { index: 2, fileIndex: 0, itemIndex: 2, fileName: 'cards.json', message: 'Aviso em item importado' }]
  const calls = []
  let failOnce = true
  const request = async (offers) => {
    calls.push(...offers.map((item) => item.productId))
    const failure = offers.findIndex((item) => item.productId === '120')
    if (failure >= 0 && failOnce) {
      failOnce = false
      return { offers: offers.filter((_, index) => index !== failure).map((item) => ({ ...item, category: 'B' })), offerIndexes: offers.map((_, index) => index).filter((index) => index !== failure), categorization: { errors: [{ index: failure, message: 'Timeout', retryable: true }] } }
    }
    return success(offers)
  }
  const first = await classifyImportSession(createImportSession(payload), request, options())
  const chosenSourceIndex = first.items[121].sourceIndex
  assert.deepEqual(importSummary(first), { classified: 124, failed: 1, pending: 0, skipped: 2 })
  assert.equal(first.duplicateCount, 2)
  const second = await classifyImportSession(first, request, { ...options(), retryFailed: true })
  assert.deepEqual(calls.slice(125), ['120'], 'duplicate occurrences never enter the paid queue')
  assert.deepEqual(second.items[120].provenance, { index: 122, fileIndex: 1, itemIndex: 57, fileName: 'generic.json' })
  assert.equal(second.items[121].sourceIndex, chosenSourceIndex, 'selection identities do not move when an earlier failed item succeeds')
  assert.deepEqual(importResult(second).provenance[120], second.items[120].provenance)
  assert.deepEqual(importResult(second).files, payload.files)
  assert.deepEqual(importResult(second).duplicates, payload.duplicates)
  assert.equal(importResult(second).errors[0].fileName, 'cards.json')
})

test('independent file envelopes and optional pasted JSON survive accumulation without concatenating formats', async () => {
  const cards = { source: 'mercadolivre', cards: [{ title: 'Panela', pricing: { discountedPrice: 10 } }] }
  const generic = [offer(2)]
  const fileA = await readImportFile({ name: 'cards.json', text: async () => JSON.stringify(cards) })
  const fileB = await readImportFile({ name: 'generic.json', text: async () => JSON.stringify(generic) })
  const files = [
    { id: 1, name: 'cards.json', size: 100, status: 'ready', text: fileA.text },
    { id: 2, name: 'generic.json', size: 100, status: 'ready', text: fileB.text },
  ]
  const payloads = prepareImportPayloads(files, JSON.stringify([offer(3)]))
  assert.deepEqual(payloads.map((entry) => entry.name), ['cards.json', 'generic.json', 'JSON colado'])
  assert.deepEqual(JSON.parse(payloads[0].json), cards)
  assert.deepEqual(JSON.parse(payloads[1].json), generic)
  assert.equal(payloads[0].source, undefined, 'each format is auto-detected independently by the backend')
  assert.equal(prepareImportPayloads(files, '  ').length, 2)
})

test('invalid or unreadable file names are visible before classification; reading files block requests', async () => {
  const invalid = await readImportFile({ name: 'quebrado.json', text: async () => '{' })
  assert.match(invalid.error, /quebrado.json/)
  const unreadable = await readImportFile({ name: 'sem-acesso.json', text: async () => { throw new Error('Read failed') } })
  assert.match(unreadable.error, /sem-acesso.json/)
  assert.throws(() => prepareImportPayloads([{ id: 1, name: 'reading.json', size: 1, status: 'reading' }], ''), /Aguarde/)
  assert.throws(() => prepareImportPayloads([{ id: 1, name: 'quebrado.json', size: 1, status: 'error', error: invalid.error }], ''), /arquivos com erro/)
  assert.throws(() => prepareImportPayloads([], '{'), /JSON colado inválido/)
})

test('a late asynchronous read cannot restore a removed file or overwrite its same-name replacement', async () => {
  let finishRead
  const lateRead = readImportFile({ name: 'mesmo.json', text: () => new Promise((resolve) => { finishRead = resolve }) })
  let files = [{ id: 1, name: 'mesmo.json', size: 2, status: 'reading' }]
  files = files.filter((file) => file.id !== 1)
  files.push({ id: 2, name: 'mesmo.json', size: 2, status: 'reading' })
  finishRead('[1]')
  files = applyFileRead(files, 1, await lateRead)
  assert.deepEqual(files, [{ id: 2, name: 'mesmo.json', size: 2, status: 'reading' }])
  assert.deepEqual(applyFileRead([], 1, { text: '[1]' }), [])
  files = applyFileRead(files, 2, { text: '[2]' })
  assert.equal(files[0].text, '[2]')
  assert.equal(files[0].status, 'ready')
})

test('combined file-count and byte limits include the optional pasted payload', () => {
  const files = Array.from({ length: 50 }, (_, id) => ({ id, name: `${id}.json`, size: 2, text: '[]', status: 'ready' }))
  assert.equal(prepareImportPayloads(files, '').length, 50)
  assert.match(importInputError(files, '[]'), /50/)
  assert.match(importInputError([{ ...files[0], size: MAX_IMPORT_BYTES }], '[]'), /32 MB/)
  assert.throws(() => prepareImportPayloads([{ ...files[0], size: 1, text: '"'.repeat(MAX_IMPORT_BYTES / 2) }], ''), /32 MB/, 'encoded request size includes JSON string escaping')
})

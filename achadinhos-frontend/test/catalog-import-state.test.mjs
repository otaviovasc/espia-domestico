import assert from 'node:assert/strict'
import test from 'node:test'
import { classificationFeedbackMessage, hasUnsavedImportWork } from '../src/lib/catalogImportState.ts'

const item = (sourceIndex, status = 'classified') => ({ sourceIndex, status })
const work = (items, saved = [], options = {}) => hasUnsavedImportWork({ session: items ? { items } : null, savedIndexes: new Set(saved), hasInput: true, ...options })

test('a loaded catalog and filters do not create unsaved import work', () => {
  assert.equal(work(null, [], { hasInput: false }), false)
  assert.equal(work(null), true, 'unprocessed input must be protected')
})

test('paid results remain unsaved regardless of current selection', () => {
  assert.equal(work([item(3), item(6)], [3]), true)
  assert.equal(work([item(3), item(6)], [3, 6]), false, 'retained raw input does not dirty fully saved results')
})

test('partial save, stopped classification and failed evaluations remain protected', () => {
  assert.equal(work([item(3), item(6), item(8, 'pending')], [3, 6]), true)
  assert.equal(work([item(3), item(6, 'failed')], [3]), true)
  assert.equal(work([item(3), item(6)], []), true, 'a failed save has no successful receipt')
})

test('running work and failed group assignments still guard already saved products', () => {
  assert.equal(work([item(3)], [3], { working: true }), true)
  assert.equal(work([item(3)], [3], { hasPendingGroups: true }), true)
  assert.equal(work([item(3)], [3]), false)
})

test('an empty parse retains input until explicitly discarded', () => {
  assert.equal(work([]), true)
  assert.equal(work(null, [], { hasInput: false }), false)
})

test('classification configuration messages use actionable operator copy', () => {
  assert.equal(classificationFeedbackMessage('Configure OPENROUTER_KEY para categorizar produtos.'), 'Classificação automática indisponível. Tente novamente mais tarde.')
  assert.equal(classificationFeedbackMessage('CATEGORIZATION_UNAVAILABLE'), 'Classificação automática indisponível. Tente novamente mais tarde.')
  assert.equal(classificationFeedbackMessage('Tempo limite na avaliação do produto 3.'), 'Tempo limite na avaliação do produto 3.')
})

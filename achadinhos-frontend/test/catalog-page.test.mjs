import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import * as workflow from '../src/lib/importWorkflow.ts'
import * as files from '../src/lib/importFiles.ts'
import * as importState from '../src/lib/catalogImportState.ts'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const source = ts.transpileModule(readFileSync(new URL('../src/pages/ProductCatalogPage.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const offer = { title: 'Resultado preservado', affiliateUrl: 'https://example.com/old', discountedPrice: 10, category: 'A' }
const profile = { id: 'default', name: 'Casa' }
const parsed = { source: 'generic', totalSeen: 1, offers: [offer], offerIndexes: [0], errors: [], categorization: { profileSnapshot: profile } }

// Exercise the page's real event handlers and async mutation lifecycle without a
// browser or network. UI primitives are leaves; state survives explicit renders.
function harness() {
  const slots = []
  let cursor = 0
  let tree
  const h = { confirm: true, confirmations: 0, evaluations: 0, preflight: async () => parsed, calls: [], query: null,
    catalog: { items: [], total: 125, classificationProfiles: [{ id: '7', name: 'Oficina' }] } }
  const slot = (init) => { const i = cursor++; if (!(i in slots)) slots[i] = init(); return i }
  const react = {
    useState(init) { const i = slot(() => typeof init === 'function' ? init() : init); return [slots[i], (v) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v }] },
    useRef(init) { const i = slot(() => ({ current: init })); return slots[i] },
    useMemo(fn) { return fn() }, useEffect() {},
  }
  const query = (options) => {
    if (options.queryKey[0] === 'saved-products') { h.query = options; return { data: h.catalog } }
    return { data: [], isPending: false }
  }
  const api = {
    apiErrorMessage: (e) => e.message,
    offerIdentity: (o) => o.affiliateUrl,
    campaignApi: { importPayloads: () => h.preflight(), importOffers: (offers, options) => {
      if (options.parseOnly) return h.preflight()
      h.evaluations++
      return Promise.resolve({ offers, offerIndexes: offers.map((_, i) => i) })
    } },
    savedProductApi: {
      list: (...args) => { h.calls.push(args); return Promise.resolve(h.catalog) },
      save: async (offers) => ({ saved: offers.map((offer, id) => ({ id, offer })), created: offers.length, updated: 0 }),
    },
    classificationProfileApi: {}, groupApi: {},
  }
  const components = new Proxy({}, { get: (_, key) => key })
  const modules = {
    react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '@tanstack/react-query': {
      useQueryClient: () => ({ invalidateQueries: async () => {} }), useQuery: query, useInfiniteQuery: query,
      useMutation: (options) => ({ isPending: false, mutate: async (arg) => {
        try { const data = await options.mutationFn(arg); await options.onSuccess?.(data, arg) }
        catch (e) { options.onError?.(e) }
        finally { options.onSettled?.() }
      } }),
    },
    '@/lib/api': api, '@/lib/importWorkflow': workflow, '@/lib/importFiles': files,
    '@/lib/catalogImportState': importState, '@/lib/productGroups': { productGroupApi: {} },
    '@/hooks/useUnsavedChanges': { useUnsavedChanges: (dirty) => { h.dirty = dirty; return { prompt: null } } },
  }
  const exports = {}
  runInNewContext(source, { exports, require: (id) => modules[id] ?? components, TextEncoder,
    window: { confirm: () => { h.confirmations++; return h.confirm } } })
  h.render = () => { cursor = 0; tree = exports.default(); return tree }
  const nodes = (node) => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]
  const text = (node) => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
  h.find = (predicate) => { h.render(); const found = nodes(tree).find(predicate); assert.ok(found, 'UI control must exist'); return found.props }
  h.button = (label) => h.find((n) => (n.type === 'Button' || n.type === 'button') && text(n) === label)
  h.text = () => { h.render(); return text(tree) }
  h.edit = (value) => h.find((n) => n.props?.id === 'catalog-json').onChange({ target: { value } })
  h.classify = () => h.button('Iniciar nova classificação').onClick()
  h.selection = () => h.find((n) => n.props?.['aria-label'] === 'Salvar Resultado preservado')
  h.file = async (text = '[]') => {
    h.find((n) => n.props?.type === 'file').onChange({ target: { files: [{ name: 'new.json', size: text.length, text: async () => text }], value: '' } })
    await new Promise(setImmediate)
  }
  h.start = async () => { h.edit('[{}]'); await h.button('Classificar produtos').onClick(); assert.match(h.text(), /Resultado preservado/) }
  return h
}

for (const action of ['text', 'add', 'remove', 'clear']) test(`${action} keeps completed classifications until replacement preflight and confirmation`, async () => {
  const h = harness()
  await h.file()
  await h.start()
  if (action === 'text') h.edit('{invalid')
  if (action === 'add') await h.file()
  if (action === 'remove') h.find((n) => n.props?.['aria-label'] === 'Remover arquivo new.json').onClick()
  if (action === 'clear') h.button('Limpar arquivos').onClick()
  assert.match(h.text(), /Resultado preservado/)
})

test('invalid, empty and cancelled replacements retain results; preflight precedes replacement', async () => {
  const h = harness()
  await h.start()
  h.selection().onChange()
  h.edit('[{"new":true}]')
  let resolve
  h.preflight = () => new Promise((r) => { resolve = r })
  const pending = h.classify()
  assert.match(h.text(), /Resultado preservado/, 'in-flight preflight retains old result')
  h.confirm = false
  resolve(parsed)
  await pending
  assert.equal(h.confirmations, 1)
  assert.match(h.text(), /Resultado preservado/)
  assert.equal(h.selection().checked, true)
  assert.equal(h.evaluations, 1, 'cancelling replacement must not evaluate anything')
  h.confirm = true
  h.preflight = async () => { throw new Error('invalid replacement') }
  await h.classify()
  assert.match(h.text(), /Resultado preservado/)
  h.preflight = async () => ({ ...parsed, offers: [], offerIndexes: [] })
  await h.classify()
  assert.match(h.text(), /Resultado preservado/)
  assert.equal(h.evaluations, 1)
  h.preflight = async () => ({ ...parsed, offers: [{ ...offer, title: 'Nova classificação' }] })
  await h.classify()
  assert.doesNotMatch(h.text(), /Resultado preservado/)
  assert.match(h.text(), /Nova classificação/)
  assert.equal(h.evaluations, 2)
})

test('malformed pasted JSON and unreadable replacement payloads cannot clear prior results', async () => {
  const h = harness()
  await h.start()
  h.edit('{invalid')
  assert.equal(h.button('Iniciar nova classificação').disabled, true)
  await h.classify()
  assert.match(h.text(), /Resultado preservado/)
  h.edit('[]')
  await h.file('{invalid')
  assert.equal(h.button('Iniciar nova classificação').disabled, true)
  await h.classify()
  assert.match(h.text(), /Resultado preservado/)
  assert.equal(h.evaluations, 1)
  assert.equal(h.confirmations, 0)
})

test('catalog query sends filters and uses server totals for pagination', async () => {
  const h = harness()
  for (const [label, value] of [['Filtrar catálogo por grupo de produtos', '23'], ['Filtrar catálogo por perfil de classificação', '7'], ['Filtrar catálogo salvo por categoria', 'B']]) {
    h.find((n) => n.props?.['aria-label'] === label).onChange({ target: { value } })
  }
  h.find((n) => n.props?.['aria-label'] === 'Buscar no catálogo').onChange({ target: { value: ' agulha ' } })
  h.render()
  await h.query.queryFn({ pageParam: 0 })
  assert.deepEqual(structuredClone(h.calls.at(-1)), [40, 0, { groupId: 23, profileId: '7', category: 'B', search: 'agulha' }])
  assert.match(h.text(), /Página 1 de 4/)
  assert.match(h.text(), /Oficina \(arquivado\)/)
  const previousKey = JSON.stringify(h.query.queryKey)
  h.button('Próxima').onClick()
  h.render()
  await h.query.queryFn()
  assert.equal(h.calls.at(-1)[1], 40)
  h.find((n) => n.props?.['aria-label'] === 'Buscar no catálogo').onChange({ target: { value: 'zero' } })
  h.catalog = { items: [], total: 0 }
  h.render()
  assert.notEqual(JSON.stringify(h.query.queryKey), previousKey)
  await h.query.queryFn()
  assert.equal(h.calls.at(-1)[1], 0)
  assert.match(h.text(), /Nenhum produto com estes filtros/)
  h.find((n) => n.props?.['aria-label'] === 'Buscar no catálogo')
})

test('save receipts survive a rejected replacement and edited drafts guard navigation', async () => {
  const h = harness()
  await h.start()
  h.selection().onChange()
  await h.button('Salvar 1 selecionado(s)').onClick()
  h.render()
  assert.equal(h.dirty, false)
  h.edit('[{"new":true}]')
  h.preflight = async () => { throw new Error('invalid replacement') }
  await h.classify()
  assert.match(h.text(), /Resultado preservado/)
  assert.equal(h.dirty, true)
  h.preflight = async () => parsed
  await h.classify()
  assert.equal(h.confirmations, 0, 'already saved result needs no discard confirmation')
})

test('clearing an unclassified draft does not create phantom unsaved work', () => {
  const h = harness()
  h.edit('[]')
  h.render()
  assert.equal(h.dirty, true)
  h.edit('')
  h.render()
  assert.equal(h.dirty, false)
})

test('catalog API client serializes all server filters with limit and offset', async () => {
  const apiSource = ts.transpileModule(readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8').replace('import.meta.env.VITE_API_BASE', 'undefined'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  let request
  const client = { interceptors: { request: { use() {} } }, get: async (...args) => {
    request = args
    return { data: { success: true, data: { items: [], total: 7 } } }
  } }
  const exports = {}
  runInNewContext(apiSource, { exports, require: () => ({ default: { create: () => client } }) })
  const filters = { search: '100%_', profileId: '7', category: 'B', groupId: 23 }
  const result = await exports.savedProductApi.list(40, 80, filters)
  assert.equal(result.total, 7)
  assert.deepEqual(structuredClone(request), ['/saved-products', { params: { limit: 40, offset: 80, ...filters } }])
})

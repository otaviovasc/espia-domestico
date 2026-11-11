// Opt-in: run only against a disposable, migrated local PostgreSQL database.
const { test: nodeTest, before, after, afterEach } = require('node:test')
// Freeze ordinary fixtures independently; explicit timer tests keep their own clock.
const test = (name, fn) => nodeTest(name, async t => {
  if (!fn.toString().includes('timers.enable')) t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T10:00:00Z').getTime() })
  return fn(t)
})
const { Op } = require('sequelize')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
require('reflect-metadata')
process.env.DATABASE_URL ??= 'postgresql://dailyqa:dailyqa-local-only@127.0.0.1:55439/dailyqa'
process.env.JWT_SECRET ??= 'daily-integration-secret-at-least-thirty-two-characters'
const { env } = require('../dist/config/env')
assert.ok(['localhost', '127.0.0.1', '::1'].includes(new URL(env.DATABASE_URL).hostname), 'Disposable local database required')
env.AI_ENABLED = true // Provider calls are replaced; no network/paid API is used.
const { sequelize } = require('../dist/database')
const { User } = require('../dist/database/models/User')
const { SmartAudience } = require('../dist/database/models/SmartAudience')
const { SmartPlan } = require('../dist/database/models/SmartPlan')
const { SmartSend } = require('../dist/database/models/SmartSend')
const { ProductGroupDelivery } = require('../dist/database/models/ProductGroupDelivery')
const { registerAssociations } = require('../dist/database/models')
registerAssociations()
const { DailyAutomationService, dailyRequestId } = require('../dist/services/DailyAutomationService')
const { DailyCollectionError } = require('../dist/services/DailyProductCollector')
const { DailyAutomationConfigSchema, dailyWindow } = require('../dist/config/dailyAutomation')
after(async () => sequelize.close())
before(async () => User.destroy({ where: { email: { [Op.like]: '%@daily.invalid' } } }))
const createdUsers = []
afterEach(async () => {
  if (createdUsers.length) await User.destroy({ where: { id: createdUsers.splice(0) } })
})

// Tests keep real wall-clock date checks, but use a full-day collection window.
async function setup() {
  const user = await User.create({ name: 'Daily QA', email: `${randomUUID()}@daily.invalid`, passwordHash: 'unused' })
  createdUsers.push(user.id)
  const config = DailyAutomationConfigSchema.parse({ userId: user.id, planningDaysAhead: 0, collectTime: '00:00', autoApprove: true, requireFullWindow: false })
  // The worker's commercial window is explicitly bounded; run QA before 21:00 SP.
  for (const slug of ['domestica', 'masculino']) {
    await SmartAudience.create({ userId: user.id, slug, name: slug, description: 'Daily QA audience', enabled: true,
      destinations: [{ groupId: `${slug}@g.us`, groupName: slug }],
      profile: { instructions: 'Relevant household or male products only.', keywords: [slug], negativeKeywords: [] },
      policy: { dailyCap: 30, startTime: '08:00', endTime: '19:00', minGapSeconds: 1200, maxGapSeconds: 1500,
        maxStandouts: 0, freshnessHours: 24, timezone: 'America/Sao_Paulo', excludePolitical: true },
    })
  }
  const calls = { collect: 0, create: 0, approve: 0 }
  const payloads = ['domestica', 'masculino'].map((slug, index) => ({ name: `${slug}.json`, targetAudienceSlug: slug,
    json: { extractedAt: new Date().toISOString(), cards: [{ productId: `MLB1234567${index}`, title: slug }] } }))
  const smart = {
    async createPlan(userId, input, dailyAutomation) {
      calls.create++
      const plan = await SmartPlan.create({ userId, status: 'ANALYZING', startDate: input.date, days: 1,
        timezone: config.timezone, audienceSlugs: input.audienceSlugs, input: { requestId: input.requestId },
        settings: { audiences: {}, global: { campaignStartTime: input.campaignStartTime }, ...(dailyAutomation ? { dailyAutomation } : {}) }, items: [] })
      return { id: plan.uuid }
    },
    async approve(userId, uuid, revision, options) {
      calls.approve++
      assert.deepEqual(options, { automatic: true })
      const plan = await SmartPlan.findOne({ where: { userId, uuid } })
      assert.equal(plan.revision, revision)
      assert.equal(plan.settings.dailyAutomation.localDate, plan.startDate)
      assert.equal(plan.settings.dailyAutomation.startTime, config.startTime)
      await plan.update({ status: 'SCHEDULED' })
    },
    async cancel(userId, uuid, revision) {
      const plan = await SmartPlan.findOne({ where: { userId, uuid } })
      assert.equal(revision, plan.revision, 'Cancellation requires the current revision')
      await plan.update({ status: 'CANCELLED', revision: revision + 1 })
    },
  }
  const collector = { async collect() { calls.collect++; return payloads } }
  const service = new DailyAutomationService(smart, collector)
  const run = async () => (await sequelize.query('SELECT * FROM daily_automation_runs WHERE user_id=:id', { replacements: { id: user.id }, type: 'SELECT' }))[0]
  return { user, config, calls, payloads, smart, collector, service, run }
}

test('daily collection, checkpoint recovery, approval, and retries converge to one plan', async () => {
  const f = await setup()
  let release, started
  const begun = new Promise(resolve => { started = resolve })
  const finish = new Promise(resolve => { release = resolve })
  f.collector.collect = async () => { f.calls.collect++; started(); await finish; return f.payloads }
  const first = f.service.tick(f.config)
  await begun
  await new DailyAutomationService(f.smart, f.collector).tick(f.config)
  release()
  await first
  assert.equal(f.calls.collect, 1)
  assert.equal(f.calls.create, 1)
  const run = await f.run()
  assert.equal(run.status, 'ANALYZING')
  const plan = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
  // Simulate losing the final checkpoint after createPlan returned.
  await sequelize.query("UPDATE daily_automation_runs SET plan_uuid=NULL, status='COLLECTING', next_attempt_at=NOW() WHERE id=:id", { replacements: { id: run.id } })
  await f.service.tick(f.config)
  assert.equal(f.calls.collect, 1)
  assert.equal(f.calls.create, 1)
  await plan.update({ status: 'REVIEW', items: ['domestica', 'masculino'].map(slug => ({ state: 'SELECTED', audienceSlug: slug })) })
  await f.service.tick(f.config)
  assert.equal((await f.run()).status, 'SCHEDULED')
  assert.equal(f.calls.approve, 1)
  await f.service.tick(f.config)
  assert.equal(f.calls.create, 1)
  assert.equal(f.calls.approve, 1)
})

test('expired auth is held without paid analysis or repeated browser allocation', async () => {
  const f = await setup()
  f.collector.collect = async () => { f.calls.collect++; throw new DailyCollectionError('AUTH_REQUIRED') }
  await f.service.tick(f.config)
  await f.service.tick(f.config)
  assert.equal((await f.run()).status, 'AUTH_REQUIRED')
  assert.equal(f.calls.collect, 1)
  assert.equal(f.calls.create, 0)
})

test('restart resumes the current frozen run before applying tomorrow collection and weekday settings', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T09:00:00Z').getTime() })
  for (const replacement of [
    { date: '2026-11-09', collectTime: '10:00', startTime: '10:00', weekdaysOnly: false },
    { date: '2026-11-08', collectTime: '06:00', startTime: '08:00', weekdaysOnly: true },
  ]) {
    const { date, ...nextSettings } = replacement
    t.mock.timers.setTime(new Date(`${date}T09:00:00Z`).getTime())
    const f = await setup()
    f.config = DailyAutomationConfigSchema.parse({ ...f.config, collectTime: '06:00', requireFullWindow: true })
    await f.service.tick(f.config)
    const initial = await f.run()
    assert.equal(initial.status, 'ANALYZING')
    t.mock.timers.setTime(new Date(`${date}T10:00:00Z`).getTime())
    const plan = await SmartPlan.findOne({ where: { uuid: initial.plan_uuid } })
    await plan.update({ status: 'REVIEW', items: ['domestica', 'masculino'].flatMap(slug => Array.from({ length: 28 }, () => ({ state: 'SELECTED', audienceSlug: slug }))) })
    const tomorrow = DailyAutomationConfigSchema.parse({ ...f.config, ...nextSettings })
    assert.equal(dailyWindow(tomorrow).due, false)
    await new DailyAutomationService(f.smart, f.collector).tick(tomorrow)
    assert.equal((await f.run()).status, 'SCHEDULED')
    assert.equal(f.calls.collect, 1)
    assert.equal(f.calls.create, 1)
    assert.equal(f.calls.approve, 1)
    assert.equal((await f.run()).config.collectTime, '06:00')
    assert.equal((await f.run()).config.weekdaysOnly, false)
  }
})

test('partial empty collection retries within the three-attempt budget before any paid analysis', async () => {
  const f = await setup()
  f.collector.collect = async () => { f.calls.collect++; return [{ ...f.payloads[0], json: { cards: [] } }] }
  for (let index = 0; index < 3; index++) {
    await f.service.tick(f.config)
    assert.equal((await f.run()).last_error, 'COLLECTION_INCOMPLETE')
    await sequelize.query('UPDATE daily_automation_runs SET next_attempt_at=NOW() WHERE user_id=:id', { replacements: { id: f.user.id } })
  }
  await f.service.tick(f.config)
  assert.equal((await f.run()).status, 'FAILED')
  assert.equal(f.calls.collect, 3)
  assert.equal(f.calls.create, 0)
})

test('completed audience checkpoints survive a collection timeout and resume only the missing audience', async () => {
  const f = await setup()
  const seen = []
  f.collector.collect = async (requests, _signal, checkpoint) => {
    f.calls.collect++
    seen.push(requests.map(request => request.slug))
    if (f.calls.collect === 1) {
      await checkpoint(f.payloads[0])
      throw new DailyCollectionError('COLLECTION_TIMEOUT')
    }
    assert.ok(requests[0].options.excludeProductIds.includes(f.payloads[0].json.cards[0].productId))
    return [f.payloads[1]]
  }
  await f.service.tick(f.config)
  assert.equal((await f.run()).status, 'RETRY')
  assert.equal((await f.run()).payloads.length, 1)
  assert.equal(f.calls.create, 0)
  await sequelize.query('UPDATE daily_automation_runs SET next_attempt_at=NOW() WHERE user_id=:id', { replacements: { id: f.user.id } })
  await f.service.tick(f.config)
  assert.deepEqual(seen, [['domestica', 'masculino'], ['masculino']])
  assert.equal((await f.run()).payloads.length, 2)
  assert.equal((await f.run()).status, 'ANALYZING')
  assert.equal((await f.run()).attempts, 0)
})

test('collection failures do not exhaust the independent post-plan approval retry budget', async () => {
  const f = await setup()
  f.collector.collect = async () => {
    f.calls.collect++
    if (f.calls.collect < 3) throw new DailyCollectionError('COLLECTION_TIMEOUT')
    return f.payloads
  }
  for (let index = 0; index < 3; index++) {
    await f.service.tick(f.config)
    await sequelize.query('UPDATE daily_automation_runs SET next_attempt_at=NOW() WHERE user_id=:id', { replacements: { id: f.user.id } })
  }
  const run = await f.run()
  assert.equal(run.status, 'ANALYZING')
  assert.equal(run.attempts, 0)
  await SmartPlan.update({ status: 'REVIEW', items: ['domestica', 'masculino'].map(slug => ({ state: 'SELECTED', audienceSlug: slug })) }, { where: { uuid: run.plan_uuid } })
  const approve = f.smart.approve
  let approvalAttempts = 0
  f.smart.approve = async (...args) => {
    if (++approvalAttempts < 3) throw new Error('Transient approval dependency')
    return approve(...args)
  }
  for (let index = 0; index < 2; index++) {
    await f.service.tick(f.config)
    assert.equal((await f.run()).status, 'RETRY')
    assert.equal((await f.run()).attempts, index + 1)
    await sequelize.query('UPDATE daily_automation_runs SET next_attempt_at=NOW() WHERE user_id=:id', { replacements: { id: f.user.id } })
  }
  await f.service.tick(f.config)
  assert.equal((await f.run()).status, 'SCHEDULED')
  assert.equal(f.calls.collect, 3)
  assert.equal(approvalAttempts, 3)
})

test('collection history normalizes source names and preserves exclusion-list headroom before browser work', async () => {
  const f = await setup()
  await ProductGroupDelivery.create({ userId: f.user.id, connectionScope: 'history-qa', groupId: 'history@g.us', groupName: 'History',
    offerIdentity: randomUUID(), offerSource: ' MercadoLivre ', offerProductId: ' mlb - 98765432 ',
    offerUrl: 'https://meli.la/history-qa', offerTitle: 'Already sent', status: 'SENT', sentAt: new Date() })
  f.collector.collect = async requests => {
    f.calls.collect++
    assert.ok(requests.every(request => request.options.excludeProductIds.includes('MLB98765432')))
    return f.payloads
  }
  await f.service.tick(f.config)
  assert.equal(f.calls.collect, 1)
  const capped = await setup()
  capped.service.exclusions = async () => Array.from({ length: 50000 }, (_, index) => `MLB${10000000 + index}`)
  await capped.service.tick(capped.config)
  assert.equal((await capped.run()).status, 'CONFIG_REQUIRED')
  assert.equal((await capped.run()).last_error, 'HISTORY_LIMIT')
  assert.equal(capped.calls.collect, 0)
  assert.equal(capped.calls.create, 0)
})

test('competing manual campaigns hold before collection and completed payloads survive a session-write failure', async () => {
  const f = await setup()
  const { Campaign } = require('../dist/database/models/Campaign')
  const campaign = await Campaign.create({ userId: f.user.id, name: 'Conflicting QA campaign', status: 'SCHEDULED', safety: {},
    offers: [], groups: [{ id: 'domestica@g.us', name: 'domestica' }] })
  await f.service.tick(f.config)
  assert.equal((await f.run()).last_error, 'SMART_MANUAL_CAMPAIGN_CONFLICT')
  assert.equal(f.calls.collect, 0)
  await campaign.update({ status: 'CANCELLED' })
  await sequelize.query("UPDATE daily_automation_runs SET status='COLLECTING', next_attempt_at=NOW() WHERE user_id=:id", { replacements: { id: f.user.id } })
  f.collector.collect = async () => { f.calls.collect++; throw new DailyCollectionError('SESSION_PERSIST_FAILED', f.payloads) }
  await f.service.tick(f.config)
  assert.equal((await f.run()).status, 'CONFIG_REQUIRED')
  assert.equal((await f.run()).payloads.length, 2)
  assert.equal(f.calls.create, 0)
  await sequelize.query("UPDATE daily_automation_runs SET status='COLLECTING', next_attempt_at=NOW() WHERE user_id=:id", { replacements: { id: f.user.id } })
  await f.service.tick(f.config)
  assert.equal((await f.run()).status, 'ANALYZING')
  assert.equal(f.calls.collect, 1, 'Repaired run reuses completed observations')
})

test('expired leases resume and create failures reuse collected evidence', async () => {
  const f = await setup()
  const date = dailyWindow(f.config).date
  await sequelize.query(`INSERT INTO daily_automation_runs(user_id, local_date, request_id, config, payloads, lease_token, lease_until)
    VALUES(:id, :date, :requestId, CAST(:config AS JSONB), CAST(:payloads AS JSONB), :token, NOW()-INTERVAL '1 minute')`, {
    replacements: { id: f.user.id, date, requestId: dailyRequestId(f.user.id, date), config: JSON.stringify(f.config), payloads: JSON.stringify(f.payloads), token: randomUUID() },
  })
  const create = f.smart.createPlan
  f.smart.createPlan = async () => { throw new Error('transient DB failure') }
  await f.service.tick(f.config)
  assert.equal((await f.run()).status, 'RETRY')
  assert.equal((await f.run()).attempts, 1)
  f.smart.createPlan = create
  await sequelize.query('UPDATE daily_automation_runs SET next_attempt_at=NOW() WHERE user_id=:id', { replacements: { id: f.user.id } })
  await f.service.tick(f.config)
  assert.equal((await f.run()).status, 'ANALYZING')
  assert.equal(f.calls.collect, 0)
  assert.equal(f.calls.create, 1)
})

test('missing qualified inventory for one audience still auto-approves the other audience', async () => {
  const f = await setup()
  await f.service.tick(f.config)
  const run = await f.run()
  await SmartPlan.update({ status: 'REVIEW', items: [{ state: 'SELECTED', audienceSlug: 'domestica' }] }, { where: { uuid: run.plan_uuid } })
  await f.service.tick(f.config)
  assert.equal((await f.run()).status, 'SCHEDULED')
  assert.equal(f.calls.approve, 1)
})

test('a plan with no qualified selection is never auto-approved', async () => {
  const f = await setup()
  await f.service.tick(f.config)
  const run = await f.run()
  await SmartPlan.update({ status: 'REVIEW', items: [{ state: 'RESERVE', audienceSlug: 'domestica' }] }, { where: { uuid: run.plan_uuid } })
  await f.service.tick(f.config)
  assert.equal((await f.run()).status, 'REVIEW')
  assert.equal((await f.run()).last_error, 'INSUFFICIENT_QUALIFIED_PRODUCTS')
  assert.equal(f.calls.approve, 0)
})

test('a full-window run auto-approves a sparse selection when both audiences have products', async (t) => {
  const date = new Date().toISOString().slice(0, 10)
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${date}T10:00:00Z`).getTime() })
  const f = await setup()
  f.config.requireFullWindow = true
  await f.service.tick(f.config)
  const run = await f.run()
  await SmartPlan.update({ status: 'REVIEW', items: ['domestica', 'masculino'].map(slug => ({ state: 'SELECTED', audienceSlug: slug })) }, { where: { uuid: run.plan_uuid } })
  await f.service.tick(f.config)
  assert.equal((await f.run()).status, 'SCHEDULED')
  assert.equal(f.calls.approve, 1)
})

test('real Smart analysis skips weak demand/politics before AI and retains rejected evidence', async () => {
  const f = await setup()
  const { SmartCampaignService } = require('../dist/services/SmartCampaignService')
  const now = new Date().toISOString()
  const product = (id, title, signals) => ({ title, productId: id, source: 'mercadolivre', currency: 'BRL', discountedPrice: 100,
    originalPrice: 200, commissioned: true, commissionedUrlStatus: 'generated_from_page_state', commissionRate: 15,
    affiliateUrl: `https://meli.la/${id}`, extensionEvidence: { extractedAt: now, visibleSignals: signals } })
  const offers = [product('MLB11111111', 'Garrafa térmica', { rating: 4.9, soldCount: 50000, bestSeller: true }),
    product('MLB22222222', 'Panela sem avaliação', undefined),
    product('MLB33333333', 'Camiseta Bolsonaro', { rating: 4.9, soldCount: 50000 }),
    { ...product('MLB44444444', 'Panela sem link verificado', { rating: 4.9, soldCount: 50000 }), commissioned: false, commissionedUrlStatus: 'share_error' },
    { ...product('MLB55555555', 'Panela expirada', { rating: 4.9, soldCount: 50000 }), extensionEvidence: { extractedAt: '2000-01-01T00:00:00Z', visibleSignals: { rating: 4.9, soldCount: 50000 } } },
    product('MLB66666666', 'Caneca estampa especial', { rating: 4.9, soldCount: 50000 })]
  const seen = []
  const intelligence = {
    async analyze(products, slugs) {
      seen.push(...products.map(value => value.productId))
      return products.map((offer, index) => ({ index, political: offer.productId === 'MLB66666666', fits: slugs.map(slug => ({ slug, score: 95, reason: 'Relevant household use', category: 'cozinha', seasonalScore: 50 })), warnings: [] }))
    },
    async standoutCopy() { return null },
  }
  const imports = { parsePayloads() { return { offers, source: 'mercadolivre', totalSeen: offers.length, errors: [], duplicateCount: 0 } } }
  const smart = new SmartCampaignService(imports, { async save(_userId, values) { return values } }, intelligence, {}, {})
  const created = await smart.createPlan(f.user.id, { requestId: randomUUID(), date: dailyWindow(f.config).date, days: 1,
    audienceSlugs: ['domestica', 'masculino'], payloads: [{ name: 'fixture', json: {} }], campaignStartTime: '08:00',
    settings: { excludePolitical: true, dailySelection: { minRating: 4.5, minSoldCount: 100, minFitScore: 80, minCommercialScore: 70 } },
  })
  const pending = await SmartPlan.findOne({ where: { uuid: created.id } })
  assert.equal(await smart.processPendingAnalysis(pending.id), true)
  const plan = await SmartPlan.findOne({ where: { uuid: created.id } })
  assert.equal(plan.status, 'REVIEW')
  assert.deepEqual(seen, ['MLB11111111', 'MLB66666666'])
  assert.ok(plan.items.some(item => item.product.productId === 'MLB22222222' && item.state === 'REJECTED' && /Vendas acumuladas/.test(item.reason)))
  assert.ok(plan.items.some(item => item.product.productId === 'MLB33333333' && item.state === 'REJECTED'))
  for (const id of ['MLB44444444', 'MLB55555555']) assert.ok(!seen.includes(id))
  assert.ok(plan.items.some(item => item.product.productId === 'MLB55555555' && item.state === 'REJECTED'))
  assert.equal(plan.items.filter(item => item.product.productId === 'MLB11111111' && item.state === 'SELECTED').length, 1)
  const political = plan.items.find(item => item.product.productId === 'MLB66666666')
  assert.equal(political.political, true)
  assert.equal(political.state, 'REJECTED')
  await assert.rejects(smart.updatePlan(f.user.id, plan.uuid, { revision: plan.revision, items: [{ id: political.id, state: 'SELECTED' }] }), /político/)
})

test('collected root and visible descriptions reach the real classification request and semantic rejection', async () => {
  const f = await setup()
  const { OfferImportService } = require('../dist/services/OfferImportService')
  const { SmartCampaignService } = require('../dist/services/SmartCampaignService')
  const { SmartCampaignIntelligence } = require('../dist/services/SmartCampaignIntelligence')
  const descriptions = ['Estampa com foice e martelo sobre estrela vermelha', 'Estampa de propaganda em símbolo descrito pelo fabricante']
  const requests = []
  const intelligence = new SmartCampaignIntelligence({ async generate(request) {
    const input = JSON.parse(request.prompt)
    requests.push(input.productData.description)
    assert.ok(descriptions.includes(input.productData.description), 'Observed description must reach the paid-request boundary')
    return { political: true, warnings: [], fits: input.requiredSlugs.map(slug => ({ slug, score: 95, reason: 'Synthetic fit; semantic flag blocks selection', category: 'utilidades', seasonalScore: 50 })) }
  } })
  const smart = new SmartCampaignService(new OfferImportService(), { async save(_user, offers) { return offers } }, intelligence, {}, {})
  const collector = { async collect() { return ['domestica', 'masculino'].map((slug, index) => ({ name: `${slug}.json`, targetAudienceSlug: slug,
    json: { schemaVersion: 1, extractedAt: new Date().toISOString(), cards: [{ productId: `MLB${93000000 + index}`, title: 'Caneca de cerâmica',
      commissionedUrl: `https://meli.la/description-${index}`, commissionedUrlStatus: 'generated_from_page_state',
      ...(index === 0 ? { description: descriptions[index] } : {}),
      visible: { ...(index === 1 ? { description: descriptions[index] } : {}), text: '4.9 | +50mil vendidos', commissionPercent: '10%', pricing: { currentAmount: 100, originalAmount: 150, currency: 'BRL' } },
    }] } })) } }
  await new DailyAutomationService(smart, collector).tick(f.config)
  const run = await f.run()
  const plan = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
  assert.equal(await smart.processPendingAnalysis(plan.id), true)
  assert.deepEqual(requests.sort(), [...descriptions].sort())
  await plan.reload()
  for (const description of descriptions) {
    const item = plan.items.find(item => item.product.description === description)
    assert.ok(item, 'The observed description must also survive on the persisted item')
    assert.equal(item.political, true)
    assert.equal(item.state, 'REJECTED')
  }
  assert.equal(plan.items.filter(item => item.state === 'SELECTED').length, 0)
})

test('active-plan limits hold before browser or paid work while a late full window still collects', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T10:00:00Z').getTime() })
  const f = await setup()
  for (let index = 0; index < 2; index++) await f.smart.createPlan(f.user.id, { date: dailyWindow(f.config).date, requestId: randomUUID(), audienceSlugs: ['domestica'], campaignStartTime: '08:00' })
  await f.service.tick(f.config)
  assert.equal((await f.run()).status, 'OPERATOR_ATTENTION')
  assert.equal((await f.run()).last_error, 'ACTIVE_PLAN_LIMIT')
  assert.equal(f.calls.collect, 0)
  const date = new Date().toISOString().slice(0, 10)
  t.mock.timers.setTime(new Date(`${date}T13:00:00Z`).getTime())
  const late = await setup()
  late.config.requireFullWindow = true
  await late.service.tick(late.config)
  assert.notEqual((await late.run()).status, 'EXPIRED')
  assert.equal(late.calls.collect, 1)
  assert.equal(late.calls.create, 1)
})

test('controlled shutdown releases its fenced lease without a 30-minute wait', async () => {
  const f = await setup()
  f.collector.collect = async () => { throw new DailyCollectionError('STOPPED') }
  await f.service.tick(f.config)
  assert.equal((await f.run()).lease_token, null)
  f.collector.collect = async () => f.payloads
  await new DailyAutomationService(f.smart, f.collector).tick(f.config)
  assert.equal((await f.run()).status, 'ANALYZING')
})

test('repeated transient collection failures stop after three total attempts', async () => {
  const f = await setup()
  let attempts = 0
  f.collector.collect = async () => { attempts++; throw new DailyCollectionError('COLLECTION_TIMEOUT') }
  for (let attempt = 0; attempt < 3; attempt++) {
    await f.service.tick(f.config)
    await sequelize.query('UPDATE daily_automation_runs SET next_attempt_at=NOW() WHERE user_id=:id', { replacements: { id: f.user.id } })
  }
  assert.equal((await f.run()).status, 'FAILED')
  assert.equal((await f.run()).attempts, 3)
  await f.service.tick(f.config)
  assert.equal(attempts, 3)
  assert.equal(f.calls.create, 0)
})

test('next-day retirement uses real cancellation and preserves a concurrent operator change', async (t) => {
  const date = new Date().toISOString().slice(0, 10)
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${date}T09:00:00Z`).getTime() })
  const f = await setup()
  await f.service.tick(f.config)
  const yesterday = await f.run()
  await SmartPlan.update({ status: 'REVIEW' }, { where: { uuid: yesterday.plan_uuid } })
  await f.service.tick(f.config) // Persist the completed analysis as a held preview before rollover.
  const { SmartCampaignService } = require('../dist/services/SmartCampaignService')
  const real = new SmartCampaignService({}, {}, {}, {}, {})
  let race = true
  f.smart.cancel = async (userId, uuid, revision) => {
    if (race) {
      race = false
      await SmartPlan.increment('revision', { where: { userId, uuid } })
      await SmartPlan.update({ status: 'PAUSED' }, { where: { userId, uuid } })
    }
    return real.cancel(userId, uuid, revision)
  }
  t.mock.timers.setTime(new Date(`${date}T09:00:00Z`).getTime() + 86400000)
  const today = dailyWindow(f.config).date
  await f.service.tick(f.config)
  assert.equal((await SmartPlan.findOne({ where: { uuid: yesterday.plan_uuid } })).status, 'PAUSED')
  const current = (await sequelize.query('SELECT * FROM daily_automation_runs WHERE user_id=:id AND local_date=:date', {
    replacements: { id: f.user.id, date: today }, type: 'SELECT',
  }))[0]
  assert.equal(current.status, 'ANALYZING')
  // An unmodified old review is retired on the next tick, without touching today's plan.
  await SmartPlan.update({ status: 'REVIEW' }, { where: { uuid: yesterday.plan_uuid } })
  await f.service.tick(f.config)
  assert.equal((await SmartPlan.findOne({ where: { uuid: yesterday.plan_uuid } })).status, 'CANCELLED')
  assert.equal(f.calls.collect, 2)
})

test('a late full window keeps its unapproved plan for automatic approval', async (t) => {
  const date = new Date().toISOString().slice(0, 10)
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${date}T09:00:00Z`).getTime() })
  const f = await setup()
  f.config.requireFullWindow = true
  await f.service.tick(f.config)
  const run = await f.run()
  const { SmartCampaignService } = require('../dist/services/SmartCampaignService')
  const real = new SmartCampaignService({}, {}, {}, {}, {})
  f.smart.cancel = real.cancel.bind(real)
  t.mock.timers.setTime(new Date(`${date}T13:00:00Z`).getTime())
  await f.service.tick(f.config)
  assert.notEqual((await f.run()).status, 'EXPIRED')
  assert.notEqual((await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })).status, 'CANCELLED')
})

test('late run reconciles an already-approved operator plan as scheduled', async (t) => {
  const date = new Date().toISOString().slice(0, 10)
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${date}T09:00:00Z`).getTime() })
  const f = await setup()
  f.config.requireFullWindow = true
  await f.service.tick(f.config)
  const run = await f.run()
  await SmartPlan.update({ status: 'SCHEDULED' }, { where: { uuid: run.plan_uuid } })
  t.mock.timers.setTime(new Date(`${date}T13:00:00Z`).getTime())
  await f.service.tick(f.config)
  assert.equal((await f.run()).status, 'SCHEDULED')
  assert.equal((await f.run()).last_error, null)
})

test('approval crossing the last full-window minute expires and cancels without an attention dead end', async (t) => {
  const date = new Date().toISOString().slice(0, 10)
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${date}T09:00:00Z`).getTime() })
  const f = await setup()
  f.config.requireFullWindow = true
  await f.service.tick(f.config)
  const run = await f.run()
  await SmartPlan.update({ status: 'REVIEW', items: ['domestica', 'masculino'].flatMap(slug => Array.from({ length: 28 }, () => ({ state: 'SELECTED', audienceSlug: slug }))) }, { where: { uuid: run.plan_uuid } })
  const { SmartCampaignService } = require('../dist/services/SmartCampaignService')
  const { AppError } = require('../dist/middleware/Error/AppError')
  const real = new SmartCampaignService({}, {}, {}, {}, {})
  f.smart.cancel = real.cancel.bind(real)
  f.smart.approve = async () => {
    t.mock.timers.setTime(new Date(`${date}T12:59:00Z`).getTime())
    throw new AppError('Late approval', 409, 'LATE_ANALYSIS')
  }
  t.mock.timers.setTime(new Date(`${date}T12:57:00Z`).getTime())
  await f.service.tick(f.config)
  assert.equal((await f.run()).status, 'EXPIRED')
  assert.equal((await f.run()).last_error, 'LATE_ANALYSIS')
  const plan = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
  assert.equal(plan.status, 'CANCELLED')
  assert.equal(await real.processPendingAnalysis(plan.id), false)
})

test('real operator retry finishing near the capacity cutoff rejoins without SQL rearming or paid replay', async (t) => {
  const date = new Date().toISOString().slice(0, 10)
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${date}T09:00:00Z`).getTime() })
  const f = await setup()
  f.config.requireFullWindow = true
  const { SmartCampaignService } = require('../dist/services/SmartCampaignService')
  const offers = Array.from({ length: 60 }, (_, index) => ({ title: `${index < 30 ? 'Panela' : 'Barbeador'} ${index}`,
    productId: `MLB${91000000 + index}`, source: 'mercadolivre', currency: 'BRL', discountedPrice: 100, originalPrice: 150,
    commissioned: true, commissionedUrlStatus: 'generated_from_page_state', commissionRate: 10,
    affiliateUrl: `https://meli.la/retry-${index}`, extensionEvidence: { extractedAt: new Date().toISOString(),
      visibleSignals: { rating: 4.9, soldCount: 50000, bestSeller: true } } }))
  let fail = true, analysisCalls = 0
  const intelligence = { async analyze(products, slugs) {
    analysisCalls++
    if (fail) throw new Error('Simulated analysis failure')
    return products.map((offer, index) => ({ index, fits: slugs.map(slug => ({ slug,
      score: (offer.title.startsWith('Panela') === (slug === 'domestica')) ? 95 : 5,
      reason: 'Audience-specific use', category: 'cozinha', seasonalScore: 50 })), warnings: [] }))
  }, async standoutCopy() { assert.fail('Standout generation is disabled') } }
  const groups = new Map(['domestica', 'masculino'].map(slug => [`${slug}@g.us`, { id: `${slug}@g.us`, name: slug, size: 20, announceOnly: false }]))
  const smart = new SmartCampaignService({ parsePayloads() { return { offers, source: 'mercadolivre', totalSeen: offers.length, errors: [], duplicateCount: 0 } } },
    { async save(_user, values) { return values } }, intelligence, { async requireCurrentGroups() { return groups } },
    { async getConnectionScope() { return `retry-${f.user.id}` }, async requireConnectedContext() { return { scope: `retry-${f.user.id}`, creds: {} } } })
  const service = new DailyAutomationService(smart, f.collector)
  await service.tick(f.config)
  const run = await f.run()
  const plan = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
  await smart.processPendingAnalysis(plan.id)
  await plan.reload()
  assert.equal(plan.status, 'FAILED')
  t.mock.timers.setTime(new Date(`${date}T12:45:00Z`).getTime())
  await service.tick(f.config)
  assert.equal((await f.run()).status, 'ANALYSIS_HOLD')
  assert.equal((await f.run()).last_error, 'SMART_ANALYSIS_FAILED')
  const beforeRetry = analysisCalls
  await service.tick(f.config)
  assert.equal(analysisCalls, beforeRetry, 'Polling a hold must never start paid analysis')
  t.mock.timers.setTime(new Date(`${date}T12:46:00Z`).getTime())
  await smart.retryAnalysis(f.user.id, plan.uuid, plan.revision, randomUUID())
  fail = false
  t.mock.timers.setTime(new Date(`${date}T12:47:00Z`).getTime())
  await smart.processPendingAnalysis(plan.id)
  await plan.reload()
  for (const slug of ['domestica', 'masculino']) assert.equal(plan.items.filter(item => item.state === 'SELECTED' && item.audienceSlug === slug).length, 28, 'Qualified reserves must fill category-driven shortages')
  assert.ok(plan.items.some(item => item.warnings?.some(warning => /Diversidade de categorias flexibilizada/.test(warning))))
  await service.tick(f.config)
  assert.equal((await f.run()).status, 'SCHEDULED')
  assert.equal(await SmartSend.count({ where: { planId: plan.id } }), 56)
  assert.equal(f.calls.collect, 1)
})

test('automatic approval replaces novelty conflicts with qualified reserves instead of holding the day', async (t) => {
  const date = new Date().toISOString().slice(0, 10)
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${date}T10:05:00Z`).getTime() }) // 07:05 Sao Paulo
  const { SmartCampaignService } = require('../dist/services/SmartCampaignService')
  const f = await setup()
  const scope = `backfill-${f.user.id}`
  const audiences = await SmartAudience.findAll({ where: { userId: f.user.id } })
  const policies = Object.fromEntries(audiences.map(a => [a.slug, { ...a.policy, spreadAcrossWindow: true, windowEndBufferSeconds: 120,
    dailySelection: { minRating: 4.5, minSoldCount: 100, minFitScore: 80, minCommercialScore: 60 } }]))
  const item = (slug, audience, index, state, score) => ({
    id: randomUUID(), audienceSlug: slug, date, state, fitScore: 95, score, reason: 'Qualified daily item',
    category: `category-${index}`, warnings: [], standout: false, observedAt: new Date().toISOString(),
    product: { title: `${slug} ${index}`, productId: `MLB${93000000 + f.user.id * 10000 + audience * 1000 + index}`,
      source: 'mercadolivre', currency: 'BRL', discountedPrice: 100, originalPrice: 150, commissioned: true,
      commissionedUrlStatus: 'generated_from_page_state', commissionRate: 10, affiliateUrl: `https://meli.la/backfill-${f.user.id}-${slug}-${index}`,
      extensionEvidence: { extractedAt: new Date().toISOString(), visibleSignals: { rating: 4.9, soldCount: 50000 } } },
  })
  const items = ['domestica', 'masculino'].flatMap((slug, audience) => [0, 1, 2].map(index => item(slug, audience, index, 'SELECTED', 95 - index)))
  const repeatedReserve = item('domestica', 0, 3, 'RESERVE', 90)
  const replacement = item('domestica', 0, 4, 'RESERVE', 85)
  const weakReserve = { ...item('domestica', 0, 5, 'RESERVE', 99), fitScore: 72 }
  items.push(repeatedReserve, replacement, weakReserve)
  const plan = await SmartPlan.create({ userId: f.user.id, status: 'REVIEW', startDate: date, days: 1, timezone: f.config.timezone,
    audienceSlugs: ['domestica', 'masculino'], input: { requestId: randomUUID() }, items,
    settings: { audiences: policies, global: { campaignStartTime: '08:00' },
      dailyAutomation: { localDate: date, startTime: '08:00', endTime: '19:00', minimumItems: 3 } } })
  for (const repeated of [items[0], repeatedReserve]) {
    await ProductGroupDelivery.create({ userId: f.user.id, connectionScope: scope, groupId: 'other@g.us', groupName: 'Other',
      offerIdentity: `mercadolivre:${repeated.product.productId}`, offerSource: 'mercadolivre', offerProductId: repeated.product.productId,
      offerUrl: repeated.product.affiliateUrl, offerTitle: repeated.product.title, status: 'SENT', sentAt: new Date() })
  }
  const groups = new Map(['domestica', 'masculino'].map(slug => [`${slug}@g.us`, { id: `${slug}@g.us`, name: slug, size: 20, announceOnly: false }]))
  const connections = { async getConnectionScope() { return scope } }
  const smart = new SmartCampaignService({}, {}, {}, { async requireCurrentGroups() { return groups } }, connections)
  await smart.approve(f.user.id, plan.uuid, plan.revision, { automatic: true })
  await plan.reload()
  assert.equal(plan.status, 'SCHEDULED')
  const sends = await SmartSend.findAll({ where: { planId: plan.id } })
  const sentIds = slug => sends.filter(send => send.audienceSlug === slug).map(send => send.offer.productId).sort()
  assert.deepEqual(sentIds('domestica'), [items[1], items[2], replacement].map(entry => entry.product.productId).sort())
  assert.equal(sentIds('masculino').length, 3)
  const state = id => plan.items.find(entry => entry.id === id)
  assert.equal(state(items[0].id).state, 'RESERVE', 'The repeated product leaves the selection')
  assert.equal(state(repeatedReserve.id).state, 'RESERVE', 'A repeated reserve is never promoted')
  assert.equal(state(weakReserve.id).state, 'RESERVE', 'Reserves below the daily quality gates are never promoted')
  assert.equal(state(replacement.id).state, 'SELECTED')
  assert.ok(state(replacement.id).warnings.some(warning => warning.includes('promovida')))
})

test('operator and automatic approval accept a qualified partial day while early-start controls respect daily limits', async (t) => {
  const date = new Date().toISOString().slice(0, 10)
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${date}T10:05:00Z`).getTime() }) // 07:05 Sao Paulo
  const { SmartCampaignService } = require('../dist/services/SmartCampaignService')
  for (const mode of ['startNow', 'advance', 'reviewLate', 'cadenceLate']) {
    t.mock.timers.setTime(new Date(`${date}T${mode === 'reviewLate' ? '12:59' : mode === 'cadenceLate' ? '12:20' : '10:05'}:00Z`).getTime())
    const f = await setup()
    const audiences = await SmartAudience.findAll({ where: { userId: f.user.id } })
    const policies = Object.fromEntries(audiences.map(a => [a.slug, { ...a.policy, spreadAcrossWindow: true, windowEndBufferSeconds: 120,
      dailySelection: { minRating: 4.5, minSoldCount: 100, minFitScore: 80, minCommercialScore: 60 } }]))
    const count = mode === 'reviewLate' ? 27 : mode === 'cadenceLate' ? 29 : 5
    const items = ['domestica', 'masculino'].flatMap((slug, audience) => Array.from({ length: mode === 'cadenceLate' ? count + 1 : count }, (_, index) => ({
      id: randomUUID(), audienceSlug: slug, date, state: 'SELECTED', fitScore: 95, score: 95, reason: 'Qualified partial selection',
      category: `category-${index}`, warnings: [], standout: false, observedAt: new Date().toISOString(),
      product: { title: `${slug} ${index}`, productId: `MLB${92000000 + f.user.id * 10000 + audience * 1000 + index}`,
        source: 'mercadolivre', currency: 'BRL', discountedPrice: 100, originalPrice: 150, commissioned: true,
        commissionedUrlStatus: 'generated_from_page_state', commissionRate: 10, affiliateUrl: `https://meli.la/partial-${f.user.id}-${slug}-${index}`,
        extensionEvidence: { extractedAt: new Date().toISOString(), visibleSignals: { rating: 4.9, soldCount: 50000 } } },
    })))
    const duplicate = { ...structuredClone(items[0]), id: randomUUID(), audienceSlug: 'masculino' }
    duplicate.product.productId = duplicate.product.productId.replace('MLB', 'mlb-')
    duplicate.product.affiliateUrl += '-other-link'
    items.push(duplicate)
    const political = { ...structuredClone(items[0]), id: randomUUID(), state: 'REJECTED', political: true }
    const weak = { ...structuredClone(items[0]), id: randomUUID(), state: 'RESERVE', fitScore: 72 }
    items.push(political, weak)
    const plan = await SmartPlan.create({ userId: f.user.id, status: 'REVIEW', startDate: date, days: 1, timezone: f.config.timezone,
      audienceSlugs: ['domestica', 'masculino'], input: { requestId: randomUUID() }, items,
      settings: { audiences: policies, global: { campaignStartTime: '09:00', startNow: mode === 'startNow' },
        dailyAutomation: { localDate: date, startTime: '08:00', endTime: '19:00', minimumItems: 28 } } })
    const groups = new Map(['domestica', 'masculino'].map(slug => [`${slug}@g.us`, { id: `${slug}@g.us`, name: slug, size: 20, announceOnly: false }]))
    const groupService = { async requireCurrentGroups() { return groups } }
    const connections = { async getConnectionScope() { return `partial-${f.user.id}` }, async requireConnectedContext() { return { scope: `partial-${f.user.id}`, creds: { baseUrl: 'https://unused.invalid', token: 'fixture' } } } }
    const smart = new SmartCampaignService({}, {}, {}, groupService, connections)
    if (mode === 'startNow') {
      const incomplete = await SmartPlan.create({ userId: f.user.id, status: 'REVIEW', startDate: date, days: 1, timezone: f.config.timezone,
        audienceSlugs: ['domestica', 'masculino'], input: { requestId: randomUUID() }, items: items.filter(item => item.state === 'SELECTED' && item.audienceSlug === 'domestica'),
        settings: { ...structuredClone(plan.settings), dailyAutomation: { ...plan.settings.dailyAutomation, minimumItems: 1 } } })
      await smart.cancel(f.user.id, incomplete.uuid, incomplete.revision)
      const originalGroups = groupService.requireCurrentGroups
      for (const race of ['overlap', 'swap']) {
        groupService.requireCurrentGroups = async () => {
          await SmartAudience.update({ destinations: race === 'overlap'
            ? [{ groupId: 'domestica@g.us', groupName: 'domestica' }, { groupId: 'masculino@g.us', groupName: 'masculino' }]
            : [{ groupId: 'masculino@g.us', groupName: 'masculino' }] }, { where: { userId: f.user.id, slug: 'domestica' } })
          if (race === 'swap') await SmartAudience.update({ destinations: [{ groupId: 'domestica@g.us', groupName: 'domestica' }] }, { where: { userId: f.user.id, slug: 'masculino' } })
          return groups
        }
        await assert.rejects(smart.approve(f.user.id, plan.uuid, plan.revision), { code: 'SMART_BINDINGS_CHANGED' }, `${race} must not preserve approval merely because the combined group set is unchanged`)
        await plan.reload()
        assert.equal(plan.status, 'REVIEW')
        assert.equal(await SmartSend.count({ where: { planId: plan.id } }), 0)
        for (const audience of audiences) await SmartAudience.update({ destinations: audience.destinations }, { where: { id: audience.id } })
      }
      groupService.requireCurrentGroups = originalGroups
    }
    for (const item of [political, weak]) await assert.rejects(smart.updatePlan(f.user.id, plan.uuid, { revision: plan.revision, items: [{ id: item.id, state: 'SELECTED' }] }), /não pode ser selecionado/)
    await smart.updatePlan(f.user.id, plan.uuid, { revision: plan.revision, campaignStartTime: '08:00', items: [] })
    await plan.reload()
    if (mode === 'startNow') {
      const edited = plan.items.find(item => item.state === 'SELECTED' && item.audienceSlug === 'domestica')
      await smart.updatePlan(f.user.id, plan.uuid, { revision: plan.revision, items: [{ id: edited.id, state: 'RESERVE' }] })
      await plan.reload()
      assert.equal(plan.items.find(item => item.id === edited.id).scheduledAt, undefined, 'Deselected items lose preview slots')
      const remaining = plan.items.filter(item => item.state === 'SELECTED' && item.audienceSlug === 'domestica')
      assert.equal(remaining.at(-1).scheduledAt, `${date}T12:15:00.000Z`, 'Item-only edits recompute slots and preserve the maximum gap for a partial day')
      await smart.updatePlan(f.user.id, plan.uuid, { revision: plan.revision, items: [{ id: edited.id, state: 'SELECTED' }] })
      await plan.reload()
      assert.ok(plan.items.find(item => item.id === edited.id).scheduledAt, 'Promoted items receive preview slots')
      await smart.updatePlan(f.user.id, plan.uuid, { revision: plan.revision, campaignStartTime: '10:00', startNow: false, items: [] })
      await plan.reload()
      assert.equal(plan.items.find(item => item.state === 'SELECTED').scheduledAt, `${date}T13:00:00.000Z`)
      await smart.updatePlan(f.user.id, plan.uuid, { revision: plan.revision, startNow: true, items: [] })
      await plan.reload()
      assert.equal(plan.items.find(item => item.state === 'SELECTED').scheduledAt, `${date}T11:00:00.000Z`, 'Toggling immediate start refreshes the preview within the daily floor')
      await smart.updatePlan(f.user.id, plan.uuid, { revision: plan.revision, startNow: false, items: [] })
      await plan.reload()
      assert.equal(plan.items.find(item => item.state === 'SELECTED').scheduledAt, `${date}T13:00:00.000Z`)
      await smart.updatePlan(f.user.id, plan.uuid, { revision: plan.revision, campaignStartTime: '08:00', items: [] })
      await plan.reload()
      const stale = await SmartPlan.create({ userId: f.user.id, status: 'REVIEW', startDate: date, days: 1, timezone: f.config.timezone,
        audienceSlugs: ['domestica'], input: { requestId: randomUUID() }, settings: structuredClone(plan.settings),
        items: [{ ...structuredClone(plan.items.find(item => item.state === 'SELECTED')), observedAt: new Date(Date.now() - 25 * 3600000).toISOString() }] })
      await assert.rejects(smart.updatePlan(f.user.id, stale.uuid, { revision: stale.revision, campaignStartTime: '08:00', items: [] }), /Atualize a evidência/)
      await smart.cancel(f.user.id, stale.uuid, stale.revision)
      const yesterday = new Date(new Date(`${date}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10)
      const multi = await SmartPlan.create({ userId: f.user.id, status: 'REVIEW', startDate: yesterday, days: 2, timezone: f.config.timezone,
        audienceSlugs: ['domestica'], input: {}, settings: { audiences: { domestica: policies.domestica }, global: { startNow: true } },
        items: [{ ...structuredClone(plan.items.find(item => item.state === 'SELECTED')), date: yesterday }] })
      await smart.updatePlan(f.user.id, multi.uuid, { revision: multi.revision, items: [{ id: multi.items[0].id, date }] })
      await multi.reload()
      assert.equal(multi.items[0].date, date, 'An old immediate-start flag must not prevent moving manual items to today')
      await assert.rejects(smart.updatePlan(f.user.id, multi.uuid, { revision: multi.revision, startNow: true, items: [] }), /apenas para hoje/)
      await smart.cancel(f.user.id, multi.uuid, multi.revision)
    }
    if (mode === 'advance') {
      await smart.updatePlan(f.user.id, plan.uuid, { revision: plan.revision, campaignStartTime: '09:00', items: [] })
      await plan.reload()
    }
    await smart.approve(f.user.id, plan.uuid, plan.revision, { automatic: mode === 'cadenceLate' || mode === 'reviewLate' })
    if (mode === 'advance') {
      await plan.reload()
      await smart.advance(f.user.id, plan.uuid, plan.revision)
    }
    const sends = await SmartSend.findAll({ where: { planId: plan.id }, order: [['scheduledAt', 'ASC']] })
    assert.equal(sends.length, count * 2)
    assert.equal(sends[0].scheduledAt.toISOString(), `${date}T${mode === 'reviewLate' ? '12:59' : mode === 'cadenceLate' ? '12:20' : '11:00'}:00.000Z`)
    await plan.reload()
    assert.equal(plan.items.find(item => item.id === duplicate.id).state, 'RESERVE')
    assert.ok(sends.every(send => send.scheduledAt >= new Date(`${date}T11:00:00Z`) && send.scheduledAt < new Date(`${date}T22:00:00Z`)))
    if (mode === 'cadenceLate') {
      const { SmartCampaignSender } = require('../dist/services/SmartCampaignSender')
      const accepted = async () => {
        t.mock.timers.setTime(Date.now() + 5000) // five seconds of provider latency
        return { id: randomUUID(), status: 'sent' }
      }
      const sender = new SmartCampaignSender({ sendText: accepted, sendMedia: accepted }, connections, groupService, { now: () => new Date() })
      let ticks = 0
      for (; ticks < 200; ticks++) {
        const next = await SmartSend.findOne({ where: { planId: plan.id, status: 'PENDING' }, order: [['scheduledAt', 'ASC']] })
        if (!next) break
        const poll = Math.ceil(Math.max(Date.now() + 1, next.scheduledAt.getTime()) / 30000) * 30000
        t.mock.timers.setTime(poll)
        await sender.processDue()
      }
      assert.ok(ticks < 200, 'Late-cycle polling must converge')
      const delivered = await SmartSend.findAll({ where: { planId: plan.id }, order: [['sentAt', 'ASC']] })
      assert.equal(delivered.filter(send => send.status === 'SENT').length, 58, 'Thirty-second polling with five-second acceptance latency should deliver the approved late cycle')
      assert.ok(delivered.every(send => send.sentAt < new Date(`${date}T22:00:00Z`)))
      for (const slug of ['domestica', 'masculino']) {
        const audience = delivered.filter(send => send.audienceSlug === slug)
        for (let i = 1; i < audience.length; i++) assert.ok(audience[i].sentAt - audience[i - 1].sentAt >= 1200000 && audience[i].sentAt - audience[i - 1].sentAt <= 1500000)
      }
    }
    await plan.reload()
    if (plan.status === 'SCHEDULED' && mode !== 'cadenceLate') await smart.cancel(f.user.id, plan.uuid, plan.revision)
  }
})

test('real daily collection-to-approval-to-sender honors late capacity and catches another plan after collection', async (t) => {
  const date = new Date().toISOString().slice(0, 10)
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${date}T09:00:00Z`).getTime() }) // 06:00 Sao Paulo
  const f = await setup()
  f.config.requireFullWindow = true
  f.config.candidateLimit = 30 // Exhausted collection budget exercises the qualified-remainder fallback.
  const { SmartCampaignService } = require('../dist/services/SmartCampaignService')
  const { OfferImportService } = require('../dist/services/OfferImportService')
  const { SmartCampaignSender } = require('../dist/services/SmartCampaignSender')
  const scope = `daily-real-${f.user.id}`
  const groups = new Map(['domestica', 'masculino'].map(slug => [`${slug}@g.us`, { id: `${slug}@g.us`, name: slug, size: 20, announceOnly: false }]))
  const groupService = { async requireCurrentGroups() { return groups } }
  const connections = { async getConnectionScope() { return scope }, async requireConnectedContext() { return { scope, creds: { baseUrl: 'https://unused.invalid', token: 'fixture' } } } }
  const intelligence = {
    async analyze(offers, slugs) { return offers.map((offer, index) => ({ index,
      fits: slugs.map(slug => ({ slug, score: 95, reason: 'Strong actual-use fit', category: `category-${Number(offer.productId.slice(-2)) % 5}`, seasonalScore: 50 })), warnings: [], shortCaption: 'PRATICIDADE NA SUA ROTINA' })) },
    async standoutCopy() { assert.fail('Standout-copy calls default off') },
  }
  const smart = new SmartCampaignService(new OfferImportService(), { async save(_user, offers) { return offers } }, intelligence, groupService, connections)
  const create = smart.createPlan.bind(smart)
  smart.createPlan = async (...args) => {
    const result = await create(...args)
    const created = await SmartPlan.findOne({ where: { uuid: result.id } })
    assert.equal(created.settings.dailyAutomation.localDate, dailyWindow(f.config).date, 'The envelope exists before createPlan returns')
    return result
  }
  const collector = { async collect() { return ['domestica', 'masculino'].map((slug, audience) => ({ name: `${slug}.json`, targetAudienceSlug: slug, json: {
    schemaVersion: 1, sourceUrl: 'https://www.mercadolivre.com.br/afiliados/hub', extractedAt: new Date().toISOString(), cards: Array.from({ length: 30 }, (_, index) => {
      const id = `MLB${81000000 + audience * 10000 + index}`
      return { productId: id, title: `${audience ? 'Barbeador' : 'Panela'} QA ${index}`, productUrl: `https://www.mercadolivre.com.br/p/${id}`,
        commissionedUrl: `https://meli.la/daily-${id}`, commissionedUrlStatus: 'generated_from_page_state',
        visible: { text: 'MAIS VENDIDO. Classificação 4.9 de 5 estrelas. +50mil vendidos. GANHOS 10%', commissionPercent: '10%', pricing: { currentAmount: 100, originalAmount: 150, currency: 'BRL' } } }
    }),
  } })) } }
  const service = new DailyAutomationService(smart, collector)
  await service.tick(f.config)
  const run = await f.run()
  const pending = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
  assert.equal(pending.settings.dailyAutomation.runId, run.id, 'Daily marker is committed with plan creation')
  assert.equal(await smart.processPendingAnalysis(pending.id), true)
  await pending.reload()
  const conflicting = pending.items.find(item => item.state === 'SELECTED' && item.audienceSlug === 'domestica')
  await ProductGroupDelivery.create({ userId: f.user.id, connectionScope: scope, groupId: 'other@g.us', groupName: 'Other',
    offerIdentity: `mercadolivre:${conflicting.product.productId}`, offerSource: 'mercadolivre', offerProductId: conflicting.product.productId,
    offerUrl: conflicting.product.affiliateUrl, offerTitle: conflicting.product.title, status: 'SENT', sentAt: new Date() })
  // Actual approval (not a stub) after the old mismatch's failure window.
  t.mock.timers.setTime(new Date(`${date}T12:20:00Z`).getTime()) // 09:20
  await service.tick(f.config)
  assert.equal((await f.run()).status, 'SCHEDULED')
  const rows = await SmartSend.findAll({ where: { planId: pending.id }, order: [['scheduledAt', 'ASC']] })
  assert.equal(rows.length, 58) // capacity trims 30 to 29 per audience
  assert.ok(rows.every(row => row.messageIntro === 'PRATICIDADE NA SUA ROTINA'), 'Classification copy reaches queued daily sends without standout calls')
  assert.ok(rows.every(row => row.offer.productId !== conflicting.product.productId))
  await pending.reload()
  assert.equal(pending.items.find(item => item.id === conflicting.id).state, 'RESERVE')
  assert.ok(rows.every(row => row.scheduledAt >= new Date(`${date}T12:20:00Z`) && row.scheduledAt < new Date(`${date}T22:00:00Z`)))
  let calls = 0
  const provider = { async sendText(_creds, request) { assert.doesNotMatch(request.text, /Preço consultado em|Confira o valor atual no link/); calls++; return { id: randomUUID(), status: 'sent' } }, async sendMedia() { calls++; return { id: randomUUID(), status: 'sent' } } }
  const sender = new SmartCampaignSender(provider, connections, groupService, { now: () => new Date() })
  const first = rows[0]
  // A different plan delivers after daily collection/approval, before dispatch.
  await ProductGroupDelivery.create({ userId: f.user.id, connectionScope: scope, groupId: 'other@g.us', groupName: 'Other',
    offerIdentity: first.offerIdentity, offerSource: 'mercadolivre', offerProductId: first.offer.productId,
    offerUrl: first.offer.affiliateUrl, offerTitle: first.offer.title, status: 'SENT', sentAt: new Date() })
  const result = await sender.processDue()
  await first.reload()
  assert.equal(first.status, 'SKIPPED', JSON.stringify({ result, status: first.status, lastError: first.lastError }))
  assert.ok(result.skipped >= 1)
  assert.equal(calls, 1) // only the other audience's first product was sent
  assert.equal(await ProductGroupDelivery.count({ where: { userId: f.user.id, planUuid: pending.uuid, status: 'SENT' } }), 1)
  await pending.reload()
  const duplicatePlan = await SmartPlan.create({ userId: f.user.id, status: 'REVIEW', startDate: pending.startDate, days: 1,
    timezone: pending.timezone, audienceSlugs: pending.audienceSlugs, settings: structuredClone(pending.settings),
    input: { requestId: randomUUID() }, items: structuredClone(pending.items) })
  await assert.rejects(smart.approve(f.user.id, duplicatePlan.uuid, duplicatePlan.revision), { code: 'DAILY_NOVELTY_CONFLICT' })
  assert.equal(await SmartSend.count({ where: { planId: duplicatePlan.id } }), 0)

  // End-of-day cadence collision must finish today, not hold a slot overnight.
  const accepted = await SmartSend.findOne({ where: { planId: pending.id, status: 'SENT' } })
  const deferred = await SmartSend.findOne({ where: { planId: pending.id, groupId: accepted.groupId, status: 'PENDING' } })
  await SmartSend.update({ status: 'SKIPPED' }, { where: { planId: pending.id, status: 'PENDING', id: { [Op.ne]: deferred.id } } })
  await accepted.update({ sentAt: new Date(`${date}T21:42:00Z`) })
  // This observation would still be fresh tomorrow at 09:00, reproducing the
  // old overnight-reservation defect rather than relying on age expiry.
  await deferred.update({ evidenceObservedAt: new Date(`${date}T13:05:00Z`) })
  t.mock.timers.setTime(new Date(`${date}T21:50:00Z`).getTime())
  const lateResult = await sender.processDue()
  await deferred.reload()
  await pending.reload()
  assert.equal(deferred.status, 'SKIPPED')
  assert.equal(deferred.localDate, date)
  assert.equal(lateResult.sent, 0)
  assert.equal(calls, 1)
  assert.equal(pending.status, 'COMPLETED')
})

test('daily UNKNOWN retry outside the envelope preserves its no-repeat ledger', async (t) => {
  const date='2026-11-09'
  t.mock.timers.enable({apis:['Date'],now:new Date(`${date}T21:43:00Z`).getTime()})
  const f=await setup()
  const {SmartCampaignService}=require('../dist/services/SmartCampaignService')
  const {offerIdentity}=require('../dist/utils/offerIdentity')
  const audience=await SmartAudience.findOne({where:{userId:f.user.id,slug:'domestica'}})
  const plan=await SmartPlan.create({userId:f.user.id,status:'PAUSED',startDate:date,days:1,timezone:f.config.timezone,audienceSlugs:['domestica'],input:{},items:[],settings:{audiences:{domestica:audience.policy},dailyAutomation:{localDate:date,startTime:'08:00',endTime:'19:00'}}})
  const product={title:'Panela QA',source:'mercadolivre',productId:'MLB987654321',currency:'BRL',discountedPrice:100,affiliateUrl:'https://meli.la/unknown-qa'}
  const send=await SmartSend.create({userId:f.user.id,planId:plan.id,audienceSlug:'domestica',groupId:'domestica@g.us',groupName:'domestica',connectionScope:'daily-unknown-qa',offerIdentity:offerIdentity(product),offer:product,scheduledAt:new Date(`${date}T21:38:00Z`),localDate:date,timezone:f.config.timezone,evidenceObservedAt:new Date(`${date}T09:00:00Z`),status:'UNKNOWN',attempts:1})
  const ledger=await ProductGroupDelivery.create({userId:f.user.id,connectionScope:send.connectionScope,offerIdentity:send.offerIdentity,offerSource:'mercadolivre',offerProductId:product.productId,offerUrl:product.affiliateUrl,offerTitle:product.title,groupId:send.groupId,groupName:send.groupName,campaignId:null,planUuid:plan.uuid,status:'SENDING'})
  const old=new Date(`${date}T21:30:00Z`)
  await sequelize.query('UPDATE smart_sends SET updated_at=:old WHERE id=:id',{replacements:{id:send.id,old}})
  await sequelize.query('UPDATE product_group_deliveries SET heartbeat_at=:old WHERE id=:id',{replacements:{id:ledger.id,old}})
  const smart=new SmartCampaignService({}, {}, {}, {}, {async getConnectionScope(){return send.connectionScope}})
  for(const instant of [`${date}T21:43:00Z`,'2026-11-10T08:30:00Z']) {
    t.mock.timers.setTime(new Date(instant).getTime())
    await assert.rejects(smart.resolveUnknown(f.user.id,send.uuid,'retry'),{code:'DAILY_RETRY_OUTSIDE_WINDOW'})
    assert.equal((await send.reload()).status,'UNKNOWN')
    assert.equal((await ledger.reload()).status,'SENDING')
  }
  await smart.resolveUnknown(f.user.id,send.uuid,'skip')
  assert.equal((await ledger.reload()).status,'SENT','Explicit skip conservatively retains the duplicate barrier')
})

test('D+1 freezes tomorrow target and resumes it before replacement startup eligibility', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T22:00:00Z').getTime() })
  const f = await setup()
  f.config = DailyAutomationConfigSchema.parse({ userId: f.user.id, autoApprove: false })
  await f.service.tick(f.config)
  const run = await f.run()
  assert.equal(run.local_date, '2026-11-10')
  assert.equal(run.request_id, dailyRequestId(f.user.id, '2026-11-10'))
  const plan = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
  assert.equal(plan.startDate, '2026-11-10')
  t.mock.timers.setTime(new Date('2026-11-10T10:00:00Z').getTime())
  const replacement = DailyAutomationConfigSchema.parse({ userId: f.user.id, collectTime: '21:00' })
  await new DailyAutomationService(f.smart, f.collector).tick(replacement)
  assert.equal((await f.run()).local_date, '2026-11-10')
  assert.equal((await f.run()).config.collectTime, '19:00')
  assert.equal(f.calls.collect, 1)
})

test('D+1 replenishment checkpoints round payloads and reuses append identity after failure', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T22:00:00Z').getTime() })
  const f = await setup()
  f.config = DailyAutomationConfigSchema.parse({ userId: f.user.id })
  await f.service.tick(f.config)
  const run = await f.run()
  const plan = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
  await plan.update({ status: 'REVIEW', items: [] })
  const requestIds = []
  f.smart.appendDailyProducts = async (_user, _uuid, _revision, payloads, requestId) => {
    requestIds.push(requestId)
    assert.equal(payloads.length, 2)
    if (requestIds.length === 1) throw new Error('simulated lost response')
    await plan.update({ status: 'ANALYZING' })
  }
  let collections = 0
  f.collector.collect = async requests => {
    collections++
    assert.ok(requests.every(r => r.options.limit <= 50 && r.options.keywords.length <= 50))
    assert.ok(requests.every(r => r.options.excludeProductIds.includes('MLB12345670')))
    return f.payloads.map((p, i) => ({ ...p, json: { ...p.json, cards: [{ productId: `MLB9999999${i}` }] } }))
  }
  await f.service.tick(f.config)
  assert.equal((await f.run()).status, 'RETRY')
  await sequelize.query('UPDATE daily_automation_runs SET next_attempt_at=NOW() WHERE id=:id', { replacements: { id: run.id } })
  await f.service.tick(f.config)
  assert.equal(collections, 1)
  assert.equal(requestIds.length, 2)
  assert.equal(requestIds[0], requestIds[1])
  assert.equal((await f.run()).discovery_state.round, 2)
})

test('empty D+1 discovery advances only missing audience keyword pages without paid work', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T22:00:00Z').getTime() })
  const f = await setup()
  f.config = DailyAutomationConfigSchema.parse({ userId: f.user.id })
  const pages = []
  f.collector.collect = async requests => {
    pages.push(requests.map(r => ({ slug: r.slug, keywords: r.options.keywords })))
    return requests.map(r => r.slug === 'domestica' ? f.payloads[0] : { ...f.payloads[1], json: { cards: [] } })
  }
  await f.service.tick(f.config)
  const run = await f.run()
  assert.equal(run.discovery_state.initialRounds.masculino, 1)
  assert.equal(run.discovery_state.initialRounds.domestica, undefined)
  assert.equal(f.calls.create, 0)
  await sequelize.query('UPDATE daily_automation_runs SET next_attempt_at=NOW() WHERE id=:id', { replacements: { id: run.id } })
  await f.service.tick(f.config)
  assert.deepEqual(pages[1].map(r => r.slug), ['masculino'])
  assert.notDeepEqual(pages[0][1].keywords, pages[1][0].keywords)
  assert.equal((await f.run()).discovery_state.initialRounds.masculino, 2)
  assert.equal(f.calls.create, 0)
})

test('stale fenced saves produce no alert and alert persistence cannot derail a durable save', async () => {
  const f = await setup()
  await f.service.tick(f.config)
  const run = await f.run()
  let alerts = 0
  const service = new DailyAutomationService(f.smart, f.collector, { async enqueue() { alerts++; throw new Error('private error') } })
  await service.save({ ...run, lease_token: randomUUID() }, 'FAILED', 'PIPELINE_FAILED')
  assert.equal(alerts, 0)
  const token = randomUUID()
  await sequelize.query('UPDATE daily_automation_runs SET lease_token=:token WHERE id=:id', { replacements: { id: run.id, token } })
  await service.save({ ...run, lease_token: token }, 'FAILED', 'PIPELINE_FAILED')
  assert.equal(alerts, 1)
  assert.equal((await f.run()).status, 'FAILED')
  assert.equal((await f.run()).lease_token, null)
})

test('D+1 ready preview still automatically approves after its first target slot', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T22:00:00Z').getTime() })
  const f = await setup()
  f.config = DailyAutomationConfigSchema.parse({ userId: f.user.id, autoApprove: true })
  await f.service.tick(f.config)
  const run = await f.run()
  const { buildSmartSchedule } = require('../dist/services/SmartCampaignService')
  const slots = buildSmartSchedule(run.local_date, 30, { startTime: '08:00', endTime: '19:00', timezone: f.config.timezone,
    minGapSeconds: 1200, maxGapSeconds: 1500, dailyCap: 30, spreadAcrossWindow: true, windowEndBufferSeconds: 120 }, 'deadline')
  const items = ['domestica', 'masculino'].flatMap(audienceSlug => slots.map(slot => ({ state: 'SELECTED', audienceSlug, scheduledAt: slot.toISOString() })))
  await SmartPlan.update({ status: 'REVIEW', items }, { where: { uuid: run.plan_uuid } })
  t.mock.timers.setTime(new Date('2026-11-10T11:15:00Z').getTime())
  await f.service.tick(f.config)
  assert.equal((await f.run()).status, 'SCHEDULED')
  assert.equal(f.calls.approve, 1)
  assert.equal(f.calls.collect, 1)
  assert.equal((await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })).status, 'SCHEDULED')
})

function noveltyOffer(index, slug = 'domestica') {
  return { title: `${slug} QA ${index}`, productId: `MLB${97000000 + index}`, source: 'mercadolivre', currency: 'BRL',
    discountedPrice: 100, originalPrice: 150, commissioned: true, commissionedUrlStatus: 'generated_from_page_state', commissionRate: 10,
    affiliateUrl: `https://meli.la/novelty-${index}`, extensionEvidence: { extractedAt: new Date().toISOString(),
      visibleSignals: { rating: 4.9, soldCount: 50000, bestSeller: true } } }
}

async function noveltySend(userId, plan, offer, status = 'PENDING', extra = {}) {
  const { offerIdentity } = require('../dist/utils/offerIdentity')
  return SmartSend.create({ userId, planId: plan.id, audienceSlug: 'domestica', groupId: 'history@g.us', groupName: 'History',
    connectionScope: 'another-connection', offerIdentity: offerIdentity(offer), offer, status, scheduledAt: new Date(),
    localDate: plan.startDate, timezone: plan.timezone, evidenceObservedAt: new Date(), ...extra })
}

async function noveltyDelivery(userId, offer, extra = {}) {
  const { offerIdentity } = require('../dist/utils/offerIdentity')
  return ProductGroupDelivery.create({ userId, connectionScope: 'old-connection', groupId: 'history@g.us', groupName: 'History',
    offerIdentity: offerIdentity(offer), offerSource: offer.source, offerProductId: offer.productId,
    offerUrl: offer.affiliateUrl, offerTitle: offer.title, status: 'SENDING', ...extra })
}

test('daily novelty-aware analysis fills both audiences without history or identity-alias duplicates in one batch', async () => {
  const f = await setup()
  const { SmartCampaignService } = require('../dist/services/SmartCampaignService')
  const offers = Array.from({ length: 20 }, (_, index) => noveltyOffer(index, index % 2 ? 'masculino' : 'domestica'))
  const history = await SmartPlan.create({ userId: f.user.id, status: 'COMPLETED', startDate: dailyWindow(f.config).date, days: 1,
    timezone: f.config.timezone, audienceSlugs: ['domestica'], input: {}, settings: {}, items: [] })
  for (const [index, status] of ['PENDING', 'SENDING', 'SENT', 'UNKNOWN'].entries()) {
    await noveltySend(f.user.id, history, { ...offers[index], source: ' MercadoLivre ', productId: ` mlb - ${97000000 + index} ` }, status)
  }
  offers[4].savedProductId = 123456
  await noveltyDelivery(f.user.id, offers[4], { offerSource: null, offerProductId: null })
  offers[5].savedProductId = 123457
  await noveltyDelivery(f.user.id, { ...offers[5], savedProductId: undefined }, { offerSource: null, offerProductId: null, status: 'SENT' })
  offers[7].productId = ' mlb - 97000006 '
  offers[8].savedProductId = 123458
  offers[9].savedProductId = 123458
  await noveltySend(f.user.id, history, offers[10], 'FAILED')
  await noveltySend(f.user.id, history, offers[11], 'SKIPPED')
  const intelligence = { async analyze(products, slugs) {
    return products.map((offer, index) => ({ index, political: false, fits: slugs.map(slug => ({ slug,
      score: offer.title.startsWith(slug) ? 100 - Number(offer.title.split(' ').at(-1)) : 5, category: 'utilidades', reason: 'Relevant daily use', seasonalScore: 50 })), warnings: [] }))
  }, async standoutCopy() { assert.fail('No standout copy') } }
  const smart = new SmartCampaignService({ parsePayloads() { return { offers, source: 'mercadolivre', errors: [], totalSeen: offers.length } } },
    { async save(_user, values) { return values } }, intelligence, {}, {})
  const created = await smart.createPlan(f.user.id, { requestId: randomUUID(), date: history.startDate, days: 1,
    audienceSlugs: ['domestica', 'masculino'], payloads: [{ name: 'fixture', json: {} }], campaignStartTime: '08:00',
    settings: { dailyCap: 4, maxStandouts: 0, excludePolitical: true,
      dailySelection: { minRating: 4.5, minSoldCount: 100, minFitScore: 80, minCommercialScore: 60 } },
  }, { runId: randomUUID(), localDate: history.startDate, startTime: '08:00', endTime: '19:00', minimumItems: 4 })
  const plan = await SmartPlan.findOne({ where: { uuid: created.id } })
  // Own-plan reservations/deliveries never consume this plan's novelty inventory.
  await noveltySend(f.user.id, plan, offers[12])
  await noveltyDelivery(f.user.id, offers[13], { planUuid: plan.uuid })
  const query = sequelize.query.bind(sequelize)
  let historyQueries = 0
  sequelize.query = (sql, ...args) => {
    if (typeof sql === 'string' && /product_group_deliveries/.test(sql)) historyQueries++
    return query(sql, ...args)
  }
  try { await smart.processPendingAnalysis(plan.id) } finally { sequelize.query = query }
  await plan.reload()
  assert.equal(plan.status, 'REVIEW')
  const selected = plan.items.filter(item => item.state === 'SELECTED')
  assert.ok(selected.every(item => !offers.slice(0, 6).some(offer => offer.productId === item.product.productId)), 'History conflicts must leave selection before approval')
  for (const index of [6, 8, 10, 11, 12, 13]) assert.ok(selected.some(item => item.product.affiliateUrl === offers[index].affiliateUrl))
  for (const index of [7, 9]) assert.ok(!selected.some(item => item.product.affiliateUrl === offers[index].affiliateUrl), 'Aliased duplicates must yield their slots to the next qualified candidates')
  const { dailyOfferAliases } = require('../dist/services/dailyNovelty')
  const identities = selected.flatMap(item => dailyOfferAliases(item.product))
  assert.equal(identities.length, new Set(identities).size, 'Normalized product and saved-product aliases dedupe across audiences')
  for (const slug of ['domestica', 'masculino']) assert.equal(selected.filter(item => item.audienceSlug === slug).length, 4)
  assert.equal(historyQueries, 1, 'Selection uses one set-based novelty query for the whole candidate pool')
})

test('daily novelty readiness rechecks later reservations and replenishes only the effectively short audience', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T22:00:00Z').getTime() })
  const f = await setup()
  f.config = DailyAutomationConfigSchema.parse({ userId: f.user.id, autoApprove: true })
  await f.service.tick(f.config)
  const run = await f.run()
  const plan = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
  const { buildSmartSchedule } = require('../dist/services/SmartCampaignService')
  const items = ['domestica', 'masculino'].flatMap((slug, audience) => {
    const slots = buildSmartSchedule(run.local_date, 30, { ...f.config, minGapSeconds: 1200, maxGapSeconds: 1500, spreadAcrossWindow: true, windowEndBufferSeconds: 120 }, slug)
    return slots.map((slot, index) => ({ id: `${slug}:${index}`, state: 'SELECTED', audienceSlug: slug, product: noveltyOffer(audience * 100 + index, slug), scheduledAt: slot.toISOString() }))
  })
  await plan.update({ status: 'REVIEW', items })
  const other = await SmartPlan.create({ userId: f.user.id, status: 'COMPLETED', startDate: run.local_date, days: 1,
    timezone: f.config.timezone, audienceSlugs: ['domestica'], input: {}, settings: {}, items: [] })
  await noveltySend(f.user.id, other, items[0].product, 'UNKNOWN')
  const appended = []
  f.smart.appendDailyProducts = async (_user, _uuid, _revision, payloads) => { appended.push(...payloads); await plan.update({ status: 'ANALYZING' }) }
  f.collector.collect = async requests => {
    f.calls.collect++
    assert.deepEqual(requests.map(r => r.slug), ['domestica'])
    assert.ok(requests[0].options.excludeProductIds.includes(items[0].product.productId))
    return [{ ...f.payloads[0], json: { cards: [{ productId: 'MLB99999991' }] } }]
  }
  await f.service.tick(f.config)
  assert.equal(f.calls.approve, 0, 'A raw 30/30 plan with a new reservation must replenish before approval')
  assert.equal(f.calls.collect, 2)
  assert.equal(appended.length, 1)
  assert.equal((await f.run()).status, 'ANALYZING')
})

test('daily novelty readiness detects cross-audience aliases even without external history', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T22:00:00Z').getTime() })
  const f = await setup()
  f.config = DailyAutomationConfigSchema.parse({ userId: f.user.id, autoApprove: true, requireFullWindow: false })
  await f.service.tick(f.config)
  const run = await f.run()
  const plan = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
  await plan.update({ status: 'REVIEW', items: ['domestica', 'masculino'].map((slug, index) => ({ state: 'SELECTED', audienceSlug: slug,
    product: { ...noveltyOffer(1, slug), productId: index ? ' mlb - 97000001 ' : 'MLB97000001' } })) })
  f.collector.collect = async requests => {
    assert.deepEqual(requests.map(r => r.slug), ['masculino'])
    return [{ ...f.payloads[1], json: { cards: [{ productId: 'MLB99999992' }] } }]
  }
  f.smart.appendDailyProducts = async () => plan.update({ status: 'ANALYZING' })
  await f.service.tick(f.config)
  assert.equal(f.calls.approve, 0)
  assert.equal((await f.run()).status, 'ANALYZING')
})

test('daily novelty collection excludes all active history and post-filters URL identities before paid planning', async () => {
  const f = await setup()
  const history = await SmartPlan.create({ userId: f.user.id, status: 'COMPLETED', startDate: dailyWindow(f.config).date, days: 1,
    timezone: f.config.timezone, audienceSlugs: ['domestica'], input: {}, settings: {}, items: [] })
  const blocked = []
  for (const [index, status] of ['PENDING', 'SENDING', 'SENT', 'UNKNOWN', 'FAILED', 'SKIPPED'].entries()) {
    const offer = noveltyOffer(index)
    await noveltySend(f.user.id, history, { ...offer, source: ' MercadoLivre ', productId: ` mlb - ${97000000 + index} ` }, status)
    if (index < 4) blocked.push(offer.productId)
  }
  await noveltyDelivery(f.user.id, noveltyOffer(6))
  blocked.push('MLB97000006')
  const urlOnly = { ...noveltyOffer(7), productId: undefined }
  await noveltyDelivery(f.user.id, urlOnly, { offerSource: null, offerProductId: null })
  const card = offer => ({ productId: offer.productId, title: offer.title, commissionedUrl: offer.affiliateUrl,
    commissionedUrlStatus: 'generated_from_page_state', pricing: { currentAmount: 100, originalAmount: 150 } })
  f.payloads[0].json.cards = [card(urlOnly), card(noveltyOffer(0)), card(noveltyOffer(4)), card(noveltyOffer(5)), card(noveltyOffer(10))]
  f.collector.collect = async (requests, _signal, checkpoint) => {
    f.calls.collect++
    for (const request of requests) {
      for (const id of blocked) assert.ok(request.options.excludeProductIds.includes(id))
      for (const id of ['MLB97000004', 'MLB97000005']) assert.ok(!request.options.excludeProductIds.includes(id))
    }
    for (const payload of f.payloads) await checkpoint(payload)
    return f.payloads
  }
  await f.service.tick(f.config)
  const run = await f.run()
  assert.equal(run.status, 'ANALYZING')
  assert.deepEqual(run.payloads[0].json.cards.map(c => c.productId), ['MLB97000004', 'MLB97000005', 'MLB97000010'], 'URL-only aliases and ignored product exclusions must be removed before paid planning')
  assert.equal(f.calls.create, 1)
})

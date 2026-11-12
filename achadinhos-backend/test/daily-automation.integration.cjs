// Opt-in: run only against a disposable, migrated local PostgreSQL database.
const { test: nodeTest, before, after, afterEach } = require('node:test')
// Freeze ordinary fixtures independently; explicit timer tests keep their own clock.
const test = (name, fn) => nodeTest(name, async t => {
  if (!fn.toString().includes('timers.enable') && !fn.toString().includes('approvalFixture')) t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T10:00:00Z').getTime() })
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
  const config = DailyAutomationConfigSchema.parse({ userId: user.id, planningDaysAhead: 0, collectTime: '00:00', repeatCooldownDays: 0, autoApprove: true, requireFullWindow: false })
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

test('expired auth backs off without paid analysis and resumes automatically after restoration', async () => {
  const f = await setup()
  f.collector.collect = async () => { f.calls.collect++; throw new DailyCollectionError('AUTH_REQUIRED') }
  await f.service.tick(f.config)
  await f.service.tick(f.config)
  assert.equal((await f.run()).status, 'RETRY')
  assert.equal((await f.run()).last_error, 'AUTH_REQUIRED')
  assert.equal(f.calls.collect, 1)
  assert.equal(f.calls.create, 0)
  f.collector.collect = async () => { f.calls.collect++; return f.payloads }
  await sequelize.query('UPDATE daily_automation_runs SET next_attempt_at=NOW() WHERE user_id=:id', { replacements: { id: f.user.id } })
  await f.service.tick(f.config)
  assert.equal((await f.run()).status, 'ANALYZING')
  assert.equal(f.calls.collect, 2)
  assert.equal(f.calls.create, 1)
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

test('partial empty collection continues retrying before the collection deadline without paid analysis', async () => {
  const f = await setup()
  f.collector.collect = async () => { f.calls.collect++; return [{ ...f.payloads[0], json: { cards: [] } }] }
  for (let index = 0; index < 3; index++) {
    await f.service.tick(f.config)
    assert.equal((await f.run()).last_error, 'COLLECTION_INCOMPLETE')
    await sequelize.query('UPDATE daily_automation_runs SET next_attempt_at=NOW() WHERE user_id=:id', { replacements: { id: f.user.id } })
  }
  await f.service.tick(f.config)
  assert.equal((await f.run()).status, 'RETRY')
  assert.equal(f.calls.collect, 4)
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

test('transient collection failures continue past three attempts while time remains', async () => {
  const f = await setup()
  let attempts = 0
  f.collector.collect = async () => { attempts++; throw new DailyCollectionError('COLLECTION_TIMEOUT') }
  for (let attempt = 0; attempt < 3; attempt++) {
    await f.service.tick(f.config)
    await sequelize.query('UPDATE daily_automation_runs SET next_attempt_at=NOW() WHERE user_id=:id', { replacements: { id: f.user.id } })
  }
  assert.equal((await f.run()).status, 'RETRY')
  assert.equal((await f.run()).attempts, 3)
  await f.service.tick(f.config)
  assert.equal(attempts, 4)
  await f.service.tick(f.config)
  assert.equal(attempts, 4, 'Repeated polls respect the next backoff')
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

test('late approval with remaining capacity backs off and expires only when the window closes', async (t) => {
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
  assert.equal((await f.run()).status, 'OPERATOR_ATTENTION')
  assert.equal((await f.run()).last_error, 'LATE_ANALYSIS')
  const plan = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
  assert.equal(plan.status, 'REVIEW')
  t.mock.timers.setTime(new Date(`${date}T22:00:00Z`).getTime())
  await sequelize.query('UPDATE daily_automation_runs SET next_attempt_at=NOW() WHERE id=:id', { replacements: { id: run.id } })
  await f.service.tick(f.config)
  await plan.reload()
  assert.equal((await f.run()).status, 'EXPIRED')
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
  for (const slug of ['domestica', 'masculino']) assert.equal(plan.items.filter(item => item.state === 'SELECTED' && item.audienceSlug === slug).length, 27, 'Qualified reserves fill shortages within the remaining cadence headroom')
  assert.ok(plan.items.some(item => item.warnings?.some(warning => /Diversidade de categorias flexibilizada/.test(warning))))
  await service.tick(f.config)
  assert.equal((await f.run()).status, 'SCHEDULED')
  assert.equal(await SmartSend.count({ where: { planId: plan.id } }), 54)
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
    const count = mode === 'reviewLate' ? 26 : mode === 'cadenceLate' ? 28 : 5
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
      assert.equal(delivered.filter(send => send.status === 'SENT').length, 56, 'Thirty-second polling with five-second acceptance latency should deliver the fitted late cycle')
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
  assert.equal(rows.length, 56) // Polling/provider headroom trims 30 to 28 per audience.
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
  assert.equal(calls, 0) // The other audience has its own account slot.
  t.mock.timers.setTime(new Date(rows.find(row => row.audienceSlug === 'masculino').scheduledAt).getTime())
  await sender.processDue()
  assert.equal(calls, 1)
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
  f.config = DailyAutomationConfigSchema.parse({ repeatCooldownDays: 0, userId: f.user.id, autoApprove: true, requireFullWindow: false })
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

for (const daysAhead of [0, 1]) {
  test(`novelty conflicts replenish a previously complete D+${daysAhead} preview before approval`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T22:00:00Z').getTime() })
    const f = await setup()
    f.config = DailyAutomationConfigSchema.parse({ repeatCooldownDays: 0, userId: f.user.id, planningDaysAhead: daysAhead,
      collectTime: daysAhead ? '19:00' : '06:00', autoApprove: true, requireFullWindow: !!daysAhead })
    if (!daysAhead) t.mock.timers.setTime(new Date('2026-11-09T10:00:00Z').getTime())
    const { dailyRequiredItems } = require('../dist/config/dailyAutomation')
    const { buildSmartSchedule } = require('../dist/services/SmartCampaignService')
    const { offerIdentity } = require('../dist/utils/offerIdentity')
    f.collector.collect = async requests => {
      f.calls.collect++
      if (f.calls.collect === 1) {
        assert.ok(requests.every(r => r.options.limit === (daysAhead ? 120 : 50)))
        return f.payloads
      }
      assert.deepEqual(requests.map(r => r.slug), ['domestica'])
      assert.ok(requests[0].options.excludeProductIds.includes('MLB87654321'))
      assert.equal(requests[0].options.excludePolitical, true)
      assert.deepEqual(requests[0].options.quality, { minRating: 4.5, minSoldCount: 100 })
      return [{ ...f.payloads[0], json: { cards: [{ productId: 'MLB87654322' }] } }]
    }
    await f.service.tick(f.config)
    const run = await f.run()
    const plan = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
    const count = dailyRequiredItems(f.config)
    const slots = buildSmartSchedule(run.local_date, count, { startTime: '08:00', endTime: '19:00', timezone: f.config.timezone,
      minGapSeconds: 1200, maxGapSeconds: 1500, dailyCap: 30, spreadAcrossWindow: true, windowEndBufferSeconds: 120 }, 'inventory')
    const items = ['domestica', 'masculino'].flatMap((audienceSlug, a) => slots.map((slot, n) => ({
      state: 'SELECTED', audienceSlug, scheduledAt: slot.toISOString(), product: { source: 'mercadolivre',
        productId: a === 0 && n === 0 ? 'MLB87654321' : `MLB${80000000 + a * 1000 + n}`,
        title: `${audienceSlug} ${n}`, affiliateUrl: `https://meli.la/inventory-${a}-${n}` },
    })))
    await plan.update({ status: 'REVIEW', items })
    const product = items[0].product
    await ProductGroupDelivery.create({ userId: f.user.id, connectionScope: 'inventory-qa', groupId: 'old@g.us', groupName: 'Old',
      offerIdentity: offerIdentity(product), offerSource: 'mercadolivre', offerProductId: product.productId,
      offerUrl: product.affiliateUrl, offerTitle: product.title, status: 'SENT', sentAt: new Date() })
    let appends = 0
    f.smart.appendDailyProducts = async () => { appends++; await plan.update({ status: 'ANALYZING' }) }
    await f.service.tick(f.config)
    assert.equal(f.calls.collect, 2)
    assert.equal(f.calls.approve, 0)
    assert.equal(appends, 1)
    assert.equal((await f.run()).status, 'ANALYZING')
    assert.equal((await plan.reload()).items.length, items.length, 'Discovery preflight does not edit Smart selections')
  })
}

test('an approval-time novelty race returns to bounded discovery instead of a terminal attention hold', async () => {
  const f = await setup()
  const { AppError } = require('../dist/middleware/Error/AppError')
  const { offerIdentity } = require('../dist/utils/offerIdentity')
  await f.service.tick(f.config)
  const run = await f.run()
  const plan = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
  const product = { source: 'mercadolivre', productId: 'MLB88776655', title: 'Panela', affiliateUrl: 'https://meli.la/race-inventory' }
  await plan.update({ status: 'REVIEW', items: [
    { state: 'SELECTED', audienceSlug: 'domestica', product },
    { state: 'SELECTED', audienceSlug: 'masculino' },
  ] })
  f.smart.approve = async () => {
    f.calls.approve++
    await ProductGroupDelivery.create({ userId: f.user.id, connectionScope: 'inventory-race', groupId: 'old@g.us', groupName: 'Old',
      offerIdentity: offerIdentity(product), offerSource: 'mercadolivre', offerProductId: product.productId,
      offerUrl: product.affiliateUrl, offerTitle: product.title, status: 'SENT', sentAt: new Date() })
    throw new AppError('Novelty race', 409, 'DAILY_NOVELTY_CONFLICT')
  }
  let appends = 0
  f.smart.appendDailyProducts = async () => { appends++; await plan.update({ status: 'ANALYZING' }) }
  f.collector.collect = async requests => {
    assert.deepEqual(requests.map(r => r.slug), ['domestica'])
    return [{ ...f.payloads[0], json: { cards: [{ productId: 'MLB88776656' }] } }]
  }
  await f.service.tick(f.config)
  assert.equal(f.calls.approve, 1)
  assert.equal(appends, 1)
  assert.equal((await f.run()).status, 'ANALYZING')
  assert.equal((await f.run()).attempts, 0)
})

test('empty initial discovery gets exactly one broad hub pass then terminates without AI', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T22:00:00Z').getTime() })
  const f = await setup()
  f.config = DailyAutomationConfigSchema.parse({ userId: f.user.id })
  const pages = []
  f.collector.collect = async requests => {
    pages.push(requests)
    return requests.map(r => ({ name: `${r.slug}.json`, targetAudienceSlug: r.slug, json: { cards: [] } }))
  }
  for (let i = 0; i < 19; i++) {
    await f.service.tick(f.config)
    const run = await f.run()
    if (run.status === 'REVIEW') break
    await sequelize.query('UPDATE daily_automation_runs SET next_attempt_at=NOW() WHERE id=:id', { replacements: { id: run.id } })
  }
  assert.equal((await f.run()).last_error, 'DISCOVERY_KEYWORDS_EXHAUSTED')
  for (const slug of ['domestica', 'masculino']) {
    const requests = pages.flat().filter(r => r.slug === slug)
    assert.ok(requests.length <= 17)
    assert.equal(requests.filter(r => r.options.keywords.length === 0).length, 1)
    assert.deepEqual(requests.at(-1).options.keywords, [])
    assert.ok(requests.every(r => r.options.excludePolitical && r.options.quality.minRating === 4.5 && r.options.limit === 120))
  }
  assert.equal(f.calls.create, 0)
})

test('low fresh inventory creates one typed durable warning per audience without blocking analysis', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T22:00:00Z').getTime() })
  const f = await setup()
  const { DailyAutomationAlerts } = require('../dist/services/DailyAutomationAlerts')
  f.config = DailyAutomationConfigSchema.parse({ userId: f.user.id, alertGroupId: '123456789012345678@g.us' })
  const alerts = new DailyAutomationAlerts({}, {}, { async sendText() { assert.fail('No provider calls') } })
  f.collector.collect = async (requests, signal, checkpoint) => {
    for (const payload of f.payloads) await checkpoint(payload)
    return f.payloads
  }
  f.service = new DailyAutomationService(f.smart, f.collector, alerts)
  await f.service.tick(f.config)
  const rows = await sequelize.query('SELECT * FROM daily_automation_alerts WHERE user_id=:id', { replacements: { id: f.user.id }, type: 'SELECT' })
  assert.equal(rows.length, 2, 'Checkpoint and returned payload warnings deduplicate')
  assert.ok(rows.every(row => row.status === 'PENDING' && row.body.includes('DAILY_INVENTORY_LOW') && row.body.includes('fresh=1 required=60')))
  assert.equal((await f.run()).status, 'ANALYZING')
  assert.equal(f.calls.create, 1)
})

test('low-inventory alert persistence failure does not stop initial collection and analysis', async () => {
  const f = await setup()
  let alerts = 0
  f.service = new DailyAutomationService(f.smart, f.collector, { async enqueueInventoryLow() { alerts++; throw Error('private') } })
  await f.service.tick(f.config)
  assert.equal(alerts, 2)
  assert.equal((await f.run()).status, 'ANALYZING')
  assert.equal(f.calls.create, 1)
})

test('replenishment uses its final broad hub pass once and does not buy analysis for empty results', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T22:00:00Z').getTime() })
  const f = await setup()
  f.config = DailyAutomationConfigSchema.parse({ repeatCooldownDays: 0, userId: f.user.id })
  await f.service.tick(f.config)
  const run = await f.run()
  const plan = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
  await plan.update({ status: 'REVIEW', items: [] })
  const { dailyDiscoveryKeywords } = require('../dist/utils/dailyDiscovery')
  let round = 1
  for (; dailyDiscoveryKeywords('domestica', ['domestica'], round, run.local_date).length; round++) {}
  await sequelize.query('UPDATE daily_automation_runs SET discovery_state=CAST(:state AS JSONB) WHERE id=:id', {
    replacements: { id: run.id, state: JSON.stringify({ round }) },
  })
  let collections = 0
  f.collector.collect = async requests => {
    collections++
    assert.deepEqual(requests.find(r => r.slug === 'domestica').options.keywords, [])
    assert.ok(requests.every(r => r.options.limit === 50 && r.options.excludePolitical && r.options.quality.minSoldCount === 100))
    return requests.map(r => ({ name: `${r.slug}.json`, targetAudienceSlug: r.slug, json: { cards: [] } }))
  }
  f.smart.appendDailyProducts = async () => assert.fail('Empty collection must not buy AI')
  await f.service.tick(f.config)
  // The two banks can have different final pages; exhaust the other audience too.
  const state = (await f.run()).discovery_state
  state.initialRounds = { masculino: 16 }
  await sequelize.query('UPDATE daily_automation_runs SET discovery_state=CAST(:state AS JSONB) WHERE id=:id', {
    replacements: { id: run.id, state: JSON.stringify(state) },
  })
  await f.service.tick(f.config)
  assert.equal(collections, 1)
  assert.equal((await f.run()).status, 'REVIEW')
  assert.equal((await f.run()).discovery_state.exhausted, true)
})

test('replenishment only collects remaining candidate headroom and stops at the configured cap', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T22:00:00Z').getTime() })
  const f = await setup()
  f.config = DailyAutomationConfigSchema.parse({ repeatCooldownDays: 0, userId: f.user.id, candidateLimit: 2 })
  await f.service.tick(f.config)
  const run = await f.run()
  const plan = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
  await plan.update({ status: 'REVIEW', items: [] })
  let collections = 0
  f.collector.collect = async requests => {
    collections++
    assert.ok(requests.every(r => r.options.limit === 1))
    return requests.map((r, i) => ({ name: `${r.slug}-extra.json`, targetAudienceSlug: r.slug, json: { cards: [{ productId: `MLB9988776${i}` }] } }))
  }
  f.smart.appendDailyProducts = async () => {}
  await f.service.tick(f.config)
  await f.service.tick(f.config)
  assert.equal(collections, 1)
  assert.equal((await f.run()).discovery_state.exhausted, true)
  assert.equal((await f.run()).status, 'REVIEW')
})

test('a full replenishment batch below the initial warning floor does not emit a low-inventory alert', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T22:00:00Z').getTime() })
  const f = await setup()
  f.config = DailyAutomationConfigSchema.parse({ userId: f.user.id })
  let warnings = 0
  f.service = new DailyAutomationService(f.smart, f.collector, { async enqueueInventoryLow() { warnings++ } })
  f.collector.collect = async requests => requests.map((r, a) => ({ name: `${r.slug}.json`, targetAudienceSlug: r.slug,
    json: { cards: Array.from({ length: r.options.limit }, (_, n) => ({ productId: `MLB${77000000 + a * 1000 + n}` })) } }))
  await f.service.tick(f.config)
  assert.equal(warnings, 0)
  const run = await f.run()
  await SmartPlan.update({ status: 'REVIEW', items: [] }, { where: { uuid: run.plan_uuid } })
  f.smart.appendDailyProducts = async () => {}
  await f.service.tick(f.config)
  assert.equal(warnings, 0)
  assert.equal((await f.run()).status, 'ANALYZING')
})

test('exhausted discovery still delegates qualified reserve backfill to approval when selected picks conflict', async () => {
  const f = await setup()
  await f.service.tick(f.config)
  const run = await f.run()
  const plan = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
  const products = ['domestica', 'masculino'].map((slug, i) => ({ source: 'mercadolivre', productId: `MLB8866554${i}`,
    title: slug, affiliateUrl: `https://meli.la/exhausted-${i}` }))
  const { offerIdentity } = require('../dist/utils/offerIdentity')
  for (const product of products) await ProductGroupDelivery.create({ userId: f.user.id, connectionScope: 'inventory-reserves',
    groupId: 'old@g.us', groupName: 'Old', offerIdentity: offerIdentity(product), offerSource: 'mercadolivre',
    offerProductId: product.productId, offerUrl: product.affiliateUrl, offerTitle: product.title, status: 'SENT', sentAt: new Date() })
  await plan.update({ status: 'REVIEW', items: ['domestica', 'masculino'].flatMap((audienceSlug, i) => [
    { state: 'SELECTED', audienceSlug, product: products[i] }, { state: 'RESERVE', audienceSlug },
  ]) })
  await sequelize.query('UPDATE daily_automation_runs SET discovery_state=CAST(:state AS JSONB) WHERE id=:id', {
    replacements: { id: run.id, state: JSON.stringify({ exhausted: true }) },
  })
  await f.service.tick(f.config)
  assert.equal(f.calls.approve, 1, 'Approval owns atomic reserve qualification and promotion')
  assert.equal(f.calls.collect, 1)
  assert.equal((await f.run()).status, 'SCHEDULED')
})

function cooldownOffer(id, title = 'Panela QA', price = 100) {
  return { title, productId: id, source: 'mercadolivre', currency: 'BRL', discountedPrice: price,
    originalPrice: price * 2, commissioned: true, commissionedUrlStatus: 'generated_from_page_state', commissionRate: 15,
    affiliateUrl: `https://meli.la/cooldown-${id}`, extensionEvidence: { extractedAt: new Date().toISOString(),
      visibleSignals: { rating: 4.9, soldCount: 50000, bestSeller: true } } }
}
async function cooldownDelivery(f, offer, days, extra = {}) {
  return ProductGroupDelivery.create({ userId: f.user.id, connectionScope: `old-${f.user.id}`, groupId: 'domestica@g.us', groupName: 'Domestic',
    offerIdentity: randomUUID(), offerSource: ' MercadoLivre ', offerProductId: ` mlb - ${offer.productId.slice(3)} `,
    offerUrl: 'https://meli.la/old-link', offerTitle: offer.title, status: 'SENT', sentAt: new Date(Date.now() - days * 86400000), ...extra })
}
function cooldownSmart(f, offers) {
  const { SmartCampaignService } = require('../dist/services/SmartCampaignService')
  const groups = new Map(['domestica', 'masculino'].map(slug => [`${slug}@g.us`, { id: `${slug}@g.us`, name: slug, size: 20, announceOnly: false }]))
  const groupService = { async requireCurrentGroups() { return groups } }
  const scope = `cooldown-${f.user.id}`
  const connections = { async getConnectionScope() { return scope }, async requireConnectedContext() { return { scope, creds: {} } } }
  const analyzed = []
  const smart = new SmartCampaignService({ parsePayloads(payloads) {
    const imported = payloads.flatMap(payload => payload.json.offers ?? [])
    const values = imported.length ? imported : offers
    return { offers: values, source: 'mercadolivre', totalSeen: values.length, errors: [], duplicateCount: 0 }
  } },
    { async save(_user, values) { return values } }, {
      async analyze(values, slugs) {
        analyzed.push(...values.map(offer => offer.productId))
        return values.map((offer, index) => ({ index, political: offer.title.includes('político'),
          fits: slugs.map(slug => ({ slug, score: slug === (offer.title.includes('Barbeador') ? 'masculino' : 'domestica') ? 98 : 72,
            reason: 'Current audience fit', category: 'uso diário', seasonalScore: 50 })), warnings: [], shortCaption: 'USO NA ROTINA' }))
      }, async standoutCopy() { assert.fail('No paid copy for daily runs') },
    }, groupService, connections)
  return { smart, analyzed, groupService, connections }
}

test('cooldown is group-specific, uses the latest confirmation and normalized aliases, and 0 keeps lifetime novelty', async () => {
  const f = await setup()
  const offer = cooldownOffer('MLB98765001')
  offer.savedProductId = 98765001
  const { hasDailyProductConflict } = require('../dist/services/dailyNovelty')
  const conflict = (days, groups = ['domestica@g.us']) => sequelize.transaction(transaction =>
    hasDailyProductConflict(f.user.id, -1, randomUUID(), offer, transaction, { repeatCooldownDays: days, groupIds: groups }))
  const old = await cooldownDelivery(f, offer, 40)
  assert.equal(await conflict(30), false)
  assert.equal(await conflict(0), true)
  assert.equal(await conflict(0, ['masculino@g.us']), true, 'Disabled mode preserves global lifetime novelty')
  await old.update({ sentAt: new Date(Date.now() - 30 * 86400000) })
  assert.equal(await conflict(30), false, 'Exactly N elapsed days qualifies')
  await old.update({ sentAt: new Date(Date.now() - 30 * 86400000 + 1) })
  assert.equal(await conflict(30), true, 'One millisecond inside the cooldown is blocked')
  await old.update({ sentAt: new Date(Date.now() - 86400000) })
  assert.equal(await conflict(30, ['masculino@g.us']), false, 'Yesterday in another destination is fresh here')
  assert.equal(await conflict(30, ['masculino@g.us', 'domestica@g.us']), true)
  await old.update({ sentAt: new Date(Date.now() - 40 * 86400000) })
  const recent = await cooldownDelivery(f, offer, 1, { connectionScope: 'changed-connection', offerIdentity: randomUUID() })
  assert.equal(await conflict(30), true, 'An older delivery never hides a newer confirmation')
  await recent.destroy()
  await old.update({ sentAt: null })
  assert.equal(await conflict(30), true, 'Missing confirmation time fails closed')
  await old.update({ status: 'SENDING', sentAt: new Date(Date.now() - 400 * 86400000) })
  assert.equal(await conflict(30, ['masculino@g.us']), true, 'Uncertain claims never age out, even in another group')
})

test('active reservations and UNKNOWN sends block aged repeats; confirmed smart sends obey the same cooldown', async () => {
  const f = await setup()
  const offer = cooldownOffer('MLB98765002')
  await cooldownDelivery(f, offer, 40)
  const other = await SmartPlan.create({ userId: f.user.id, status: 'PAUSED', startDate: dailyWindow(f.config).date,
    days: 1, timezone: f.config.timezone, audienceSlugs: ['domestica'], input: {}, settings: {}, items: [] })
  const send = await SmartSend.create({ userId: f.user.id, planId: other.id, audienceSlug: 'domestica', groupId: 'domestica@g.us', groupName: 'Domestic',
    connectionScope: 'reservation-qa', offerIdentity: randomUUID(), offer: { ...offer, productId: ' mlb - 98765002 ' },
    scheduledAt: new Date(), evidenceObservedAt: new Date(), localDate: dailyWindow(f.config).date, timezone: f.config.timezone, status: 'PENDING' })
  const { hasDailyProductConflict } = require('../dist/services/dailyNovelty')
  const conflict = () => sequelize.transaction(transaction => hasDailyProductConflict(f.user.id, -1, randomUUID(), offer,
    transaction, { repeatCooldownDays: 30, groupIds: ['domestica@g.us'] }))
  for (const status of ['PENDING', 'SENDING', 'UNKNOWN']) {
    await send.update({ status, sentAt: new Date(Date.now() - 400 * 86400000) })
    assert.equal(await conflict(), true, status)
  }
  await send.update({ status: 'SENT', sentAt: new Date(Date.now() - 40 * 86400000) })
  assert.equal(await conflict(), false)
  await send.update({ sentAt: new Date(Date.now() - 86400000) })
  assert.equal(await conflict(), true)
})

test('collector exclusions admit cooled products per destination but retain recent and uncertain history', async () => {
  const f = await setup()
  const old = cooldownOffer('MLB98765003'), recent = cooldownOffer('MLB98765004'), uncertain = cooldownOffer('MLB98765005')
  await cooldownDelivery(f, old, 40)
  await cooldownDelivery(f, recent, 1)
  await cooldownDelivery(f, uncertain, 400, { status: 'SENDING' })
  const config = { ...f.config, repeatCooldownDays: 30 }
  assert.deepEqual((await f.service.exclusions(f.user.id, config, ['domestica@g.us'])).sort(), [recent.productId, uncertain.productId])
  assert.deepEqual(await f.service.exclusions(f.user.id, config, ['masculino@g.us']), [uncertain.productId])
  assert.deepEqual((await f.service.exclusions(f.user.id, f.config, ['domestica@g.us'])).sort(), [old.productId, recent.productId, uncertain.productId])
})

test('fresh products outrank richer repeats, fallback reuses analyses, and sender delivers an approved repeat', async t => {
  const f = await setup()
  const fresh = cooldownOffer('MLB98765006'), repeat = cooldownOffer('MLB98765007', 'Panela premium QA', 600)
  await cooldownDelivery(f, repeat, 40)
  const { smart, analyzed, connections, groupService } = cooldownSmart(f, [repeat, fresh])
  const created = await smart.createPlan(f.user.id, { requestId: randomUUID(), date: dailyWindow(f.config).date, days: 1,
    audienceSlugs: ['domestica'], payloads: [{ name: 'current-collection', json: {} }], campaignStartTime: '08:00',
    settings: { dailyCap: 2, maxStandouts: 0, excludePolitical: true, dailySelection: { minRating: 4.5, minSoldCount: 100, minFitScore: 75, minCommercialScore: 60 } },
  }, { runId: randomUUID(), localDate: dailyWindow(f.config).date, minimumItems: 2, startTime: '08:00', endTime: '19:00', repeatCooldownDays: 30 })
  const plan = await SmartPlan.findOne({ where: { uuid: created.id } })
  await smart.processPendingAnalysis(plan.id)
  await plan.reload()
  assert.equal(plan.status, 'REVIEW', JSON.stringify(plan.progress))
  assert.deepEqual(plan.items.filter(item => item.state === 'SELECTED').map(item => item.product.productId), [fresh.productId])
  assert.equal(plan.items.find(item => item.product.productId === repeat.productId).state, 'RESERVE')
  const paid = analyzed.length
  await smart.enableDailyRepeatFallback(f.user.id, plan.uuid, plan.revision)
  await smart.processPendingAnalysis(plan.id)
  await plan.reload()
  assert.equal(analyzed.length, paid, 'Selection rebuild never purchases the saved classification again')
  const selected = plan.items.filter(item => item.state === 'SELECTED').sort((a, b) => a.sendOrder - b.sendOrder)
  assert.deepEqual(selected.map(item => item.product.productId), [fresh.productId, repeat.productId])
  assert.ok(selected[1].score > selected[0].score, 'Priority wins over commercial score and price mix')
  assert.equal(selected[1].repeatFallback, true)
  assert.ok(selected[1].warnings.includes('Repetição após 30 dias'))
  assert.equal(plan.progress.repeatSelected, 1)
  await smart.approve(f.user.id, plan.uuid, plan.revision, { automatic: true })
  const rows = await SmartSend.findAll({ where: { planId: plan.id } })
  await SmartSend.update({ status: 'SKIPPED' }, { where: { id: rows.find(row => row.offer.productId === fresh.productId).id } })
  const target = rows.find(row => row.offer.productId === repeat.productId)
  t.mock.timers.setTime(target.scheduledAt.getTime())
  let sends = 0
  const accepted = async () => { sends++; return { id: randomUUID(), status: 'sent' } }
  const { SmartCampaignSender } = require('../dist/services/SmartCampaignSender')
  const sender = new SmartCampaignSender({ sendText: accepted, sendMedia: accepted }, connections, groupService, { now: () => new Date() })
  const result = await sender.processDue()
  await target.reload()
  assert.equal(target.status, 'SENT', JSON.stringify({ result, error: target.lastError }))
  assert.equal(sends, 1)
  assert.equal(await ProductGroupDelivery.count({ where: { planUuid: plan.uuid, status: 'SENT' } }), 1)
})

test('worker exhausts fresh discovery before enabling repeats and records the approved run count', async () => {
  const f = await setup()
  f.config = { ...f.config, repeatCooldownDays: 30, candidateLimit: 1 }
  const offers = [cooldownOffer('MLB98765008'), cooldownOffer('MLB98765009', 'Barbeador QA')]
  await cooldownDelivery(f, offers[0], 40)
  const { smart, analyzed } = cooldownSmart(f, offers)
  const service = new DailyAutomationService(smart, f.collector)
  await service.tick(f.config)
  const run = await f.run()
  const plan = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
  await smart.processPendingAnalysis(plan.id)
  await plan.reload()
  assert.equal(plan.items.filter(item => item.state === 'SELECTED' && item.audienceSlug === 'domestica').length, 0)
  const paid = analyzed.length
  await service.tick(f.config)
  await plan.reload()
  assert.equal((await f.run()).discovery_state.exhausted, true)
  assert.equal(plan.settings.dailyAutomation.repeatFallbackReady, true)
  assert.equal(plan.status, 'ANALYZING')
  await smart.processPendingAnalysis(plan.id)
  await service.tick(f.config)
  await plan.reload()
  assert.equal((await f.run()).status, 'SCHEDULED')
  assert.equal((await f.run()).discovery_state.repeatSelected, 1)
  assert.equal(plan.progress.repeatSelected, 1)
  assert.equal(analyzed.length, paid)
  assert.equal(f.calls.collect, 1, 'Candidate bound ends discovery without replaying collection')
  const sendCount = await SmartSend.count({ where: { planId: plan.id } })
  await sequelize.query("UPDATE daily_automation_runs SET status='ANALYZING', discovery_state=discovery_state - 'repeatSelected', next_attempt_at=NOW() WHERE id=:id", { replacements: { id: run.id } })
  await service.tick(f.config)
  assert.equal((await f.run()).discovery_state.repeatSelected, 1, 'Restart recovers evidence after approval committed before the run checkpoint')
  assert.equal(await SmartSend.count({ where: { planId: plan.id } }), sendCount)
})

test('approval and both sender rechecks reject newly conflicting repeats without provider calls', async t => {
  const { SmartCampaignSender } = require('../dist/services/SmartCampaignSender')
  for (const stage of ['approval', 'reservation', 'provider']) {
    const f = await setup()
    const offer = cooldownOffer(`MLB${98765100 + ['approval', 'reservation', 'provider'].indexOf(stage)}`)
    await cooldownDelivery(f, offer, 40)
    const { smart, connections, groupService } = cooldownSmart(f, [offer])
    const created = await smart.createPlan(f.user.id, { requestId: randomUUID(), date: dailyWindow(f.config).date, days: 1,
      audienceSlugs: ['domestica'], payloads: [{ name: 'current', json: {} }], campaignStartTime: '08:00',
      settings: { maxStandouts: 0, dailyCap: 1, dailySelection: { minRating: 4.5, minSoldCount: 100, minFitScore: 75, minCommercialScore: 60 } },
    }, { runId: randomUUID(), localDate: dailyWindow(f.config).date, minimumItems: 1, startTime: '08:00', endTime: '19:00', repeatCooldownDays: 30 })
    const plan = await SmartPlan.findOne({ where: { uuid: created.id } })
    await smart.processPendingAnalysis(plan.id)
    await plan.reload()
    await smart.enableDailyRepeatFallback(f.user.id, plan.uuid, plan.revision)
    await smart.processPendingAnalysis(plan.id)
    await plan.reload()
    if (stage === 'approval') {
      await cooldownDelivery(f, offer, 1, { connectionScope: 'latest' })
      await assert.rejects(smart.approve(f.user.id, plan.uuid, plan.revision, { automatic: true }), { code: 'DAILY_NOVELTY_CONFLICT' })
      assert.equal(await SmartSend.count({ where: { planId: plan.id } }), 0)
      continue
    }
    await smart.approve(f.user.id, plan.uuid, plan.revision, { automatic: true })
    const target = await SmartSend.findOne({ where: { planId: plan.id } })
    t.mock.timers.setTime(target.scheduledAt.getTime())
    const other = await SmartPlan.create({ userId: f.user.id, status: 'PAUSED', startDate: target.localDate, days: 1,
      timezone: f.config.timezone, audienceSlugs: ['domestica'], input: {}, settings: {}, items: [] })
    const reserve = () => SmartSend.create({ userId: f.user.id, planId: other.id, audienceSlug: 'domestica', groupId: 'other@g.us', groupName: 'Other',
      connectionScope: 'other-account-scope', offerIdentity: randomUUID(), offer: { ...offer, productId: ` mlb - ${offer.productId.slice(3)} ` },
      scheduledAt: new Date(), evidenceObservedAt: new Date(), localDate: target.localDate, timezone: f.config.timezone, status: 'UNKNOWN' })
    const fail = async () => assert.fail('A newly uncertain repeat must never reach the provider')
    const sender = new SmartCampaignSender({ sendText: fail, sendMedia: fail }, connections, groupService, { now: () => new Date() })
    if (stage === 'reservation') await reserve()
    else {
      const ready = sender.readyForProvider.bind(sender)
      sender.readyForProvider = async (...args) => { await reserve(); return ready(...args) }
    }
    await sender.processDue()
    await target.reload()
    assert.equal(target.status, 'SKIPPED', `${stage}: ${target.lastError}`)
    assert.equal(await ProductGroupDelivery.count({ where: { planUuid: plan.uuid } }), 0, 'Only the unsent owned claim may be removed')
    assert.equal(await SmartSend.count({ where: { planId: other.id, status: 'UNKNOWN' } }), 1)
  }
})

test('repeat fallback preserves stale-evidence, popularity, affiliate and political hard gates', async () => {
  const f = await setup()
  const offers = Array.from({ length: 5 }, (_, index) => cooldownOffer(`MLB${98765200 + index}`))
  offers[0].extensionEvidence.extractedAt = '2000-01-01T00:00:00Z'
  offers[1].extensionEvidence.visibleSignals.rating = 4
  offers[2].extensionEvidence.visibleSignals.soldCount = 0
  offers[3].commissionedUrlStatus = 'manual_unverified'
  offers[4].title = 'Caneca com conteúdo político'
  for (const offer of offers) await cooldownDelivery(f, offer, 40)
  const { smart } = cooldownSmart(f, offers)
  const created = await smart.createPlan(f.user.id, { requestId: randomUUID(), date: dailyWindow(f.config).date, days: 1,
    audienceSlugs: ['domestica'], payloads: [{ name: 'current', json: {} }], campaignStartTime: '08:00',
    settings: { maxStandouts: 0, excludePolitical: true, dailySelection: { minRating: 4.5, minSoldCount: 100, minFitScore: 75, minCommercialScore: 60 } },
  }, { runId: randomUUID(), localDate: dailyWindow(f.config).date, minimumItems: 1, startTime: '08:00', endTime: '19:00', repeatCooldownDays: 30 })
  const plan = await SmartPlan.findOne({ where: { uuid: created.id } })
  await smart.processPendingAnalysis(plan.id)
  await plan.reload()
  await smart.enableDailyRepeatFallback(f.user.id, plan.uuid, plan.revision)
  await smart.processPendingAnalysis(plan.id)
  await plan.reload()
  assert.equal(plan.status, 'REVIEW')
  assert.equal(plan.items.length, 5)
  assert.ok(plan.items.every(item => item.state === 'REJECTED'))
  assert.ok(plan.items.every(item => item.reason.length > 0))
  assert.equal(plan.progress.repeatSelected, 0)
})

test('newly discovered fresh products fill the target before stored repeat candidates are released', async () => {
  const f = await setup()
  f.config = DailyAutomationConfigSchema.parse({ ...f.config, repeatCooldownDays: 30, candidateLimit: 3, endTime: '08:25' })
  const repeat = cooldownOffer('MLB98765300'), male = cooldownOffer('MLB98765301', 'Barbeador QA')
  const fresh = [cooldownOffer('MLB98765302'), cooldownOffer('MLB98765303')]
  const male2 = cooldownOffer('MLB98765304', 'Barbeador QA 2')
  await cooldownDelivery(f, repeat, 40)
  const payload = (slug, offers) => ({ name: `${slug}-${offers[0].productId}.json`, targetAudienceSlug: slug,
    json: { offers, cards: offers.map(offer => ({ productId: offer.productId })) } })
  let collections = 0
  const collector = { async collect(requests) {
    collections++
    if (collections === 1) return [payload('domestica', [repeat]), payload('masculino', [male])]
    if (collections === 2) return [payload('domestica', [fresh[0]]), payload('masculino', [male2])]
    assert.equal(collections, 3)
    assert.deepEqual(requests.map(request => request.slug), ['domestica'])
    assert.ok(requests[0].options.excludeProductIds.includes(fresh[0].productId))
    return [payload('domestica', [fresh[1]])]
  } }
  const { smart, analyzed } = cooldownSmart(f, [])
  const service = new DailyAutomationService(smart, collector)
  await service.tick(f.config)
  const run = await f.run()
  const plan = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
  for (let round = 0; round < 3; round++) {
    await smart.processPendingAnalysis(plan.id)
    await service.tick(f.config)
  }
  await plan.reload()
  assert.equal(plan.status, 'SCHEDULED', JSON.stringify(plan.progress))
  assert.deepEqual(plan.items.filter(item => item.state === 'SELECTED' && item.audienceSlug === 'domestica').map(item => item.product.productId).sort(), fresh.map(offer => offer.productId).sort())
  assert.equal(plan.items.find(item => item.product.productId === repeat.productId && item.audienceSlug === 'domestica').state, 'RESERVE')
  assert.equal(plan.settings.dailyAutomation.repeatFallbackReady, undefined)
  assert.equal((await f.run()).discovery_state.repeatSelected, 0)
  assert.equal(analyzed.length, 5, 'Replenishment analyzes only the three new observations')
  assert.equal(collections, 3)
})

test('cooldown collection catches relisted affiliate URLs and retains old matches as repeat reserves', async t => {
  const f = await setup()
  f.config = { ...f.config, repeatCooldownDays: 30 }
  const { offerIdentity } = require('../dist/utils/offerIdentity')
  const recent = cooldownOffer('MLB98800001'), old = cooldownOffer('MLB98800002')
  for (const [offer, days] of [[recent, 1], [old, 40]]) {
    await cooldownDelivery(f, offer, days, { offerIdentity: offerIdentity(offer), offerUrl: offer.affiliateUrl })
  }
  const cards = [recent, old].map((offer, index) => ({ ...offer, productId: `MLB9880010${index}`,
    commissionedUrl: offer.affiliateUrl }))
  const filtered = await f.service.filterPayload({ user_id: f.user.id, config: f.config }, {
    name: 'relisted.json', targetAudienceSlug: 'domestica', json: { extractedAt: new Date().toISOString(), cards },
  })
  assert.deepEqual(filtered.json.cards.map(card => card.productId), [cards[1].productId])
  assert.equal(filtered.json.cards[0].repeatFallback, true)
  const otherGroup = await f.service.filterPayload({ user_id: f.user.id, config: f.config }, {
    ...filtered, targetAudienceSlug: 'masculino', json: { cards },
  })
  assert.equal(otherGroup.json.cards.length, 2)
  assert.ok(otherGroup.json.cards.every(card => !card.repeatFallback), 'Confirmed history only in another group is fresh')
  const warnings = []
  const service = new DailyAutomationService(f.smart, f.collector, { async enqueueInventoryLow(...args) { warnings.push(args) } })
  await service.inventoryWarning({ user_id: f.user.id, config: f.config, id: 'relisted-qa', local_date: dailyWindow(f.config).date }, filtered)
  assert.equal(warnings[0][4], 0, 'Cooled repeats never count as fresh inventory')
  const { smart } = cooldownSmart(f, filtered.json.cards)
  const created = await smart.createPlan(f.user.id, { requestId: randomUUID(), date: dailyWindow(f.config).date, days: 1,
    audienceSlugs: ['domestica'], payloads: [{ name: 'filtered-collection', json: {} }], campaignStartTime: '08:00',
    settings: { dailyCap: 2, maxStandouts: 0, excludePolitical: true,
      dailySelection: { minRating: 4.5, minSoldCount: 100, minFitScore: 75, minCommercialScore: 60 } },
  }, { runId: randomUUID(), localDate: dailyWindow(f.config).date, minimumItems: 2, startTime: '08:00', endTime: '19:00', repeatCooldownDays: 30 })
  const plan = await SmartPlan.findOne({ where: { uuid: created.id } })
  await smart.processPendingAnalysis(plan.id)
  await plan.reload()
  assert.equal(plan.items.length, 1)
  assert.equal(plan.items[0].state, 'RESERVE')
  assert.equal(plan.items[0].repeatFallback, true)
  assert.ok(plan.items[0].warnings.includes('Repetição após 30 dias'))
})

test('cooldown planning and approval batch once per audience and preserve destination-specific freshness', async () => {
  const f = await setup()
  f.config = { ...f.config, repeatCooldownDays: 30 }
  const domestic = [cooldownOffer('MLB98800200'), cooldownOffer('MLB98800201'), cooldownOffer('MLB98800202')]
  const male = [cooldownOffer('MLB98800203', 'Barbeador QA'), cooldownOffer('MLB98800204', 'Barbeador premium QA', 600)]
  await cooldownDelivery(f, domestic[0], 1, { groupId: 'masculino@g.us' })
  await cooldownDelivery(f, male[1], 40, { groupId: 'masculino@g.us' })
  const { smart } = cooldownSmart(f, [...domestic, ...male])
  const created = await smart.createPlan(f.user.id, { requestId: randomUUID(), date: dailyWindow(f.config).date, days: 1,
    audienceSlugs: ['domestica', 'masculino'], payloads: [{ name: 'batch-qa', json: {} }], campaignStartTime: '08:00',
    settings: { dailyCap: 2, maxStandouts: 0, excludePolitical: true,
      dailySelection: { minRating: 4.5, minSoldCount: 100, minFitScore: 75, minCommercialScore: 60 } },
  }, { runId: randomUUID(), localDate: dailyWindow(f.config).date, minimumItems: 2, startTime: '08:00', endTime: '19:00', repeatCooldownDays: 30 })
  const plan = await SmartPlan.findOne({ where: { uuid: created.id } })
  const query = sequelize.query.bind(sequelize)
  let queries = 0
  const batched = async action => {
    queries = 0
    sequelize.query = (sql, ...args) => {
      if (typeof sql === 'string' && sql.includes('WITH daily_history AS')) queries++
      return query(sql, ...args)
    }
    try { await action() } finally { sequelize.query = query }
    assert.equal(queries, 2, 'History work is bounded by audience count, not offer/item count')
  }
  await batched(() => smart.processPendingAnalysis(plan.id))
  await plan.reload()
  const fresh = plan.items.find(item => item.audienceSlug === 'domestica' && item.product.productId === domestic[0].productId)
  assert.equal(fresh.state, 'SELECTED')
  assert.equal(fresh.repeatFallback, false)
  const repeat = () => plan.items.find(item => item.audienceSlug === 'masculino' && item.product.productId === male[1].productId)
  assert.equal(repeat().state, 'RESERVE')
  assert.equal(repeat().repeatFallback, true)
  await smart.enableDailyRepeatFallback(f.user.id, plan.uuid, plan.revision)
  await batched(() => smart.processPendingAnalysis(plan.id))
  await plan.reload()
  assert.equal(repeat().state, 'SELECTED')
  const audiences = await SmartAudience.findAll({ where: { userId: f.user.id } })
  const run = { user_id: f.user.id, config: f.config, local_date: plan.startDate }
  assert.equal((await f.service.noveltyCoverage(run, plan, audiences)).noveltyShortage, false)
  await cooldownDelivery(f, fresh.product, 1, { connectionScope: 'new-reservation', status: 'SENDING', groupId: 'unrelated@g.us' })
  assert.equal((await f.service.noveltyCoverage(run, plan, audiences)).noveltyShortage, true)
  await batched(() => smart.approve(f.user.id, plan.uuid, plan.revision, { automatic: true }))
  await plan.reload()
  assert.equal(plan.status, 'SCHEDULED')
  const selected = plan.items.filter(item => item.state === 'SELECTED')
  assert.equal(selected.length, 4)
  assert.ok(!selected.some(item => item.product.productId === domestic[0].productId))
  assert.equal(selected.filter(item => item.repeatFallback).length, 1)
})

async function approvalFixture(t, time = '2026-11-09T10:00:00Z') {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(time).getTime() })
  const f = await setup()
  const { SmartCampaignService } = require('../dist/services/SmartCampaignService')
  const audiences = await SmartAudience.findAll({ where: { userId: f.user.id } })
  const policies = Object.fromEntries(audiences.map(a => [a.slug, { ...a.policy, spreadAcrossWindow: true, windowEndBufferSeconds: 120 }]))
  const scope = `approval-${f.user.id}`
  const groups = new Map(audiences.map(a => [a.destinations[0].groupId, { id: a.destinations[0].groupId, name: a.slug }]))
  const smart = new SmartCampaignService({}, {}, {}, { async requireCurrentGroups() { return groups } }, { async getConnectionScope() { return scope } })
  let sequence = 0
  const item = (patch = {}) => {
    const n = sequence++
    return { id: randomUUID(), audienceSlug: 'domestica', date: '2026-11-09', state: 'SELECTED', fitScore: 95, score: 95 - n,
      category: `category-${n}`, reason: 'Qualified', warnings: [], standout: false, observedAt: new Date().toISOString(),
      product: { title: `Qualified ${n}`, productId: `MLB${93000000 + f.user.id * 10000 + n}`, source: 'mercadolivre', currency: 'BRL',
        discountedPrice: 90, originalPrice: 150, commissioned: true, commissionedUrlStatus: 'generated_from_page_state', commissionRate: 10,
        affiliateUrl: `https://meli.la/approval-${f.user.id}-${n}`, extensionEvidence: { extractedAt: new Date().toISOString(), visibleSignals: { rating: 4.9, soldCount: 50000 } } }, ...patch }
  }
  const plan = async items => SmartPlan.create({ userId: f.user.id, status: 'REVIEW', startDate: '2026-11-09', days: 1,
    timezone: f.config.timezone, audienceSlugs: ['domestica', 'masculino'], input: { requestId: dailyRequestId(f.user.id, '2026-11-09') }, items,
    settings: { audiences: policies, global: { campaignStartTime: '08:00' }, dailyAutomation: { localDate: '2026-11-09', startTime: '08:00', endTime: '19:00', minimumItems: 30 } } })
  const approve = async p => { await smart.approve(f.user.id, p.uuid, p.revision, { automatic: true }); await p.reload(); return SmartSend.findAll({ where: { planId: p.id }, order: [['scheduledAt', 'ASC']] }) }
  return { ...f, smart, item, plan, approve, scope, policies }
}

test('robust approval drops stale, ineligible and excess standout items and fills exact-slot-fresh reserves', async t => {
  const f = await approvalFixture(t, '2026-11-09T21:00:00Z') // 18:00, evidence expires at 18:30.
  const stale = f.item({ observedAt: '2026-11-08T20:00:00Z' })
  const weak = f.item({ fitScore: 20 })
  const standout = f.item({ standout: true })
  const reserves = Array.from({ length: 3 }, () => f.item({ state: 'RESERVE', observedAt: '2026-11-08T21:30:00Z' }))
  const p = await f.plan([stale, weak, standout, ...reserves])
  const rows = await f.approve(p)
  assert.ok(rows.length >= 1)
  assert.ok(rows.every(r => reserves.some(i => i.product.productId === r.offer.productId)))
  for (const bad of [stale, weak, standout]) {
    const dropped = p.items.find(i => i.id === bad.id)
    assert.equal(dropped.state, 'RESERVE'); assert.ok(dropped.warnings.length)
  }
  assert.ok(rows.every(r => new Date(r.scheduledAt) <= new Date('2026-11-09T21:30:00Z')))
})

test('robust approval releases trimmed cross-audience identities including promoted reserves', async t => {
  const f = await approvalFixture(t, '2026-11-09T21:45:00Z')
  const keep = f.item({ score: 99 })
  const shared = f.item({ score: 80 })
  const other = { ...structuredClone(shared), id: randomUUID(), audienceSlug: 'masculino' }
  const p = await f.plan([keep, shared, other])
  const rows = await f.approve(p)
  assert.equal(rows.length, 2)
  assert.equal(rows.filter(r => r.audienceSlug === 'masculino').length, 1)
})

test('robust approval preserves replacement price bands, pins and contiguous sendOrder', async t => {
  const f = await approvalFixture(t)
  const bad = f.item({ sendOrder: 1 })
  const keep = f.item({ sendOrder: 2 })
  const premium = f.item({ state: 'RESERVE', score: 99 }); premium.product.discountedPrice = 800
  const affordable = f.item({ state: 'RESERVE', score: 80, pinned: true, sendOrder: 0 })
  const p = await f.plan([bad, keep, premium, affordable])
  await ProductGroupDelivery.create({ userId: f.user.id, connectionScope: f.scope, groupId: 'other@g.us', groupName: 'Other',
    offerIdentity: `mercadolivre:${bad.product.productId}`, offerSource: 'mercadolivre', offerProductId: bad.product.productId,
    offerUrl: bad.product.affiliateUrl, offerTitle: bad.product.title, status: 'SENT', sentAt: new Date() })
  const rows = await f.approve(p)
  assert.equal(rows.length, 2)
  const retained = p.items.filter(i => i.state === 'SELECTED').sort((a, b) => a.sendOrder - b.sendOrder)
  assert.deepEqual(retained.map(i => i.id), [affordable.id, keep.id])
  assert.deepEqual(retained.map(i => i.sendOrder), [0, 1])
  assert.equal(rows[0].offer.productId, affordable.product.productId)
})

test('robust approval degrades excess pins by score within late capacity', async t => {
  const f = await approvalFixture(t, '2026-11-09T21:45:00Z')
  const items = [f.item({ pinned: true, score: 80 }), f.item({ pinned: true, score: 99 }), f.item({ pinned: true, score: 90 })]
  const p = await f.plan(items)
  const rows = await f.approve(p)
  assert.equal(rows.length, 1); assert.equal(rows[0].offer.productId, items[1].product.productId)
})

test('robust approval trims to residual group dailyCap under reservation locks', async t => {
  const f = await approvalFixture(t)
  f.policies.domestica.dailyCap = 3
  const previous = await SmartPlan.create({ userId: f.user.id, status: 'SCHEDULED', startDate: '2026-11-09', days: 1, timezone: f.config.timezone, audienceSlugs: [], input: {}, settings: {}, items: [] })
  for (let i = 0; i < 2; i++) await SmartSend.create({ userId: f.user.id, planId: previous.id, audienceSlug: 'domestica', groupId: 'domestica@g.us', groupName: 'domestica', connectionScope: f.scope,
    offerIdentity: `previous-${i}`, offer: {}, scheduledAt: new Date('2026-11-09T11:00:00Z'), localDate: '2026-11-09', timezone: f.config.timezone, evidenceObservedAt: new Date(), status: i ? 'UNKNOWN' : 'PENDING' })
  const items = [f.item({ score: 80 }), f.item({ score: 99 }), f.item({ score: 90 }), f.item({ score: 85 })]
  const p = await f.plan(items)
  const rows = await f.approve(p)
  assert.equal(rows.length, 1); assert.equal(rows[0].offer.productId, items[1].product.productId)
})

for (const held of ['REVIEW', 'OPERATOR_ATTENTION']) test(`robust approval reclaims existing ${held} without recollection and persists backoff`, async t => {
  const f = await approvalFixture(t)
  const p = await f.plan([f.item()])
  await sequelize.query(`INSERT INTO daily_automation_runs(user_id,local_date,request_id,config,status,plan_uuid,last_error,payloads)
    VALUES(:userId,'2026-11-09',:requestId,CAST(:config AS JSONB),:status,:uuid,:error,CAST(:payloads AS JSONB))`, {
    replacements: { userId: f.user.id, requestId: p.input.requestId, config: JSON.stringify(f.config), status: held, uuid: p.uuid,
      error: held === 'REVIEW' ? null : 'DAILY_NOVELTY_CONFLICT', payloads: JSON.stringify(f.payloads) } })
  const { AppError } = require('../dist/middleware/Error/AppError')
  let calls = 0
  const approve = f.smart.approve.bind(f.smart)
  f.smart.approve = async (...args) => { calls++; if (calls === 1) throw new AppError('race', 409, 'SMART_PLAN_REVISION_CONFLICT'); return approve(...args) }
  const worker = new DailyAutomationService(f.smart, { async collect() { assert.fail('No recollection') } })
  await worker.tick(f.config)
  let run = await f.run()
  assert.equal(calls, 1); assert.equal(run.approval_attempts, 1)
  assert.ok(new Date(run.next_attempt_at) > new Date(run.updated_at))
  await worker.tick(f.config); assert.equal(calls, 1, 'Backoff prevents hot retries')
  await p.update({ revision: p.revision + 1 })
  await sequelize.query('UPDATE daily_automation_runs SET next_attempt_at=NOW() WHERE id=:id', { replacements: { id: run.id } })
  await worker.tick(f.config)
  run = await f.run(); assert.equal(run.status, 'SCHEDULED'); assert.equal(calls, 2)
  assert.equal(await SmartSend.count({ where: { planId: p.id } }), 1)
})

test('robust alerts distinguish accepted partial, stalled automatic and explicitly manual approval with frozen config', async t => {
  const f = await approvalFixture(t, '2026-11-09T10:30:00Z')
  const { DailyAutomationAlerts } = require('../dist/services/DailyAutomationAlerts')
  const alerts = new DailyAutomationAlerts({}, {}, {})
  f.config.alertGroupId = '123456789012345678@g.us'
  const p = await f.plan([f.item()])
  await sequelize.query(`INSERT INTO daily_automation_runs(user_id,local_date,request_id,config,status,plan_uuid,last_error)
    VALUES(:userId,'2026-11-09',:requestId,CAST(:config AS JSONB),'OPERATOR_ATTENTION',:uuid,'DAILY_NOVELTY_CONFLICT')`, {
    replacements: { userId: f.user.id, requestId: p.input.requestId, config: JSON.stringify(f.config), uuid: p.uuid } })
  await alerts.monitor({ ...f.config, autoApprove: false }, new Date())
  await p.update({ status: 'SCHEDULED' })
  await alerts.monitor(f.config, new Date())
  await p.update({ status: 'REVIEW' })
  await sequelize.query(`UPDATE daily_automation_runs SET config=jsonb_set(config,'{autoApprove}','false') WHERE user_id=:id`, { replacements: { id: f.user.id } })
  await alerts.monitor(f.config, new Date())
  const rows = await sequelize.query('SELECT body FROM daily_automation_alerts WHERE user_id=:id', { replacements: { id: f.user.id }, type: 'SELECT' })
  assert.equal(rows.length, 3)
  for (const code of ['AUTO_APPROVAL_STALLED', 'DAILY_PARTIAL_DAY', 'MANUAL_APPROVAL_REQUIRED']) assert.ok(rows.some(r => r.body.includes(code)), code)
  assert.ok(rows.every(r => /selected=1/.test(r.body)))
})

test('robust held-run recovery preserves operator edits, cancellation and frozen manual runs', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T10:00:00Z').getTime() })
  for (const intent of ['edit', 'cancel', 'manual', 'auth', 'config', 'active', 'campaign']) {
    const f = await setup()
    await f.service.tick(f.config)
    const run = await f.run()
    const p = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
    await p.update({ status: intent === 'cancel' ? 'CANCELLED' : 'REVIEW', items: [{ id: randomUUID(), state: 'SELECTED', audienceSlug: 'domestica', date: '2026-11-09' }] })
    const error = { auth: 'AUTH_REQUIRED', config: 'CONFIG_REQUIRED', active: 'ACTIVE_PLAN_LIMIT', campaign: 'SMART_MANUAL_CAMPAIGN_CONFLICT' }[intent] ?? 'DAILY_NOVELTY_CONFLICT'
    const config = { ...f.config, autoApprove: intent !== 'manual' }
    await sequelize.query(`UPDATE daily_automation_runs SET config=CAST(:config AS JSONB),status='OPERATOR_ATTENTION',last_error=:error,next_attempt_at=NOW() WHERE id=:id`, { replacements: { id: run.id, config: JSON.stringify(config), error } })
    if (intent === 'edit') {
      const { SmartCampaignService } = require('../dist/services/SmartCampaignService')
      const real = new SmartCampaignService({}, {}, {}, {}, {})
      await p.update({ items: [] })
      await real.updatePlan(f.user.id, p.uuid, { revision: p.revision, items: [] })
    }
    await f.service.tick(f.config)
    assert.equal(f.calls.approve, 0, intent)
  }
})

test('robust approval keeps manual freshness and standout validation strict', async t => {
  const f = await approvalFixture(t, '2026-11-09T21:00:00Z')
  for (const patch of [{ observedAt: '2026-11-08T20:00:00Z' }, { standout: true }, { fitScore: 20 }]) {
    const p = await f.plan([f.item(patch), f.item({ state: 'RESERVE' })])
    // Independent request IDs permit several manual-review plans in this fixture.
    await p.update({ input: { requestId: randomUUID() } })
    await assert.rejects(f.smart.approve(f.user.id, p.uuid, p.revision), error => ['CONFLICT', 'BAD_REQUEST'].includes(error.code))
    assert.equal(await SmartSend.count({ where: { planId: p.id } }), 0)
    assert.equal((await p.reload()).status, 'REVIEW')
  }
})

test('robust approval can backfill with an initially capacity-trimmed fresh selection', async t => {
  const f = await approvalFixture(t, '2026-11-09T21:45:00Z')
  const stale = f.item({ score: 99, observedAt: '2026-11-08T20:00:00Z' })
  const fresh = f.item({ score: 80 })
  const p = await f.plan([stale, fresh])
  const rows = await f.approve(p)
  assert.equal(rows.length, 1); assert.equal(rows[0].offer.productId, fresh.product.productId)
})

test('robust approval releases aliases of promoted items lost during exact-slot reconciliation', async t => {
  const f = await approvalFixture(t, '2026-11-09T21:00:00Z')
  const keep = f.item({ sendOrder: 0 })
  const invalid = f.item({ fitScore: 10 })
  const shared = f.item({ state: 'RESERVE', score: 99, observedAt: '2026-11-08T21:01:00Z', sendOrder: 1 })
  const other = { ...structuredClone(shared), id: randomUUID(), audienceSlug: 'masculino', state: 'SELECTED', sendOrder: 0 }
  const replacement = f.item({ state: 'RESERVE', score: 80, sendOrder: 1 })
  const p = await f.plan([keep, invalid, shared, other, replacement])
  const rows = await f.approve(p)
  assert.equal(rows.length, 3)
  assert.equal(rows.find(r => r.audienceSlug === 'masculino').offer.productId, shared.product.productId)
  assert.equal(p.items.find(i => i.id === shared.id).state, 'RESERVE')
})

for (const cause of ['SMART_CONNECTION_CHANGED', 'SMART_BINDINGS_CHANGED', 'DAILY_INVENTORY_SHORTAGE', 'CONFLICT', 'LATE_ANALYSIS']) test(`robust worker retries transient ${cause} with the latest revision`, async t => {
  const f = await approvalFixture(t)
  const p = await f.plan([f.item()])
  await sequelize.query(`INSERT INTO daily_automation_runs(user_id,local_date,request_id,config,status,plan_uuid,last_error)
    VALUES(:userId,'2026-11-09',:requestId,CAST(:config AS JSONB),'OPERATOR_ATTENTION',:uuid,:code)`, {
    replacements: { userId: f.user.id, requestId: p.input.requestId, config: JSON.stringify(f.config), uuid: p.uuid, code: cause } })
  await new DailyAutomationService(f.smart, { async collect() { assert.fail('No recollection') } }).tick(f.config)
  assert.equal((await f.run()).status, 'SCHEDULED')
  assert.equal(await SmartSend.count({ where: { planId: p.id } }), 1)
})

test('robust worker preserves an unmarked legacy operator edit after the held checkpoint', async t => {
  const f = await approvalFixture(t)
  const p = await f.plan([f.item()])
  await sequelize.query(`INSERT INTO daily_automation_runs(user_id,local_date,request_id,config,status,plan_uuid,last_error)
    VALUES(:userId,'2026-11-09',:requestId,CAST(:config AS JSONB),'OPERATOR_ATTENTION',:uuid,'DAILY_NOVELTY_CONFLICT')`, {
    replacements: { userId: f.user.id, requestId: p.input.requestId, config: JSON.stringify(f.config), uuid: p.uuid } })
  await sequelize.query("UPDATE smart_plans SET updated_at=NOW()+INTERVAL '1 second',revision=revision+1 WHERE id=:id", { replacements: { id: p.id } })
  await new DailyAutomationService(f.smart, { async collect() { assert.fail('No recollection') } }).tick(f.config)
  assert.equal((await f.run()).last_error, 'DAILY_OPERATOR_HOLD')
  assert.equal(await SmartSend.count({ where: { planId: p.id } }), 0)
})

test('robust reserve freshness uses the actual slot rather than end of window', async t => {
  const f = await approvalFixture(t, '2026-11-09T21:00:00Z')
  const repeated = f.item()
  const reserve = f.item({ state: 'RESERVE', observedAt: '2026-11-08T21:30:00Z' })
  const p = await f.plan([repeated, reserve])
  await ProductGroupDelivery.create({ userId: f.user.id, connectionScope: f.scope, groupId: 'other@g.us', groupName: 'Other',
    offerIdentity: `mercadolivre:${repeated.product.productId}`, offerSource: 'mercadolivre', offerProductId: repeated.product.productId,
    offerUrl: repeated.product.affiliateUrl, offerTitle: repeated.product.title, status: 'SENT', sentAt: new Date() })
  const rows = await f.approve(p)
  assert.equal(rows.length, 1); assert.equal(rows[0].offer.productId, reserve.product.productId)
  assert.equal(rows[0].scheduledAt.toISOString(), '2026-11-09T21:00:00.000Z')
})

test('robust approval reevaluates local duplicates and standout counts after dropping stale evidence', async t => {
  const f = await approvalFixture(t)
  f.policies.domestica.maxStandouts = 1
  const stale = f.item({ standout: true, score: 99, observedAt: '2026-11-07T10:00:00Z' })
  const fresh = { ...structuredClone(stale), id: randomUUID(), score: 90, observedAt: new Date().toISOString() }
  const p = await f.plan([stale, fresh])
  const rows = await f.approve(p)
  assert.equal(rows.length, 1)
  assert.equal(p.items.find(i => i.id === fresh.id).state, 'SELECTED')
})

test('robust worker prioritizes a current-day held approval over expired historical holds', async t => {
  const f = await approvalFixture(t)
  const current = await f.plan([f.item()])
  const old = await SmartPlan.create({ userId: f.user.id, status: 'REVIEW', startDate: '2026-11-08', days: 1, timezone: f.config.timezone,
    audienceSlugs: [], input: { requestId: dailyRequestId(f.user.id, '2026-11-08') }, items: [], settings: { dailyAutomation: {} } })
  for (const p of [old, current]) await sequelize.query(`INSERT INTO daily_automation_runs(user_id,local_date,request_id,config,status,plan_uuid,last_error)
    VALUES(:userId,:date,:requestId,CAST(:config AS JSONB),'OPERATOR_ATTENTION',:uuid,'DAILY_NOVELTY_CONFLICT')`, {
    replacements: { userId: f.user.id, date: p.startDate, requestId: p.input.requestId, config: JSON.stringify(f.config), uuid: p.uuid } })
  await new DailyAutomationService(f.smart, {}).tick(f.config)
  assert.equal((await current.reload()).status, 'SCHEDULED')
  assert.equal((await old.reload()).status, 'CANCELLED')
})

test('automatic cooldown run reconciles approval races and stale evidence with fresh reserves before a flagged repeat', async () => {
  const f = await setup()
  f.config = { ...f.config, repeatCooldownDays: 30, candidateLimit: 7, endTime: '09:10' }
  const domestic = Array.from({ length: 7 }, (_, index) => cooldownOffer(`MLB9880030${index}`, `Panela QA ${index}`, index === 6 ? 90 : 600))
  const male = Array.from({ length: 7 }, (_, index) => cooldownOffer(`MLB9880040${index}`, index ? `Barbeador político ${index}` : 'Barbeador QA'))
  await cooldownDelivery(f, domestic[6], 40)
  const { smart, analyzed } = cooldownSmart(f, [...domestic, ...male])
  let collections = 0
  const collector = { async collect() {
    collections++
    return [domestic, male].map((offers, index) => ({ name: `combined-${index}.json`, targetAudienceSlug: index ? 'masculino' : 'domestica',
      json: { extractedAt: new Date().toISOString(), offers, cards: offers.map(offer => ({ ...offer, commissionedUrl: offer.affiliateUrl })) } }))
  } }
  const service = new DailyAutomationService(smart, collector)
  await service.tick(f.config)
  const run = await f.run()
  const plan = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
  await smart.processPendingAnalysis(plan.id)
  await service.tick(f.config)
  await plan.reload()
  assert.equal(plan.status, 'ANALYZING')
  assert.equal(plan.settings.dailyAutomation.repeatFallbackReady, true)
  assert.equal((await f.run()).discovery_state.exhausted, true)
  const paid = analyzed.length
  await smart.processPendingAnalysis(plan.id)
  await plan.reload()
  assert.equal(analyzed.length, paid, 'Fallback rebuild reuses persisted classification')
  const original = plan.items.filter(item => item.audienceSlug === 'domestica' && item.state === 'SELECTED')
  const reserves = plan.items.filter(item => item.audienceSlug === 'domestica' && item.state === 'RESERVE' && !item.repeatFallback)
  const repeat = plan.items.find(item => item.audienceSlug === 'domestica' && item.repeatFallback)
  assert.equal(original.length, 4)
  assert.equal(reserves.length, 2)
  await sequelize.query(`UPDATE daily_automation_runs SET status='OPERATOR_ATTENTION',last_error='DAILY_NOVELTY_CONFLICT',
    approval_revision=:revision,next_attempt_at=NOW() WHERE id=:id`, { replacements: { id: run.id, revision: plan.revision } })
  const approve = smart.approve.bind(smart)
  let approvalQueries = 0
  smart.approve = async (...args) => {
    await cooldownDelivery(f, original[0].product, 1, { offerProductId: 'MLB99990001', offerUrl: original[0].product.affiliateUrl })
    const other = await SmartPlan.create({ userId: f.user.id, status: 'PAUSED', startDate: plan.startDate, days: 1,
      timezone: f.config.timezone, audienceSlugs: [], input: {}, settings: {}, items: [] })
    await noveltySend(f.user.id, other, original[1].product, 'UNKNOWN', { groupId: 'unrelated@g.us' })
    const items = structuredClone(plan.items)
    items.find(item => item.id === original[2].id).observedAt = new Date(Date.now() - 25 * 3600000).toISOString()
    Object.assign(items.find(item => item.id === repeat.id), { score: 999, pinned: true, sendOrder: 0 })
    await plan.update({ items })
    const query = sequelize.query.bind(sequelize)
    sequelize.query = (sql, ...values) => {
      if (typeof sql === 'string' && sql.includes('WITH daily_history AS')) approvalQueries++
      return query(sql, ...values)
    }
    try { return await approve(...args) } finally { sequelize.query = query }
  }
  await service.tick(f.config)
  await plan.reload()
  const completed = await f.run()
  assert.equal(completed.status, 'SCHEDULED')
  assert.equal(completed.approval_attempts, 1)
  assert.equal(plan.status, 'SCHEDULED')
  assert.equal(approvalQueries, 2, 'Each audience shares one cooldown-aware history snapshot across reconciliation passes')
  const retained = plan.items.filter(item => item.state === 'SELECTED' && item.audienceSlug === 'domestica').sort((a, b) => a.sendOrder - b.sendOrder)
  assert.equal(retained.length, 4)
  assert.deepEqual(retained.map(item => item.sendOrder), [0, 1, 2, 3])
  assert.ok(reserves.every(reserve => retained.some(item => item.id === reserve.id)))
  assert.equal(retained.at(-1).id, repeat.id, 'Fresh products precede repeats despite pins, score and price band')
  assert.ok(retained.at(-1).warnings.includes('Repetição após 30 dias'))
  for (const item of original.slice(0, 3)) assert.equal(plan.items.find(value => value.id === item.id).state, 'RESERVE')
  assert.ok(plan.items.find(item => item.id === original[2].id).warnings.includes('DAILY_ITEM_FRESHNESS'))
  assert.equal(plan.progress.repeatSelected, 1)
  assert.equal(completed.discovery_state.repeatSelected, 1)
  const sends = await SmartSend.findAll({ where: { planId: plan.id } })
  assert.equal(sends.length, 5)
  assert.equal(sends.filter(send => send.audienceSlug === 'domestica').length, 4)
  const [audit] = await sequelize.query(`SELECT metadata FROM smart_operation_events WHERE user_id=:userId AND action='SMART_PLAN_APPROVED'`, {
    replacements: { userId: f.user.id }, type: 'SELECT' })
  assert.equal(audit.metadata.repeatSelected, 1)
  assert.equal(audit.metadata.sendCount, 5)
  assert.equal(audit.metadata.approvalMode, 'automatic')
  assert.equal(collections, 1)
  assert.equal(analyzed.length, paid)
})

for (const code of ['DAILY_NOVELTY_CONFLICT', 'DAILY_OPERATOR_HOLD', 'DAILY_APPROVAL_RETRY_LIMIT']) test(`held ${code} recovery checkpoints an operator-approved plan without AI or collection`, async t => {
  const f = await approvalFixture(t)
  const p = await f.plan([f.item()])
  const attempts = code === 'DAILY_APPROVAL_RETRY_LIMIT' ? 256 : 0
  await sequelize.query(`INSERT INTO daily_automation_runs(user_id,local_date,request_id,config,status,plan_uuid,last_error,approval_attempts)
    VALUES(:userId,:date,:requestId,CAST(:config AS JSONB),'OPERATOR_ATTENTION',:uuid,:code,:attempts)`, {
    replacements: { userId: f.user.id, date: p.startDate, requestId: p.input.requestId, config: JSON.stringify(f.config), uuid: p.uuid, code, attempts } })
  if (code === 'DAILY_OPERATOR_HOLD') await p.update({ settings: { ...p.settings, dailyAutomation: { ...p.settings.dailyAutomation, operatorHold: true } } })
  await f.smart.approve(f.user.id, p.uuid, p.revision)
  env.AI_ENABLED = false
  try { await new DailyAutomationService({}, {}).tick(f.config) } finally { env.AI_ENABLED = true }
  assert.equal((await f.run()).status, 'SCHEDULED')
  assert.equal((await f.run()).approval_attempts, attempts)
  assert.equal(await SmartSend.count({ where: { planId: p.id } }), 1)
})

test('automatic approval stops at the persisted retry limit without rebuilding or recollecting', async t => {
  const f = await approvalFixture(t)
  const p = await f.plan([f.item()])
  await sequelize.query(`INSERT INTO daily_automation_runs(user_id,local_date,request_id,config,status,plan_uuid,last_error,approval_attempts)
    VALUES(:userId,:date,:requestId,CAST(:config AS JSONB),'OPERATOR_ATTENTION',:uuid,'DAILY_NOVELTY_CONFLICT',255)`, {
    replacements: { userId: f.user.id, date: p.startDate, requestId: p.input.requestId, config: JSON.stringify(f.config), uuid: p.uuid } })
  const { AppError } = require('../dist/middleware/Error/AppError')
  let approvals = 0
  const worker = new DailyAutomationService({ async approve() { approvals++; throw new AppError('race', 409, 'SMART_CONNECTION_CHANGED') } }, {})
  await worker.tick(f.config)
  const run = await f.run()
  assert.equal(run.approval_attempts, 256)
  assert.equal(run.last_error, 'DAILY_APPROVAL_RETRY_LIMIT')
  await sequelize.query('UPDATE daily_automation_runs SET next_attempt_at=NOW() WHERE id=:id', { replacements: { id: run.id } })
  await worker.tick(f.config)
  assert.equal(approvals, 1)
  assert.equal((await p.reload()).status, 'REVIEW')
})

test('terminal recovery preserves account scope, backoff and an active worker lease', async t => {
  const f = await approvalFixture(t)
  const other = await setup()
  const p = await f.plan([f.item()])
  await f.smart.approve(f.user.id, p.uuid, p.revision)
  const token = randomUUID()
  await sequelize.query(`INSERT INTO daily_automation_runs(user_id,local_date,request_id,config,status,plan_uuid,last_error,lease_token,lease_until,next_attempt_at)
    VALUES(:userId,:date,:requestId,CAST(:config AS JSONB),'OPERATOR_ATTENTION',:uuid,'DAILY_OPERATOR_HOLD',:token,NOW()+INTERVAL '1 hour',NOW()+INTERVAL '1 hour')`, {
    replacements: { userId: f.user.id, date: p.startDate, requestId: p.input.requestId, config: JSON.stringify(f.config), uuid: p.uuid, token } })
  await new DailyAutomationService({}, {}).tick(f.config)
  await other.service.tick(other.config)
  const held = await f.run()
  assert.equal(held.status, 'OPERATOR_ATTENTION')
  assert.equal(held.lease_token, token)
  assert.equal(held.approval_attempts, 0)
  assert.equal((await other.run()).status, 'ANALYZING')
  assert.equal(other.calls.create, 1)
})

test('daily planning and automatic reconciliation reserve colour variants and backfill distinct products', async () => {
  const f = await setup()
  const products = [cooldownOffer('MLB99886001', 'Cafeteira Nescafé Dolce Gusto Genio S Basic Grafite', 400),
    cooldownOffer('MLB99886002', 'Cafeteira Nescafé Dolce Gusto Genio S Basic Branca 110v', 400),
    cooldownOffer('MLB99886003', 'Cafeteira Nescafé Dolce Gusto Genio S Plus Preto', 400),
    cooldownOffer('MLB99886004', 'Panela de pressão Inox', 100)]
  const { smart } = cooldownSmart(f, products)
  const created = await smart.createPlan(f.user.id, { requestId: randomUUID(), date: dailyWindow(f.config).date, days: 1,
    audienceSlugs: ['domestica'], payloads: [{ name: 'variants', json: {} }], campaignStartTime: '08:00',
    settings: { dailyCap: 3, maxStandouts: 0, dailySelection: { minRating: 4.5, minSoldCount: 100, minFitScore: 75, minCommercialScore: 60 } },
  }, { runId: randomUUID(), localDate: dailyWindow(f.config).date, minimumItems: 3, startTime: '08:00', endTime: '19:00', repeatCooldownDays: 30 })
  const plan = await SmartPlan.findOne({ where: { uuid: created.id } })
  await smart.processPendingAnalysis(plan.id)
  await plan.reload()
  const selectedIds = () => plan.items.filter(i => i.state === 'SELECTED').map(i => i.product.productId)
  assert.equal(selectedIds().length, 3)
  assert.equal(selectedIds().filter(id => ['MLB99886001', 'MLB99886002'].includes(id)).length, 1)
  assert.ok(selectedIds().includes('MLB99886003'), 'Plus is a distinct model')
  // A review edit can reintroduce a variant; automatic approval must replace it.
  const items = structuredClone(plan.items)
  items.forEach(i => { i.state = i.product.productId === 'MLB99886004' ? 'RESERVE' : 'SELECTED' })
  await plan.update({ items })
  await smart.approve(f.user.id, plan.uuid, plan.revision, { automatic: true })
  await plan.reload()
  assert.equal(selectedIds().length, 3)
  assert.equal(selectedIds().filter(id => ['MLB99886001', 'MLB99886002'].includes(id)).length, 1)
  assert.ok(selectedIds().includes('MLB99886004'))
  assert.equal(await SmartSend.count({ where: { planId: plan.id } }), 3)
})

test('daily cooldown catches known models sold under different listing IDs without excluding kits or other groups', async () => {
  const f = await setup()
  const old = cooldownOffer('MLB99886101', 'Aspirador de Pó e Água WAP GTW 10 1400W de Potência com Bocal de Sopro')
  const alias = cooldownOffer('MLB99886102', 'Aspirador De Pó e Água Wap Gtw 10 Compacto 1400w 10 Litros Amarelo')
  await cooldownDelivery(f, old, 1)
  const { dailyProductHistory } = require('../dist/services/dailyNovelty')
  const history = (offer, group = 'domestica@g.us') => dailyProductHistory(f.user.id, -1, randomUUID(), offer, { repeatCooldownDays: 30, groupIds: [group] })
  assert.equal((await history(alias)).conflict, true)
  assert.equal((await history(alias, 'masculino@g.us')).conflict, false)
  assert.equal((await history({ ...alias, title: 'Kit Aspirador WAP GTW 10 + Sacos extras' })).conflict, false)
  assert.equal((await history({ ...alias, title: 'Aspirador de pó WAP GTW 12 Inox' })).conflict, false)
  const blender = cooldownOffer('MLB99886103', 'Liquidificador Turbo Power Mondial Preto 550W L-99 FB')
  await cooldownDelivery(f, blender, 40)
  const cooled = await history(cooldownOffer('MLB99886104', 'Liquidificador Turbo Power Mondial 550W - L-99 FB'))
  assert.deepEqual(cooled, { conflict: false, repeat: true })
})

test('session outage retries until morning then auto-approves fresh retained inventory and eligible repeats without browsing', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T22:00:00Z').getTime() })
  const f = await setup()
  f.config = { ...f.config, planningDaysAhead: 1, collectTime: '19:00', repeatCooldownDays: 30 }
  const offers = [cooldownOffer('MLB98765901'), cooldownOffer('MLB98765902', 'Barbeador QA'),
    cooldownOffer('MLB98765903', 'Panela antiga'), cooldownOffer('MLB98765904', 'Panela repetida ontem'), cooldownOffer('MLB98765905', 'Panela sem atribuição')]
  offers[2].extensionEvidence.extractedAt = '2026-11-08T10:00:00Z'
  offers[4].commissioned = false
  await cooldownDelivery(f, offers[1], 40, { groupId: 'masculino@g.us' })
  await cooldownDelivery(f, offers[3], 1)
  await SmartPlan.create({ userId: f.user.id, status: 'COMPLETED', startDate: '2026-11-09', days: 1,
    timezone: f.config.timezone, audienceSlugs: ['domestica', 'masculino'], input: { offers }, items: [], settings: {} })
  const { smart } = cooldownSmart(f, [])
  smart.imports = new (require('../dist/services/OfferImportService').OfferImportService)()
  const alerts = []
  let collections = 0
  const collector = { async collect() { collections++; throw new DailyCollectionError('AUTH_REQUIRED') } }
  const notices = { enqueue: async (...args) => alerts.push(args[3]), enqueueInventoryLow: async () => {} }
  const service = new DailyAutomationService(smart, collector, notices)
  await service.tick(f.config)
  let run = await f.run()
  assert.equal(run.status, 'RETRY')
  assert.equal(new Date(run.next_attempt_at).getTime() - new Date(run.updated_at).getTime(), 60_000)
  await service.tick(f.config)
  assert.equal(collections, 1, 'Scheduler polls must honor durable backoff')
  await sequelize.query('UPDATE daily_automation_runs SET next_attempt_at=NOW() WHERE id=:id', { replacements: { id: run.id } })
  await service.tick(f.config)
  run = await f.run()
  assert.equal(new Date(run.next_attempt_at).getTime() - new Date(run.updated_at).getTime(), 120_000)
  t.mock.timers.setTime(new Date('2026-11-10T10:30:00Z').getTime())
  await sequelize.query('UPDATE daily_automation_runs SET next_attempt_at=NOW() WHERE id=:id', { replacements: { id: run.id } })
  const resumed = new DailyAutomationService(smart, collector, notices)
  for (let tick = 0; tick < 5; tick++) {
    await resumed.tick(f.config)
    run = await f.run()
    if (run.plan_uuid) {
      const plan = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
      if (plan.status === 'ANALYZING') await smart.processPendingAnalysis(plan.id)
    }
    await sequelize.query('UPDATE daily_automation_runs SET next_attempt_at=NOW() WHERE id=:id', { replacements: { id: run.id } })
  }
  run = await f.run()
  assert.equal(run.status, 'SCHEDULED', JSON.stringify({ status: run.status, error: run.last_error, items: (await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })).items.map(i => ({ id: i.product?.productId, state: i.state, reason: i.reason })) }))
  assert.equal(run.local_date, '2026-11-10')
  assert.equal(collections, 2, 'No further live collection/replenishment after the cutoff')
  const plan = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
  const selected = plan.items.filter(item => item.state === 'SELECTED')
  assert.deepEqual(selected.map(item => item.product.productId).sort(), offers.slice(0, 2).map(offer => offer.productId).sort())
  assert.equal(selected.find(item => item.product.productId === offers[1].productId).repeatFallback, true)
  assert.ok(selected.every(item => item.observedAt === offers[0].extensionEvidence.extractedAt))
  assert.ok(alerts.includes('AUTH_REQUIRED'))
  assert.ok(alerts.includes('DAILY_SESSION_FALLBACK'))
  assert.equal(await SmartSend.count({ where: { planId: plan.id } }), 2)
})

test('offline fallback preserves a completed audience and adds saved inventory without renewing observation times', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T22:00:00Z').getTime() })
  const f = await setup()
  f.config = { ...f.config, planningDaysAhead: 1, collectTime: '19:00' }
  const retained = cooldownOffer('MLB98765911')
  const saved = cooldownOffer('MLB98765912', 'Barbeador QA')
  const { SavedProduct } = require('../dist/database/models/SavedProduct')
  await SavedProduct.create({ userId: f.user.id, offer: saved, affiliateUrl: saved.affiliateUrl, affiliateUrlHash: 'a'.repeat(64) })
  const { smart } = cooldownSmart(f, [])
  smart.imports = new (require('../dist/services/OfferImportService').OfferImportService)()
  const collector = { async collect(_requests, _signal, checkpoint) {
    await checkpoint({ name: 'retained.json', targetAudienceSlug: 'domestica', json: { offers: [retained] } })
    throw new DailyCollectionError('AUTH_REQUIRED')
  } }
  const service = new DailyAutomationService(smart, collector)
  await service.tick(f.config)
  const initial = await f.run()
  assert.equal(initial.payloads[0].json.offers[0].extensionEvidence.extractedAt, retained.extensionEvidence.extractedAt)
  t.mock.timers.setTime(new Date('2026-11-10T10:30:00Z').getTime())
  for (let step = 0; step < 4; step++) {
    await sequelize.query('UPDATE daily_automation_runs SET next_attempt_at=NOW() WHERE id=:id', { replacements: { id: initial.id } })
    await service.tick(f.config)
    const run = await f.run()
    if (run.plan_uuid) {
      const plan = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
      if (plan.status === 'ANALYZING') await smart.processPendingAnalysis(plan.id)
    }
  }
  const run = await f.run()
  assert.equal(run.status, 'SCHEDULED')
  const sends = await SmartSend.findAll({ where: { userId: f.user.id } })
  assert.deepEqual(sends.map(s => s.offer.productId).sort(), [retained.productId, saved.productId].sort())
  assert.ok(sends.every(s => s.evidenceObservedAt.toISOString() === saved.extensionEvidence.extractedAt))
})

test('offline inventory with no qualifying observation or disabled repeats alerts without fabricating a plan', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-10T10:30:00Z').getTime() })
  const f = await setup()
  const offer = cooldownOffer('MLB98765921')
  await cooldownDelivery(f, offer, 40)
  await SmartPlan.create({ userId: f.user.id, status: 'COMPLETED', startDate: '2026-11-09', days: 1,
    timezone: f.config.timezone, audienceSlugs: ['domestica'], input: { offers: [offer] }, items: [], settings: {} })
  const alerts = []
  const service = new DailyAutomationService(f.smart, { async collect() { throw new DailyCollectionError('AUTH_REQUIRED') } },
    { enqueue: async (...args) => alerts.push(args[3]) })
  await service.tick(f.config)
  await service.tick(f.config)
  const run = await f.run()
  assert.equal(run.status, 'OPERATOR_ATTENTION')
  assert.equal(run.last_error, 'DAILY_OFFLINE_INVENTORY_EMPTY')
  assert.equal(run.plan_uuid, null)
  assert.equal(f.calls.create, 0)
  assert.ok(alerts.includes('DAILY_OFFLINE_INVENTORY_EMPTY'))
})

test('offline approval appends a durable partial discovery round before using the qualified remainder', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T22:00:00Z').getTime() })
  const f = await setup()
  f.config = { ...f.config, planningDaysAhead: 1, collectTime: '19:00' }
  await f.service.tick(f.config)
  const run = await f.run()
  const plan = await SmartPlan.findOne({ where: { uuid: run.plan_uuid } })
  await plan.update({ status: 'REVIEW' })
  const pending = [{ name: 'partial-round.json', targetAudienceSlug: 'domestica', json: { offers: [cooldownOffer('MLB98765931')] } }]
  await sequelize.query('UPDATE daily_automation_runs SET discovery_state=CAST(:state AS JSONB),next_attempt_at=NOW() WHERE id=:id', {
    replacements: { id: run.id, state: JSON.stringify({ offline: true, exhausted: true, round: 1, pending }) },
  })
  let appended = 0
  f.smart.appendDailyProducts = async (_user, uuid, _revision, payloads) => {
    appended++
    assert.equal(uuid, plan.uuid)
    assert.deepEqual(payloads, pending)
    await plan.update({ status: 'ANALYZING' })
  }
  await f.service.tick(f.config)
  const resumed = await f.run()
  assert.equal(appended, 1)
  assert.equal(f.calls.collect, 1, 'Only the original initial collection allocated a browser')
  assert.equal(resumed.status, 'ANALYZING')
  assert.equal(resumed.discovery_state.pending, undefined)
  assert.ok(resumed.payloads.some(payload => payload.name === pending[0].name))
})

test('09:26 approval reserves enough cadence headroom and staggers audiences through the last slot', async t => {
  const f = await approvalFixture(t, '2026-11-09T12:26:17.592Z')
  const items = ['domestica', 'masculino'].flatMap(audienceSlug =>
    Array.from({ length: 30 }, () => f.item({ audienceSlug })))
  const p = await f.plan(items)
  const rows = await f.approve(p)
  assert.equal(rows.length, 56, '28 sends fit per audience with polling/provider headroom; extras remain reserves')
  assert.equal(p.items.filter(i => i.state === 'RESERVE').length, 4)
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].scheduledAt - rows[i - 1].scheduledAt >= 60000, 'Shared account needs distinct polling slots')
  }
  for (const slug of ['domestica', 'masculino']) {
    const audience = rows.filter(row => row.audienceSlug === slug)
    for (let i = 1; i < audience.length; i++) {
      assert.ok(audience[i].scheduledAt - audience[i - 1].scheduledAt >= 1260000)
    }
  }
})

test('full daily approval staggers equal last slots before the exclusive window end', async t => {
  const f = await approvalFixture(t)
  const p = await f.plan(['domestica', 'masculino'].flatMap(audienceSlug =>
    Array.from({ length: 30 }, () => f.item({ audienceSlug }))))
  const rows = await f.approve(p)
  assert.equal(rows.length, 60)
  assert.ok(rows.at(-1).scheduledAt <= new Date('2026-11-09T21:58:00Z'))
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].scheduledAt - rows[i - 1].scheduledAt >= 60000)
  }
})

test('late daily sender delivers every fitted slot with 30-second polling and provider latency', async t => {
  const f = await approvalFixture(t, '2026-11-09T12:26:17.592Z')
  const p = await f.plan(['domestica', 'masculino'].flatMap(audienceSlug =>
    Array.from({ length: 30 }, () => f.item({ audienceSlug }))))
  const rows = await f.approve(p)
  const groups = new Map(rows.map(row => [row.groupId, { id: row.groupId, name: row.audienceSlug, size: 20, announceOnly: false }]))
  const { SmartCampaignSender } = require('../dist/services/SmartCampaignSender')
  let providerCalls = 0
  const provider = { async sendText() {
    providerCalls++
    t.mock.timers.setTime(Date.now() + 3000)
    return { id: randomUUID(), status: 'sent' }
  } }
  const sender = new SmartCampaignSender(provider,
    { async requireConnectedContext() { return { scope: f.scope, creds: {} } } },
    { async requireCurrentGroups() { return groups } }, { now: () => new Date() })
  let ticks = 0
  while (ticks++ < 200) {
    const next = await SmartSend.findOne({ where: { planId: p.id, status: 'PENDING' }, order: [['scheduledAt', 'ASC']] })
    if (!next) break
    // Wake on the worker's fixed polling grid, independent of acceptance latency.
    t.mock.timers.setTime(Math.ceil(Math.max(Date.now() + 1, next.scheduledAt.getTime()) / 30000) * 30000)
    await sender.processDue()
  }
  assert.ok(ticks < 200)
  const finished = await SmartSend.findAll({ where: { planId: p.id } })
  assert.deepEqual(finished.filter(row => row.status !== 'SENT').map(row => row.lastError), [])
  assert.equal(providerCalls, rows.length)
  assert.ok(finished.every(row => row.sentAt < new Date('2026-11-09T22:00:00Z')))
})

test('legacy lifetime variant history explains a conflict without another plan or a self-conflict', async t => {
  const f = await approvalFixture(t, '2026-11-09T20:16:30Z')
  const old = f.item()
  old.product.title = 'Caixa De Som Bluetooth JBL Boombox 4 PRETA'
  const current = f.item()
  current.product.title = 'Jbl Boombox 4 Caixa De Som Com Bluetooth Cor Laranja'
  const p = await f.plan([current])
  const { dailyProductHistory } = require('../dist/services/dailyNovelty')
  const { offerIdentity } = require('../dist/utils/offerIdentity')
  const delivery = (item, planUuid, sentAt) => ProductGroupDelivery.create({
    userId: f.user.id, connectionScope: f.scope, groupId: 'domestica@g.us', groupName: 'QA',
    offerIdentity: offerIdentity(item.product), offerSource: 'mercadolivre', offerProductId: item.product.productId,
    offerUrl: item.product.affiliateUrl, offerTitle: item.product.title, status: 'SENT', sentAt, planUuid,
  })
  await delivery(old, null, new Date('2026-09-28T18:09:00Z'))
  // The exact current product in this plan must be excluded from history.
  await delivery(current, p.uuid, new Date('2026-11-09T12:48:00Z'))
  const policy = { groupIds: ['domestica@g.us'], now: new Date() }
  assert.deepEqual(await dailyProductHistory(f.user.id, p.id, p.uuid, current.product, policy), { conflict: true, repeat: false })
  assert.deepEqual(await dailyProductHistory(f.user.id, p.id, p.uuid, current.product, { ...policy, repeatCooldownDays: 30 }), { conflict: false, repeat: true })
  assert.equal(await SmartPlan.count({ where: { userId: f.user.id } }), 1)
})

test('identical end slots fit the account gap normally but a delayed last minute can skip the second', async t => {
  const f = await approvalFixture(t, '2026-11-09T21:00:00Z')
  const { SmartCampaignSender } = require('../dist/services/SmartCampaignSender')
  for (const minute of ['58:00', '59:45']) {
    t.mock.timers.setTime(new Date('2026-11-09T21:00:00Z').getTime())
    const p = await f.plan(['domestica', 'masculino'].map(audienceSlug => f.item({ audienceSlug })))
    const rows = await f.approve(p)
    await SmartSend.update({ scheduledAt: new Date('2026-11-09T21:58:00Z') }, { where: { planId: p.id } })
    const groups = new Map(rows.map(row => [row.groupId, { id: row.groupId, name: row.audienceSlug }]))
    const provider = { async sendText() { t.mock.timers.setTime(Date.now() + 3000); return { id: randomUUID(), status: 'sent' } } }
    const sender = new SmartCampaignSender(provider,
      { async requireConnectedContext() { return { scope: f.scope, creds: {} } } },
      { async requireCurrentGroups() { return groups } }, { now: () => new Date() })
    t.mock.timers.setTime(new Date(`2026-11-09T21:${minute}Z`).getTime())
    await sender.processDue()
    if (minute === '58:00') {
      t.mock.timers.setTime(new Date('2026-11-09T21:58:30Z').getTime())
      await sender.processDue()
      assert.equal(await SmartSend.count({ where: { planId: p.id, status: 'SENT' } }), 2)
    } else {
      assert.equal(await SmartSend.count({ where: { planId: p.id, status: 'SENT' } }), 1)
      const skipped = await SmartSend.findOne({ where: { planId: p.id, status: 'SKIPPED' } })
      assert.equal(skipped.lastError, 'O intervalo seguro ultrapassa a janela diária.')
    }
    // Independent cases: the prior case must not supply either cadence history.
    await ProductGroupDelivery.destroy({ where: { userId: f.user.id } })
    await SmartSend.destroy({ where: { planId: p.id } })
    await p.destroy()
  }
})

#!/usr/bin/env node
// Offline only: migrate a disposable PostgreSQL database before running this script.
const fs = require('node:fs')
const assert = require('node:assert/strict')
const { randomUUID, createHash } = require('node:crypto')
const args = process.argv.slice(2)
const option = name => args[args.indexOf(name) + 1]
if (!args.includes('--snapshot') || !args.includes('--out')) throw new Error('--snapshot <export.json> --out <results.json> [--forecast] required')
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost'].includes(database.hostname) && database.port === '55450', 'Requires disposable local Postgres on port 55450')
process.env.JWT_SECRET ??= 'selection-replay-local-only-secret-thirty-two-characters'
process.env.LOG_LEVEL = 'warn'
require('reflect-metadata')
const { env } = require('../dist/config/env')
env.AI_ENABLED = true
const { sequelize } = require('../dist/database')
const { User } = require('../dist/database/models/User')
const { SmartAudience } = require('../dist/database/models/SmartAudience')
const { SmartPlan } = require('../dist/database/models/SmartPlan')
const { SmartSend } = require('../dist/database/models/SmartSend')
const { SavedProduct } = require('../dist/database/models/SavedProduct')
const { ProductGroupDelivery } = require('../dist/database/models/ProductGroupDelivery')
require('../dist/database/models').registerAssociations()
const { SmartCampaignService } = require('../dist/services/SmartCampaignService')
const { DailyAutomationService } = require('../dist/services/DailyAutomationService')
const { OfferImportService } = require('../dist/services/OfferImportService')
const { DailyAutomationConfigSchema, dailyItemTarget } = require('../dist/config/dailyAutomation')
const { dailyPriceBand } = require('../dist/utils/dailyCommercialValue')
const { dailyCategoryKey, dailyVariantKey } = require('../dist/utils/dailyAssortment')
const { dailyProductConflicts, dailyOfferAliases } = require('../dist/services/dailyNovelty')
global.fetch = async () => { throw new Error('Network calls forbidden in replay') }
for (const name of ['node:http', 'node:https']) for (const method of ['request', 'get']) require(name)[method] = () => { throw new Error('HTTP calls forbidden in replay') }
const dailySelectionAliases = product => [...dailyOfferAliases(product), ...(dailyVariantKey(product) ? [dailyVariantKey(product)] : [])]
const snapshot = JSON.parse(fs.readFileSync(option('--snapshot'), 'utf8'))
const RealDate = Date
let instant
function setTime(value) {
  instant = new RealDate(value).getTime()
  global.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [instant])) }
    static now() { return instant }
  }
}
const histogram = values => values.reduce((counts, value) => { counts[value] = (counts[value] || 0) + 1; return counts }, {})
const average = values => values.length ? Math.round(values.reduce((a,b) => a+b, 0) / values.length * 10) / 10 : null
function metrics(items, slug) {
  const all = items.filter(i => i.audienceSlug === slug), selected = all.filter(i => i.state === 'SELECTED')
  const ages = selected.map(i => (new Date(i.scheduledAt) - new Date(i.observedAt)) / 3600000)
  return { selected: selected.length, reserves: all.filter(i => i.state === 'RESERVE' && !i.repeatFallback).length,
    repeatReserves: all.filter(i => i.state === 'RESERVE' && i.repeatFallback).length,
    rejected: histogram(all.filter(i => i.state === 'REJECTED').flatMap(i => i.reason.split('; '))),
    planningConflicts: all.filter(i => i.state === 'REJECTED' && /intervalo de repetição/.test(i.reason)).length,
    approvalConflicts: all.filter(i => i.warnings?.includes('DAILY_ITEM_NOVELTY')).length,
    repeatSelected: selected.filter(i => i.repeatFallback).length, freshSelected: selected.filter(i => !i.repeatFallback).length,
    bands: histogram(selected.map(i => dailyPriceBand(i.product.discountedPrice))),
    categories: histogram(selected.map(i => i.category ?? 'outros')), categoryFamilies: histogram(selected.map(i => dailyCategoryKey(i.category))),
    variantDuplicates: selected.length - new Set(selected.map(i => dailySelectionAliases(i.product).at(-1))).size,
    affordableTarget: Math.floor(selected.length * 0.2), premiumTarget: Math.floor(selected.length * 0.2), averageScore: average(selected.map(i => i.score)),
    averageFit: average(selected.map(i => i.fitScore ?? 0)), averageAgeHours: average(ages), maxAgeHours: ages.length ? Math.max(...ages) : null,
    staleAtSlot: selected.filter((i,index) => ages[index] < 0 || ages[index] > 24).length,
    products: selected.map(i => ({ id: i.product.productId, title: i.product.title, price: i.product.discountedPrice, category: i.category, score: i.score, fit: i.fitScore, observedAt: i.observedAt, scheduledAt: i.scheduledAt })) }
}
function policy(config, current = {}) {
  return { ...current, dailyCap: 30, startTime: config.startTime, endTime: config.endTime, minGapSeconds: config.minIntervalMinutes*60,
    maxGapSeconds: config.maxIntervalMinutes*60, spreadAcrossWindow: true, windowEndBufferSeconds: 120, freshnessHours: 24,
    timezone: config.timezone, excludePolitical: true, maxStandouts: 0,
    dailySelection: { minRating: config.minRating, minSoldCount: config.minSoldCount, minFitScore: config.minFitScore, minCommercialScore: config.minCommercialScore } }
}
function asOf(row, time, delivery = false) {
  if (new RealDate(row.created_at) > new RealDate(time)) return null
  const sent = row.sent_at && new RealDate(row.sent_at) <= new RealDate(time)
  // Status transitions are not event-sourced: conservatively reserve rows sent later.
  const status = sent ? 'SENT' : row.sent_at ? (delivery ? 'SENDING' : 'PENDING') : row.status
  return { ...row, status, sent_at: sent ? row.sent_at : null }
}
async function seedHistory(user, source, time, includeToday = false) {
  const dummy = await SmartPlan.create({ userId: user.id, status: 'COMPLETED', startDate: source.start_date, days: 1,
    timezone: source.timezone, audienceSlugs: [], input: {}, settings: {} })
  const deliveries = snapshot.deliveries.filter(r => r.user_id === source.user_id && (includeToday || r.plan_uuid !== source.uuid))
    .map(r => asOf(r,time,true)).filter(Boolean)
  const seen = new Set()
  const deliveryRows = []
  for (const r of deliveries) {
    const key = `${r.connection_scope}:${r.group_id}:${r.offer_identity}`
    if (seen.has(key)) continue
    seen.add(key)
    deliveryRows.push({ userId: user.id, connectionScope: r.connection_scope, offerIdentity: r.offer_identity,
      offerSource: r.offer_source, offerProductId: r.offer_product_id, offerUrl: r.offer_url, offerTitle: r.offer_title,
      groupId: r.group_id, groupName: r.group_name, status: r.status, sentAt: r.sent_at,
      createdAt: r.created_at, updatedAt: r.updated_at })
  }
  await ProductGroupDelivery.bulkCreate(deliveryRows)
  const sends = snapshot.sends.filter(r => r.user_id === source.user_id && (includeToday || r.plan_id !== source.id))
    .map(r => asOf(r,time)).filter(r => r && ['PENDING','SENDING','SENT','UNKNOWN'].includes(r.status))
  const historyPlans = new Map()
  for (const id of new Set(sends.map(r => r.plan_id))) historyPlans.set(id, (await SmartPlan.create({ userId: user.id, status: 'COMPLETED', startDate: source.start_date, days: 1, timezone: source.timezone, audienceSlugs: [], input: {}, settings: {} })).id)
  await SmartSend.bulkCreate(sends.map(r => ({ userId: user.id, planId: historyPlans.get(r.plan_id), audienceSlug: r.audience_slug,
    groupId: r.group_id, groupName: r.group_name, connectionScope: r.connection_scope, offerIdentity: r.offer_identity,
    offer: r.offer, scheduledAt: r.scheduled_at, localDate: r.local_date, timezone: r.timezone,
    evidenceObservedAt: r.evidence_observed_at, status: r.status, sentAt: r.sent_at, createdAt: r.created_at, updatedAt: r.updated_at })))
  return { deliveries: deliveries.length, sends: sends.length }
}
function dependencies(source, analysisById, counters) {
  return new SmartCampaignService(new OfferImportService(), { async save() { return [] } }, {
    async analyze(batch) {
      counters.analyses += batch.length
      return batch.map((offer,index) => {
        const analysis = analysisById.get(offer.productId)
        if (!analysis) { counters.missingAnalyses++; return { index, fits: [], warnings: ['Stored analysis unavailable; no inferred classification'] } }
        return { ...structuredClone(analysis), index }
      })
    }, async standoutCopy() { throw new Error('Copy generation forbidden in replay') },
  }, { async requireCurrentGroups(_userId, ids) { return new Map(ids.map(id => [id, { id, name: id, size: 20, announceOnly: false }])) } },
  { async getConnectionScope() { return snapshot.sends.find(s => s.plan_id === source.id)?.connection_scope ?? 'offline-replay' }, async requireConnectedContext() { return { scope: snapshot.sends.find(s => s.plan_id === source.id)?.connection_scope ?? 'offline-replay', creds: {} } } })
}
async function scenario(source, forecast = false, refresh = true, delayed = false) {
  const run = snapshot.runs.find(r => r.plan_uuid === source.uuid)
  const collectionAt = forecast ? '2026-11-11T22:00:00.000Z' : new RealDate(Math.max(new RealDate(source.created_at).getTime(), ...source.input.observedAt.filter(Boolean).map(v => new RealDate(v).getTime()))).toISOString()
  setTime(collectionAt)
  const user = await User.create({ name: 'Offline selection replay', email: `selection-${randomUUID()}@replay.invalid`, passwordHash: 'unused' })
  try {
    const config = DailyAutomationConfigSchema.parse({ ...run?.config, alertGroupId: undefined, userId: user.id, repeatCooldownDays: 30, autoApprove: true })
    const targetDate = forecast ? '2026-11-12' : source.start_date
    const history = await seedHistory(user, source, collectionAt, forecast)
    const offers = structuredClone(source.input.offers)
    const observations = structuredClone(source.input.observedAt)
    if (forecast && refresh) for (let i=0;i<offers.length;i++) {
      observations[i] = collectionAt
      if (offers[i].extensionEvidence) offers[i].extensionEvidence.extractedAt = collectionAt
    }
    const ids = new Set()
    for (const offer of offers) if (offer.savedProductId && !ids.has(offer.savedProductId)) {
      ids.add(offer.savedProductId)
      await SavedProduct.create({ id: offer.savedProductId, userId: user.id, source: offer.source, productId: offer.productId,
        affiliateUrl: offer.affiliateUrl, affiliateUrlHash: createHash('sha256').update(offer.affiliateUrl).digest('hex'), offer })
    }
    const audiences = []
    for (const slug of source.audience_slugs) {
      const original = snapshot.audiences.find(a => a.user_id === source.user_id && a.slug === slug)
      audiences.push(await SmartAudience.create({ userId: user.id, slug, name: slug, description: original.description, enabled: true,
        profile: original.profile, destinations: original.destinations, policy: policy(config, original.policy) }))
    }
    const analyses = new Map(offers.flatMap((o,index) => source.input.analysisResults[String(index)] ? [[o.productId,source.input.analysisResults[String(index)]]] : []))
    const counters = { analyses: 0, missingAnalyses: 0, collectorCalls: 0 }
    const smart = dependencies(source, analyses, counters)
    const settings = { ...structuredClone(source.settings), audiences: Object.fromEntries(audiences.map(a => [a.slug,a.policy])),
      global: { timezone: config.timezone, campaignStartTime: config.startTime, startNow: false },
      audienceProfiles: source.settings.audienceProfiles ?? Object.fromEntries(audiences.map(a => [a.slug,a.profile])),
      dailyAutomation: { runId: randomUUID(), localDate: targetDate, minimumItems: 30, startTime: config.startTime, endTime: config.endTime, repeatCooldownDays: 30 } }
    let plan
    let daily
    const trace = []
    if (forecast) {
      const payloads = structuredClone(run.payloads)
      for (const payload of payloads) {
        if (refresh) {
          payload.json.extractedAt = collectionAt
          for (const card of payload.json.cards ?? []) {
            if (card.extensionEvidence) card.extensionEvidence.extractedAt = collectionAt
            if ('extractedAt' in card) card.extractedAt = collectionAt
          }
        }
      }
      // Only the captured inventory exists; later discovery deliberately returns no cards.
      daily = new DailyAutomationService(smart, { async collect(requests, _signal, checkpoint) {
        counters.collectorCalls++
        const values = requests.map(request => counters.collectorCalls === 1
          ? payloads.find(p => p.targetAudienceSlug === request.slug) ?? { name: request.slug, targetAudienceSlug: request.slug, json: { cards: [] } }
          : { name: `${request.slug}-${counters.collectorCalls}`, targetAudienceSlug: request.slug, json: { extractedAt: collectionAt, cards: [] } })
        for (const payload of values) if (checkpoint) await checkpoint(payload)
        trace.push({ event: 'collect', requests: requests.map(r => ({ slug: r.slug, limit: r.options.limit,
          mode: r.options.keywords?.length ? 'keywords' : 'hub', excluded: r.options.excludeProductIds?.length ?? 0 })), cards: values.map(p => (p.json.cards ?? []).length) })
        return values
      } })
      await daily.tick(config)
      plan = await SmartPlan.findOne({ where: { userId: user.id, startDate: targetDate, status: 'ANALYZING' } })
    } else {
      plan = await SmartPlan.create({ userId: user.id, uuid: source.uuid, status: 'ANALYZING', startDate: targetDate, days: 1,
        timezone: source.timezone, audienceSlugs: source.audience_slugs,
        input: { ...structuredClone(source.input), offers, observedAt: observations, analysisResults: {} }, settings, items: [], progress: {} })
    }
    if (!plan) return { source: source.uuid, date: targetDate, forecast, refresh, history, counters, trace, hold: 'NO_PLAN_AFTER_COLLECTION' }
    await smart.processPendingAnalysis(plan.id)
    await plan.reload()
    if (plan.status === 'FAILED') throw new Error(`Replay analysis failed: ${JSON.stringify(plan.progress)}`)
    const planning = Object.fromEntries(source.audience_slugs.map(slug => [slug,metrics(plan.items,slug)]))
    let hold = null
    if (forecast) {
      for (let step=0;step<48;step++) {
        const [state] = await sequelize.query('SELECT status,last_error,discovery_state FROM daily_automation_runs WHERE user_id=:id', { replacements: { id: user.id }, type: 'SELECT' })
        trace.push({ event: 'tick', ...state, planStatus: plan.status })
        if (['SCHEDULED','OPERATOR_ATTENTION','ANALYSIS_HOLD','EXPIRED','FAILED'].includes(state.status) || (state.status === 'REVIEW' && state.last_error)) { hold = state.last_error; break }
        await sequelize.query('UPDATE daily_automation_runs SET next_attempt_at=NOW() WHERE user_id=:id', { replacements: { id: user.id } })
        await daily.tick(config)
        await plan.reload()
        if (plan.status === 'ANALYZING') await smart.processPendingAnalysis(plan.id)
        await plan.reload()
      }
      const [state] = await sequelize.query('SELECT status,last_error,discovery_state FROM daily_automation_runs WHERE user_id=:id', { replacements: { id: user.id }, type: 'SELECT' })
      trace.push({ event: 'final', ...state }); hold ??= state.last_error
    } else {
      if (delayed && source.approved_at) {
        setTime(source.approved_at)
        await SmartSend.destroy({ where: { userId: user.id } })
        await ProductGroupDelivery.destroy({ where: { userId: user.id } })
        await seedHistory(user, source, source.approved_at)
      }
      try { await smart.approve(user.id,plan.uuid,plan.revision,{ automatic: true }) } catch(e) { hold = e.code || e.message }
      await plan.reload()
    }
    const reserveDepth = {}
    for (const audience of audiences) {
      const all = plan.items.filter(i => i.audienceSlug === audience.slug)
      const conflicts = await dailyProductConflicts(user.id, plan.id, plan.uuid, all.map(i => i.product), undefined, { repeatCooldownDays: 30, groupIds: audience.destinations.map(d => d.groupId) })
      const occupied = new Set(plan.items.filter(i => i.state === 'SELECTED').flatMap(i => dailySelectionAliases(i.product)))
      let usable = 0
      for (const item of all.filter(i => i.state === 'RESERVE' && !i.repeatFallback)) {
        const aliases = dailySelectionAliases(item.product)
        if (aliases.some(alias => occupied.has(alias)) || dailyOfferAliases(item.product).some(alias => conflicts.has(alias))) continue
        const age = (new Date(`${targetDate}T21:58:00Z`) - new Date(item.observedAt))/3600000
        if (age < 0 || age > 24) continue
        usable++; aliases.forEach(alias => occupied.add(alias))
      }
      reserveDepth[audience.slug] = usable
    }
    return { source: source.uuid, date: targetDate, usableReserveDepth: reserveDepth, historicalMode: source.settings.dailyAutomation ? 'daily' : 'manual-counterfactual',
      forecast, refresh, delayed, collectionAt, approvalAt: new Date().toISOString(), history, counters, planning, approved: Object.fromEntries(source.audience_slugs.map(slug => [slug,metrics(plan.items,slug)])),
      status: plan.status, hold, progress: plan.progress, trace,
      actual: { status: source.status, approvedAt: source.approved_at, selected: Object.fromEntries(source.audience_slugs.map(slug => [slug,metrics(source.items,slug)])),
        sends: histogram(snapshot.sends.filter(s => s.plan_id === source.id).map(s => `${s.audience_slug}:${s.status}`)) } }
  } finally { await User.destroy({ where: { id: user.id } }) }
}
;(async () => {
  const results = []
  const plans = snapshot.plans.filter(p => p.input.offers?.length && p.input.analysisResults && p.settings.audienceProfiles)
  for (const source of args.includes('--forecast-only') ? [] : plans.filter(p => !args.includes('--plan') || p.uuid === option('--plan'))) {
    const result = await scenario(source, false, true, args.includes('--approval-at-production-time'))
    results.push(result)
    console.error(source.start_date,source.uuid.slice(0,8),result.status,result.hold,JSON.stringify(Object.fromEntries(Object.entries(result.approved ?? {}).map(([slug,m]) => [slug,[m.selected,m.reserves,m.bands]]))))
    fs.writeFileSync(option('--out'),JSON.stringify({ version: 1, snapshotExportedAt: snapshot.exportedAt, results },null,2))
  }
  if (args.includes('--forecast')) for (const refresh of [false,true]) {
    const result = await scenario(snapshot.plans.at(-1),true,refresh)
    results.push(result)
    console.error('forecast',refresh,result.status,result.hold,JSON.stringify(result.counters))
  }
  fs.writeFileSync(option('--out'),JSON.stringify({ version: 1, snapshotExportedAt: snapshot.exportedAt, results },null,2))
})().catch(e => { console.error(e.stack, e.message, e.original?.message); process.exitCode = 1 }).finally(async () => { global.Date = RealDate; await sequelize.close() })

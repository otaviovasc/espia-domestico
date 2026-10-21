import assert from 'node:assert/strict'
import test from 'node:test'
import { audienceInput, audienceValidation, splitAudienceTerms, validPlanDate, inferFileAudience, countFileOffers, optionalNumber, smartLocalDate, campaignTimingValidation, canAdvanceSmartPlan, nextSmartDelivery, smartCampaignStart, reservedSmartStart, planAudienceContext, smartCsvCell, smartDeliveriesCsv, safeAffiliateUrl, smartRecoveryReason, historyDateValidation } from '../src/lib/smartCampaignUi.ts'

const audience = { enabled: true, destinationGroupIds: ['group-b', 'group-a'], profile: { instructions: 'Ofertas de cozinha e organização para casa.', keywords: ['cozinha'], negativeKeywords: [] }, dailyCap: 50, startTime: '09:00', endTime: '21:00', minIntervalMinutes: 12, maxIntervalMinutes: 16, maxStandoutMessages: 3 }
const input = (overrides = {}) => audienceInput({ ...audience, ...overrides }, 'cozinha, casa', '')

test('audience drafts compare editable values and clear commission floors explicitly', () => {
  assert.deepEqual(input(), audienceInput({ ...audience, destinationGroupIds: ['group-a', 'group-b'], updatedAt: 'later' }, 'cozinha, casa', ''))
  assert.equal(JSON.parse(JSON.stringify(input())).minCommissionPercent, null)
  assert.equal(JSON.parse(JSON.stringify(input())).minEstimatedCommission, null)
  assert.equal(input({ minCommissionPercent: 0 }).minCommissionPercent, 0)
  assert.deepEqual(splitAudienceTerms('casa, cozinha, '), ['casa', 'cozinha'])
})

test('audience validation catches invalid limits and missing destinations before saving', () => {
  assert.equal(audienceValidation(input()), null)
  for (const overrides of [{ dailyCap: 51 }, { dailyCap: 1.5 }, { minIntervalMinutes: 16, maxIntervalMinutes: 12 }, { endTime: '09:00' }, { endTime: '22:00' }, { maxStandoutMessages: -1 }, { minCommissionPercent: 101 }, { destinationGroupIds: [] }]) assert.equal(typeof audienceValidation(input(overrides)), 'string')
  assert.equal(audienceValidation(input({ enabled: false, destinationGroupIds: [] })), null)
  assert.match(audienceValidation(audienceInput(audience, 'a', '')), /termos/)
})

test('plan dates reject past, malformed and impossible calendar dates', () => {
  assert.equal(validPlanDate('2026-10-15', '2026-10-15'), true)
  assert.equal(validPlanDate('2026-10-16', '2026-10-15'), true)
  for (const date of ['2026-02-30', '', '2026-13-01', '16/10/2026']) assert.equal(validPlanDate(date, '2026-01-01'), false)
  assert.equal(validPlanDate('2026-10-14', '2026-10-15'), false)
})

test('file audience suggestions handle ambiguity and do not classify tapete as pet', () => {
  const audiences = ['DOMESTICA', 'MASCULINO', 'PESCA', 'PET'].map((slug) => ({ slug, name: slug }))
  const selected = new Set(audiences.map((item) => item.slug))
  assert.equal(inferFileAudience('ofertas-pesca.json', selected, audiences), 'PESCA')
  assert.equal(inferFileAudience('doméstica-15.json', selected, audiences), 'DOMESTICA')
  assert.equal(inferFileAudience('pesca-masculino.json', selected, audiences), undefined)
  assert.equal(inferFileAudience('tapete.json', selected, audiences), undefined)
  assert.equal(inferFileAudience('coleta.json', new Set(['DOMESTICA']), audiences), 'DOMESTICA')
  assert.equal(inferFileAudience('pesca.json', new Set(['DOMESTICA', 'MASCULINO']), audiences), undefined)
})

test('file summaries recognize supported envelopes without inventing an offer count', () => {
  assert.equal(countFileOffers([{}, {}]), 2)
  for (const key of ['offers', 'products', 'items', 'produtos', 'ofertas', 'data', 'cards']) assert.equal(countFileOffers({ [key]: [{}] }), 1)
  assert.equal(countFileOffers({ offers: [] }), 0)
  assert.equal(countFileOffers({ metadata: 'not a product list' }), null)
  assert.equal(countFileOffers(null), null)
})

test('audience filters preserve policy-only values, false, explicit clears and zero across saves', () => {
  const policy = { excludePolitical: true, minPrice: 0, maxPrice: 300, minCommissionPercent: 0, minEstimatedCommission: 5 }
  const saved = input({ policy })
  assert.equal(saved.excludePolitical, true)
  assert.equal(saved.minPrice, 0)
  assert.equal(saved.maxPrice, 300)
  assert.equal(saved.minCommissionPercent, 0)
  assert.equal(saved.minEstimatedCommission, 5)
  const cleared = input({ policy, excludePolitical: false, minPrice: null, maxPrice: null, minCommissionPercent: null, minEstimatedCommission: 0 })
  assert.equal(cleared.excludePolitical, false)
  assert.equal(cleared.minPrice, null)
  assert.equal(cleared.maxPrice, null)
  assert.equal(cleared.minCommissionPercent, null)
  assert.equal(cleared.minEstimatedCommission, 0)
  assert.equal(input().excludePolitical, false)
  assert.equal(optionalNumber(''), null)
  assert.equal(optionalNumber('  '), null)
  assert.equal(optionalNumber('0'), 0)
  assert.equal(optionalNumber('19.99'), 19.99)
  assert.equal(audienceValidation(input({ minPrice: 0, maxPrice: 0 })), null)
  for (const changes of [{ minPrice: -1 }, { maxPrice: NaN }, { minPrice: Infinity }, { minPrice: 10, maxPrice: 0 }, { minCommissionPercent: -1 }]) assert.equal(typeof audienceValidation(input(changes)), 'string')
})

const policy = { dailyCap: 20, startTime: '09:00', endTime: '21:00', minGapSeconds: 720, maxGapSeconds: 960, maxStandouts: 3, freshnessHours: 24, timezone: 'America/Sao_Paulo' }
const send = { id: 'send-1', audienceSlug: 'PET', groupId: 'original', groupName: 'Grupo original', status: 'PENDING', scheduledAt: '2026-10-21T11:01:00Z', localDate: '2026-10-21', timezone: 'America/Sao_Paulo', attempts: 0 }
const plan = { id: 'plan', revision: 1, status: 'SCHEDULED', startDate: '2026-10-21', days: 2, timezone: 'America/Sao_Paulo', audienceSlugs: ['PET'], settings: { global: { campaignStartTime: '09:00', earlyStart: { date: '2026-10-21', time: '08:01' } }, audiences: { PET: policy } }, items: [], sends: [send] }

test('local dates are explicit ISO calendar dates and advance uses plan timezone at midnight', () => {
  const midnight = new Date('2026-10-22T02:30:00Z')
  assert.equal(smartLocalDate(midnight), '2026-10-21')
  assert.equal(smartLocalDate(midnight, 'UTC'), '2026-10-22')
  assert.equal(canAdvanceSmartPlan(plan, new Date('2026-10-21T11:00:00Z')), true)
  assert.equal(canAdvanceSmartPlan(plan, new Date('2026-10-21T11:02:00Z')), false)
  assert.equal(canAdvanceSmartPlan({ ...plan, status: 'PAUSED' }), false)
  assert.equal(canAdvanceSmartPlan({ ...plan, sends: [{ ...send, scheduledAt: '2026-10-22T12:00:00Z', localDate: '2026-10-22' }] }, new Date('2026-10-21T11:00:00Z')), false)
  for (const status of ['SENDING', 'FAILED', 'UNKNOWN']) {
    assert.equal(canAdvanceSmartPlan({ ...plan, sendSummary: { [status]: 1 } }, new Date('2026-10-21T11:00:00Z')), false)
    assert.equal(canAdvanceSmartPlan({ ...plan, sends: [send, { ...send, id: status, status }] }, new Date('2026-10-21T11:00:00Z')), false)
  }
})

test('timing rejects blank/inverted windows and applies early start to its date only', () => {
  assert.equal(campaignTimingValidation('09:00', false, plan.startDate, plan.startDate), null)
  assert.match(campaignTimingValidation('', false, plan.startDate, plan.startDate), /início/)
  assert.match(campaignTimingValidation('21:00', false, plan.startDate, plan.startDate), /antes/)
  assert.match(campaignTimingValidation('10:00', false, plan.startDate, plan.startDate, '10:00'), /antes/)
  assert.match(campaignTimingValidation('09:00', true, plan.startDate, '2026-10-22'), /hoje/)
  assert.equal(smartCampaignStart(plan, '2026-10-21'), '08:01')
  assert.equal(smartCampaignStart(plan, '2026-10-22'), '09:00')
  const review = { ...plan, status: 'REVIEW', settings: { global: { startNow: true, campaignStartTime: '10:00' } } }
  assert.equal(smartCampaignStart(review, '2026-10-21'), 'ao aprovar hoje')
  assert.equal(smartCampaignStart(review, '2026-10-22'), '10:00')
  assert.equal(reservedSmartStart(plan, 'PET', '2026-10-21'), send.scheduledAt)
  assert.equal(nextSmartDelivery({ ...plan, sends: [{ ...send, status: 'SENT', scheduledAt: '2026-10-21T10:00:00Z' }, send] }).id, send.id)
})

test('review freezes policies and persisted destinations, flagging current configuration drift', () => {
  const current = { slug: 'PET', policy: { ...policy, dailyCap: 50 }, destinations: [{ groupId: 'changed', groupName: 'Grupo atual' }], destinationGroupIds: ['changed'] }
  const context = planAudienceContext(plan, 'PET', [current])
  assert.equal(context.policy.dailyCap, 20)
  assert.equal(context.policyFrozen, true)
  assert.equal(context.destinationsFrozen, true)
  assert.equal(context.drift, true)
  assert.equal(context.destinationDrift, true)
  assert.deepEqual(context.destinations, [{ groupId: 'original', groupName: 'Grupo original' }])
  assert.equal(planAudienceContext({ ...plan, settings: { audiencePolicies: { PET: policy } } }, 'PET', [current]).policy.dailyCap, 20)
  assert.equal(planAudienceContext({ ...plan, settings: {}, sends: [] }, 'PET', [current]).policyFrozen, false)
  assert.equal(smartRecoveryReason({ ...plan, sends: [{ ...send, lastError: 'A conexão do WhatsApp mudou desde a aprovação.' }] }), 'binding-change')
  assert.equal(smartRecoveryReason({ ...plan, sends: [{ ...send, lastError: 'A conexão ficou indisponível antes do envio.' }] }), 'disconnected')
  assert.equal(smartRecoveryReason(plan), null)
})

test('delivery exports retain every error and neutralize spreadsheet formulas and unsafe links', () => {
  for (const text of ['=SUM(A1)', ' +1', '\t@SUM(A1)', '\u0000 -1', '\n=1']) assert.equal(smartCsvCell(text).startsWith('"\''), true)
  assert.equal(smartCsvCell('A "quoted"; value\nnext'), '"A ""quoted""; value\nnext"')
  const many = { ...plan, sends: Array.from({ length: 7 }, (_, index) => ({ ...send, id: `send-${index}`, lastError: `error-${index}`, groupName: '=HYPERLINK("bad")' })) }
  const csv = smartDeliveriesCsv(many)
  assert.match(csv, /error-6/)
  assert.match(csv, /"'=HYPERLINK/)
  assert.equal(csv.startsWith('\uFEFF'), true)
  for (const url of ['javascript:alert(1)', 'data:text/html,test', '//evil.test', 'https://user:password@example.com']) assert.equal(safeAffiliateUrl(url), undefined)
  assert.equal(safeAffiliateUrl('https://mercadolivre.com/sec/test'), 'https://mercadolivre.com/sec/test')
})

test('history date filters allow past dates and equal inclusive boundaries but reject inverted or invalid dates', () => {
  assert.equal(historyDateValidation('', ''), null)
  assert.equal(historyDateValidation('2026-10-01', '2026-10-01'), null)
  assert.equal(historyDateValidation('2026-01-01', ''), null)
  assert.match(historyDateValidation('2026-10-02', '2026-10-01'), /final/)
  assert.match(historyDateValidation('2026-02-30', ''), /válidas/)
})

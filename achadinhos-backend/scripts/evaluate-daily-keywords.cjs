const fs = require('node:fs')
const path = require('node:path')
const { matchesKeyword, marketplaceSignals, politicalMention } = require('../vendor/affiliate-hub/extractor')
const audiences = ['domestica', 'masculino']
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
const rate = (count, total) => total ? Math.round(count / total * 10000) / 100 : null
const presentNumber = value => typeof value === 'number' && Number.isFinite(value)

function observations(data) {
  const items = Array.isArray(data) ? data : data.items || []
  const records = items.map(item => {
    const product = item.product || item.card || item
    return { audience: item.audience_slug || item.audienceSlug || item.targetAudienceSlug,
      productId: product.productId || item.product_id, title: product.title || item.title || '',
      visible: product.visible, signals: product.extensionEvidence?.visibleSignals || item.signals || marketplaceSignals(product.visible?.text) || {},
      category: item.category, state: item.state || null, reason: item.reason || '', fit: item.fit_score ?? item.fitScore,
      score: item.score, searchMatch: product.extensionEvidence?.searchMatch || product.searchMatch,
      plan: item.plan_uuid, date: item.start_date || item.date }
  })
  const cards = (data.runs || []).flatMap(run => (run.payloads || []).flatMap(payload => (payload.cards || payload.json?.cards || []).map(card => {
    const audience = payload.audienceSlug || payload.targetAudienceSlug
    const item = records.findLast(item => item.plan === run.plan_uuid && item.audience === audience && item.productId === card.productId)
    return { ...item, audience, productId: card.productId, title: card.title, visible: card.visible,
      signals: marketplaceSignals(card.visible?.text) || item?.signals || {}, searchMatch: card.searchMatch, run: run.id }
  })))
  // Keep one latest observation per audience/product; plan revisions are not independent discoveries.
  const latest = [...new Map(records.filter(item => audiences.includes(item.audience) && item.productId)
    .map(item => [`${item.audience}:${item.productId}`, item])).values()]
  return { records, latest, cards }
}

function metrics(rows) {
  const classified = rows.filter(row => presentNumber(row.fit))
  const qualified = rows.filter(row => [row.fit, row.score, row.signals.rating, row.signals.soldCount].every(presentNumber) && row.fit >= 75 && row.score >= 60 && row.signals.rating >= 4.5 && row.signals.soldCount >= 100 && !row.signals.timeLimited && !politicalMention(row))
  const sold = rows.map(row => row.signals.soldCount).filter(presentNumber).sort((a, b) => a - b)
  return { matches: rows.length, selected: rows.filter(row => row.state === 'SELECTED').length,
    reserve: rows.filter(row => row.state === 'RESERVE').length, rejected: rows.filter(row => row.state === 'REJECTED').length,
    qualified: qualified.length, qualifiedRate: rate(qualified.length, rows.length),
    qualityUnknown: rows.filter(row => !presentNumber(row.signals.rating) || !presentNumber(row.signals.soldCount) || !presentNumber(row.fit) || !presentNumber(row.score)).length,
    fitKnown: classified.length, offAudience: classified.filter(row => row.fit < 75).length,
    offAudienceRate: rate(classified.filter(row => row.fit < 75).length, classified.length),
    soldSignalKnown: sold.length, soldAtLeast100: sold.filter(value => value >= 100).length,
    medianCumulativeSoldLowerBound: sold.length ? sold[Math.floor(sold.length / 2)] : null }
}

function evaluate(data, discovery, date = new Date().toISOString().slice(0, 10), days = 28) {
  const { records, latest, cards } = observations(data)
  const result = { methodology: { attribution: 'Recorded word matches on daily cards; counterfactual inventory matches use the extractor on title plus retained visible text. Daily counts are card observations, not unique products; multi-label cards count for each keyword. No impression/query denominator or causal conversion yield is available.',
    population: 'Latest plan observation per audience/product in input order; input items must be oldest first. Plan-state totals retain all observations separately.',
    qualified: 'rating >=4.5, cumulative sold >=100, fit >=75, commercial score >=60, no time-limited/political signal; unknown is not qualified; this is not affiliate attribution or send readiness',
    offAudience: 'fit <75 among fit-known matches; rejection alone is not off-audience',
    sales: 'Notice lines are newly observed demand, possibly indirect/historical; not paid commissions, campaign attribution or total sales. Repeated notice/product lines count once.', date, days }, audiences: {} }
  for (const slug of audiences) {
    const profile = data.audiences?.find(audience => audience.slug === slug)?.profile || { keywords: [], negativeKeywords: [] }
    const inventory = Array.from({ length: 16 }, (_, round) => discovery.dailyDiscoveryKeywords(slug, [], round)).flat()
    const rows = latest.filter(row => row.audience === slug)
    const direct = cards.filter(row => row.audience === slug && row.searchMatch?.matchStyle === 'word')
    const sales = [...new Set((data.salesNotices || []).flatMap(notice => notice.products || [])
      .map(line => line.replace(/^• /, '').split(' — ')[0]))].map(title => ({ title }))
    const cache = new WeakMap()
    const match = (row, term) => {
      let terms = cache.get(row)
      if (!terms) { terms = new Map(); cache.set(row, terms) }
      const key = normalize(term)
      if (!terms.has(key)) terms.set(key, matchesKeyword(row, term, 'word'))
      return terms.get(key)
    }
    const perKeyword = inventory.map(keyword => ({ keyword, ...metrics(rows.filter(row => match(row, keyword))),
      directlyAttributedCards: direct.filter(row => row.searchMatch.keywords?.some(term => normalize(term) === normalize(keyword))).length,
      observedSaleProducts: sales.filter(sale => match(sale, keyword)).length }))
    const pageMetrics = []
    for (let day = 0; day < days; day++) {
      const localDate = new Date(Date.parse(`${date}T00:00:00Z`) + day * 86400000).toISOString().slice(0, 10)
      const keywords = discovery.dailyDiscoveryKeywords(slug, profile.keywords, 0, localDate)
      const matched = rows.filter(row => keywords.some(term => match(row, term)))
      pageMetrics.push({ date: localDate, keywords, provenTerms: keywords.filter(term => perKeyword.some(k => normalize(k.keyword) === normalize(term) && k.qualified >= 2 && k.offAudienceRate <= 25)).length, ...metrics(matched) })
    }
    const attributedKeywords = [...new Set(direct.flatMap(row => row.searchMatch.keywords || []))]
    const categories = [...new Set(rows.map(row => row.category).filter(Boolean))]
      .map(category => ({ category, ...metrics(rows.filter(row => row.category === category)) })).sort((a, b) => b.matches - a.matches)
    result.audiences[slug] = { inventorySize: inventory.length, observations: metrics(records.filter(row => row.audience === slug)),
      uniqueProducts: metrics(rows), inventoryMatches: metrics(rows.filter(row => inventory.some(term => match(row, term)))),
      dailyCards: metrics(cards.filter(row => row.audience === slug)), dailyCardsWithWordProvenance: direct.length,
      observedDemandProducts: sales.filter(sale => inventory.some(term => match(sale, term))).map(sale => sale.title),
      perKeyword, attributedKeywords: attributedKeywords.map(keyword => ({ keyword, ...metrics(direct.filter(row => row.searchMatch.keywords?.includes(keyword))) })),
      rejectionReasons: Object.entries(rows.filter(row => row.state === 'REJECTED').reduce((all, row) => { all[row.reason] = (all[row.reason] || 0) + 1; return all }, {})).sort((a, b) => b[1] - a[1]),
      categories, firstPages: pageMetrics,
      firstPageAverage: Object.fromEntries(['matches', 'qualified', 'qualifiedRate', 'offAudienceRate', 'provenTerms'].map(key => [key, Math.round(pageMetrics.reduce((sum, row) => sum + (row[key] || 0), 0) / days * 100) / 100])) }
  }
  return result
}

if (require.main === module) {
  const [file, ...args] = process.argv.slice(2)
  if (!file) { console.error('Usage: node scripts/evaluate-daily-keywords.cjs historical.json [--discovery=/absolute/module.cjs] [--date=YYYY-MM-DD] [--days=28]'); process.exit(1) }
  const options = Object.fromEntries(args.map(value => value.replace(/^--/, '').split('=')))
  const date = options.date || new Date().toISOString().slice(0, 10), days = Number(options.days || 28)
  if (!Number.isSafeInteger(days) || days < 1 || days > 366 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Invalid date/days')
  const discovery = require(options.discovery ? path.resolve(options.discovery) : '../dist/utils/dailyDiscovery')
  console.log(JSON.stringify(evaluate(JSON.parse(fs.readFileSync(file, 'utf8')), discovery, date, days), null, 2))
}
module.exports = { evaluate, observations, metrics }

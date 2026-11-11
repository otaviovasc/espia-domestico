const { test } = require('node:test')
const assert = require('node:assert/strict')
const { dailyDiscoveryKeywords, dailyDiscoveryPage, DAILY_DISCOVERY_MAX_KEYWORD_ROUNDS, DAILY_DISCOVERY_ROUND_SIZE } = require('../dist/utils/dailyDiscovery')
const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

for (const slug of ['domestica', 'masculino']) {
  test(`${slug} discovery expands beyond the wire limit, preserves base priority and terminates`, () => {
    const base = [' CÂMERA ', 'camera', 'panela, cafeteira', '', 'x'.repeat(201)]
    const first = dailyDiscoveryKeywords(slug, base, 0)
    assert.equal(DAILY_DISCOVERY_ROUND_SIZE, 50)
    assert.deepEqual(first.slice(0, 3), ['CÂMERA', 'panela', 'cafeteira'])
    const all = []
    let round = 0
    for (; round < 20; round++) {
      const keywords = dailyDiscoveryKeywords(slug, base, round)
      assert.deepEqual(keywords, dailyDiscoveryKeywords(slug, base, round))
      assert.ok(keywords.length <= 50)
      assert.ok(keywords.every(term => term.length <= 200))
      if (!keywords.length) break
      all.push(...keywords)
    }
    assert.ok(round < 20, 'keyword bank must terminate without cycling')
    assert.ok(all.length >= 300, 'audience bank must provide at least 300 relevant terms')
    for (let page = 0; page < 5; page++) {
      assert.equal(dailyDiscoveryKeywords(slug, [], page).length, 50, 'five full pages support the 250-candidate cap')
    }
    const bank = Array.from({ length: 20 }, (_, page) => dailyDiscoveryKeywords(slug, [], page)).flat()
    assert.ok(bank.length >= 300, 'bank size must not depend on supplied base terms')
    assert.equal(new Set(bank.map(normalize)).size, bank.length)
    assert.equal(new Set(all.map(normalize)).size, all.length)
    assert.deepEqual(dailyDiscoveryKeywords(slug, base, round + 1), [])
  })
}
test('audience banks differ and invalid rounds cannot silently restart discovery', () => {
  assert.notDeepEqual(dailyDiscoveryKeywords('domestica', [], 1), dailyDiscoveryKeywords('masculino', [], 1))
  for (const round of [-1, 0.5, NaN, Infinity]) assert.throws(() => dailyDiscoveryKeywords('domestica', [], round), RangeError)
})

for (const slug of ['domestica', 'masculino']) {
  test(`${slug} date rotation is repeatable, covers disjoint pages and has one broad hub fallback`, () => {
    const date = '2026-11-11'
    const base = ['panela', 'Panela', 'café, CAFÉ']
    const first = dailyDiscoveryKeywords(slug, base, 0, date)
    assert.deepEqual(first, dailyDiscoveryKeywords(slug, base, 0, date))
    assert.notDeepEqual(first, dailyDiscoveryKeywords(slug, base, 0, '2026-11-12'))
    const all = []
    let round = 0
    for (; round <= DAILY_DISCOVERY_MAX_KEYWORD_ROUNDS; round++) {
      const page = dailyDiscoveryPage(slug, base, round, date)
      assert.ok(Array.isArray(page))
      if (!page.length) break
      all.push(...page)
    }
    assert.ok(round <= 16)
    assert.ok(all.length >= 500, 'at least ten pages of audience terms')
    assert.equal(new Set(all.map(normalize)).size, all.length)
    const unrotated = Array.from({ length: 16 }, (_, page) => dailyDiscoveryKeywords(slug, base, page)).flat()
    assert.deepEqual(new Set(all.map(normalize)), new Set(unrotated.map(normalize)))
    assert.deepEqual(dailyDiscoveryPage(slug, base, round, date), [])
    assert.equal(dailyDiscoveryPage(slug, base, round + 1, date), undefined)
    assert.equal(dailyDiscoveryPage(slug, base, 100, date), undefined)
  })
}
test('date rotation validates dates and oversized custom inventories have a hard page bound', () => {
  for (const date of ['2026-02-30', 'not-a-date', '2026-13-01'])
    assert.throws(() => dailyDiscoveryKeywords('domestica', [], 0, date), RangeError)
  const base = Array.from({ length: 2000 }, (_, n) => `produto ${n}`)
  assert.equal(dailyDiscoveryKeywords('domestica', base, 16, '2026-11-11').length, 0)
  assert.deepEqual(dailyDiscoveryPage('domestica', base, 16, '2026-11-11'), [])
  assert.equal(dailyDiscoveryPage('domestica', base, 17, '2026-11-11'), undefined)
})

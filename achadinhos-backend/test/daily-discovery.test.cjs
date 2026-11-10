const { test } = require('node:test')
const assert = require('node:assert/strict')
const { dailyDiscoveryKeywords, DAILY_DISCOVERY_ROUND_SIZE } = require('../dist/utils/dailyDiscovery')
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

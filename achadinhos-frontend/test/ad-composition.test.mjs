import test from 'node:test'
import assert from 'node:assert/strict'
import { compositionGeometry, duplicateCompositionLayer, moveCompositionLayer, newCompositionLayer, wrapCompositionText } from '../src/lib/adComposition.ts'

test('paint order, duplication, and bounds preserve original layers', () => {
  const background = newCompositionLayer('shape', 'background')
  const logo = newCompositionLayer('image', 'logo', 42)
  const original = [background, logo]
  assert.deepEqual(moveCompositionLayer(original, 'logo', -1).map((layer) => layer.id), ['logo', 'background'])
  assert.deepEqual(original.map((layer) => layer.id), ['background', 'logo'])
  assert.equal(moveCompositionLayer(original, 'background', -1), original)
  const copies = duplicateCompositionLayer([{ ...logo, x: 99, y: 100 }], 'logo', 'logo-copy')
  assert.equal(copies[1].assetId, 42)
  assert.equal(copies[1].x, 100)
  assert.equal(copies[1].y, 100)
  assert.equal(copies[0].x, 99)
  const maximum = Array.from({ length: 8 }, (_, index) => newCompositionLayer('text', String(index)))
  assert.equal(duplicateCompositionLayer(maximum, '0', 'copy'), maximum)
})

test('overlay geometry uses output coordinates and text keeps hard breaks and Unicode codepoints', () => {
  assert.deepEqual(compositionGeometry(newCompositionLayer('text', 'text'), { width: 1080, height: 1920 }), { x: 108, y: 192, width: 864, height: 384 })
  assert.deepEqual(wrapCompositionText('Olá mundo\n\n😀😀😀😀😀', 70, 20), ['Olá', 'mundo', '', '😀😀😀😀😀'])
  assert.deepEqual(wrapCompositionText('😀😀😀😀😀😀', 70, 20), ['😀😀😀😀😀', '😀'])
  assert.deepEqual(wrapCompositionText('Longword', 1, 64), ['L', 'o', 'n', 'g', 'w', 'o', 'r', 'd'])
  assert.deepEqual(wrapCompositionText('  Olá      ', 70, 20), ['  Olá'])
})

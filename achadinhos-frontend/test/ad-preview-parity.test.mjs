import assert from 'node:assert/strict'
import test from 'node:test'
import {
  previewClipLoops,
  previewClipSourceTime,
  previewDissolveAlpha,
  previewDissolveNoise,
  previewTransitionFrame,
} from '../src/lib/adPreviewParity.ts'
import { previewClipGeometry } from '../src/lib/adPreviewFraming.ts'

test('a transition keeps the incoming layer hidden until both videos are ready', () => {
  const frame = previewTransitionFrame('fade', 0, false)
  assert.deepEqual(frame.incoming, { opacity: 0, transform: 'none' })
  assert.deepEqual(frame.outgoing, { opacity: 1, transform: 'none' })
})

test('slide transitions travel a full frame without an opacity flash', () => {
  assert.deepEqual(previewTransitionFrame('slide-left', 0, true), {
    incoming: { opacity: 1, transform: 'translate3d(100%, 0, 0)' },
    outgoing: { opacity: 1, transform: 'translate3d(0%, 0, 0)' },
  })
  assert.deepEqual(previewTransitionFrame('slide-left', 0.5, true), {
    incoming: { opacity: 1, transform: 'translate3d(50%, 0, 0)' },
    outgoing: { opacity: 1, transform: 'translate3d(-50%, 0, 0)' },
  })
})

test('fade composites incoming color over a fully opaque outgoing frame', () => {
  const frame = previewTransitionFrame('fade', 0.5, true)
  assert.equal(frame.outgoing.opacity, 1)
  assert.equal(frame.incoming.opacity, 0.5)
  const outgoingBrightness = 40
  const incomingBrightness = 200
  const composite = frame.incoming.opacity * incomingBrightness +
    (1 - frame.incoming.opacity) * frame.outgoing.opacity * outgoingBrightness
  assert.equal(composite, 120)
  assert.equal(previewTransitionFrame('cut', 0, true).incoming.opacity, 1)
})

test('zoom grows the outgoing frame first, then reveals the incoming frame', () => {
  const early = previewTransitionFrame('zoom', 0.25, true)
  const middle = previewTransitionFrame('zoom', 0.5, true)
  const late = previewTransitionFrame('zoom', 0.75, true)
  assert.equal(early.incoming.opacity, 0)
  assert.equal(early.outgoing.opacity, 1)
  assert.equal(early.outgoing.transform, 'scale(2)')
  assert.equal(middle.incoming.opacity, 0)
  assert.equal(late.incoming.opacity, 0.5)
  assert.equal(late.outgoing.opacity, 1)
  assert.equal(late.outgoing.transform, 'scale(1000)')
  assert.equal(previewTransitionFrame('zoom', 0.25, false).outgoing.transform, 'none')
})

test('dissolve uses a fixed spatial threshold instead of uniform opacity', () => {
  const frame = previewTransitionFrame('dissolve', 0.5, true)
  assert.equal(frame.incoming.opacity, 1)
  assert.equal(frame.outgoing.opacity, 1)
  assert.equal(previewDissolveNoise(7, 11), previewDissolveNoise(7, 11))
  assert.notEqual(previewDissolveNoise(7, 11), previewDissolveNoise(8, 11))
  let incomingPixels = 0
  let outgoingPixels = 0
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const alpha = previewDissolveAlpha(x, y, 0.5)
      incomingPixels += alpha === 255 ? 1 : 0
      outgoingPixels += alpha === 0 ? 1 : 0
      assert.ok(previewDissolveAlpha(x, y, 0.75) >= alpha)
    }
  }
  assert.ok(incomingPixels > 0)
  assert.ok(outgoingPixels > 0)
})

test('framing keeps contained clips centered and crops enlarged clips around the chosen focus', () => {
  const output = { width: 1080, height: 1920 }
  const landscape = { width: 640, height: 360 }
  const contained = previewClipGeometry(output, landscape, 'contain-solid', 20, 0, 1)
  assert.equal(contained.width, '100%')
  assert.equal(contained.left, '0%')
  assert.equal(Number.parseFloat(contained.height), 31.640625)
  assert.equal(Number.parseFloat(contained.top), 34.1796875)
  const enlarged = previewClipGeometry(output, landscape, 'contain-solid', 20, 0, 1.4)
  assert.equal(enlarged.width, '140%')
  assert.ok(Math.abs(Number.parseFloat(enlarged.left) + 8) < 1e-8)
  assert.ok(Math.abs(Number.parseFloat(enlarged.top) - 27.8515625) < 1e-8)
  const coverLeft = previewClipGeometry(output, landscape, 'cover', 0, 50, 1.4)
  const coverRight = previewClipGeometry(output, landscape, 'cover', 100, 50, 1.4)
  assert.equal(coverLeft.left, '0%')
  assert.ok(Number.parseFloat(coverRight.left) < -300)
})

test('manual timeline seeks map to the same trimmed clip frame as the renderer', () => {
  assert.equal(previewClipSourceTime(0, 5.066667, 1, 2.4, 2.5), 2.4)
  assert.equal(previewClipSourceTime(1, 3, 2, 1.25, 3), 1.5)
  assert.equal(previewClipSourceTime(1, 20, 1, 25, 30), 19.99)
  assert.equal(previewClipLoops(1, 3, 2, 3), true)
  assert.equal(previewClipLoops(1, 20, 1, 30), false)
})

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { existsSync } = require('node:fs')
const { Resvg } = require('@resvg/resvg-js')

const {
  createCaptionArtwork,
  rasterizeCaptionArtwork,
} = require('../dist/services/adCaptionArtwork.js')

function input(text, overrides = {}) {
  return {
    text,
    output: { width: 1080, height: 1920 },
    textStyle: {
      fontSize: 72,
      fontColor: '#F1E2D3',
      borderWidth: 6,
      borderColor: '#123456',
      positionY: 52,
    },
    ...overrides,
  }
}

test('caption artwork outlines centered multiline text with the configured fill and stroke', () => {
  const artwork = createCaptionArtwork(input('FIRST LINE\nSECOND LINE'))
  const box = new Resvg(artwork.svg).getBBox()

  assert.equal(artwork.text, 'FIRST LINE\nSECOND LINE')
  assert.deepEqual(artwork.lines, ['FIRST LINE', 'SECOND LINE'])
  assert.ok(artwork.svg.includes('<path'))
  assert.ok(!artwork.svg.includes('<text'))
  assert.match(artwork.svg, /fill="#f1e2d3"/)
  assert.match(artwork.svg, /stroke="#123456"/)
  assert.match(artwork.svg, /stroke-width="12"/)
  assert.match(artwork.svg, /stroke-linejoin="round"/)
  assert.ok(box)
  assert.ok(Math.abs(box.x + box.width / 2 - 540) < 0.1)
  assert.ok(box.width <= 1080 * 0.86 + 0.1, `artwork width was ${box.width}`)
  assert.ok(Math.abs(box.y + box.height / 2 - 1920 * 0.52) < 0.1)
})

test('caption wrapping preserves every word and clamps all stroked ink inside the frame', () => {
  const text = 'SUPERCALIFRAGILISTICEXPIALIDOCIOUS every visible word stays present'
  const artwork = createCaptionArtwork(input(text, {
    output: { width: 360, height: 640 },
    textStyle: {
      fontSize: 140,
      fontColor: '#FFFFFF',
      borderWidth: 12,
      borderColor: '#000000',
      positionY: 15,
    },
  }))
  const box = new Resvg(artwork.svg).getBBox()
  const normalizedLines = artwork.lines.join('').replace(/\s+/g, '')

  assert.equal(normalizedLines, text.replace(/\s+/g, ''))
  assert.ok(artwork.lines.length > 3, 'long content should add lines instead of truncating')
  assert.ok(!artwork.svg.includes('…'))
  assert.ok(box)
  assert.ok(box.x >= -0.01, `left edge was ${box.x}`)
  assert.ok(box.y >= -0.01, `top edge was ${box.y}`)
  assert.ok(box.x + box.width <= 360.01, `right edge was ${box.x + box.width}`)
  assert.ok(box.y + box.height <= 640.01, `bottom edge was ${box.y + box.height}`)
})

test('caption artwork embeds Twemoji above the text in the same SVG and PNG', () => {
  const artwork = createCaptionArtwork(input('😍 FIRST LINE\nSECOND LINE', {
    output: { width: 360, height: 640 },
    textStyle: {
      fontSize: 72,
      fontColor: '#FFFFFF',
      borderWidth: 6,
      borderColor: '#000000',
      positionY: 52,
    },
  }))
  assert.match(artwork.svg, /<image /)
  assert.ok(!artwork.svg.includes('<text'))

  const rendered = new Resvg(artwork.svg).render()
  const pixels = rendered.pixels
  let emojiMaxY = -1
  let captionMinY = rendered.height
  for (let y = 0; y < rendered.height; y += 1) {
    for (let x = 0; x < rendered.width; x += 1) {
      const offset = (y * rendered.width + x) * 4
      const red = pixels[offset]
      const green = pixels[offset + 1]
      const blue = pixels[offset + 2]
      const alpha = pixels[offset + 3]
      if (alpha > 100 && red > 110 && (red - blue > 35 || green - blue > 35)) {
        emojiMaxY = Math.max(emojiMaxY, y)
      }
      if (alpha > 100 && red > 220 && green > 220 && blue > 220) {
        captionMinY = Math.min(captionMinY, y)
      }
    }
  }
  assert.ok(emojiMaxY >= 0, 'emoji pixels were not found')
  assert.ok(captionMinY < rendered.height, 'caption pixels were not found')
  assert.ok(emojiMaxY < captionMinY, `emoji ended at ${emojiMaxY}, caption began at ${captionMinY}`)
  assert.ok(rasterizeCaptionArtwork(artwork).length > 1_000)
})

test('AD_FONT_FILE selects the configured explicit font', (context) => {
  const customFont = '/usr/share/fonts/noto/NotoSans-Bold.ttf'
  if (!existsSync(customFont)) {
    context.skip('Noto Sans is not installed')
    return
  }
  const previous = process.env.AD_FONT_FILE
  delete process.env.AD_FONT_FILE
  const bundled = createCaptionArtwork(input('FONT METRICS'))
  process.env.AD_FONT_FILE = customFont
  try {
    const custom = createCaptionArtwork(input('FONT METRICS'))
    assert.notEqual(custom.svg, bundled.svg)
  } finally {
    if (previous === undefined) delete process.env.AD_FONT_FILE
    else process.env.AD_FONT_FILE = previous
  }
})

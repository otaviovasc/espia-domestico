const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
module.exports = async function validateStudio({
  json,
  base,
  token,
  otherToken,
  fromBackend,
  user,
  other,
  carousel,
  config,
  images,
  video,
  job,
  directory,
  command,
  completed,
}) {
  const current = await json(`/${carousel.id}`)
  const attempts = await Promise.all(
    [0, 1].map(async (i) => {
      const response = await fetch(`${base}/${carousel.id}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: current.revision, name: `Revision QA ${i}` }),
      })
      return response.status
    }),
  )
  assert.deepEqual(attempts.sort(), [200, 409])
  assert.equal((await json(`/${carousel.id}`)).revision, current.revision + 1)
  const lib = await json(`/${carousel.id}/assets/${images[0].id}/library`, 'POST', {
    name: 'Reusable product',
    tags: ['kitchen'],
    productIds: [],
  })
  assert.equal(lib.duplicate, false)
  assert.equal('storagePath' in lib.record.payload, false)
  const again = await json(`/${carousel.id}/assets/${images[0].id}/library`, 'POST', {
    name: 'Another name',
    tags: [],
    productIds: [],
  })
  assert.equal(again.duplicate, true)
  assert.equal(again.record.id, lib.record.id)
  assert.equal((await json('/studio/library?q=kitchen')).total, 1)
  assert.equal((await json('/studio/library', 'GET', undefined, 200, otherToken)).total, 0)
  await json(`/${carousel.id}/library/attach`, 'POST', { recordId: lib.record.id }, 404, otherToken)
  await json(`/studio/records/${lib.record.id}`, 'DELETE', undefined, 404, otherToken)
  const emptyConfig = {
    ...config,
    productIds: [],
    selectedClipIds: [],
    clipEdits: {},
    carousel: { slides: [], caption: '' },
    musicAssetId: null,
    musicTracks: [],
    hook: { ...config.hook, clipAssetId: null },
  }
  const fresh = await json('', 'POST', { name: 'Studio QA destination', config: emptyConfig }, 201)
  const attached = await json(`/${fresh.id}/library/attach`, 'POST', { recordId: lib.record.id })
  await json(`/studio/library/${lib.record.id}`, 'PATCH', {
    name: 'Retagged media',
    tags: ['updated'],
    productIds: [],
  })
  assert.equal((await json('/studio/library?q=updated')).total, 1)
  await json(`/studio/records/${lib.record.id}`, 'DELETE')
  const attachedContent = await fetch(`${base}/${fresh.id}/assets/${attached.id}/content`, {
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(attachedContent.status, 200)
  assert.ok((await attachedContent.arrayBuffer()).byteLength > 0)
  const brand = {
    name: 'QA brand',
    backgroundColor: '#123456',
    textStyle: config.textStyle,
    signature: 'QA signature',
  }
  const brandRecord = await json('/studio/brand', 'POST', { key: 'qa-brand', payload: brand })
  const updated = await json('/studio/brand', 'POST', {
    key: 'qa-brand',
    payload: { ...brand, signature: 'Changed' },
    expectedRevision: brandRecord.revision,
  })
  assert.equal(updated.revision, 1)
  await json('/studio/brand', 'POST', { key: 'qa-brand', payload: brand, expectedRevision: 0 }, 409)
  await json(`/studio/records/${brandRecord.id}`, 'DELETE', undefined, 404, otherToken)
  const { AdStudioRecord } = fromBackend('dist/database/models/AdStudioRecord.js')
  const paged = await AdStudioRecord.bulkCreate(Array.from({ length: 51 }, (_, i) => ({ userId: user.id, kind: 'brand', key: `page-${i}`, payload: { ...brand, name: i === 0 ? 'Literal 100%_match' : `Paged brand ${i}` } })))
  const firstPage = await json('/studio/brand')
  assert.equal(firstPage.total, 52)
  assert.equal(firstPage.items.length, 50)
  const secondPage = await json(`/studio/brand?offset=${firstPage.nextOffset}`)
  assert.equal(secondPage.items.length, 2)
  assert.equal(secondPage.nextOffset, null)
  assert.equal(new Set([...firstPage.items, ...secondPage.items].map((row) => row.id)).size, 52)
  assert.equal((await json('/studio/brand?q=%25_match')).total, 1)
  await Promise.all(paged.map((row) => row.destroy()))
  const template = await json('/studio/template', 'POST', {
    key: 'qa-template',
    payload: { name: 'QA template', config: emptyConfig, slideLayouts: [{ text: 'Reusable slide', durationSeconds: 3, edit: { motion: 'zoom-in', volume: 0 }, textStyle: config.textStyle }] },
  })
  assert.equal(template.payload.config.kind, 'carousel')
  assert.equal(template.payload.slideLayouts[0].edit.motion, 'zoom-in')
  assert.equal(template.payload.slideLayouts[0].edit.volume, 0)
  assert.equal(template.payload.slideLayouts[0].text, 'Reusable slide')
  await json(
    '/studio/template',
    'POST',
    {
      key: 'invalid-template',
      payload: { name: 'Invalid template', config: { ...config, selectedClipIds: [images[0].id] } },
    },
    422,
  )
  await json('/studio/preset', 'POST', {
    key: 'qa-preset',
    payload: {
      id: 'qa-preset',
      name: 'QA preset',
      visualEffects: config.visualEffects,
      hook: config.hook,
      timing: config.timing,
      transition: config.transition,
    },
  })
  assert.equal((await json('/studio/preset')).total, 1)
  const { SavedProduct } = fromBackend('dist/database/models/SavedProduct.js')
  const product = await SavedProduct.create({
    userId: user.id,
    source: 'qa',
    affiliateUrl: 'https://example.invalid/qa-product',
    affiliateUrlHash: createHash('sha256').update('qa-product').digest('hex'),
    offer: {
      title: 'QA Kitchen organizer',
      discountedPrice: 39.9,
      currency: 'BRL',
      coupon: 'CASA10',
      imageUrl: 'https://httpbin.org/image/png',
      affiliateUrl: 'https://example.invalid/qa-product',
    },
  })
  const unrelated = await SavedProduct.create({
    userId: other.id,
    source: 'qa',
    affiliateUrl: 'https://example.invalid/other',
    affiliateUrlHash: createHash('sha256').update('other-product').digest('hex'),
    offer: {
      title: 'Other account product',
      discountedPrice: 1,
      currency: 'BRL',
      affiliateUrl: 'https://example.invalid/other',
    },
  })
  await json(`/${fresh.id}/products/import`, 'POST', { productIds: [unrelated.id] }, 422)
  await json('/studio/copy/suggest', 'POST', { productIds: [unrelated.id] }, 422)
  const importer = fromBackend('dist/services/AdMusicImport.js')
  const originalDownload = importer.downloadProductImage
  let mockedCalls = 0
  if (!process.argv.includes('--live-image'))
    importer.downloadProductImage = async () => {
      mockedCalls++
      const folder = fs.mkdtempSync(path.join(directory, 'product-download-'))
      const dest = path.join(folder, 'product.jpg')
      // Read a real stored image through the storage adapter; mock only HTTP.
      const asset = await fromBackend('dist/database/models/AdAsset.js').AdAsset.findByPk(
        images[0].id,
      )
      await fromBackend('dist/services/AdObjectStorage.js').adObjectStorage.materialize(
        asset.storagePath,
        dest,
      )
      return {
        path: dest,
        directory: folder,
        originalname: 'product.jpg',
        mimetype: 'image/jpeg',
        size: fs.statSync(dest).size,
      }
    }
  let imported
  try {
    imported = await json(`/${fresh.id}/products/import`, 'POST', { productIds: [product.id] })
  } finally {
    importer.downloadProductImage = originalDownload
  }
  assert.equal(imported.errors.length, 0, JSON.stringify(imported.errors))
  assert.equal(imported.items.length, 1)
  assert.ok(imported.items[0].product.text.includes('39,90'))
  assert.ok(imported.items[0].product.text.includes('CASA10'))
  if (!process.argv.includes('--live-image')) assert.equal(mockedCalls, 1)
  if (process.argv.includes('--live-ai')) {
    const suggestion = await json('/studio/copy/suggest', 'POST', {
      productIds: [product.id],
      tone: 'friendly',
    })
    assert.ok(suggestion.texts[0].includes('39,90'))
    assert.ok(suggestion.caption.includes('CASA10'))
    assert.ok(suggestion.caption.includes('https://example.invalid/qa-product'))
    console.log('PASS: live OpenRouter copy suggestion, commercial facts preserved.')
  }
  const pub = {
    name: 'Calendar QA',
    projectId: carousel.id,
    jobId: job.id,
    status: 'scheduled',
    scheduledAt: '2026-10-06T18:00:00.000Z',
    timeZone: 'America/Sao_Paulo',
    caption: 'Calendar caption',
    productIds: [product.id],
    postUrl: null,
    publishedAt: null,
    metrics: null,
  }
  await json(
    '/studio/publication',
    'POST',
    { key: 'invalid-pub', payload: { ...pub, scheduledAt: null } },
    400,
  )
  await json(
    '/studio/publication',
    'POST',
    { key: 'other-product-pub', payload: { ...pub, productIds: [unrelated.id] } },
    422,
  )
  const publication = await json('/studio/publication', 'POST', {
    key: 'qa-publication',
    payload: pub,
  })
  const metrics = {
    impressions: 1000,
    clicks: 20,
    saves: 10,
    likes: 40,
    comments: 5,
    sales: 3,
    revenue: 119.7,
    attribution: 'Affiliate report QA fixture',
    observedAt: new Date().toISOString(),
    source: 'manual',
  }
  await json(
    '/studio/publication',
    'POST',
    {
      key: publication.key,
      expectedRevision: 0,
      payload: { ...pub, metrics: { ...metrics, attribution: '' } },
    },
    400,
  )
  const measured = await json('/studio/publication', 'POST', {
    key: publication.key,
    expectedRevision: 0,
    payload: { ...pub, metrics },
  })
  assert.equal(measured.payload.metrics.sales, 3)
  assert.equal((await json('/studio/publication', 'GET', undefined, 200, otherToken)).total, 0)
  await json(
    '/studio/publication',
    'POST',
    { key: 'invalid-published', payload: { ...pub, status: 'published' } },
    400,
  )
  await json('/studio/publication', 'POST', { key: 'other-project', payload: pub }, 404, otherToken)
  const zip = await fetch(`${base}/${carousel.id}/render-jobs/${job.id}/bundle`, {
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(zip.status, 200)
  assert.match(zip.headers.get('content-type'), /application\/zip/)
  const file = path.join(directory, 'bundle.zip')
  fs.writeFileSync(file, Buffer.from(await zip.arrayBuffer()))
  const entries = command('unzip', ['-Z1', file]).trim().split('\n')
  assert.deepEqual(
    entries.sort(),
    ['01.jpg', '02.mp4', '03.jpg', 'caption.txt', 'cover.jpg', 'manifest.json'].sort(),
  )
  assert.equal(command('unzip', ['-p', file, 'caption.txt']), job.config.carousel.caption)
  assert.deepEqual(
    JSON.parse(command('unzip', ['-p', file, 'manifest.json'])).outputs.map(
      (o) => o.clipAssetIds[0],
    ),
    job.outputs.map((o) => o.clipAssetIds[0]),
  )
  const denied = await fetch(`${base}/${carousel.id}/render-jobs/${job.id}/bundle`, {
    headers: { authorization: `Bearer ${otherToken}` },
  })
  assert.equal(denied.status, 404)
  // Trimmed loop with mute and an animated still must render through real worker.
  const creativeConfig = {
    ...config,
    carousel: {
      caption: 'Motion and trim QA',
      slides: [
        { assetId: images[0].id, text: '', durationSeconds: 3, edit: { motion: 'zoom-in' } },
        {
          assetId: video.id,
          text: '',
          durationSeconds: 3,
          edit: {
            trimStart: 0.2,
            trimEnd: 0.8,
            volume: 0,
            framingOverride: true,
            zoom: 1.2,
            focusX: 30,
            focusY: 60,
          },
        },
      ],
    },
  }
  await json(`/${carousel.id}`, 'PATCH', { config: creativeConfig })
  const motionJob = await json(`/${carousel.id}/render-jobs`, 'POST', {}, 202)
  const motionResult = await completed(carousel.id, motionJob.id)
  assert.deepEqual(
    motionResult.outputs.map((o) => o.mimeType),
    ['video/mp4', 'video/mp4'],
  )
  const originalJob = await fromBackend('dist/database/models/AdRenderJob.js').AdRenderJob.findByPk(
    motionJob.id,
  )
  for (const [index, out] of originalJob.outputs.entries()) {
    const probe = JSON.parse(
      command('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_type,width,height',
        '-of',
        'json',
        out.storagePath,
      ]),
    )
    assert.equal(probe.streams.find((s) => s.codec_type === 'video').width, 1080)
    assert.ok(Math.abs(Number(probe.format.duration) - 3) < 0.2)
    if (index === 1)
      assert.equal(
        probe.streams.some((s) => s.codec_type === 'audio'),
        false,
      )
  }
  for (const format of ['feed', 'carousel', 'reels', 'stories']) {
    const variant = await json(
      `/${carousel.id}/variants`,
      'POST',
      { format, framing: { ...config.framing, focusX: 35 } },
      201,
    )
    assert.equal(variant.config.output.height, ['feed', 'carousel'].includes(format) ? 1350 : 1920)
    assert.equal(variant.config.framing.focusX, 35)
    const ownedAssets = await fromBackend('dist/database/models/AdAsset.js').AdAsset.findAll({
      where: { projectId: variant.id },
    })
    assert.equal(ownedAssets.length, variant.assets.length)
    assert.ok(
      variant.config.carousel.slides.every((slide) =>
        ownedAssets.some((asset) => asset.id === slide.assetId),
      ),
    )
    assert.equal(variant.config.kind, ['feed', 'carousel'].includes(format) ? 'carousel' : 'video')
    if (format === 'reels') {
      const render = await json(`/${variant.id}/render-jobs`, 'POST', {}, 202)
      assert.equal((await completed(variant.id, render.id)).outputs.length, 1)
    }
  }
  console.log(
    `PASS: studio revisions/conflicts, media reuse/dedup/search/ownership, server brands/templates/presets, ${process.argv.includes('--live-image') ? 'live' : 'mocked HTTP'} catalog import, calendar/attributed metrics, ZIP snapshot/cover, real motion/trim/mute worker, format variants.`,
  )
}

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')

// Runs only inside validate-ad-media's disposable database, API and storage.
module.exports = async function validateArtcraftStudio({
  json, base, token, otherToken, fromBackend, carousel, config, images, video,
  directory, command, completed,
}) {
  const blank = {
    ...config,
    texts: [],
    productIds: [],
    selectedClipIds: [],
    clipEdits: {},
    musicAssetId: null,
    musicTracks: [],
    hook: { ...config.hook, enabled: false, clipAssetId: null },
    carousel: { slides: [], caption: '' },
    overlays: [],
  }
  // Carousel slides have their own text; video permutations still require text.
  await json('', 'POST', { name: 'QA blank carousel', config: blank }, 201)
  await json('', 'POST', { name: 'QA invalid blank video', config: { ...blank, kind: 'video' } }, 400)

  const imageLayer = {
    id: 'product-image', name: 'Product inset', type: 'image', assetId: images[2].id,
    x: 75, y: 5, width: 20, height: 20, opacity: 1, hidden: false, fit: 'cover',
  }
  const overlays = [
    { id: 'rectangle', name: 'Green card', type: 'shape', shape: 'rectangle', color: '#00FF00', x: 5, y: 5, width: 20, height: 10, opacity: 1, hidden: false },
    { id: 'label', name: 'Sale label', type: 'text', text: 'OFERTA', color: '#FFFFFF', fontSize: 36, backgroundColor: '#FF00FF', x: 40, y: 5, width: 20, height: 10, opacity: 1, hidden: false },
    imageLayer,
    { id: 'hidden', name: 'Hidden cover', type: 'shape', shape: 'rectangle', color: '#FF0000', x: 5, y: 5, width: 20, height: 10, opacity: 1, hidden: true },
    { id: 'transparent', name: 'Transparent cover', type: 'shape', shape: 'ellipse', color: '#0000FF', x: 5, y: 5, width: 20, height: 10, opacity: 0, hidden: false },
  ]
  const composition = {
    ...blank,
    overlays,
    audioFinishing: { normalizeLoudness: true, targetLufs: -14 },
    carousel: {
      caption: 'Composition QA snapshot',
      slides: [
        { assetId: images[0].id, text: '', durationSeconds: 3 },
        { assetId: video.id, text: '', durationSeconds: 3 },
      ],
    },
  }
  const saved = await json(`/${carousel.id}`, 'PATCH', { config: composition })
  assert.deepEqual(saved.config.overlays, overlays)
  assert.deepEqual(saved.config.audioFinishing, composition.audioFinishing)
  assert.equal(saved.config.texts.length, 0)
  // This asset appears only as an overlay, so its guard cannot pass by accident
  // because it is selected as a clip or carousel slide.
  await json(`/${carousel.id}/assets/${images[2].id}`, 'DELETE', undefined, 409)
  await json(`/${carousel.id}`, 'PATCH', { config: composition }, 404, otherToken)

  const wrongProject = await json(`/${carousel.id}/duplicate`, 'POST', {}, 201)
  const wrongImage = wrongProject.assets.find((asset) => asset.kind === 'image')
  const foreign = await json('', 'POST', { name: 'Other account composition', config: blank }, 201, otherToken)
  const form = new FormData()
  form.set('kind', 'image')
  form.append('files', new Blob([fs.readFileSync(path.join(directory, 'produto.jpg'))], { type: 'image/jpeg' }), 'foreign.jpg')
  const foreignResponse = await fetch(`${base}/${foreign.id}/assets`, {
    method: 'POST', headers: { authorization: `Bearer ${otherToken}` }, body: form,
  })
  const foreignBody = await foreignResponse.json()
  assert.equal(foreignResponse.status, 201, JSON.stringify(foreignBody))
  const foreignImage = foreignBody.data[0]

  const reusable = await json(`/${carousel.id}/assets/${images[1].id}/library`, 'POST', {
    name: 'Composition retry fixture', tags: ['composition-retry'], productIds: [],
  })
  const reusableOther = await json(`/${carousel.id}/assets/${images[2].id}/library`, 'POST', {
    name: 'Composition second fixture', tags: [], productIds: [],
  })
  const destination = await json('', 'POST', { name: 'QA attachment destination', config: blank }, 201)
  const anotherDestination = await json('', 'POST', { name: 'QA attachment alternate', config: blank }, 201)
  const attachmentRequest = { recordId: reusable.record.id, requestKey: randomUUID() }
  const attachments = await Promise.all([0, 1, 2].map(() => json(`/${destination.id}/library/attach`, 'POST', attachmentRequest)))
  assert.equal(new Set(attachments.map((asset) => asset.id)).size, 1, 'Concurrent attach retries must return one asset')
  assert.equal((await json(`/${destination.id}`)).assets.length, 1)
  assert.equal((await json(`/${destination.id}/library/attach`, 'POST', attachmentRequest)).id, attachments[0].id)
  assert.equal((await json(`/${destination.id}/library/attach`, 'POST', { ...attachmentRequest, requestKey: attachmentRequest.requestKey.toUpperCase() })).id, attachments[0].id)
  await json(`/${anotherDestination.id}/library/attach`, 'POST', attachmentRequest, 409)
  await json(`/${destination.id}/library/attach`, 'POST', { ...attachmentRequest, recordId: reusableOther.record.id }, 409)
  await json(`/${destination.id}/library/attach`, 'POST', { ...attachmentRequest, requestKey: 'invalid' }, 400)
  await json(`/${destination.id}/library/attach`, 'POST', attachmentRequest, 404, otherToken)
  await json(`/${foreign.id}/library/attach`, 'POST', attachmentRequest, 404)
  await json(`/${foreign.id}/library/attach`, 'POST', attachmentRequest, 404, otherToken)
  await json(`/${destination.id}/assets/${attachments[0].id}`, 'DELETE')
  await json(`/${destination.id}/library/attach`, 'POST', attachmentRequest, 409)
  assert.equal((await json(`/${destination.id}`)).assets.length, 0, 'A deleted receipt asset must not be silently recreated')

  for (const invalidId of [wrongImage.id, foreignImage.id, video.id, 999999999]) {
    await json(`/${carousel.id}`, 'PATCH', {
      config: { ...composition, overlays: [{ ...imageLayer, assetId: invalidId }] },
    }, 422)
  }
  await json(`/${carousel.id}`, 'PATCH', {
    config: { ...composition, overlays: [overlays[0], overlays[0]] },
  }, 400)
  await json(`/${carousel.id}`, 'PATCH', {
    config: { ...composition, overlays: Array.from({ length: 9 }, (_, index) => ({ ...overlays[0], id: `extra-${index}` })) },
  }, 400)
  await json(`/${carousel.id}`, 'PATCH', {
    config: { ...composition, audioFinishing: { normalizeLoudness: true, targetLufs: -80 } },
  }, 400)
  assert.equal((await json(`/${carousel.id}`)).revision, saved.revision)

  const assertRemapped = (copy) => {
    const copied = copy.config.overlays.find((layer) => layer.type === 'image')
    assert.ok(copied)
    assert.notEqual(copied.assetId, imageLayer.assetId)
    assert.ok(copy.assets.some((asset) => asset.id === copied.assetId && asset.kind === 'image'))
    assert.deepEqual(copy.config.overlays.filter((layer) => layer.type !== 'image'), overlays.filter((layer) => layer.type !== 'image'))
    assert.deepEqual(copy.config.audioFinishing, composition.audioFinishing)
  }
  assertRemapped(wrongProject)
  let videoVariation
  for (const format of ['feed', 'reels']) {
    const variant = await json(`/${carousel.id}/variants`, 'POST', { format }, 201)
    assertRemapped(variant)
    if (format === 'reels') {
      assert.equal(variant.config.kind, 'video')
      assert.ok(variant.config.texts.length > 0, 'A carousel without captions needs a valid video text fallback')
      assert.ok(variant.config.texts.every((text) => text.trim().length > 0))
      // Video variations intentionally discard source clip audio; supply an
      // explicit music track to verify finishing of the final mixed output.
      const musicFile = path.join(directory, 'composition-music.m4a')
      command('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=3', '-c:a', 'aac', musicFile])
      const musicForm = new FormData()
      musicForm.set('kind', 'music')
      musicForm.append('files', new Blob([fs.readFileSync(musicFile)], { type: 'audio/mp4' }), 'composition-music.m4a')
      const musicResponse = await fetch(`${base}/${variant.id}/assets`, {
        method: 'POST', headers: { authorization: `Bearer ${token}` }, body: musicForm,
      })
      const musicBody = await musicResponse.json()
      assert.equal(musicResponse.status, 201, JSON.stringify(musicBody))
      await json(`/${variant.id}`, 'PATCH', { config: { ...variant.config, musicAssetId: musicBody.data[0].id } })
      const submitted = await json(`/${variant.id}/render-jobs`, 'POST', {}, 202)
      const finished = await completed(variant.id, submitted.id)
      assert.equal(finished.outputs.length, 1)
      assert.equal(finished.outputs[0].mimeType, 'video/mp4')
      const record = await fromBackend('dist/database/models/AdRenderJob.js').AdRenderJob.findByPk(submitted.id)
      videoVariation = { projectId: variant.id, jobId: submitted.id, output: record.outputs[0], width: variant.config.output.width, height: variant.config.output.height }
    }
  }
  const template = await json('/studio/template', 'POST', {
    key: 'qa-composition-template',
    payload: { name: 'Reusable composition', config: { ...blank, overlays, audioFinishing: composition.audioFinishing } },
  })
  assert.deepEqual(template.payload.config.overlays, overlays.filter((layer) => layer.type !== 'image'))
  assert.deepEqual(template.payload.config.audioFinishing, composition.audioFinishing)

  const queued = await json(`/${carousel.id}/render-jobs`, 'POST', {}, 202)
  // Change both composition and audio after enqueueing. The worker must read
  // the queued snapshot and its overlay-only asset, not this newer project.
  await json(`/${carousel.id}`, 'PATCH', { config: { ...composition, overlays: [], audioFinishing: { normalizeLoudness: false, targetLufs: -16 } } })
  const rendered = await completed(carousel.id, queued.id)
  assert.deepEqual(rendered.config.overlays, overlays)
  assert.deepEqual(rendered.config.audioFinishing, composition.audioFinishing)
  assert.deepEqual(rendered.outputs.map((output) => output.mimeType), ['image/jpeg', 'video/mp4'])
  const stored = await fromBackend('dist/database/models/AdRenderJob.js').AdRenderJob.findByPk(queued.id)
  assert.deepEqual(stored.configSnapshot.overlays, overlays)
  assert.deepEqual(stored.configSnapshot.audioFinishing, composition.audioFinishing)

  function pixel(file, xPercent, yPercent, width, height) {
    const value = command('ffmpeg', [
      '-v', 'error', '-i', file, '-vf',
      `format=rgb24,crop=1:1:${Math.floor(width * xPercent / 100)}:${Math.floor(height * yPercent / 100)}`,
      '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
    ], { encoding: null })
    assert.equal(value.length, 3)
    return [...value]
  }
  const pixelEvidence = []
  const renderedFiles = [
    ...stored.outputs.map((output) => ({ projectId: carousel.id, jobId: queued.id, output, width: composition.output.width, height: composition.output.height })),
    videoVariation,
  ]
  for (const { projectId, jobId, output, width, height } of renderedFiles) {
    const response = await fetch(`${base}/${projectId}/render-jobs/${jobId}/outputs/${output.index}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    assert.equal(response.status, 200)
    const file = path.join(directory, `composition-${jobId}-${output.index}${output.mimeType === 'image/jpeg' ? '.jpg' : '.mp4'}`)
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()))
    const green = pixel(file, 10, 10, width, height)
    const magenta = pixel(file, 45, 13, width, height)
    const orange = pixel(file, 76, 6, width, height)
    const whiteImageCenter = pixel(file, 85, 15, width, height)
    assert.ok(green[1] > 220 && green[0] < 35 && green[2] < 35, `shape/hidden/opacity pixels ${green}`)
    assert.ok(magenta[0] > 220 && magenta[2] > 220 && magenta[1] < 35, `text background pixels ${magenta}`)
    assert.ok(orange[0] > 200 && orange[1] > 60 && orange[1] < 140 && orange[2] < 100, `image edge pixels ${orange}`)
    assert.ok(whiteImageCenter.every((channel) => channel > 220), `image center pixels ${whiteImageCenter}`)
    pixelEvidence.push({ mime: output.mimeType, width, height, green, magenta, orange, whiteImageCenter })
  }
  const audioOutput = stored.outputs.find((output) => output.mimeType === 'video/mp4')
  const probe = JSON.parse(command('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,sample_rate', '-of', 'json', audioOutput.storagePath]))
  const audioStream = probe.streams.find((stream) => stream.codec_type === 'audio')
  assert.ok(audioStream)
  assert.equal(Number(audioStream.sample_rate), 48000, 'Normalized AAC output must retain the supported 48 kHz rate')
  const videoProbe = JSON.parse(command('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,sample_rate', '-of', 'json', videoVariation.output.storagePath]))
  assert.equal(Number(videoProbe.streams.find((stream) => stream.codec_type === 'audio')?.sample_rate), 48000)
  const measured = spawnSync('ffmpeg', [
    '-hide_banner', '-i', audioOutput.storagePath, '-vn',
    '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-',
  ], { encoding: 'utf8' })
  assert.equal(measured.status, 0, measured.stderr)
  const measurement = measured.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)
  assert.ok(measurement, measured.stderr)
  const inputLufs = Number(JSON.parse(measurement[0]).input_i)
  assert.ok(Number.isFinite(inputLufs) && Math.abs(inputLufs + 14) < 1.5, `Rendered loudness ${inputLufs} LUFS must match -14 target`)
  assert.deepEqual((await json(`/${carousel.id}`)).config.overlays, [])
  // Leave the completed composition available to browser acceptance in
  // --serve mode after proving that newer project edits did not affect it.
  await json(`/${carousel.id}`, 'PATCH', { config: composition })
  console.log(`PASS: Artcraft composition ownership/type/limits, reference deletion, idempotent/concurrent library attach with mismatch/deletion/ownership guards, clone/feed/reels remapping, portable templates, captionless carousel-to-video, immutable JPG/MP4 snapshot and final reels render. Pixels: ${JSON.stringify(pixelEvidence)}. Normalized 48 kHz AAC audio: ${inputLufs} LUFS.`)
}

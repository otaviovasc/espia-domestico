import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import multer from 'multer'
import { container } from 'tsyringe'
import { env } from '@/config/env'
import { AdStudioController } from '@/controllers/AdStudioController'
import { AdProjectController } from '@/controllers/AdProjectController'
import { authenticate } from '@/middleware/auth'
import { adUploadTempDir } from '@/services/AdMediaService'

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    void mkdir(adUploadTempDir, { recursive: true }).then(
      () => callback(null, adUploadTempDir),
      (error: Error) => callback(error, adUploadTempDir),
    )
  },
  filename: (_req, _file, callback) => callback(null, `${Date.now()}-${randomUUID()}.upload`),
})
const upload = multer({
  storage,
  limits: {
    files: 50,
    fileSize: Math.max(20, env.AD_MAX_CLIP_MB, env.AD_MAX_MUSIC_MB) * 1024 * 1024,
    fields: 4,
  },
})

const adProjectRoutes = Router()
const controller = container.resolve(AdProjectController)
const studio = container.resolve(AdStudioController)
const musicImportLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
})

adProjectRoutes.use(authenticate)
adProjectRoutes.get('/studio/:kind', (req, res) => studio.list(req, res))
adProjectRoutes.post('/studio/:kind', (req, res) => studio.save(req, res))
adProjectRoutes.delete('/studio/records/:recordId', (req, res) => studio.remove(req, res))
adProjectRoutes.patch('/studio/library/:recordId', (req, res) => studio.editMedia(req, res))
adProjectRoutes.post('/studio/copy/suggest', musicImportLimit, (req, res) => studio.copy(req, res))
adProjectRoutes.post('/:id/assets/:assetId/library', (req, res) => studio.saveMedia(req, res))
adProjectRoutes.post('/:id/library/attach', (req, res) => studio.attach(req, res))
adProjectRoutes.post('/:id/products/import', musicImportLimit, (req, res) => studio.products(req, res))
adProjectRoutes.post('/:id/variants', (req, res) => studio.variant(req, res))
adProjectRoutes.get('/:id/render-jobs/:jobId/bundle', (req, res) => studio.bundle(req, res))
adProjectRoutes.get('/', (req, res) => controller.list(req, res))
adProjectRoutes.post('/', (req, res) => controller.create(req, res))
adProjectRoutes.get('/preview/sfx/:preset', (req, res) => controller.previewSfx(req, res))
adProjectRoutes.post('/preview/captions', (req, res) => controller.previewCaptions(req, res))
adProjectRoutes.post('/:id/preview/timing', (req, res) => controller.previewTiming(req, res))
adProjectRoutes.get('/:id', (req, res) => controller.get(req, res))
adProjectRoutes.patch('/:id', (req, res) => controller.update(req, res))
adProjectRoutes.post('/:id/duplicate', (req, res) => controller.duplicate(req, res))
adProjectRoutes.delete('/:id', (req, res) => controller.remove(req, res))
adProjectRoutes.post('/:id/assets', upload.array('files', 50), (req, res) => controller.addAssets(req, res))
adProjectRoutes.post('/:id/music/import', musicImportLimit, (req, res) => controller.importMusic(req, res))
adProjectRoutes.delete('/:id/assets/:assetId', (req, res) => controller.removeAsset(req, res))
adProjectRoutes.get('/:id/assets/:assetId/content', (req, res) => controller.assetContent(req, res))
adProjectRoutes.get('/:id/render-jobs', (req, res) => controller.listJobs(req, res))
adProjectRoutes.post('/:id/render-jobs', (req, res) => controller.createJob(req, res))
adProjectRoutes.get('/:id/render-jobs/:jobId', (req, res) => controller.getJob(req, res))
adProjectRoutes.post('/:id/render-jobs/:jobId/cancel', (req, res) => controller.cancelJob(req, res))
adProjectRoutes.get('/:id/render-jobs/:jobId/outputs/:index', (req, res) => controller.output(req, res))

export { adProjectRoutes }

import type { Request, Response } from 'express'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import archiver from 'archiver'
import { inject, injectable } from 'tsyringe'
import { z } from 'zod'
import { AdStudioService } from '@/services/AdStudioService'
import { AdProjectService } from '@/services/AdProjectService'
import { adObjectStorage } from '@/services/AdObjectStorage'
import { runProcess } from '@/services/AdMediaService'
import { BadRequestError, UnauthorizedError } from '@/middleware/Error/AppError'
const id = z.coerce.number().int().positive()
const productIds = z.array(z.number().int().positive()).min(1).max(20)
@injectable()
export class AdStudioController {
  constructor(
    @inject(AdStudioService) private studio: AdStudioService,
    @inject(AdProjectService) private projects: AdProjectService,
  ) {}
  private user(req: Request) {
    if (!req.user) throw UnauthorizedError('Não autenticado')
    return req.user.userId
  }
  async list(req: Request, res: Response) {
    res.json({
      success: true,
      data: await this.studio.list(
        this.user(req),
        req.params.kind,
        z.coerce.number().int().min(0).default(0).parse(req.query.offset),
        z.string().max(100).default('').parse(req.query.q),
      ),
    })
  }
  async save(req: Request, res: Response) {
    res.json({
      success: true,
      data: await this.studio.save(this.user(req), req.params.kind, req.body),
    })
  }
  async remove(req: Request, res: Response) {
    await this.studio.remove(this.user(req), id.parse(req.params.recordId))
    res.json({ success: true, data: {} })
  }
  async saveMedia(req: Request, res: Response) {
    res.json({
      success: true,
      data: await this.studio.saveMedia(
        this.user(req),
        id.parse(req.params.id),
        id.parse(req.params.assetId),
        req.body,
      ),
    })
  }
  async editMedia(req: Request, res: Response) {
    res.json({
      success: true,
      data: await this.studio.editMedia(this.user(req), id.parse(req.params.recordId), req.body),
    })
  }
  async attach(req: Request, res: Response) {
    res.json({
      success: true,
      data: await this.studio.attachMedia(
        this.user(req),
        id.parse(req.params.id),
        id.parse(req.body.recordId),
      ),
    })
  }
  async products(req: Request, res: Response) {
    res.json({
      success: true,
      data: await this.studio.importProducts(
        this.user(req),
        id.parse(req.params.id),
        productIds.parse(req.body.productIds),
      ),
    })
  }
  async copy(req: Request, res: Response) {
    res.json({
      success: true,
      data: await this.studio.suggestCopy(
        this.user(req),
        productIds.parse(req.body.productIds),
        z.enum(['direct', 'friendly', 'educational']).default('direct').parse(req.body.tone),
      ),
    })
  }
  async variant(req: Request, res: Response) {
    const input = z
      .object({
        format: z.enum(['feed', 'carousel', 'reels', 'stories']),
        framing: z
          .object({
            mode: z.enum(['cover', 'contain-blur', 'contain-solid']),
            focusX: z.number().int().min(0).max(100),
            focusY: z.number().int().min(0).max(100),
            backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i),
          })
          .optional(),
      })
      .parse(req.body)
    const userId = this.user(req)
    const clone = await this.projects.duplicate(userId, id.parse(req.params.id))
    try {
      const c = clone.config
      const carousel =
        input.format === 'carousel' || (input.format === 'feed' && c.kind === 'carousel')
      const selected =
        c.kind === 'carousel'
          ? [...new Set(c.carousel.slides.map((s) => s.assetId))]
          : c.selectedClipIds
      const slides = c.carousel.slides.length
        ? c.carousel.slides
        : selected.slice(0, 20).map((assetId, index) => ({
            assetId,
            text: c.texts[index % c.texts.length],
            durationSeconds: 5,
            ...(c.clipEdits[String(assetId)] ? { edit: c.clipEdits[String(assetId)] } : {}),
          }))
      if (slides.length === 1 && carousel) slides.push({ ...slides[0] })
      const texts =
        c.kind === 'carousel'
          ? c.carousel.slides
              .map((s) => s.text)
              .filter(Boolean)
              .slice(0, 20)
          : c.texts
      const result = await this.projects.update(userId, clone.id, {
        name: `${clone.name.replace(/ \(cópia\)$/, '')} · ${input.format}`.slice(0, 120),
        config: {
          ...c,
          kind: carousel ? 'carousel' : 'video',
          variationCount: 1,
          selectedClipIds: selected,
          clipEdits:
            c.kind === 'carousel'
              ? Object.fromEntries(
                  c.carousel.slides.filter((s) => s.edit).map((s) => [String(s.assetId), s.edit!]),
                )
              : c.clipEdits,
          texts: texts.length ? texts : c.texts,
          carousel: { ...c.carousel, slides: slides.slice(0, 20) },
          output: {
            ...c.output,
            width: 1080,
            height: input.format === 'feed' || input.format === 'carousel' ? 1350 : 1920,
          },
          framing: input.framing ?? c.framing,
        },
      })
      res.status(201).json({ success: true, data: result })
    } catch (error) {
      await this.projects.remove(userId, clone.id)
      throw error
    }
  }
  async bundle(req: Request, res: Response) {
    const user = this.user(req),
      projectId = id.parse(req.params.id),
      jobId = id.parse(req.params.jobId)
    const job = await this.projects.getJob(user, projectId, jobId)
    if (job.status !== 'completed' || !job.outputs.length)
      throw BadRequestError('Aguarde a renderização concluir')
    const directory = await mkdtemp(path.join(os.tmpdir(), 'ad-bundle-'))
    const abort = new AbortController()
    const close = () => {
      if (!res.writableFinished) abort.abort()
    }
    res.on('close', close)
    const archive = archiver('zip', { zlib: { level: 1 } })
    const streams: import('node:stream').Readable[] = []
    try {
      const first = await this.projects.output(user, projectId, jobId, job.outputs[0].index)
      const original = path.join(
        directory,
        first.mimeType === 'image/jpeg' ? 'cover.jpg' : 'source.mp4',
      )
      await adObjectStorage.materialize(first.storagePath, original, abort.signal)
      const cover = path.join(directory, 'cover.jpg')
      if (first.mimeType !== 'image/jpeg')
        await runProcess(
          'ffmpeg',
          ['-v', 'error', '-y', '-i', original, '-frames:v', '1', '-q:v', '2', cover],
          { signal: abort.signal },
        )
      res.type('application/zip')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="creative-${projectId}-${jobId}.zip"`,
      )
      res.setHeader('Cache-Control', 'private, no-store')
      const output = pipeline(archive, res, { signal: abort.signal })
      void output.catch(() => undefined)
      archive.file(cover, { name: 'cover.jpg' })
      archive.append(job.config.carousel?.caption || job.config.texts.join('\n\n'), {
        name: 'caption.txt',
      })
      archive.append(
        JSON.stringify(
          {
            projectId,
            jobId,
            format: job.config.output,
            productIds: job.config.productIds ?? [],
            outputs: job.outputs,
          },
          null,
          2,
        ),
        { name: 'manifest.json' },
      )
      for (const [index, out] of job.outputs.entries()) {
        const item = await this.projects.output(user, projectId, jobId, out.index)
        const content = await adObjectStorage.open(item.storagePath)
        streams.push(content.body)
        archive.append(content.body, {
          name: `${String(index + 1).padStart(2, '0')}.${item.mimeType === 'image/jpeg' ? 'jpg' : 'mp4'}`,
        })
      }
      await archive.finalize()
      await output
    } finally {
      archive.destroy()
      streams.forEach((stream) => stream.destroy())
      res.off('close', close)
      await rm(directory, { recursive: true, force: true })
    }
  }
}

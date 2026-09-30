import type { Request, Response } from 'express'
import { rm } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { inject, injectable } from 'tsyringe'
import { z } from 'zod'
import {
  AdAssetKindSchema,
  AdProjectConfigSchema,
  CreateAdProjectSchema,
  ImportAdMusicSchema,
  PreviewAdCaptionsSchema,
  PreviewAdTimingSchema,
  UpdateAdProjectSchema,
} from '@/dtos/adProject'
import { BadRequestError, UnauthorizedError } from '@/middleware/Error/AppError'
import { AdProjectService } from '@/services/AdProjectService'
import type { StoredMediaContent } from '@/services/AdObjectStorage'
import { createCaptionArtwork } from '@/services/adCaptionArtwork'

import { previewTransitionSfx } from '@/services/adTransitionSfx'

const IdSchema = z.coerce.number().int().positive()

@injectable()
export class AdProjectController {
  constructor(@inject(AdProjectService) private service: AdProjectService) {}

  private userId(req: Request): number {
    if (!req.user) throw UnauthorizedError('Não autenticado')
    return req.user.userId
  }

  private id(value: string): number {
    const parsed = IdSchema.safeParse(value)
    if (!parsed.success) throw BadRequestError('ID inválido')
    return parsed.data
  }

  private async sendContent(
    res: Response,
    content: StoredMediaContent,
    contentType: string,
    disposition: string,
  ): Promise<void> {
    res.status(content.range ? 206 : 200)
    res.type(contentType)
    res.setHeader('Content-Disposition', disposition)
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Length', String(content.contentLength))
    res.setHeader('Cache-Control', 'private, max-age=3600')
    if (content.range) {
      res.setHeader(
        'Content-Range',
        `bytes ${content.range.start}-${content.range.end}/${content.totalSize}`,
      )
    }
    if (content.etag) res.setHeader('ETag', content.etag)
    if (content.lastModified) res.setHeader('Last-Modified', content.lastModified.toUTCString())
    await pipeline(content.body, res)
  }

  async list(req: Request, res: Response): Promise<void> {
    res.json({ success: true, data: await this.service.list(this.userId(req)) })
  }

  async previewCaptions(req: Request, res: Response): Promise<void> {
    this.userId(req)
    const input = PreviewAdCaptionsSchema.parse(req.body)
    const captions = input.texts.map((text) => createCaptionArtwork({
      text,
      output: input.output,
      textStyle: input.textStyle,
    }))
    res.json({
      success: true,
      data: { captions: captions.map(({ text, svg }) => ({ text, svg })) },
    })
  }

  async previewSfx(req: Request, res: Response): Promise<void> {
    this.userId(req)
    const preset = z.enum(['whoosh', 'pop', 'click']).parse(req.params.preset)
    const audio = await previewTransitionSfx(preset)
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.type('audio/wav').send(audio)
  }

  async previewTiming(req: Request, res: Response): Promise<void> {
    const input = PreviewAdTimingSchema.parse(req.body)
    res.json({
      success: true,
      data: await this.service.previewTiming(
        this.userId(req),
        this.id(req.params.id),
        input.config,
      ),
    })
  }

  async get(req: Request, res: Response): Promise<void> {
    res.json({
      success: true,
      data: await this.service.get(this.userId(req), this.id(req.params.id)),
    })
  }

  async create(req: Request, res: Response): Promise<void> {
    const input = CreateAdProjectSchema.parse(req.body)
    res
      .status(201)
      .json({ success: true, data: await this.service.create(this.userId(req), input) })
  }

  async update(req: Request, res: Response): Promise<void> {
    const input = UpdateAdProjectSchema.parse(req.body)
    res.json({
      success: true,
      data: await this.service.update(this.userId(req), this.id(req.params.id), input),
    })
  }

  async duplicate(req: Request, res: Response): Promise<void> {
    res
      .status(201)
      .json({
        success: true,
        data: await this.service.duplicate(this.userId(req), this.id(req.params.id)),
      })
  }

  async remove(req: Request, res: Response): Promise<void> {
    const id = this.id(req.params.id)
    await this.service.remove(this.userId(req), id)
    res.json({ success: true, data: { id } })
  }

  async addAssets(req: Request, res: Response): Promise<void> {
    const files = req.files
    if (!Array.isArray(files) || !files.length) throw BadRequestError('Envie pelo menos um arquivo')
    try {
      const kind = AdAssetKindSchema.parse(req.body.kind)
      res.status(201).json({
        success: true,
        data: await this.service.addAssets(this.userId(req), this.id(req.params.id), kind, files),
      })
    } finally {
      await Promise.all(files.map((file) => rm(file.path, { force: true }).catch(() => undefined)))
    }
  }

  async importMusic(req: Request, res: Response): Promise<void> {
    const input = ImportAdMusicSchema.parse(req.body)
    res.status(201).json({
      success: true,
      data: await this.service.importMusic(this.userId(req), this.id(req.params.id), input),
    })
  }

  async removeAsset(req: Request, res: Response): Promise<void> {
    const projectId = this.id(req.params.id)
    const assetId = this.id(req.params.assetId)
    await this.service.removeAsset(this.userId(req), projectId, assetId)
    res.json({ success: true, data: { id: assetId } })
  }

  async assetContent(req: Request, res: Response): Promise<void> {
    const { asset, content } = await this.service.assetContent(
      this.userId(req),
      this.id(req.params.id),
      this.id(req.params.assetId),
      req.headers.range,
    )
    await this.sendContent(res, content, asset.mimeType, 'inline')
  }

  async listJobs(req: Request, res: Response): Promise<void> {
    res.json({
      success: true,
      data: await this.service.listJobs(this.userId(req), this.id(req.params.id)),
    })
  }

  async createJob(req: Request, res: Response): Promise<void> {
    const config =
      req.body?.config === undefined ? undefined : AdProjectConfigSchema.parse(req.body.config)
    res.status(202).json({
      success: true,
      data: await this.service.createJob(this.userId(req), this.id(req.params.id), config),
    })
  }

  async getJob(req: Request, res: Response): Promise<void> {
    res.json({
      success: true,
      data: await this.service.getJob(
        this.userId(req),
        this.id(req.params.id),
        this.id(req.params.jobId),
      ),
    })
  }

  async cancelJob(req: Request, res: Response): Promise<void> {
    res.json({
      success: true,
      data: await this.service.cancelJob(
        this.userId(req),
        this.id(req.params.id),
        this.id(req.params.jobId),
      ),
    })
  }

  async output(req: Request, res: Response): Promise<void> {
    const { output, content } = await this.service.outputContent(
      this.userId(req),
      this.id(req.params.id),
      this.id(req.params.jobId),
      z.coerce.number().int().min(0).parse(req.params.index),
      req.headers.range,
    )
    await this.sendContent(res, content, 'video/mp4', `inline; filename="${output.fileName}"`)
  }
}

import { Op } from 'sequelize'
import { inject, injectable } from 'tsyringe'
import { env } from '@/config/env'
import { sequelize } from '@/database'
import { AdAsset } from '@/database/models/AdAsset'
import { AdProject } from '@/database/models/AdProject'
import { AdRenderJob, type AdRenderOutput } from '@/database/models/AdRenderJob'
import {
  AdProjectConfigSchema,
  type AdProjectConfig,
  type AdAssetKind,
  type CreateAdProjectInput,
  type ImportAdMusicInput,
  type UpdateAdProjectInput,
} from '@/dtos/adProject'
import { ConflictError, NotFoundError, UnprocessableError } from '@/middleware/Error/AppError'
import { AdMediaService, serializeAdAsset } from '@/services/AdMediaService'
import { cleanupImportedMusic, downloadDirectMusic } from '@/services/AdMusicImport'
import { cancelAdRender, enqueueAdRender } from '@/services/AdRenderQueue'
import { AdVideoRenderer } from '@/services/AdVideoRenderer'

type AdTimingResult = { cuts: number[]; timingSource: 'fixed' | 'beat' | 'fallback' }
const previewTimingCache = new Map<string, Promise<AdTimingResult>>()
const MAX_PREVIEW_TIMING_CACHE_ENTRIES = 64

function cachedTiming(key: string, compute: () => Promise<AdTimingResult>): Promise<AdTimingResult> {
  const cached = previewTimingCache.get(key)
  if (cached) {
    previewTimingCache.delete(key)
    previewTimingCache.set(key, cached)
    return cached
  }
  const pending = compute().catch((error) => {
    previewTimingCache.delete(key)
    throw error
  })
  previewTimingCache.set(key, pending)
  while (previewTimingCache.size > MAX_PREVIEW_TIMING_CACHE_ENTRIES) {
    previewTimingCache.delete(previewTimingCache.keys().next().value!)
  }
  return pending
}

function serializeOutput(projectId: number, jobId: number, output: AdRenderOutput) {
  return {
    index: output.index,
    mimeType: output.mimeType ?? 'video/mp4',
    fileName: output.fileName,
    sizeBytes: output.sizeBytes,
    durationSeconds: output.durationSeconds,
    seed: output.seed,
    cutTimes: output.cutTimes,
    timingSource: output.timingSource,
    clipAssetIds: output.clipAssetIds,
    textOrder: output.textOrder,
    downloadUrl: `${env.API_PREFIX}/ad-projects/${projectId}/render-jobs/${jobId}/outputs/${output.index}`,
  }
}

export function serializeAdJob(job: AdRenderJob) {
  return {
    id: job.id,
    projectId: job.projectId,
    status: job.status,
    progress: job.progress,
    error: job.error,
    config: AdProjectConfigSchema.parse(job.configSnapshot),
    outputs: job.outputs.map((output) => serializeOutput(job.projectId, job.id, output)),
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }
}

@injectable()
export class AdProjectService {
  constructor(
    @inject(AdMediaService) private media: AdMediaService,
    @inject(AdVideoRenderer) private renderer: AdVideoRenderer,
  ) {}

  private async project(userId: number, projectId: number): Promise<AdProject> {
    const project = await AdProject.findOne({ where: { id: projectId, userId } })
    if (!project) throw NotFoundError('Projeto de anúncio não encontrado')
    return project
  }

  private async job(userId: number, projectId: number, jobId: number): Promise<AdRenderJob> {
    await this.project(userId, projectId)
    const job = await AdRenderJob.findOne({ where: { id: jobId, projectId } })
    if (!job) throw NotFoundError('Renderização não encontrada')
    return job
  }

  async list(userId: number) {
    const projects = await AdProject.findAll({ where: { userId }, order: [['updatedAt', 'DESC']] })
    return await Promise.all(
      projects.map(async (project) => {
        const [assetCount, latestJob] = await Promise.all([
          AdAsset.count({ where: { projectId: project.id } }),
          AdRenderJob.findOne({ where: { projectId: project.id }, order: [['createdAt', 'DESC']] }),
        ])
        return {
          id: project.id,
          name: project.name,
          config: AdProjectConfigSchema.parse(project.config),
          assetCount,
          latestJob: latestJob ? serializeAdJob(latestJob) : null,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        }
      }),
    )
  }

  async get(userId: number, projectId: number) {
    const project = await this.project(userId, projectId)
    const [assets, jobs] = await Promise.all([
      AdAsset.findAll({ where: { projectId }, order: [['createdAt', 'ASC']] }),
      AdRenderJob.findAll({ where: { projectId }, order: [['createdAt', 'DESC']], limit: 10 }),
    ])
    return {
      id: project.id,
      name: project.name,
      config: AdProjectConfigSchema.parse(project.config),
      assets: assets.map(serializeAdAsset),
      latestJobs: jobs.map(serializeAdJob),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }
  }

  async create(userId: number, input: CreateAdProjectInput) {
    // New projects have no assets yet. Reject references to another project.
    if (
      input.config.selectedClipIds.length ||
      input.config.carousel.slides.length ||
      input.config.musicAssetId ||
      Object.keys(input.config.clipEdits ?? {}).length ||
      input.config.musicTracks?.length ||
      input.config.hook?.clipAssetId
    )
      throw UnprocessableError('Envie as mídias antes de selecioná-las no projeto')
    const project = await AdProject.create({ userId, name: input.name, config: input.config })
    return await this.get(userId, project.id)
  }

  async update(userId: number, projectId: number, input: UpdateAdProjectInput) {
    const project = await this.project(userId, projectId)
    if (input.config) await this.validateAssetSelection(projectId, input.config)
    await project.update(input)
    return await this.get(userId, projectId)
  }

  async duplicate(userId: number, projectId: number) {
    const source = await this.project(userId, projectId)
    const sourceConfig = AdProjectConfigSchema.parse(source.config)
    const sourceAssets = await AdAsset.findAll({ where: { projectId }, order: [['id', 'ASC']] })
    const clone = await AdProject.create({
      userId,
      name: `${source.name} (cópia)`.slice(0, 120),
      config: { ...sourceConfig, selectedClipIds: [], carousel: { ...sourceConfig.carousel, slides: [] }, musicAssetId: null },
    })
    const assetMap = new Map<number, number>()
    try {
      for (const asset of sourceAssets) {
        const storagePath = await this.media.copyAssetStorage(asset, clone.id)
        const copied = await AdAsset.create({
          projectId: clone.id,
          kind: asset.kind,
          originalName: asset.originalName,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          storagePath,
          durationSeconds: asset.durationSeconds,
          width: asset.width,
          height: asset.height,
        })
        assetMap.set(asset.id, copied.id)
      }
      await clone.update({
        config: {
          ...sourceConfig,
          carousel: {
            ...sourceConfig.carousel,
            slides: sourceConfig.carousel.slides.map((slide) => ({ ...slide, assetId: assetMap.get(slide.assetId)! })),
          },
          selectedClipIds: sourceConfig.selectedClipIds
            .map((id) => assetMap.get(id))
            .filter((id): id is number => Boolean(id)),
          clipEdits: Object.fromEntries(
            Object.entries(sourceConfig.clipEdits).flatMap(([id, edit]) => {
              const copiedId = assetMap.get(Number(id))
              return copiedId ? [[String(copiedId), edit]] : []
            }),
          ),
          hook: sourceConfig.hook
            ? {
                ...sourceConfig.hook,
                clipAssetId: sourceConfig.hook.clipAssetId
                  ? (assetMap.get(sourceConfig.hook.clipAssetId) ?? null)
                  : null,
              }
            : { enabled: false, clipAssetId: null, durationSeconds: 2, text: '' },
          musicTracks: sourceConfig.musicTracks.flatMap((track) => {
            const copiedId = assetMap.get(track.assetId)
            return copiedId ? [{ ...track, assetId: copiedId }] : []
          }),
          musicAssetId: sourceConfig.musicAssetId
            ? (assetMap.get(sourceConfig.musicAssetId) ?? null)
            : null,
        },
      })
      return await this.get(userId, clone.id)
    } catch (error) {
      await clone.destroy().catch(() => undefined)
      await this.media.removeProjectStorage(clone.id).catch(() => undefined)
      throw error
    }
  }

  async remove(userId: number, projectId: number): Promise<void> {
    const project = await this.project(userId, projectId)
    const active = await AdRenderJob.count({
      where: { projectId, status: { [Op.in]: ['queued', 'running'] } },
    })
    if (active) throw ConflictError('Cancele as renderizações ativas antes de excluir o projeto')
    await this.media.removeProjectStorage(projectId)
    await project.destroy()
  }

  async addAssets(
    userId: number,
    projectId: number,
    kind: AdAssetKind,
    files: Express.Multer.File[],
  ) {
    await this.project(userId, projectId)
    const stored: AdAsset[] = []
    try {
      for (const file of files) stored.push(await this.media.store(projectId, kind, file))
      return stored.map(serializeAdAsset)
    } catch (error) {
      for (const asset of stored) await this.media.remove(asset).catch(() => undefined)
      throw error
    }
  }

  async importMusic(userId: number, projectId: number, input: ImportAdMusicInput) {
    const existing = await this.project(userId, projectId)
    if ((existing.config.musicTracks ?? []).length >= 8) {
      throw UnprocessableError('O projeto já atingiu o limite de 8 faixas de música')
    }
    const downloaded = await downloadDirectMusic(input.url, userId)
    let stored: AdAsset | null = null
    let committed = false
    try {
      const asset = await sequelize.transaction(async (transaction) => {
        const project = await AdProject.findOne({
          where: { id: projectId, userId },
          transaction,
          lock: transaction.LOCK.UPDATE,
        })
        if (!project) throw NotFoundError('Projeto de anúncio não encontrado')
        const musicTracks = project.config.musicTracks ?? []
        if (musicTracks.length >= 8) {
          throw UnprocessableError('O projeto já atingiu o limite de 8 faixas de música')
        }
        const created = await this.media.store(projectId, 'music', downloaded, { transaction })
        stored = created
        await project.update(
          {
            config: {
              ...project.config,
              musicAssetId: project.config.musicAssetId ?? created.id,
              musicTracks: [
                ...musicTracks,
                {
                  assetId: created.id,
                  volume: 0.8,
                  startSeconds: 0,
                  endSeconds: null,
                  sourceStartSeconds: 0,
                  fadeInSeconds: 0,
                  fadeOutSeconds: 0.8,
                },
              ],
            },
          },
          { transaction },
        )
        return created
      })
      committed = true
      return {
        asset: serializeAdAsset(asset),
        project: await this.get(userId, projectId),
      }
    } catch (error) {
      if (stored && !committed) await this.media.remove(stored).catch(() => undefined)
      throw error
    } finally {
      await cleanupImportedMusic(downloaded)
    }
  }

  async removeAsset(userId: number, projectId: number, assetId: number): Promise<void> {
    const project = await this.project(userId, projectId)
    const asset = await AdAsset.findOne({ where: { id: assetId, projectId } })
    if (!asset) throw NotFoundError('Mídia não encontrada')
    const active = await AdRenderJob.count({
      where: { projectId, status: { [Op.in]: ['queued', 'running'] } },
    })
    if (active) throw ConflictError('Cancele as renderizações ativas antes de excluir a mídia')
    if (
      project.config.selectedClipIds.includes(assetId) ||
      project.config.carousel?.slides.some((slide) => slide.assetId === assetId) ||
      project.config.musicAssetId === assetId ||
      project.config.musicTracks?.some((track) => track.assetId === assetId) ||
      (project.config.hook?.enabled && project.config.hook.clipAssetId === assetId)
    ) {
      throw ConflictError('Remova a mídia da seleção do projeto antes de excluí-la')
    }
    await this.media.remove(asset)
  }

  async asset(userId: number, projectId: number, assetId: number) {
    await this.project(userId, projectId)
    const asset = await AdAsset.findOne({ where: { id: assetId, projectId } })
    if (!asset) throw NotFoundError('Mídia não encontrada')
    return asset
  }

  async assetContent(userId: number, projectId: number, assetId: number, rangeHeader?: string) {
    const asset = await this.asset(userId, projectId, assetId)
    return { asset, content: await this.media.content(asset.storagePath, rangeHeader) }
  }

  async previewTiming(
    userId: number,
    projectId: number,
    config: AdProjectConfig,
  ): Promise<AdTimingResult> {
    await this.project(userId, projectId)
    if (config.timing.mode === 'fixed') return await this.renderer.getTiming(config, [])

    const firstTrack = config.musicTracks[0] ?? (config.musicAssetId
      ? {
          assetId: config.musicAssetId,
          volume: config.musicVolume,
          startSeconds: 0,
          endSeconds: null,
          sourceStartSeconds: 0,
          fadeInSeconds: 0,
          fadeOutSeconds: 0.8,
        }
      : undefined)
    if (!firstTrack) return await this.renderer.getTiming(config, [])

    const asset = await AdAsset.findOne({
      where: { id: firstTrack.assetId, projectId, kind: 'music' },
    })
    if (!asset) throw UnprocessableError('A música selecionada é inválida')
    const trackEnd = firstTrack.endSeconds ?? config.output.durationSeconds
    if (
      firstTrack.startSeconds >= config.output.durationSeconds ||
      trackEnd > config.output.durationSeconds ||
      trackEnd - firstTrack.startSeconds < 0.1
    ) {
      throw UnprocessableError('O intervalo da faixa de música é inválido')
    }
    if (firstTrack.sourceStartSeconds >= asset.durationSeconds - 0.05) {
      throw UnprocessableError('O início da faixa está fora da duração da música')
    }

    const key = JSON.stringify({
      storagePath: asset.storagePath,
      assetDuration: asset.durationSeconds,
      outputDuration: config.output.durationSeconds,
      track: {
        sourceStartSeconds: firstTrack.sourceStartSeconds,
        startSeconds: firstTrack.startSeconds,
        endSeconds: firstTrack.endSeconds,
      },
      hook: {
        enabled: config.hook.enabled,
        durationSeconds: config.hook.durationSeconds,
      },
    })
    return await cachedTiming(key, async () => {
      const stage = await this.media.stageAssets(projectId, [asset])
      try {
        return await this.renderer.getTiming(config, stage.assets)
      } finally {
        await this.media.cleanupStage(stage)
      }
    })
  }

  private async validateAssetSelection(
    projectId: number,
    config: AdProject['config'],
  ): Promise<void> {
    if (new Set(config.selectedClipIds).size !== config.selectedClipIds.length)
      throw UnprocessableError('Um clipe não pode aparecer duas vezes na seleção')
    const selected = new Set(config.selectedClipIds)
    const clipEdits = config.clipEdits ?? {}
    if (Object.keys(clipEdits).some((id) => !/^\d+$/.test(id) || !selected.has(Number(id))))
      throw UnprocessableError('Um ou mais ajustes de clipe não pertencem à seleção')
    if (config.hook?.enabled && config.hook.clipAssetId && !selected.has(config.hook.clipAssetId))
      throw UnprocessableError('O clipe de abertura deve estar na seleção')
    const musicTracks = config.musicTracks ?? []
    const musicIds = [
      ...musicTracks.map((track) => track.assetId),
      ...(config.musicAssetId ? [config.musicAssetId] : []),
    ]
    const slideIds = config.carousel.slides.map((slide) => slide.assetId)
    const ids = [...config.selectedClipIds, ...slideIds, ...musicIds]
    if (!ids.length) return
    const assets = await AdAsset.findAll({ where: { projectId, id: { [Op.in]: ids } } })
    const clips = new Set(assets.filter((item) => item.kind === 'clip' || item.kind === 'image').map((item) => item.id))
    if (slideIds.some((id) => !clips.has(id))) throw UnprocessableError('Uma ou mais mídias do carrossel são inválidas')
    if (config.selectedClipIds.some((id) => !clips.has(id)))
      throw UnprocessableError('Um ou mais clipes selecionados são inválidos')
    const availableMusic = new Map(
      assets.filter((item) => item.kind === 'music').map((item) => [item.id, item]),
    )
    if (musicIds.some((id) => !availableMusic.has(id))) {
      throw UnprocessableError('A música selecionada é inválida')
    }
    for (const track of musicTracks) {
      const end = track.endSeconds ?? config.output.durationSeconds
      if (
        track.startSeconds >= config.output.durationSeconds ||
        end > config.output.durationSeconds ||
        end - track.startSeconds < 0.1 ||
        track.fadeInSeconds + track.fadeOutSeconds > end - track.startSeconds + 0.01
      ) {
        throw UnprocessableError('O intervalo ou fade da faixa de música é inválido')
      }
      const music = availableMusic.get(track.assetId)!
      if (track.sourceStartSeconds >= music.durationSeconds - 0.05)
        throw UnprocessableError('O início da faixa está fora da duração da música')
    }
    for (const [clipIndex, clip] of assets.filter((item) => item.kind === 'clip').entries()) {
      const edit = clipEdits[String(clip.id)]
      if (!edit) continue
      const clipEnd = edit.trimEnd ?? clip.durationSeconds
      if (
        edit.trimStart >= clip.durationSeconds - 0.05 ||
        clipEnd > clip.durationSeconds + 0.05 ||
        clipEnd - edit.trimStart < 0.25
      ) {
        throw UnprocessableError(
          `O recorte do clipe ${clipIndex + 1} deve ter ao menos 0,25 s e caber na duração original`,
        )
      }
    }
  }

  async createJob(userId: number, projectId: number, configOverride?: unknown) {
    const project = await this.project(userId, projectId)
    const config = AdProjectConfigSchema.parse(
      configOverride === undefined ? project.config : configOverride,
    )
    await this.validateAssetSelection(projectId, config)
    if (config.kind === 'carousel' && config.carousel.slides.length < 2) throw UnprocessableError('Adicione de 2 a 20 slides ao carrossel')
    if (config.kind === 'video' && !config.selectedClipIds.length) {
      throw UnprocessableError('Selecione pelo menos um clipe para renderizar')
    }
    const active = await AdRenderJob.findOne({
      where: { projectId, status: { [Op.in]: ['queued', 'running'] } },
    })
    if (active) throw ConflictError('Este projeto já possui uma renderização ativa')
    let job: AdRenderJob
    try {
      job = await AdRenderJob.create({ projectId, configSnapshot: config })
    } catch (error) {
      if (error instanceof Error && error.name === 'SequelizeUniqueConstraintError') {
        throw ConflictError('Este projeto já possui uma renderização ativa')
      }
      throw error
    }
    enqueueAdRender(job.id)
    return serializeAdJob(job)
  }

  async listJobs(userId: number, projectId: number) {
    await this.project(userId, projectId)
    const jobs = await AdRenderJob.findAll({
      where: { projectId },
      order: [['createdAt', 'DESC']],
      limit: 50,
    })
    return jobs.map(serializeAdJob)
  }

  async getJob(userId: number, projectId: number, jobId: number) {
    return serializeAdJob(await this.job(userId, projectId, jobId))
  }

  async cancelJob(userId: number, projectId: number, jobId: number) {
    const job = await this.job(userId, projectId, jobId)
    await cancelAdRender(job)
    await job.reload()
    return serializeAdJob(job)
  }

  async output(userId: number, projectId: number, jobId: number, index: number) {
    const job = await this.job(userId, projectId, jobId)
    const output = job.outputs.find((item) => item.index === index)
    if (!output) throw NotFoundError('Mídia renderizada não encontrada')
    return output
  }

  async outputContent(
    userId: number,
    projectId: number,
    jobId: number,
    index: number,
    rangeHeader?: string,
  ) {
    const output = await this.output(userId, projectId, jobId, index)
    return { output, content: await this.media.content(output.storagePath, rangeHeader) }
  }
}

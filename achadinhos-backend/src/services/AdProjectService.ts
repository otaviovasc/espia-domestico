import { Op } from 'sequelize'
import { inject, injectable } from 'tsyringe'
import { env } from '@/config/env'
import { AdAsset } from '@/database/models/AdAsset'
import { AdProject } from '@/database/models/AdProject'
import { AdRenderJob, type AdRenderOutput } from '@/database/models/AdRenderJob'
import {
  AdProjectConfigSchema,
  type CreateAdProjectInput,
  type UpdateAdProjectInput,
} from '@/dtos/adProject'
import { ConflictError, NotFoundError, UnprocessableError } from '@/middleware/Error/AppError'
import { AdMediaService, serializeAdAsset } from '@/services/AdMediaService'
import { cancelAdRender, enqueueAdRender } from '@/services/AdRenderQueue'

function serializeOutput(projectId: number, jobId: number, output: AdRenderOutput) {
  return {
    index: output.index,
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
    config: job.configSnapshot,
    outputs: job.outputs.map((output) => serializeOutput(job.projectId, job.id, output)),
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }
}

@injectable()
export class AdProjectService {
  constructor(@inject(AdMediaService) private media: AdMediaService) {}

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
          config: project.config,
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
      config: project.config,
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
    const sourceAssets = await AdAsset.findAll({ where: { projectId }, order: [['id', 'ASC']] })
    const clone = await AdProject.create({
      userId,
      name: `${source.name} (cópia)`.slice(0, 120),
      config: { ...source.config, selectedClipIds: [], musicAssetId: null },
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
          ...source.config,
          selectedClipIds: source.config.selectedClipIds
            .map((id) => assetMap.get(id))
            .filter((id): id is number => Boolean(id)),
          clipEdits: Object.fromEntries(
            Object.entries(source.config.clipEdits ?? {}).flatMap(([id, edit]) => {
              const copiedId = assetMap.get(Number(id))
              return copiedId ? [[String(copiedId), edit]] : []
            }),
          ),
          hook: source.config.hook
            ? {
                ...source.config.hook,
                clipAssetId: source.config.hook.clipAssetId
                  ? (assetMap.get(source.config.hook.clipAssetId) ?? null)
                  : null,
              }
            : { enabled: false, clipAssetId: null, durationSeconds: 2, text: '' },
          musicTracks: (source.config.musicTracks ?? []).flatMap((track) => {
            const copiedId = assetMap.get(track.assetId)
            return copiedId ? [{ ...track, assetId: copiedId }] : []
          }),
          musicAssetId: source.config.musicAssetId
            ? (assetMap.get(source.config.musicAssetId) ?? null)
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
    kind: 'clip' | 'music',
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
    const ids = [...config.selectedClipIds, ...musicIds]
    if (!ids.length) return
    const assets = await AdAsset.findAll({ where: { projectId, id: { [Op.in]: ids } } })
    const clips = new Set(assets.filter((item) => item.kind === 'clip').map((item) => item.id))
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
    for (const clip of assets.filter((item) => item.kind === 'clip')) {
      const edit = clipEdits[String(clip.id)]
      if (!edit) continue
      const clipEnd = edit.trimEnd ?? clip.durationSeconds
      if (
        edit.trimStart >= clip.durationSeconds - 0.05 ||
        clipEnd > clip.durationSeconds + 0.05 ||
        clipEnd - edit.trimStart < 0.25
      ) {
        throw UnprocessableError(
          `O recorte do clipe ${clip.originalName} deve ter ao menos 0,25 s e caber na duração original`,
        )
      }
    }
  }

  async createJob(userId: number, projectId: number, configOverride?: unknown) {
    const project = await this.project(userId, projectId)
    const config =
      configOverride === undefined ? project.config : AdProjectConfigSchema.parse(configOverride)
    await this.validateAssetSelection(projectId, config)
    if (!config.selectedClipIds.length) {
      throw UnprocessableError('Selecione pelo menos um clipe para renderizar')
    }
    const clipCount = await AdAsset.count({
      where: {
        projectId,
        kind: 'clip',
        id: { [Op.in]: config.selectedClipIds },
      },
    })
    if (!clipCount) throw UnprocessableError('Adicione e selecione pelo menos um clipe')
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
    if (!output) throw NotFoundError('Vídeo renderizado não encontrado')
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

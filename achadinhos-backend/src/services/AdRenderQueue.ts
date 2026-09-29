import { randomUUID } from 'node:crypto'
import { Op } from 'sequelize'
import { container } from 'tsyringe'
import { env } from '@/config/env'
import { AdAsset } from '@/database/models/AdAsset'
import { AdRenderJob } from '@/database/models/AdRenderJob'
import { AdMediaService, type StagedAdAssets } from '@/services/AdMediaService'
import { AdVideoRenderer } from '@/services/AdVideoRenderer'
import { logger } from '@/utils/logger'

const pending: number[] = []
const pendingSet = new Set<number>()
const controllers = new Map<number, AbortController>()
const activeTasks = new Map<number, Promise<void>>()
let running = 0
let started = false
let stopping = false
const workerId = randomUUID()
let heartbeatTimer: NodeJS.Timeout | null = null

function enqueueInternal(jobId: number): void {
  if (pendingSet.has(jobId) || controllers.has(jobId)) return
  pending.push(jobId)
  pendingSet.add(jobId)
}

async function processJob(jobId: number): Promise<void> {
  let job: AdRenderJob | null = null
  try {
    job = await AdRenderJob.findOne({ where: { id: jobId, status: 'queued' } })
    if (!job) return
    const [claimed] = await AdRenderJob.update(
      {
        status: 'running',
        startedAt: new Date(),
        finishedAt: null,
        error: null,
        progress: 0,
        workerId,
        heartbeatAt: new Date(),
      },
      { where: { id: jobId, status: 'queued' } },
    )
    if (!claimed) return
    await job.reload()
  } catch (error) {
    logger.error({ err: error, jobId }, 'Unable to claim ad render')
    return
  }

  const controller = new AbortController()
  controllers.set(jobId, controller)
  const media = container.resolve(AdMediaService)
  let stage: StagedAdAssets | null = null
  let persistedOutputs: AdRenderJob['outputs'] = []
  try {
    const assets = await AdAsset.findAll({
      where: { projectId: job.projectId },
      order: [['id', 'ASC']],
    })
    const clips = assets.filter(
      (asset) => asset.kind === 'clip' && job.configSnapshot.selectedClipIds.includes(asset.id),
    )
    const musicIds = job.configSnapshot.musicTracks?.length
      ? job.configSnapshot.musicTracks.map((track) => track.assetId)
      : job.configSnapshot.musicAssetId ? [job.configSnapshot.musicAssetId] : []
    const musicIdSet = new Set(musicIds)
    const music = assets.filter(
      (asset) => asset.kind === 'music' && musicIdSet.has(asset.id),
    )
    if (!clips.length) throw new Error('Nenhum clipe selecionado está disponível')
    if (music.length !== musicIdSet.size)
      throw new Error('Uma ou mais músicas selecionadas não estão disponíveis')

    // A queued job has no committed outputs. Clear files left by a crashed
    // attempt, then materialize private bucket objects into this attempt only.
    await media.removeRenderJobStorage(job.projectId, job.id)
    stage = await media.stageAssets(
      job.id,
      [...clips, ...music],
      controller.signal,
    )
    const stagedById = new Map(stage.assets.map((asset) => [asset.id, asset]))
    const stagedClips = clips.map((asset) => stagedById.get(asset.id)!).filter(Boolean)
    const stagedMusic = music.map((asset) => stagedById.get(asset.id)!).filter(Boolean)

    const renderer = container.resolve(AdVideoRenderer)
    const localOutputs = await renderer.render(
      job,
      stagedClips,
      stagedMusic,
      async (progress) => {
        await AdRenderJob.update(
          { progress, heartbeatAt: new Date() },
          { where: { id: jobId, status: 'running', workerId } },
        )
      },
      controller.signal,
    )
    persistedOutputs = await media.persistRenderOutputs(
      job.projectId,
      job.id,
      localOutputs,
      controller.signal,
    )
    const [completed] = await AdRenderJob.update(
      { status: 'completed', progress: 100, outputs: persistedOutputs, finishedAt: new Date() },
      { where: { id: jobId, status: 'running', workerId } },
    )
    if (!completed) {
      await media.removeOutputs(persistedOutputs)
      persistedOutputs = []
    }
  } catch (error) {
    if (persistedOutputs.length) {
      await media.removeOutputs(persistedOutputs)
      persistedOutputs = []
    }
    const current = await AdRenderJob.findByPk(jobId)
    if (!stopping && current?.status === 'running' && current.workerId === workerId) {
      const rawMessage = error instanceof Error ? error.message : ''
      const message =
        rawMessage.includes('Nenhum clipe') || rawMessage.includes('música selecionada')
          ? rawMessage
          : 'Não foi possível renderizar os vídeos. Verifique as mídias e tente novamente.'
      await AdRenderJob.update(
        { status: 'failed', error: message, finishedAt: new Date() },
        { where: { id: jobId, status: 'running', workerId } },
      )
      logger.error({ err: error, jobId }, 'Ad render failed')
    }
  } finally {
    if (stage) await media.cleanupStage(stage).catch(() => undefined)
    controllers.delete(jobId)
  }
}

function drain(): void {
  if (stopping) return
  while (running < env.AD_RENDER_CONCURRENCY && pending.length) {
    const jobId = pending.shift()!
    pendingSet.delete(jobId)
    running += 1
    const task = processJob(jobId)
      .catch((error) => logger.error({ err: error, jobId }, 'Unhandled ad render worker error'))
      .finally(() => {
        running -= 1
        activeTasks.delete(jobId)
        drain()
      })
    activeTasks.set(jobId, task)
  }
}

export function enqueueAdRender(jobId: number): void {
  enqueueInternal(jobId)
  drain()
}

export async function startAdRenderQueue(): Promise<void> {
  if (started) return
  started = true
  stopping = false
  await AdRenderJob.update(
    {
      status: 'queued',
      startedAt: null,
      progress: 0,
      error: 'Renderização retomada após interrupção',
      workerId: null,
      heartbeatAt: null,
    },
    {
      where: {
        status: 'running',
        [Op.or]: [
          { heartbeatAt: null },
          { heartbeatAt: { [Op.lt]: new Date(Date.now() - 120_000) } },
        ],
      },
    },
  )
  const jobs = await AdRenderJob.findAll({
    where: { status: 'queued' },
    order: [['createdAt', 'ASC']],
  })
  for (const job of jobs) enqueueInternal(job.id)
  heartbeatTimer = setInterval(() => {
    void (async () => {
      await AdRenderJob.update(
        { heartbeatAt: new Date() },
        { where: { status: 'running', workerId } },
      )
      await AdRenderJob.update(
        {
          status: 'queued',
          startedAt: null,
          progress: 0,
          error: 'Renderização retomada após interrupção',
          workerId: null,
          heartbeatAt: null,
        },
        {
          where: {
            status: 'running',
            [Op.or]: [
              { heartbeatAt: null },
              { heartbeatAt: { [Op.lt]: new Date(Date.now() - 120_000) } },
            ],
          },
        },
      )
      const live = await AdRenderJob.findAll({
        attributes: ['id'],
        where: { status: 'running', workerId },
      })
      const liveIds = new Set(live.map((job) => job.id))
      for (const [jobId, controller] of controllers) {
        if (!liveIds.has(jobId)) controller.abort(new Error('Renderização cancelada ou reassumida'))
      }
      const queued = await AdRenderJob.findAll({
        attributes: ['id'],
        where: { status: 'queued' },
        order: [['createdAt', 'ASC']],
      })
      for (const job of queued) enqueueInternal(job.id)
      drain()
    })().catch((error) => logger.error({ err: error }, 'Ad render heartbeat failed'))
  }, 15_000)
  heartbeatTimer.unref()
  drain()
}

export async function cancelAdRender(job: AdRenderJob): Promise<void> {
  const [cancelled] = await AdRenderJob.update(
    { status: 'cancelled', finishedAt: new Date(), error: null },
    { where: { id: job.id, status: { [Op.in]: ['queued', 'running'] } } },
  )
  if (!cancelled) {
    const current = await AdRenderJob.findByPk(job.id, { attributes: ['status'] })
    if (current?.status !== 'cancelled') return
  }
  const queuedIndex = pending.indexOf(job.id)
  if (queuedIndex >= 0) pending.splice(queuedIndex, 1)
  pendingSet.delete(job.id)
  controllers.get(job.id)?.abort(new Error('Renderização cancelada'))
  const media = container.resolve(AdMediaService)
  await media.removeOutputs(job.outputs)
  await media.removeRenderJobStorage(job.projectId, job.id)
}

export async function stopAdRenderQueue(): Promise<void> {
  stopping = true
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatTimer = null
  for (const controller of controllers.values()) controller.abort(new Error('Servidor encerrando'))
  await Promise.allSettled(activeTasks.values())
  await AdRenderJob.update(
    {
      status: 'queued',
      startedAt: null,
      progress: 0,
      error: 'Renderização aguardando reinício',
      workerId: null,
      heartbeatAt: null,
    },
    { where: { status: { [Op.eq]: 'running' }, workerId } },
  )
  started = false
}

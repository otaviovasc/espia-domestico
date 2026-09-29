import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { injectable } from 'tsyringe'
import type { Express } from 'express'
import { env } from '@/config/env'
import { AdAsset } from '@/database/models/AdAsset'
import type { AdRenderOutput } from '@/database/models/AdRenderJob'
import type { AdAssetKind } from '@/dtos/adProject'
import { BadRequestError, UnprocessableError } from '@/middleware/Error/AppError'
import { adObjectStorage, type StoredMediaContent } from '@/services/AdObjectStorage'

interface ProbeResult {
  format?: { duration?: string }
  streams?: Array<{ codec_type?: string; width?: number; height?: number }>
}

const EXTENSIONS: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-m4v': '.m4v',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/m4a': '.m4a',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/flac': '.flac',
}

export const adMediaRoot = path.resolve(env.AD_MEDIA_DIR)
export const adUploadTempDir = path.join(adMediaRoot, '.uploads')
const adStageRoot = path.join(adMediaRoot, '.stage')

export interface StagedAdAssets {
  directory: string
  assets: AdAsset[]
}

export async function ensureAdMediaDirectories(): Promise<void> {
  // Uploads, staged bucket objects and FFmpeg work files are disposable. A
  // clean startup makes interrupted attempts converge before jobs are requeued.
  await Promise.all([
    rm(adUploadTempDir, { recursive: true, force: true }),
    rm(adStageRoot, { recursive: true, force: true }),
    rm(path.join(adMediaRoot, '.work'), { recursive: true, force: true }),
  ])
  await Promise.all([
    mkdir(adUploadTempDir, { recursive: true }),
    mkdir(adStageRoot, { recursive: true }),
    mkdir(path.join(adMediaRoot, 'projects'), { recursive: true }),
  ])
}

export async function runProcess(
  command: string,
  args: string[],
  options: { signal?: AbortSignal; captureStdout?: boolean } = {},
): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', options.captureStdout ? 'pipe' : 'ignore', 'pipe'],
      signal: options.signal,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.reduce((sum, item) => sum + item.length, 0) < 64_000) stderr.push(chunk)
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) return resolve(Buffer.concat(stdout))
      reject(new Error(`${command} exited with code ${code}: ${Buffer.concat(stderr).toString()}`))
    })
  })
}

export async function probeMedia(filePath: string): Promise<ProbeResult> {
  const output = await runProcess(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type,width,height',
      '-of',
      'json',
      filePath,
    ],
    { captureStdout: true, signal: AbortSignal.timeout(15_000) },
  )
  return JSON.parse(output.toString()) as ProbeResult
}

async function hasRecognizedSignature(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(16)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead < 4) return false
    const ascii = buffer.toString('ascii')
    return (
      ascii.slice(4, 8) === 'ftyp' ||
      ascii.startsWith('RIFF') ||
      ascii.startsWith('OggS') ||
      ascii.startsWith('fLaC') ||
      ascii.startsWith('ID3') ||
      (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) ||
      (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
    )
  } finally {
    await handle.close()
  }
}

export function serializeAdAsset(asset: AdAsset) {
  return {
    id: asset.id,
    kind: asset.kind,
    originalName: asset.originalName,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    durationSeconds: asset.durationSeconds,
    width: asset.width,
    height: asset.height,
    contentUrl: `${env.API_PREFIX}/ad-projects/${asset.projectId}/assets/${asset.id}/content`,
    createdAt: asset.createdAt,
  }
}

@injectable()
export class AdMediaService {
  async store(projectId: number, kind: AdAssetKind, file: Express.Multer.File): Promise<AdAsset> {
    const mimeAllowed =
      kind === 'clip'
        ? file.mimetype.startsWith('video/')
        : file.mimetype.startsWith('audio/') || file.mimetype === 'video/mp4'
    const maxBytes = (kind === 'clip' ? env.AD_MAX_CLIP_MB : env.AD_MAX_MUSIC_MB) * 1024 * 1024
    try {
      if (!mimeAllowed || !EXTENSIONS[file.mimetype]) {
        throw BadRequestError(
          kind === 'clip' ? 'Formato de vídeo não suportado' : 'Formato de áudio não suportado',
        )
      }
      if (file.size < 1 || file.size > maxBytes)
        throw BadRequestError('Arquivo excede o limite permitido')
      if (!(await hasRecognizedSignature(file.path)))
        throw BadRequestError('Assinatura do arquivo inválida')

      let probe: ProbeResult
      try {
        probe = await probeMedia(file.path)
      } catch {
        throw UnprocessableError('Não foi possível ler o arquivo de mídia')
      }
      const requiredStream = kind === 'clip' ? 'video' : 'audio'
      const stream = probe.streams?.find((item) => item.codec_type === requiredStream)
      const durationSeconds = Number(probe.format?.duration)
      if (!stream || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        throw UnprocessableError(
          `O arquivo não contém ${kind === 'clip' ? 'vídeo' : 'áudio'} válido`,
        )
      }
      if (kind === 'clip' && durationSeconds > 120)
        throw BadRequestError('Cada clipe pode ter até 2 minutos')
      if (kind === 'music' && durationSeconds > 600)
        throw BadRequestError('A música pode ter até 10 minutos')
      if (kind === 'clip' && (stream.width ?? 0) * (stream.height ?? 0) > 40_000_000) {
        throw BadRequestError('A resolução do clipe excede o limite permitido')
      }

      const storagePath = await adObjectStorage.putFile(
        `projects/${projectId}/assets/${randomUUID()}${EXTENSIONS[file.mimetype]}`,
        file.path,
        file.mimetype,
        { removeSource: true },
      )
      try {
        return await AdAsset.create({
          projectId,
          kind,
          originalName: path.basename(file.originalname).slice(0, 255),
          mimeType: file.mimetype,
          sizeBytes: file.size,
          storagePath,
          durationSeconds,
          width: stream.width ?? null,
          height: stream.height ?? null,
        })
      } catch (error) {
        await adObjectStorage.remove(storagePath).catch(() => undefined)
        throw error
      }
    } finally {
      await rm(file.path, { force: true }).catch(() => undefined)
    }
  }

  async remove(asset: AdAsset): Promise<void> {
    await adObjectStorage.remove(asset.storagePath)
    await asset.destroy()
  }

  async assertReadable(asset: AdAsset): Promise<void> {
    if (!(await adObjectStorage.head(asset.storagePath))) {
      throw UnprocessableError('Arquivo de mídia não está disponível no armazenamento')
    }
  }

  async content(storagePath: string, rangeHeader?: string): Promise<StoredMediaContent> {
    return await adObjectStorage.open(storagePath, rangeHeader)
  }

  async copyAssetStorage(asset: AdAsset, targetProjectId: number): Promise<string> {
    const extension = EXTENSIONS[asset.mimeType] ?? path.extname(asset.originalName).toLowerCase()
    return await adObjectStorage.copyToKey(
      asset.storagePath,
      `projects/${targetProjectId}/assets/${randomUUID()}${extension}`,
      asset.mimeType,
    )
  }

  async removeProjectStorage(projectId: number): Promise<void> {
    await adObjectStorage.removePrefix(`projects/${projectId}`)
  }

  async removeRenderJobStorage(projectId: number, jobId: number): Promise<void> {
    await adObjectStorage.removePrefix(`projects/${projectId}/renders/${jobId}`)
  }

  async stageAssets(
    jobId: number,
    assets: AdAsset[],
    signal?: AbortSignal,
  ): Promise<StagedAdAssets> {
    await mkdir(adStageRoot, { recursive: true })
    const directory = await mkdtemp(path.join(adStageRoot, `ad-render-${jobId}-`))
    const staged: AdAsset[] = []
    try {
      for (const asset of assets) {
        const extension =
          EXTENSIONS[asset.mimeType] ?? path.extname(asset.originalName).toLowerCase()
        const target = path.join(directory, `${asset.id}${extension}`)
        await adObjectStorage.materialize(asset.storagePath, target, signal)
        staged.push(
          AdAsset.build(
            { ...asset.get({ plain: true }), storagePath: target },
            { isNewRecord: false, raw: true },
          ),
        )
      }
      return { directory, assets: staged }
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  async cleanupStage(stage: StagedAdAssets): Promise<void> {
    await rm(stage.directory, { recursive: true, force: true })
  }

  async persistRenderOutputs(
    projectId: number,
    jobId: number,
    outputs: AdRenderOutput[],
    signal?: AbortSignal,
  ): Promise<AdRenderOutput[]> {
    const attemptId = randomUUID()
    const persisted: AdRenderOutput[] = []
    const sourceDirectories = new Set(outputs.map((output) => path.dirname(output.storagePath)))
    try {
      for (const output of outputs) {
        const storagePath = await adObjectStorage.putFile(
          `projects/${projectId}/renders/${jobId}/${attemptId}/${output.fileName}`,
          output.storagePath,
          'video/mp4',
          { removeSource: true, signal },
        )
        persisted.push({ ...output, storagePath })
      }
      return persisted
    } catch (error) {
      await Promise.allSettled(
        persisted.map((output) => adObjectStorage.remove(output.storagePath)),
      )
      throw error
    } finally {
      await Promise.allSettled(
        [...sourceDirectories].map((directory) => rm(directory, { recursive: true, force: true })),
      )
    }
  }

  async removeOutputs(outputs: AdRenderOutput[]): Promise<void> {
    await Promise.allSettled(outputs.map((output) => adObjectStorage.remove(output.storagePath)))
  }
}

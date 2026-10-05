import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, open, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { injectable } from 'tsyringe'
import type { Express } from 'express'
import type { Transaction } from 'sequelize'
import { env } from '@/config/env'
import { AdAsset } from '@/database/models/AdAsset'
import type { AdRenderOutput } from '@/database/models/AdRenderJob'
import type { AdAssetKind } from '@/dtos/adProject'
import { BadRequestError, UnprocessableError } from '@/middleware/Error/AppError'
import { adObjectStorage, type StoredMediaContent } from '@/services/AdObjectStorage'

interface ProbeResult {
  format?: { duration?: string }
  streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
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
      'format=duration:stream=codec_type,codec_name,width,height',
      '-of',
      'json',
      filePath,
    ],
    { captureStdout: true, signal: AbortSignal.timeout(15_000) },
  )
  return JSON.parse(output.toString()) as ProbeResult
}

async function hasRecognizedSignature(filePath: string, imageMime?: string): Promise<boolean> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(16)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead < 4) return false
    const ascii = buffer.toString('ascii')
    if (imageMime === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    if (imageMime === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    if (imageMime === 'image/webp') return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP'
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

export async function hasTransportStreamSignature(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(377)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return bytesRead === buffer.length && [0, 188, 376].every(offset => buffer[offset] === 0x47)
  } finally { await handle.close() }
}

/** Browser previews need MP4; Mercado Livre's full reviews are MPEG-TS. */
export async function convertTransportStream(filePath: string, probe: ProbeResult): Promise<string> {
  const output = `${filePath}-${randomUUID()}.mp4`
  const video = probe.streams?.find(stream => stream.codec_type === 'video')
  const audio = probe.streams?.filter(stream => stream.codec_type === 'audio') ?? []
  const copy = video?.codec_name === 'h264' && audio.every(stream => stream.codec_name === 'aac')
  try {
    await runProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', filePath,
      '-map', '0:v:0', '-map', '0:a:0?', ...(copy ? ['-c', 'copy'] : ['-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-c:a', 'aac']),
      '-movflags', '+faststart', output], { signal: AbortSignal.timeout(120_000) })
    return output
  } catch {
    await rm(output, { force: true }).catch(() => undefined)
    throw UnprocessableError('Não foi possível converter o vídeo TS para MP4')
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
  async store(
    projectId: number,
    kind: AdAssetKind,
    file: Pick<Express.Multer.File, 'path' | 'originalname' | 'mimetype' | 'size'>,
    options: { transaction?: Transaction } = {},
  ): Promise<AdAsset> {
    const transportStream = kind === 'clip' && (file.mimetype.toLowerCase() === 'video/mp2t' || path.extname(file.originalname).toLowerCase() === '.ts')
    let convertedPath: string | undefined
    const mimeAllowed =
      kind === 'image' ? file.mimetype.startsWith('image/') : kind === 'clip'
        ? file.mimetype.startsWith('video/')
        : file.mimetype.startsWith('audio/') || file.mimetype === 'video/mp4'
    const maxBytes = (kind === 'image' ? 20 : kind === 'clip' ? env.AD_MAX_CLIP_MB : env.AD_MAX_MUSIC_MB) * 1024 * 1024
    try {
      if (!transportStream && (!mimeAllowed || !EXTENSIONS[file.mimetype])) {
        throw BadRequestError(
          kind === 'image' ? 'Envie uma imagem JPG, PNG ou WebP' : kind === 'clip' ? 'Formato de vídeo não suportado' : 'Formato de áudio não suportado',
        )
      }
      if (file.size < 1 || file.size > maxBytes)
        throw BadRequestError('Arquivo excede o limite permitido')
      if (!(transportStream ? await hasTransportStreamSignature(file.path) : await hasRecognizedSignature(file.path, kind === 'image' ? file.mimetype : undefined)))
        throw BadRequestError('Assinatura do arquivo inválida')

      let probe: ProbeResult
      try {
        probe = await probeMedia(file.path)
      } catch {
        throw UnprocessableError('Não foi possível ler o arquivo de mídia')
      }
      const requiredStream = kind === 'music' ? 'audio' : 'video'
      const stream = probe.streams?.find((item) => item.codec_type === requiredStream)
      const durationSeconds = kind === 'image' ? 0 : Number(probe.format?.duration)
      if (!stream || (kind !== 'image' && (!Number.isFinite(durationSeconds) || durationSeconds <= 0))) {
        throw UnprocessableError(
          `O arquivo não contém ${kind === 'clip' ? 'vídeo' : 'áudio'} válido`,
        )
      }
      if (kind === 'clip' && durationSeconds > 120)
        throw BadRequestError('Cada clipe pode ter até 2 minutos')
      if (kind === 'music' && durationSeconds > 600)
        throw BadRequestError('A música pode ter até 10 minutos')
      if (kind !== 'music' && (!(stream.width && stream.height) || stream.width * stream.height > 40_000_000)) {
        throw BadRequestError('A resolução da mídia é inválida ou excede 40 megapixels')
      }

      let storedFile = file.path, mimeType = file.mimetype, sizeBytes = file.size
      if (transportStream) {
        convertedPath = await convertTransportStream(file.path, probe)
        storedFile = convertedPath; mimeType = 'video/mp4'
        sizeBytes = (await stat(storedFile)).size
        if (sizeBytes > maxBytes) throw BadRequestError('Vídeo convertido excede o limite permitido')
      }
      const storagePath = await adObjectStorage.putFile(
        `projects/${projectId}/assets/${randomUUID()}${EXTENSIONS[mimeType]}`,
        storedFile,
        mimeType,
        { removeSource: true },
      )
      try {
        return await AdAsset.create(
          {
            projectId,
            kind,
            originalName: path.basename(file.originalname).slice(0, 255),
            mimeType,
            sizeBytes,
            storagePath,
            durationSeconds,
            width: stream.width ?? null,
            height: stream.height ?? null,
          },
          options,
        )
      } catch (error) {
        await adObjectStorage.remove(storagePath).catch(() => undefined)
        throw error
      }
    } finally {
      await rm(file.path, { force: true }).catch(() => undefined)
      if (convertedPath) await rm(convertedPath, { force: true }).catch(() => undefined)
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
          output.mimeType ?? 'video/mp4',
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

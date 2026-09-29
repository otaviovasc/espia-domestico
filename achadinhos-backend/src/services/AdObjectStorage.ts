import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { env } from '@/config/env'
import { AppError, UnprocessableError } from '@/middleware/Error/AppError'

const S3_REFERENCE_PREFIX = 's3://'

interface ByteRange {
  start: number
  end: number
}

export interface StoredMediaContent {
  body: Readable
  contentLength: number
  totalSize: number
  range: ByteRange | null
  etag?: string
  lastModified?: Date
}

interface StoredObjectInfo {
  size: number
  etag?: string
  lastModified?: Date
}

function normalizeKey(input: string): string {
  const key = path.posix.normalize(input.replace(/^\/+/, ''))
  if (!key || key === '.' || key === '..' || key.startsWith('../')) {
    throw new Error('Invalid object storage key')
  }
  return key
}

function parseRange(header: string | undefined, size: number): ByteRange | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (!match[1] && !match[2])) {
    throw new AppError('Intervalo de bytes inválido', 416, 'RANGE_NOT_SATISFIABLE', undefined, {
      'Content-Range': `bytes */${size}`,
      'Accept-Ranges': 'bytes',
    })
  }

  let start: number
  let end: number
  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new AppError('Intervalo de bytes inválido', 416, 'RANGE_NOT_SATISFIABLE', undefined, {
        'Content-Range': `bytes */${size}`,
        'Accept-Ranges': 'bytes',
      })
    }
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    throw new AppError('Intervalo de bytes inválido', 416, 'RANGE_NOT_SATISFIABLE', undefined, {
      'Content-Range': `bytes */${size}`,
      'Accept-Ranges': 'bytes',
    })
  }
  return { start, end: Math.min(end, size - 1) }
}

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return (
    candidate.name === 'NotFound' ||
    candidate.name === 'NoSuchKey' ||
    candidate.$metadata?.httpStatusCode === 404
  )
}

export class AdObjectStorage {
  readonly driver = env.AD_STORAGE_DRIVER
  private readonly root = path.resolve(env.AD_MEDIA_DIR)
  private readonly bucket = env.AD_S3_BUCKET ?? env.BUCKET
  private readonly s3: S3Client | null

  constructor() {
    if (this.driver === 'local') {
      this.s3 = null
      return
    }
    this.s3 = new S3Client({
      endpoint: env.AD_S3_ENDPOINT ?? env.ENDPOINT,
      region: env.AD_S3_REGION ?? env.REGION,
      forcePathStyle: env.AD_S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: (env.AD_S3_ACCESS_KEY_ID ?? env.ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID)!,
        secretAccessKey: (env.AD_S3_SECRET_ACCESS_KEY ??
          env.SECRET_ACCESS_KEY ??
          env.AWS_SECRET_ACCESS_KEY)!,
      },
    })
  }

  private client(): S3Client {
    if (!this.s3 || !this.bucket) throw new Error('S3 storage is not configured')
    return this.s3
  }

  private localPath(referenceOrKey: string): string {
    if (referenceOrKey.startsWith(S3_REFERENCE_PREFIX)) {
      throw new Error('S3 object cannot be read without S3 storage configuration')
    }
    const target = path.resolve(this.root, referenceOrKey)
    if (target !== this.root && !target.startsWith(`${this.root}${path.sep}`)) {
      throw new Error('Local media path is outside AD_MEDIA_DIR')
    }
    return target
  }

  private objectKey(reference: string): string {
    if (!reference.startsWith(S3_REFERENCE_PREFIX))
      throw new Error('Expected an S3 object reference')
    return normalizeKey(reference.slice(S3_REFERENCE_PREFIX.length))
  }

  private referenceForKey(key: string): string {
    const normalized = normalizeKey(key)
    return this.driver === 's3' ? `${S3_REFERENCE_PREFIX}${normalized}` : this.localPath(normalized)
  }

  async putFile(
    key: string,
    sourcePath: string,
    contentType: string,
    options: { removeSource?: boolean; signal?: AbortSignal } = {},
  ): Promise<string> {
    const normalized = normalizeKey(key)
    if (options.signal?.aborted) throw options.signal.reason
    if (this.driver === 's3') {
      const file = await stat(sourcePath)
      await this.client().send(
        new PutObjectCommand({
          Bucket: this.bucket!,
          Key: normalized,
          Body: createReadStream(sourcePath),
          ContentLength: file.size,
          ContentType: contentType,
          CacheControl: 'private, max-age=3600',
        }),
        { abortSignal: options.signal },
      )
      if (options.removeSource) await rm(sourcePath, { force: true })
      return this.referenceForKey(normalized)
    }

    const target = this.localPath(normalized)
    if (path.resolve(sourcePath) === target) return target
    await mkdir(path.dirname(target), { recursive: true })
    if (options.removeSource) {
      try {
        await rename(sourcePath, target)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
        const temporary = `${target}.part-${randomUUID()}`
        try {
          await copyFile(sourcePath, temporary)
          await rename(temporary, target)
          await rm(sourcePath, { force: true })
        } finally {
          await rm(temporary, { force: true }).catch(() => undefined)
        }
      }
    } else {
      const temporary = `${target}.part-${randomUUID()}`
      try {
        await copyFile(sourcePath, temporary)
        await rename(temporary, target)
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined)
      }
    }
    return target
  }

  async copyToKey(reference: string, key: string, contentType: string): Promise<string> {
    const normalized = normalizeKey(key)
    if (this.driver === 's3' && reference.startsWith(S3_REFERENCE_PREFIX)) {
      await this.client().send(
        new CopyObjectCommand({
          Bucket: this.bucket!,
          Key: normalized,
          CopySource: `${this.bucket}/${this.objectKey(reference)}`,
          ContentType: contentType,
          MetadataDirective: 'REPLACE',
          CacheControl: 'private, max-age=3600',
        }),
      )
      return this.referenceForKey(normalized)
    }
    if (reference.startsWith(S3_REFERENCE_PREFIX)) {
      throw new Error('Cannot copy an S3 object while AD_STORAGE_DRIVER=local')
    }
    return await this.putFile(normalized, this.localPath(reference), contentType)
  }

  async remove(reference: string): Promise<void> {
    if (reference.startsWith(S3_REFERENCE_PREFIX)) {
      await this.client().send(
        new DeleteObjectCommand({ Bucket: this.bucket!, Key: this.objectKey(reference) }),
      )
      return
    }
    await rm(this.localPath(reference), { force: true })
  }

  async removePrefix(prefix: string): Promise<void> {
    const normalized = `${normalizeKey(prefix).replace(/\/+$/, '')}/`
    if (this.driver === 'local') {
      await rm(this.localPath(normalized), { recursive: true, force: true })
      return
    }
    let continuationToken: string | undefined
    do {
      const page = await this.client().send(
        new ListObjectsV2Command({
          Bucket: this.bucket!,
          Prefix: normalized,
          ContinuationToken: continuationToken,
        }),
      )
      const objects = (page.Contents ?? []).flatMap((item) => (item.Key ? [{ Key: item.Key }] : []))
      if (objects.length) {
        await this.client().send(
          new DeleteObjectsCommand({
            Bucket: this.bucket!,
            Delete: { Objects: objects, Quiet: true },
          }),
        )
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (continuationToken)
  }

  async head(reference: string): Promise<StoredObjectInfo | null> {
    if (reference.startsWith(S3_REFERENCE_PREFIX)) {
      try {
        const result = await this.client().send(
          new HeadObjectCommand({ Bucket: this.bucket!, Key: this.objectKey(reference) }),
        )
        if (result.ContentLength === undefined) return null
        return { size: result.ContentLength, etag: result.ETag, lastModified: result.LastModified }
      } catch (error) {
        if (isMissingObject(error)) return null
        throw error
      }
    }
    const file = await stat(this.localPath(reference)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    return file?.isFile() ? { size: file.size, lastModified: file.mtime } : null
  }

  async materialize(reference: string, targetPath: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason
    await mkdir(path.dirname(targetPath), { recursive: true })
    const temporary = `${targetPath}.part-${randomUUID()}`
    try {
      if (reference.startsWith(S3_REFERENCE_PREFIX)) {
        const response = await this.client().send(
          new GetObjectCommand({ Bucket: this.bucket!, Key: this.objectKey(reference) }),
          { abortSignal: signal },
        )
        if (!(response.Body instanceof Readable))
          throw new Error('Object storage returned an unreadable response')
        await pipeline(response.Body, createWriteStream(temporary, { flags: 'wx' }), { signal })
      } else {
        await copyFile(this.localPath(reference), temporary)
        if (signal?.aborted) throw signal.reason
      }
      await rename(temporary, targetPath)
    } catch (error) {
      if (isMissingObject(error))
        throw UnprocessableError('Arquivo de mídia não está disponível no armazenamento')
      throw error
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }

  async open(reference: string, rangeHeader?: string): Promise<StoredMediaContent> {
    const info = await this.head(reference)
    if (!info) throw UnprocessableError('Arquivo de mídia não está disponível no armazenamento')
    const range = parseRange(rangeHeader, info.size)
    if (reference.startsWith(S3_REFERENCE_PREFIX)) {
      try {
        const response = await this.client().send(
          new GetObjectCommand({
            Bucket: this.bucket!,
            Key: this.objectKey(reference),
            Range: range ? `bytes=${range.start}-${range.end}` : undefined,
          }),
        )
        if (!(response.Body instanceof Readable))
          throw new Error('Object storage returned an unreadable response')
        return {
          body: response.Body,
          contentLength:
            response.ContentLength ?? (range ? range.end - range.start + 1 : info.size),
          totalSize: info.size,
          range,
          etag: response.ETag ?? info.etag,
          lastModified: response.LastModified ?? info.lastModified,
        }
      } catch (error) {
        if (isMissingObject(error))
          throw UnprocessableError('Arquivo de mídia não está disponível no armazenamento')
        throw error
      }
    }
    return {
      body: createReadStream(this.localPath(reference), range ?? undefined),
      contentLength: range ? range.end - range.start + 1 : info.size,
      totalSize: info.size,
      range,
      etag: info.etag,
      lastModified: info.lastModified,
    }
  }
}

export const adObjectStorage = new AdObjectStorage()

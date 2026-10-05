import type { LookupAddress } from 'node:dns'
import { lookup as dnsLookup } from 'node:dns/promises'
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises'
import type { IncomingHttpHeaders } from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import path from 'node:path'
import { env } from '@/config/env'
import {
  BadRequestError,
  TooManyRequestsError,
  UnprocessableError,
} from '@/middleware/Error/AppError'
import { adUploadTempDir } from '@/services/AdMediaService'

const MAX_REDIRECTS = 4
const DOWNLOAD_TIMEOUT_MS = 90_000
const IMPORT_CONCURRENCY = 4
const IMPORT_QUEUE_LIMIT = 16
const USER_IMPORT_CONCURRENCY = 2
const USER_IMPORT_QUEUE_LIMIT = 4
const QUEUE_TIMEOUT_MS = 15_000

const AUDIO_EXTENSIONS: Readonly<Record<string, string>> = {
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/m4a': '.m4a',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/flac': '.flac',
}

export interface ImportedMusic {
  path: string
  directory: string
  originalname: string
  mimetype: string
  size: number
}

interface RemoteResponse {
  statusCode: number
  headers: IncomingHttpHeaders
  body: AsyncIterable<Buffer | string>
  discard(): void
}

export interface MusicImportDependencies {
  resolveHost(hostname: string): Promise<LookupAddress[]>
  request(url: URL, target: LookupAddress, signal: AbortSignal): Promise<RemoteResponse>
}

interface QueueWaiter {
  resolve: () => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

let activeImports = 0
const importQueue: QueueWaiter[] = []
const activeUserImports = new Map<number, number>()
const userImportQueues = new Map<number, QueueWaiter[]>()

function ipv4Number(address: string): number | null {
  if (isIP(address) !== 4) return null
  return address
    .split('.')
    .map(Number)
    .reduce((value, octet) => value * 256 + octet, 0)
}

function ipv4InCidr(address: number, base: number, prefix: number): boolean {
  const divisor = 2 ** (32 - prefix)
  return Math.floor(address / divisor) === Math.floor(base / divisor)
}

function isPublicIpv4(address: string): boolean {
  const value = ipv4Number(address)
  if (value === null) return false
  const blocked: Array<[string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ]
  return !blocked.some(([base, prefix]) => ipv4InCidr(value, ipv4Number(base)!, prefix))
}

function parseIpv6(address: string): number[] | null {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized.includes('%') || isIP(normalized) !== 6) return null
  const ipv4Match = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)
  let expanded = normalized
  if (ipv4Match) {
    const value = ipv4Number(ipv4Match[1])
    if (value === null) return null
    expanded = `${normalized.slice(0, -ipv4Match[1].length)}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`
  }
  const halves = expanded.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null
  const parts = [...left, ...Array(missing).fill('0'), ...right].map((part) =>
    Number.parseInt(part, 16),
  )
  return parts.length === 8 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 0xffff)
    ? parts
    : null
}

function isPublicIpv6(address: string): boolean {
  const parts = parseIpv6(address)
  if (!parts) return false
  const [first, second] = parts
  if (parts.every((part) => part === 0)) return false
  if (parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1) return false
  if (parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff) {
    return isPublicIpv4(`${parts[6] >>> 8}.${parts[6] & 255}.${parts[7] >>> 8}.${parts[7] & 255}`)
  }
  if ((first & 0xfe00) === 0xfc00) return false
  if ((first & 0xffc0) === 0xfe80) return false
  if ((first & 0xff00) === 0xff00) return false
  if (first === 0x100 && parts.slice(1, 4).every((part) => part === 0)) return false
  if (first === 0x64 && second === 0xff9b && parts.slice(2, 6).every((part) => part === 0)) return false
  if (first === 0x2001 && second === 0) return false
  if (first === 0x2001 && second === 0xdb8) return false
  if (first === 0x2001 && (second & 0xfff0) === 0x10) return false
  if (first === 0x2002) return false
  return (first & 0xe000) === 0x2000
}

export function isPublicNetworkAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, '')
  const family = isIP(normalized)
  if (family === 4) return isPublicIpv4(normalized)
  if (family === 6) return isPublicIpv6(normalized)
  return false
}

export function normalizeDirectAudioUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw BadRequestError('Cole um link HTTPS válido para um arquivo de áudio')
  }
  if (url.protocol !== 'https:') throw BadRequestError('O link do áudio deve usar HTTPS')
  if (url.username || url.password) throw BadRequestError('O link do áudio não pode conter credenciais')
  if (url.port && url.port !== '443') throw BadRequestError('O link do áudio deve usar a porta HTTPS padrão')
  if (!url.hostname || url.hostname.length > 253) throw BadRequestError('O endereço do áudio é inválido')
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    hostname === 'youtube.com' ||
    hostname.endsWith('.youtube.com') ||
    hostname === 'youtu.be' ||
    hostname.endsWith('.youtu.be') ||
    hostname === 'spotify.com' ||
    hostname.endsWith('.spotify.com')
  ) {
    throw BadRequestError(
      'Links do YouTube e Spotify não são arquivos de áudio diretos. Use um link HTTPS direto para um arquivo licenciado.',
    )
  }
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home.arpa')
  ) {
    throw BadRequestError('O link do áudio deve apontar para um endereço público')
  }
  url.hash = ''
  return url
}

async function defaultResolver(hostname: string): Promise<LookupAddress[]> {
  if (isIP(hostname)) return [{ address: hostname, family: isIP(hostname) as 4 | 6 }]
  return await dnsLookup(hostname, { all: true, verbatim: true })
}

export async function resolvePublicTarget(
  url: URL,
  resolver: MusicImportDependencies['resolveHost'] = defaultResolver,
): Promise<LookupAddress[]> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  let addresses: LookupAddress[]
  try {
    addresses = await resolver(hostname)
  } catch {
    throw UnprocessableError('Não foi possível localizar o servidor do áudio')
  }
  if (!addresses.length || addresses.some((target) => !isPublicNetworkAddress(target.address))) {
    throw BadRequestError('O link do áudio deve apontar somente para endereços públicos')
  }
  return [...addresses].sort((left, right) => left.family - right.family)
}

function requestPinnedHttps(
  url: URL,
  target: LookupAddress,
  signal: AbortSignal,
): Promise<RemoteResponse> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: 'GET',
        signal,
        headers: {
          Accept: 'audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/flac;q=0.9',
          'Accept-Encoding': 'identity',
          'User-Agent': 'AchadinhosAudioImport/1.0',
        },
        lookup: (_hostname, options, callback) => {
          if (typeof options === 'object' && options.all) {
            const returnAll = callback as unknown as (
              error: NodeJS.ErrnoException | null,
              addresses: LookupAddress[],
            ) => void
            returnAll(null, [target])
            return
          }
          const returnOne = callback as unknown as (
            error: NodeJS.ErrnoException | null,
            address: string,
            family: number,
          ) => void
          returnOne(null, target.address, target.family)
        },
      },
      (response) => {
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: response,
          discard: () => response.resume(),
        })
      },
    )
    request.once('error', reject)
    request.end()
  })
}

const defaultDependencies: MusicImportDependencies = {
  resolveHost: defaultResolver,
  request: requestPinnedHttps,
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function fileNameFromResponse(url: URL, headers: IncomingHttpHeaders, extension: string): string {
  const disposition = firstHeader(headers['content-disposition']) ?? ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  const plain =
    disposition.match(/filename="([^"]+)"/i)?.[1] ?? disposition.match(/filename=([^;]+)/i)?.[1]
  let candidate = encoded ?? plain
  if (encoded) {
    try {
      candidate = decodeURIComponent(encoded)
    } catch {
      candidate = encoded
    }
  }
  if (!candidate) {
    try {
      candidate = path.basename(decodeURIComponent(url.pathname))
    } catch {
      candidate = path.basename(url.pathname)
    }
  }
  candidate = path
    .basename(candidate || 'Áudio importado')
    .split('')
    .map((character) => (character.charCodeAt(0) < 32 ? ' ' : character))
    .join('')
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const stem = candidate.toLowerCase().endsWith(extension)
    ? candidate.slice(0, -extension.length)
    : candidate.replace(/\.[a-z0-9]{1,8}$/i, '')
  return `${stem || 'Áudio importado'}${extension}`.slice(0, 255)
}

async function acquireImportSlot(): Promise<() => void> {
  if (activeImports < IMPORT_CONCURRENCY) {
    activeImports += 1
    return releaseImportSlot
  }
  if (importQueue.length >= IMPORT_QUEUE_LIMIT) {
    throw TooManyRequestsError(
      'Há muitas importações de áudio em andamento. Tente novamente em instantes.',
      15,
    )
  }
  await new Promise<void>((resolve, reject) => {
    const waiter: QueueWaiter = {
      resolve,
      reject,
      timeout: setTimeout(() => {
        const index = importQueue.indexOf(waiter)
        if (index >= 0) importQueue.splice(index, 1)
        reject(TooManyRequestsError('A importação de áudio demorou para iniciar. Tente novamente.', 10))
      }, QUEUE_TIMEOUT_MS),
    }
    importQueue.push(waiter)
  })
  return releaseImportSlot
}

function releaseImportSlot(): void {
  const next = importQueue.shift()
  if (next) {
    clearTimeout(next.timeout)
    next.resolve()
    return
  }
  activeImports = Math.max(0, activeImports - 1)
}

async function acquireUserImportSlot(userId: number): Promise<() => void> {
  const active = activeUserImports.get(userId) ?? 0
  if (active < USER_IMPORT_CONCURRENCY) {
    activeUserImports.set(userId, active + 1)
    return () => releaseUserImportSlot(userId)
  }
  const queue = userImportQueues.get(userId) ?? []
  if (queue.length >= USER_IMPORT_QUEUE_LIMIT) {
    throw TooManyRequestsError('Você já tem muitas importações de áudio em andamento.', 15)
  }
  userImportQueues.set(userId, queue)
  await new Promise<void>((resolve, reject) => {
    const waiter: QueueWaiter = {
      resolve,
      reject,
      timeout: setTimeout(() => {
        const currentQueue = userImportQueues.get(userId)
        const index = currentQueue?.indexOf(waiter) ?? -1
        if (index >= 0) currentQueue!.splice(index, 1)
        if (!currentQueue?.length) userImportQueues.delete(userId)
        reject(TooManyRequestsError('A importação de áudio demorou para iniciar. Tente novamente.', 10))
      }, QUEUE_TIMEOUT_MS),
    }
    queue.push(waiter)
  })
  return () => releaseUserImportSlot(userId)
}

function releaseUserImportSlot(userId: number): void {
  const queue = userImportQueues.get(userId)
  const next = queue?.shift()
  if (next) {
    if (!queue!.length) userImportQueues.delete(userId)
    clearTimeout(next.timeout)
    next.resolve()
    return
  }
  userImportQueues.delete(userId)
  const active = Math.max(0, (activeUserImports.get(userId) ?? 1) - 1)
  if (active) activeUserImports.set(userId, active)
  else activeUserImports.delete(userId)
}

async function openRemoteAudio(
  rawUrl: string,
  signal: AbortSignal,
  dependencies: MusicImportDependencies,
  extensions: Readonly<Record<string, string>> = AUDIO_EXTENSIONS,
): Promise<{ response: RemoteResponse; url: URL; mimeType: string; extension: string }> {
  let url = normalizeDirectAudioUrl(rawUrl)
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const [target] = await resolvePublicTarget(url, dependencies.resolveHost)
    let response: RemoteResponse
    try {
      response = await dependencies.request(url, target, signal)
    } catch {
      if (signal.aborted) throw UnprocessableError('O servidor do áudio demorou demais para responder')
      throw UnprocessableError('Não foi possível baixar o arquivo de áudio')
    }
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const location = firstHeader(response.headers.location)
      response.discard()
      if (!location) throw UnprocessableError('O servidor do áudio retornou um redirecionamento inválido')
      if (redirectCount === MAX_REDIRECTS) throw BadRequestError('O link do áudio redirecionou vezes demais')
      try {
        url = normalizeDirectAudioUrl(new URL(location, url).toString())
      } catch (error) {
        if (error instanceof Error && 'statusCode' in error) throw error
        throw UnprocessableError('O servidor do áudio retornou um redirecionamento inválido')
      }
      continue
    }
    if (response.statusCode !== 200) {
      response.discard()
      throw UnprocessableError(
        `O servidor do áudio respondeu com status ${response.statusCode || 'inválido'}`,
      )
    }
    const encoding = firstHeader(response.headers['content-encoding'])?.toLowerCase()
    if (encoding && encoding !== 'identity') {
      response.discard()
      throw BadRequestError('O servidor deve fornecer o arquivo de áudio sem compactação HTTP')
    }
    const mimeType = (firstHeader(response.headers['content-type']) ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase()
    const extension = extensions[mimeType]
    if (!extension) {
      response.discard()
      throw BadRequestError('O link deve apontar diretamente para um arquivo de áudio compatível')
    }
    return { response, url, mimeType, extension }
  }
  throw BadRequestError('O link do áudio redirecionou vezes demais')
}

async function downloadDirectMusicWithSlot(
  rawUrl: string,
  dependencies: MusicImportDependencies,
  image = false,
): Promise<ImportedMusic> {
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  const maxBytes = (image ? 20 : env.AD_MAX_MUSIC_MB) * 1024 * 1024
  const remote = await openRemoteAudio(rawUrl, signal, dependencies, image ? { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' } : AUDIO_EXTENSIONS)
  const declaredLength = Number(firstHeader(remote.response.headers['content-length']))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    remote.response.discard()
    throw BadRequestError('O arquivo de áudio excede o limite permitido')
  }

  let directory: string | undefined
  let handle: Awaited<ReturnType<typeof open>> | undefined
  let size = 0
  let completed = false
  try {
    await mkdir(adUploadTempDir, { recursive: true })
    directory = await mkdtemp(path.join(adUploadTempDir, 'audio-url-'))
    const outputPath = path.join(directory, `source${remote.extension}`)
    handle = await open(outputPath, 'wx')
    for await (const value of remote.response.body) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      size += chunk.length
      if (size > maxBytes) throw BadRequestError('O arquivo de áudio excede o limite permitido')
      await handle.write(chunk)
    }
    if (size < 1) throw UnprocessableError('O servidor retornou um arquivo de áudio vazio')
    if (Number.isFinite(declaredLength) && declaredLength >= 0 && declaredLength !== size) {
      throw UnprocessableError('O download do áudio terminou incompleto')
    }
    completed = true
    return {
      path: outputPath,
      directory,
      originalname: fileNameFromResponse(remote.url, remote.response.headers, remote.extension),
      mimetype: remote.mimeType,
      size,
    }
  } catch (error) {
    if (signal.aborted) throw UnprocessableError('O download do áudio excedeu o tempo permitido')
    if (error instanceof Error && 'statusCode' in error) throw error
    throw UnprocessableError('Não foi possível concluir o download do áudio')
  } finally {
    await handle?.close().catch(() => undefined)
    if (!completed) {
      remote.response.discard()
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

export async function downloadDirectMusic(
  rawUrl: string,
  userId: number,
  dependencies: MusicImportDependencies = defaultDependencies,
): Promise<ImportedMusic> {
  const releaseUser = await acquireUserImportSlot(userId)
  let releaseGlobal: (() => void) | undefined
  try {
    releaseGlobal = await acquireImportSlot()
    return await downloadDirectMusicWithSlot(rawUrl, dependencies)
  } finally {
    releaseGlobal?.()
    releaseUser()
  }
}

export async function cleanupImportedMusic(file: ImportedMusic): Promise<void> {
  await rm(file.directory, { recursive: true, force: true })
}

export async function downloadProductImage(url: string, userId: number): Promise<ImportedMusic> {
  const releaseUser = await acquireUserImportSlot(userId)
  let releaseGlobal: (() => void) | undefined
  try {
    releaseGlobal = await acquireImportSlot()
    return await downloadDirectMusicWithSlot(url, defaultDependencies, true)
  } finally { releaseGlobal?.(); releaseUser() }
}

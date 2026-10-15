import https from 'node:https'
import type { LookupAddress } from 'node:dns'

interface ImageHead { status: number; contentType?: string; location?: string }
interface ImageDependencies {
  resolve: (url: URL) => Promise<LookupAddress[]>
  head: (url: URL, target: LookupAddress, signal: AbortSignal) => Promise<ImageHead>
}

async function resolvePublicImageTarget(url: URL): Promise<LookupAddress[]> {
  // Keep message formatting/task building independent of media service boot.
  const { resolvePublicTarget } = await import('../services/AdMusicImport.js')
  return resolvePublicTarget(url)
}

function pinnedHead(url: URL, target: LookupAddress, signal: AbortSignal): Promise<ImageHead> {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'HEAD', signal,
      // Resolve once, validate every address, and pin this connection so DNS
      // rebinding cannot turn a public hostname into an internal request.
      lookup: (_hostname, options, callback) => {
        if (typeof options === 'object' && options.all) {
          const all = callback as unknown as (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void
          all(null, [target])
        } else {
          const one = callback as unknown as (error: NodeJS.ErrnoException | null, address: string, family: number) => void
          one(null, target.address, target.family)
        }
      },
    }, (response) => {
      response.resume()
      resolve({ status: response.statusCode ?? 0, contentType: response.headers['content-type'], location: response.headers.location })
    })
    request.once('error', reject)
    request.end()
  })
}

/** Untrusted marketplace images can only trigger bounded public HTTPS HEADs. */
export async function resolveUsablePublicImage(
  imageUrl?: string,
  dependencies: ImageDependencies = { resolve: resolvePublicImageTarget, head: pinnedHead },
): Promise<string | null> {
  if (!imageUrl) return null
  if (/^data:image\/(png|jpeg|webp|gif);base64,[a-z\d+/=]+$/i.test(imageUrl)) return imageUrl
  try {
    let current = new URL(imageUrl)
    const signal = AbortSignal.timeout(6000)
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (current.protocol !== 'https:' || current.username || current.password || (current.port && current.port !== '443')) return null
      const targets = await dependencies.resolve(current)
      if (signal.aborted || !targets.length) return null
      const response = await dependencies.head(current, targets[0], signal)
      if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
        current = new URL(response.location, current)
        continue
      }
      return response.status >= 200 && response.status < 300 && response.contentType?.toLowerCase().startsWith('image/')
        ? current.href : null
    }
  } catch {
    // Text fallback preserves the offer without fetching an unsafe/broken URL.
  }
  return null
}

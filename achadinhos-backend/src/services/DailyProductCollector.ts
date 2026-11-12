import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { normalizedMercadoLivreProductId } from '@/utils/offerIdentity'
import { MlLoginRecoveryError, type MlRecoveryStep } from './MlLoginRecovery'
import { browserSessionHash, checkpointBrowserSession } from './PrivateBrowserSession'

export const DAILY_AUDIENCES = ['domestica', 'masculino'] as const
export type DailyAudienceSlug = (typeof DAILY_AUDIENCES)[number]
export interface DailyCollectionRequest {
  slug: DailyAudienceSlug
  options: Record<string, unknown>
}
export interface DailyPayload {
  name: string
  targetAudienceSlug: DailyAudienceSlug
  json: Record<string, unknown>
}

export class DailyCollectionError extends Error {
  constructor(
    public readonly code:
      | 'AUTH_REQUIRED'
      | 'COLLECTION_FAILED'
      | 'COLLECTION_INCOMPLETE'
      | 'COLLECTION_TIMEOUT'
      | 'SESSION_PERSIST_FAILED'
      | 'HISTORY_LIMIT'
      | 'STOPPED',
    public readonly payloads?: DailyPayload[],
    public readonly step?: MlRecoveryStep,
  ) {
    super(code)
  }
}

/** Reuses the audited extension DOM/share flow, without an undocumented ML API. */
export class DailyProductCollector {
  async collect(
    requests: DailyCollectionRequest[],
    signal: AbortSignal,
    checkpoint?: (payload: DailyPayload) => Promise<void>,
    recover?: (page: Page) => Promise<boolean>,
  ): Promise<DailyPayload[]> {
    const statePath = process.env.DAILY_BROWSER_STATE_PATH
    if (!statePath) throw new DailyCollectionError('AUTH_REQUIRED')
    let storageState: Awaited<ReturnType<BrowserContext['storageState']>>
    let sessionHash: string
    try {
      const raw = await readFile(statePath, 'utf8')
      storageState = JSON.parse(raw)
      sessionHash = browserSessionHash(raw)
    } catch {
      throw new DailyCollectionError('AUTH_REQUIRED')
    }
    const assetPath = path.resolve(__dirname, '../../vendor/affiliate-hub')
    const [extractor, bridge] = await Promise.all([
      readFile(path.join(assetPath, 'extractor.js'), 'utf8'),
      readFile(path.join(assetPath, 'page-fiber.js'), 'utf8'),
    ])
    let browser: Browser | undefined
    let context: BrowserContext | undefined
    let timedOut = false
    const close = (): void => {
      void context?.close().catch(() => undefined)
    }
    const timeout = setTimeout(() => {
      timedOut = true
      close()
    }, 22 * 60_000)
    signal.addEventListener('abort', close, { once: true })
    try {
      if (signal.aborted) throw new DailyCollectionError('STOPPED')
      // Remote errors can contain credential-bearing CDP URLs: never log them.
      browser = process.env.DAILY_BROWSER_CDP_URL
        ? await chromium.connectOverCDP(process.env.DAILY_BROWSER_CDP_URL, { timeout: 30_000 })
        : await chromium.launch({
            headless: true,
            timeout: 30_000,
            proxy: process.env.DAILY_BROWSER_PROXY_SERVER
              ? {
                  server: process.env.DAILY_BROWSER_PROXY_SERVER,
                  username: process.env.DAILY_BROWSER_PROXY_USERNAME,
                  password: process.env.DAILY_BROWSER_PROXY_PASSWORD,
                }
              : undefined,
          })
      context = await browser.newContext({
        storageState,
        // The affiliate hub rejects the default HeadlessChrome agent even with
        // a valid session. Identify the actual Chromium version normally.
        userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`,
        locale: 'pt-BR',
        timezoneId: 'America/Sao_Paulo',
        bypassCSP: true,
        permissions: ['clipboard-read', 'clipboard-write'],
      })
      if (signal.aborted || timedOut)
        throw new DailyCollectionError(signal.aborted ? 'STOPPED' : 'COLLECTION_TIMEOUT')
      await context.addInitScript({ content: bridge })
      await context.route('**/*', (route) =>
        ['image', 'media', 'font'].includes(route.request().resourceType())
          ? route.abort()
          : route.continue(),
      )
      const page = await context.newPage()
      const payloads: DailyPayload[] = []
      const collectedIds = new Set<string>()
      for (const request of requests) {
        const excluded = [
          ...new Set(
            [
              ...(Array.isArray(request.options.excludeProductIds)
                ? request.options.excludeProductIds
                : []),
              ...collectedIds,
            ]
              .map((value) =>
                typeof value === 'string' ? normalizedMercadoLivreProductId(value) : undefined,
              )
              .filter((value): value is string => Boolean(value)),
          ),
        ]
        if (excluded.length > 50_000) throw new DailyCollectionError('HISTORY_LIMIT')
        await page.goto('https://www.mercadolivre.com.br/afiliados/hub', {
          waitUntil: 'domcontentloaded',
          timeout: 45_000,
        })
        try {
          await page.waitForSelector('.poly-card', { timeout: 45_000 })
        } catch {
          const text = await page
            .locator('body')
            .innerText({ timeout: 5_000 })
            .catch(() => '')
          if (
            /login|auth|captcha|challenge|security/i.test(new URL(page.url()).pathname) ||
            /entre na sua conta|inicie sess[aã]o|verifique que voc[eê]|confirme que voc[eê]/i.test(
              text,
            )
          ) {
            if (!recover || !await recover(page)) throw new DailyCollectionError('AUTH_REQUIRED')
            await page.goto('https://www.mercadolivre.com.br/afiliados/hub', { waitUntil: 'domcontentloaded', timeout: 45_000 })
            await page.waitForSelector('.poly-card', { timeout: 30_000 })
          } else throw new DailyCollectionError('COLLECTION_FAILED')
        }
        await page.addScriptTag({ content: extractor })
        const json = await page.evaluate(
          async (options) => {
            const api = (
              globalThis as unknown as {
                AffiliateExtractor: {
                  collect: (value: Record<string, unknown>) => Promise<Record<string, unknown>>
                }
              }
            ).AffiliateExtractor
            return api.collect(options)
          },
          { ...request.options, excludeProductIds: excluded },
        )
        // Keep observed fields and attribution evidence; raw HTML is unused by
        // ingestion and can otherwise duplicate megabytes in daily JSONB rows.
        if (Array.isArray(json.cards))
          json.cards = json.cards.map((card) => {
            const compact = { ...(card as Record<string, unknown>) }
            delete compact.raw
            const productId =
              typeof compact.productId === 'string'
                ? normalizedMercadoLivreProductId(compact.productId)
                : undefined
            if (productId) collectedIds.add(productId)
            return compact
          })
        payloads.push({
          name: `daily-${request.slug}.json`,
          targetAudienceSlug: request.slug,
          json,
        })
        await checkpoint?.(payloads[payloads.length - 1])
        // Checkpoint only after a successful authenticated audience collection,
        // retaining rotated state even if a later audience fails. Never replace
        // the login file with an unverified challenge/error page's state.
        try {
          const state = await context.storageState({ indexedDB: true })
          const saved = await checkpointBrowserSession(statePath, sessionHash, state)
          if (saved.saved) sessionHash = saved.hash
        } catch {
          throw new DailyCollectionError('SESSION_PERSIST_FAILED', payloads)
        }
      }
      return payloads
    } catch (error) {
      if (signal.aborted) throw new DailyCollectionError('STOPPED')
      if (timedOut) throw new DailyCollectionError('COLLECTION_TIMEOUT')
      if (error instanceof MlLoginRecoveryError) throw new DailyCollectionError('AUTH_REQUIRED', undefined, error.step)
      if (error instanceof DailyCollectionError) throw error
      throw new DailyCollectionError('COLLECTION_FAILED')
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', close)
      await context?.close().catch(() => undefined)
      // Only closes the browser we launched; CDP close disconnects this client.
      await browser?.close().catch(() => undefined)
    }
  }
}

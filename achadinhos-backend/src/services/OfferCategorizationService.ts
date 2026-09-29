import type { OfferInput } from '@/dtos/campaign'
import { env } from '@/config/env'
import { AppError } from '@/middleware/Error/AppError'
import { MAX_IMPORT_ITEMS } from '@/services/OfferImportService'

export type OfferCategory = 'A' | 'B' | 'C' | 'D'
export type RelevanceEvaluator = (offer: OfferInput) => Promise<number>

const MODEL = 'typesafe/jev-1.13'

/** Jev assesses only fit with the household theme. Prices and rates are scored in code. */
export async function evaluateHouseholdRelevance(offer: OfferInput): Promise<number> {
  if (!env.OPENROUTER_KEY) {
    throw new AppError(
      'Configure OPENROUTER_KEY para categorizar produtos.',
      503,
      'CATEGORIZATION_UNAVAILABLE',
    )
  }

  // The latest AI SDK and OpenRouter provider are ESM-only. NodeNext preserves
  // dynamic import while the rest of this backend continues to use CommonJS.
  const [{ experimental_evaluate: evaluate }, { createOpenRouter }] = await Promise.all([
    import('ai'),
    import('@openrouter/ai-sdk-provider'),
  ])
  const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_KEY })
  const result = await evaluate({
    model: openrouter.evaluationModel(MODEL),
    state: {
      title: offer.title,
      description: offer.description?.slice(0, 500) ?? '',
    },
    questions: {
      household_relevance: {
        type: 'score',
        instructions:
          'Avalie se este produto combina com ofertas para uma audiência interessada em produtos de uso doméstico. Use o título e a descrição. Cosméticos, moda, veículos e itens de uso pessoal não são domésticos apenas por poderem ser usados em casa.',
        criteria: [
          'Sem relação com casa, cozinha, limpeza, organização, conforto ou manutenção doméstica.',
          'Relação fraca ou indireta com o lar.',
          'Útil para alguma atividade comum da casa.',
          'Claramente feito para uso doméstico, como cozinha, eletrodoméstico, limpeza, organização, móveis ou manutenção da casa.',
        ],
      },
    },
    abortSignal: AbortSignal.timeout(20_000),
    maxRetries: 1,
  })

  const score = result.answers.household_relevance.score
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 3) {
    throw new Error('Jev returned an invalid household relevance score')
  }
  return Math.round((score / 3) * 100)
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

export function commercialSignals(offer: OfferInput): {
  discountPercent: number
  commissionRate: number
} {
  const priceDiscount =
    offer.originalPrice && offer.originalPrice > 0
      ? Math.max(0, ((offer.originalPrice - offer.discountedPrice) / offer.originalPrice) * 100)
      : undefined
  const discountPercent = clampPercent(priceDiscount ?? offer.discountPercent ?? 0)
  const parsedRate = Number(offer.commissionPercent?.replace('%', '').replace(',', '.').trim())
  const commissionRate =
    offer.commissioned === false || !Number.isFinite(parsedRate) ? 0 : clampPercent(parsedRate)
  return {
    discountPercent: Math.round(discountPercent * 100) / 100,
    commissionRate: Math.round(commissionRate * 100) / 100,
  }
}

export function categoryForSignals(
  relevanceScore: number,
  discountPercent: number,
  commissionRate: number,
): OfferCategory {
  // Relevance dominates. Discounts and commission cannot turn an unrelated item into A or B.
  if (relevanceScore < 25) return 'D'
  const score =
    relevanceScore * 0.6 +
    Math.min(discountPercent / 50, 1) * 25 +
    Math.min(commissionRate / 20, 1) * 15
  if (relevanceScore >= 75 && discountPercent >= 15 && commissionRate >= 10 && score >= 75)
    return 'A'
  if (relevanceScore >= 50 && score >= 55) return 'B'
  if (score >= 35) return 'C'
  return 'D'
}

export async function categorizeOffers(
  offers: OfferInput[],
  evaluateRelevance: RelevanceEvaluator = evaluateHouseholdRelevance,
): Promise<{ offers: OfferInput[]; counts: Record<OfferCategory, number> }> {
  const categorized: OfferInput[] = new Array(offers.length)
  const counts: Record<OfferCategory, number> = { A: 0, B: 0, C: 0, D: 0 }
  let next = 0
  let hasError = false
  let firstError: unknown

    // Start every allowed product immediately, while retaining the import cap
    // as the upper bound for callers outside the import route.
  async function worker(): Promise<void> {
    while (next < offers.length && !hasError) {
      const index = next++
      const offer = offers[index]
      try {
        const relevanceScore = clampPercent(await evaluateRelevance(offer))
        if (!Number.isFinite(relevanceScore)) throw new Error('Invalid household relevance score')
        const signals = commercialSignals(offer)
        const category = categoryForSignals(
          relevanceScore,
          signals.discountPercent,
          signals.commissionRate,
        )
        categorized[index] = { ...offer, ...signals, relevanceScore, category }
        counts[category]++
      } catch (error) {
        if (!hasError) firstError = error
        hasError = true
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_IMPORT_ITEMS, offers.length) }, () => worker()))
  if (hasError) throw firstError
  return { offers: categorized, counts }
}

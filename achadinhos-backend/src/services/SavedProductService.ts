import { injectable } from 'tsyringe'
import { createHash } from 'crypto'
import { Op, QueryTypes } from 'sequelize'
import { sequelize } from '@/database'
import { SavedProduct } from '@/database/models/SavedProduct'
import { User } from '@/database/models/User'
import { OfferSchema, type OfferInput } from '@/dtos/campaign'
import type { SavedProductOfferPatch } from '@/dtos/savedProduct'
import { ConflictError, NotFoundError, UnauthorizedError } from '@/middleware/Error/AppError'
import { offerIdentity } from '@/utils/offerIdentity'

export interface SavedProductResult {
  id: number
  offer: OfferInput
  manualOverrides: string[]
  createdAt: Date
  updatedAt: Date
}

function serialize(product: SavedProduct): SavedProductResult {
  return {
    id: product.id,
    offer: { ...product.offer, savedProductId: product.id },
    manualOverrides: product.manualOverrides,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  }
}

@injectable()
export class SavedProductService {
  async save(userId: number, offers: OfferInput[]) {
    return sequelize.transaction(async (transaction) => {
      // Serialize this user's batches so concurrent requests cannot both create
      // the same product. The unique indexes remain the database backstop.
      const user = await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE })
      if (!user) throw UnauthorizedError('Usuário não encontrado')
      const saved: SavedProductResult[] = []
      let created = 0
      let updated = 0

      for (const offer of offers) {
        // Catalog identity is assigned by this service, never trusted from imports.
        const incoming = { ...offer }
        delete incoming.savedProductId
        const source = offer.source?.trim() || null
        const productId = offer.productId?.trim() || null
        const affiliateUrl = offer.affiliateUrl.trim()
        const affiliateUrlHash = createHash('sha256').update(affiliateUrl).digest('hex')
        const normalized = Object.fromEntries(
          Object.entries({
            ...incoming,
            affiliateUrl,
            ...(source ? { source } : {}),
            ...(productId ? { productId } : {}),
          }).filter(([, value]) => value !== undefined),
        ) as OfferInput
        const identities: Array<
          { affiliateUrlHash: string } | { source: string | null; productId: string }
        > = [
          { affiliateUrlHash },
        ]
        if (productId) identities.push({ source, productId })
        const matches = await SavedProduct.findAll({
          where: { userId, [Op.or]: identities },
          transaction,
          lock: transaction.LOCK.UPDATE,
        })
        if (matches.length > 1) {
          throw ConflictError('A oferta corresponde a dois produtos salvos diferentes')
        }

        let product = matches[0]
        if (product) {
          // A later import can omit optional signals. Keep the last known
          // category, score, commission, and marketplace identity in that case.
          const refreshed = Object.fromEntries(
            Object.entries(normalized).filter(([field]) => !product.manualOverrides.includes(field)),
          )
          product.offer = { ...product.offer, ...refreshed }
          product.source = source ?? product.source
          product.productId = productId ?? product.productId
          product.affiliateUrl = product.offer.affiliateUrl
          product.affiliateUrlHash = createHash('sha256').update(product.affiliateUrl).digest('hex')
          await product.save({ transaction })
          updated++
        } else {
          product = await SavedProduct.create(
            { userId, source, productId, affiliateUrl, affiliateUrlHash, offer: normalized },
            { transaction },
          )
          created++
        }
        saved.push(serialize(product))
      }

      return { saved, created, updated }
    })
  }

  async list(userId: number, limit: number, offset: number) {
    const { rows, count } = await SavedProduct.findAndCountAll({
      where: { userId },
      order: [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
      offset,
    })
    return { items: rows.map(serialize), total: count }
  }

  async update(userId: number, id: number, patch: SavedProductOfferPatch): Promise<SavedProductResult> {
    return sequelize.transaction(async (transaction) => {
      const user = await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE })
      if (!user) throw UnauthorizedError('Usuário não encontrado')
      const product = await SavedProduct.findOne({
        where: { id, userId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      if (!product) throw NotFoundError('Produto salvo não encontrado')

      const nextOffer: Record<string, unknown> = { ...product.offer }
      const overrides = new Set(product.manualOverrides)
      const changedFields = new Set<string>()
      for (const [field, value] of Object.entries(patch)) {
        const normalizedValue = field === 'affiliateUrl' && typeof value === 'string' ? value.trim() : value
        if (normalizedValue === (product.offer as Record<string, unknown>)[field] ||
          (normalizedValue === null && !(field in product.offer))) continue
        if (value === null) delete nextOffer[field]
        else nextOffer[field] = normalizedValue
        overrides.add(field)
        changedFields.add(field)
      }
      if (changedFields.has('commissionRate')) {
        if (typeof patch.commissionRate === 'number') {
          nextOffer.commissionPercent = `${patch.commissionRate}%`
        } else {
          delete nextOffer.commissionPercent
        }
        overrides.add('commissionPercent')
      } else if (changedFields.has('commissionPercent')) {
        const match = typeof patch.commissionPercent === 'string'
          ? patch.commissionPercent.trim().match(/^(\d+(?:\.\d+)?)%$/)
          : null
        const rate = match ? Number(match[1]) : undefined
        if (rate !== undefined && rate <= 100) nextOffer.commissionRate = rate
        else delete nextOffer.commissionRate
        overrides.add('commissionRate')
      }
      if ((changedFields.has('originalPrice') || changedFields.has('discountedPrice')) &&
        !('discountPercent' in patch)) {
        const original = nextOffer.originalPrice
        const discounted = nextOffer.discountedPrice
        if (typeof original === 'number' && typeof discounted === 'number') {
          nextOffer.discountPercent = Math.max(0, Math.min(100, Math.round((1 - discounted / original) * 100)))
        } else {
          delete nextOffer.discountPercent
        }
        overrides.add('discountPercent')
      }
      if (changedFields.has('category')) {
        delete nextOffer.relevanceScore
        overrides.add('relevanceScore')
      }
      const validated = OfferSchema.parse(nextOffer)
      const nextUrl = validated.affiliateUrl.trim()
      if (nextUrl !== product.affiliateUrl) {
        const nextHash = createHash('sha256').update(nextUrl).digest('hex')
        const duplicate = await SavedProduct.findOne({
          where: { userId, affiliateUrlHash: nextHash, id: { [Op.ne]: id } },
          transaction,
          lock: transaction.LOCK.UPDATE,
        })
        if (duplicate) throw ConflictError('Link de afiliado já pertence a outro produto salvo')

        const sentByUrlOnly = await sequelize.query<{ sent: number }>(
          `SELECT 1 AS sent FROM campaign_logs AS log
           JOIN campaigns AS campaign ON campaign.id = log.campaign_id
           WHERE campaign.user_id = :userId AND log.offer_url = :affiliateUrl
             AND log.success = TRUE
             AND (log.offer_identity IS NULL OR log.offer_identity <> :savedIdentity)
             AND (log.offer_product_id IS NULL OR :productId IS NULL)
           LIMIT 1`,
          {
            replacements: {
              userId,
              affiliateUrl: product.affiliateUrl,
              productId: product.productId,
              savedIdentity: offerIdentity({ savedProductId: product.id, affiliateUrl: product.affiliateUrl }),
            },
            type: QueryTypes.SELECT,
            transaction,
          },
        )
        if (sentByUrlOnly.length) {
          throw ConflictError('Este link já foi enviado sem identidade estável; alterá-lo perderia o histórico de envio')
        }
        product.affiliateUrl = nextUrl
        product.affiliateUrlHash = nextHash
      }
      product.offer = { ...validated, affiliateUrl: nextUrl }
      product.manualOverrides = [...overrides].sort()
      await product.save({ transaction })
      return serialize(product)
    })
  }

  async remove(userId: number, id: number): Promise<boolean> {
    return (await SavedProduct.destroy({ where: { id, userId } })) > 0
  }
}

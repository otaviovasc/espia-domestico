import { injectable } from 'tsyringe'
import { createHash } from 'crypto'
import { Op } from 'sequelize'
import { sequelize } from '@/database'
import { SavedProduct } from '@/database/models/SavedProduct'
import { User } from '@/database/models/User'
import type { OfferInput } from '@/dtos/campaign'
import { ConflictError, UnauthorizedError } from '@/middleware/Error/AppError'

export interface SavedProductResult {
  id: number
  offer: OfferInput
  createdAt: Date
  updatedAt: Date
}

function serialize(product: SavedProduct): SavedProductResult {
  return {
    id: product.id,
    offer: product.offer,
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
        const source = offer.source?.trim() || null
        const productId = offer.productId?.trim() || null
        const affiliateUrl = offer.affiliateUrl.trim()
        const affiliateUrlHash = createHash('sha256').update(affiliateUrl).digest('hex')
        const normalized = Object.fromEntries(
          Object.entries({
            ...offer,
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
          product.offer = { ...product.offer, ...normalized }
          product.source = source ?? product.source
          product.productId = productId ?? product.productId
          product.affiliateUrl = affiliateUrl
          product.affiliateUrlHash = affiliateUrlHash
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

  async remove(userId: number, id: number): Promise<boolean> {
    return (await SavedProduct.destroy({ where: { id, userId } })) > 0
  }
}

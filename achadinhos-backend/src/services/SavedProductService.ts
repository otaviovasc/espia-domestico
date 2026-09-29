import { injectable } from 'tsyringe'
import { createHash } from 'crypto'
import { col, fn, Op, QueryTypes, Transaction, where } from 'sequelize'
import { sequelize } from '@/database'
import { ClassificationProfileRecord } from '@/database/models/ClassificationProfile'
import { ProductGroup } from '@/database/models/ProductGroup'
import { SavedProduct } from '@/database/models/SavedProduct'
import { SavedProductGroupMembership } from '@/database/models/SavedProductGroupMembership'
import { User } from '@/database/models/User'
import { OfferSchema, type OfferInput } from '@/dtos/campaign'
import { DEFAULT_CLASSIFICATION_PROFILE } from '@/dtos/classificationProfile'
import type {
  SavedProductClassification,
  SavedProductClassifications,
  SavedProductOfferPatch,
} from '@/dtos/savedProduct'
import { ConflictError, NotFoundError, UnauthorizedError } from '@/middleware/Error/AppError'
import { ensureDefaultProductGroup } from '@/services/ProductGroupService'
import { offerIdentity } from '@/utils/offerIdentity'

export interface SavedProductResult {
  id: number
  offer: OfferInput
  classifications: SavedProductClassifications
  groupIds: number[]
  manualOverrides: string[]
  createdAt: Date
  updatedAt: Date
}

function serialize(product: SavedProduct, groupIds: number[]): SavedProductResult {
  return {
    id: product.id,
    offer: { ...product.offer, savedProductId: product.id },
    classifications: product.classifications,
    groupIds,
    manualOverrides: product.manualOverrides,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  }
}

const CLASSIFICATION_FIELDS = [
  'category',
  'relevanceScore',
  'discountPercent',
  'commissionRate',
] as const
type ClassificationField = (typeof CLASSIFICATION_FIELDS)[number]

function classificationOverrideKey(profileId: string, field: ClassificationField): string {
  return `classification:${profileId}:${field}`
}

function hasClassificationOverride(
  manualOverrides: string[],
  profileId: string,
  field: ClassificationField,
): boolean {
  if (manualOverrides.includes(classificationOverrideKey(profileId, field))) return true
  if (field === 'discountPercent' || field === 'commissionRate') {
    return manualOverrides.includes(field)
  }
  return profileId === DEFAULT_CLASSIFICATION_PROFILE.id && manualOverrides.includes(field)
}

async function serializeProducts(
  products: SavedProduct[],
  transaction?: Transaction,
): Promise<SavedProductResult[]> {
  if (!products.length) return []
  const memberships = await SavedProductGroupMembership.findAll({
    attributes: ['savedProductId', 'productGroupId'],
    where: { savedProductId: products.map((product) => product.id) },
    order: [
      ['savedProductId', 'ASC'],
      ['productGroupId', 'ASC'],
    ],
    transaction,
  })
  const groupsByProduct = new Map<number, number[]>()
  for (const membership of memberships) {
    const groupIds = groupsByProduct.get(membership.savedProductId) ?? []
    groupIds.push(membership.productGroupId)
    groupsByProduct.set(membership.savedProductId, groupIds)
  }
  return products.map((product) => serialize(product, groupsByProduct.get(product.id) ?? []))
}

function mergeClassification(
  offer: OfferInput,
  profileId: string,
  profileName: string,
  existing: SavedProductClassification | undefined,
  manualOverrides: string[],
): SavedProductClassification {
  const merged: Partial<SavedProductClassification> = { ...existing, profileName }
  for (const field of CLASSIFICATION_FIELDS) {
    const value = offer[field]
    if (value !== undefined && !hasClassificationOverride(manualOverrides, profileId, field)) {
      ;(merged as Record<string, unknown>)[field] = value
    }
  }
  if (!merged.category) {
    throw ConflictError('A classificação recebida não possui categoria')
  }
  merged.classifiedAt = new Date().toISOString()
  return merged as SavedProductClassification
}

@injectable()
export class SavedProductService {
  private async profileName(
    userId: number,
    profileId: string,
    transaction: Transaction,
  ): Promise<string> {
    if (profileId === DEFAULT_CLASSIFICATION_PROFILE.id) {
      return DEFAULT_CLASSIFICATION_PROFILE.name
    }
    if (!/^[1-9]\d*$/.test(profileId)) {
      throw NotFoundError('Perfil de classificação não encontrado')
    }
    const numericId = Number(profileId)
    if (!Number.isSafeInteger(numericId)) {
      throw NotFoundError('Perfil de classificação não encontrado')
    }
    const profile = await ClassificationProfileRecord.findOne({
      attributes: ['name'],
      where: { id: numericId, userId },
      transaction,
    })
    if (!profile) throw NotFoundError('Perfil de classificação não encontrado')
    return profile.name
  }

  async save(userId: number, offers: OfferInput[]) {
    return sequelize.transaction(async (transaction) => {
      // Serialize this user's batches so concurrent requests cannot both create
      // the same product. The unique indexes remain the database backstop.
      const user = await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE })
      if (!user) throw UnauthorizedError('Usuário não encontrado')
      const defaultGroup = await ensureDefaultProductGroup(userId, transaction)
      const saved: SavedProductResult[] = []
      const savedModels: SavedProduct[] = []
      let created = 0
      let updated = 0

      for (const offer of offers) {
        // Catalog identity is assigned by this service, never trusted from imports.
        const incoming = { ...offer }
        delete incoming.savedProductId
        const source = offer.source?.trim().toLowerCase() || null
        const productId = offer.productId?.trim() || null
        const affiliateUrl = offer.affiliateUrl.trim()
        const profileId = offer.classificationProfileId ?? DEFAULT_CLASSIFICATION_PROFILE.id
        const profileName = await this.profileName(userId, profileId, transaction)
        const affiliateUrlHash = createHash('sha256').update(affiliateUrl).digest('hex')
        const normalized = Object.fromEntries(
          Object.entries({
            ...incoming,
            affiliateUrl,
            classificationProfileId: profileId,
            classificationProfileName: profileName,
            source: source ?? undefined,
            productId: productId ?? undefined,
          }).filter(([, value]) => value !== undefined),
        ) as OfferInput
        const identities = [
          { affiliateUrlHash },
          ...(productId
            ? [
                source
                  ? { [Op.and]: [{ productId }, where(fn('lower', col('source')), source)] }
                  : { source: null, productId },
              ]
            : []),
        ]
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
            Object.entries(normalized).filter(([field]) => {
              if ((CLASSIFICATION_FIELDS as readonly string[]).includes(field)) {
                return !hasClassificationOverride(
                  product.manualOverrides,
                  profileId,
                  field as ClassificationField,
                )
              }
              return !product.manualOverrides.includes(field)
            }),
          )
          const classification = mergeClassification(
            normalized,
            profileId,
            profileName,
            product.classifications[profileId],
            product.manualOverrides,
          )
          const currentOffer = { ...product.offer, ...refreshed }
          for (const field of CLASSIFICATION_FIELDS) {
            const value = classification[field]
            if (value === undefined) delete (currentOffer as Record<string, unknown>)[field]
            else (currentOffer as Record<string, unknown>)[field] = value
          }
          product.offer = currentOffer
          product.classifications = { ...product.classifications, [profileId]: classification }
          product.source = source ?? product.source
          product.productId = productId ?? product.productId
          product.affiliateUrl = product.offer.affiliateUrl
          product.affiliateUrlHash = createHash('sha256').update(product.affiliateUrl).digest('hex')
          await product.save({ transaction })
          updated++
        } else {
          const classification = mergeClassification(
            normalized,
            profileId,
            profileName,
            undefined,
            [],
          )
          product = await SavedProduct.create(
            {
              userId,
              source,
              productId,
              affiliateUrl,
              affiliateUrlHash,
              offer: normalized,
              classifications: { [profileId]: classification },
            },
            { transaction },
          )
          await SavedProductGroupMembership.create(
            { savedProductId: product.id, productGroupId: defaultGroup.id },
            { transaction },
          )
          created++
        }
        savedModels.push(product)
      }

      saved.push(...(await serializeProducts(savedModels, transaction)))
      return { saved, created, updated }
    })
  }

  async list(userId: number, limit: number, offset: number, groupId?: number) {
    return sequelize.transaction(async (transaction) => {
      await ensureDefaultProductGroup(userId, transaction)
      let memberProductIds: number[] | undefined
      if (groupId !== undefined) {
        const group = await ProductGroup.findOne({ where: { id: groupId, userId }, transaction })
        if (!group) throw NotFoundError('Grupo de produtos não encontrado')
        const memberships = await SavedProductGroupMembership.findAll({
          attributes: ['savedProductId'],
          where: { productGroupId: groupId },
          transaction,
        })
        memberProductIds = memberships.map((membership) => membership.savedProductId)
      }
      const { rows, count } = await SavedProduct.findAndCountAll({
        where: {
          userId,
          ...(memberProductIds ? { id: { [Op.in]: memberProductIds } } : {}),
        },
        order: [
          ['createdAt', 'DESC'],
          ['id', 'DESC'],
        ],
        limit,
        offset,
        transaction,
      })
      return { items: await serializeProducts(rows, transaction), total: count }
    })
  }

  async update(
    userId: number,
    id: number,
    patch: SavedProductOfferPatch,
    requestedProfileId?: string,
  ): Promise<SavedProductResult> {
    return sequelize.transaction(async (transaction) => {
      const user = await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE })
      if (!user) throw UnauthorizedError('Usuário não encontrado')
      const product = await SavedProduct.findOne({
        where: { id, userId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      if (!product) throw NotFoundError('Produto salvo não encontrado')

      const currentProfileId =
        product.offer.classificationProfileId ?? DEFAULT_CLASSIFICATION_PROFILE.id
      const profileId = requestedProfileId ?? currentProfileId
      const profileName = await this.profileName(userId, profileId, transaction)
      const editsCurrentRating = profileId === currentProfileId
      const nextOffer: Record<string, unknown> = { ...product.offer }
      const overrides = new Set(product.manualOverrides)
      const changedFields = new Set<string>()
      const existingClassification = product.classifications[profileId]
      let nextClassification = existingClassification
        ? { ...existingClassification, profileName }
        : undefined
      let classificationChanged = false
      for (const [field, value] of Object.entries(patch)) {
        if (field === 'category') {
          if (value === existingClassification?.category) continue
          nextClassification = {
            ...(nextClassification ?? {
              profileName,
              classifiedAt: new Date().toISOString(),
            }),
            category: value as SavedProductClassification['category'],
          }
          delete nextClassification.relevanceScore
          if (profileId === DEFAULT_CLASSIFICATION_PROFILE.id) {
            overrides.add('category')
            overrides.add('relevanceScore')
          } else {
            overrides.add(classificationOverrideKey(profileId, 'category'))
            overrides.add(classificationOverrideKey(profileId, 'relevanceScore'))
          }
          if (editsCurrentRating) {
            nextOffer.category = value
            delete nextOffer.relevanceScore
          }
          changedFields.add(field)
          classificationChanged = true
          continue
        }
        const normalizedValue =
          field === 'affiliateUrl' && typeof value === 'string' ? value.trim() : value
        if (
          normalizedValue === (product.offer as Record<string, unknown>)[field] ||
          (normalizedValue === null && !(field in product.offer))
        )
          continue
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
        const match =
          typeof patch.commissionPercent === 'string'
            ? patch.commissionPercent.trim().match(/^(\d+(?:\.\d+)?)%$/)
            : null
        const rate = match ? Number(match[1]) : undefined
        if (rate !== undefined && rate <= 100) nextOffer.commissionRate = rate
        else delete nextOffer.commissionRate
        overrides.add('commissionRate')
      }
      if (
        (changedFields.has('originalPrice') || changedFields.has('discountedPrice')) &&
        !('discountPercent' in patch)
      ) {
        const original = nextOffer.originalPrice
        const discounted = nextOffer.discountedPrice
        if (typeof original === 'number' && typeof discounted === 'number') {
          nextOffer.discountPercent = Math.max(
            0,
            Math.min(100, Math.round((1 - discounted / original) * 100)),
          )
        } else {
          delete nextOffer.discountPercent
        }
        overrides.add('discountPercent')
      }
      const validated = OfferSchema.parse(nextOffer)
      if (nextClassification) {
        if (
          changedFields.has('discountPercent') ||
          changedFields.has('originalPrice') ||
          changedFields.has('discountedPrice')
        ) {
          nextClassification.discountPercent = validated.discountPercent
          classificationChanged = true
        }
        if (changedFields.has('commissionRate') || changedFields.has('commissionPercent')) {
          nextClassification.commissionRate = validated.commissionRate
          classificationChanged = true
        }
        if (classificationChanged) nextClassification.classifiedAt = new Date().toISOString()
      }
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
              savedIdentity: offerIdentity({
                savedProductId: product.id,
                affiliateUrl: product.affiliateUrl,
              }),
            },
            type: QueryTypes.SELECT,
            transaction,
          },
        )
        if (sentByUrlOnly.length) {
          throw ConflictError(
            'Este link já foi enviado sem identidade estável; alterá-lo perderia o histórico de envio',
          )
        }
        product.affiliateUrl = nextUrl
        product.affiliateUrlHash = nextHash
      }
      product.offer = { ...validated, affiliateUrl: nextUrl }
      if (nextClassification) {
        product.classifications = {
          ...product.classifications,
          [profileId]: nextClassification,
        }
      }
      product.manualOverrides = [...overrides].sort()
      await product.save({ transaction })
      return (await serializeProducts([product], transaction))[0]
    })
  }

  async remove(userId: number, id: number): Promise<boolean> {
    return (await SavedProduct.destroy({ where: { id, userId } })) > 0
  }
}

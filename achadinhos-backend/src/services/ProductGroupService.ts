import { injectable } from 'tsyringe'
import { fn, Op, QueryTypes, Transaction, where } from 'sequelize'
import { sequelize } from '@/database'
import { ProductGroup } from '@/database/models/ProductGroup'
import { SavedProduct } from '@/database/models/SavedProduct'
import { SavedProductGroupMembership } from '@/database/models/SavedProductGroupMembership'
import { BadRequestError, ConflictError, NotFoundError } from '@/middleware/Error/AppError'

export const DEFAULT_PRODUCT_GROUP_NAME = 'Produtos existentes'

export interface ProductGroupResult {
  id: number
  name: string
  isDefault: boolean
  productCount: number
  createdAt: Date
  updatedAt: Date
}

/**
 * Historically the app auto-created a catch-all "Produtos existentes" default
 * group. The workflow is now one group per product batch, so we no longer
 * create a default group. This remains a lookup for any legacy default group
 * that still exists, but it never creates one.
 */
export async function findDefaultProductGroup(
  userId: number,
  transaction?: Transaction,
): Promise<ProductGroup | null> {
  return ProductGroup.findOne({ where: { userId, isDefault: true }, transaction })
}

async function serializeGroups(
  groups: ProductGroup[],
  transaction?: Transaction,
): Promise<ProductGroupResult[]> {
  if (!groups.length) return []
  const counts = await sequelize.query<{ productGroupId: number; productCount: string }>(
    `SELECT product_group_id AS "productGroupId", COUNT(*)::text AS "productCount"
     FROM saved_product_group_memberships
     WHERE product_group_id IN (:groupIds)
     GROUP BY product_group_id`,
    {
      replacements: { groupIds: groups.map((group) => group.id) },
      type: QueryTypes.SELECT,
      transaction,
    },
  )
  const countById = new Map(counts.map((row) => [row.productGroupId, Number(row.productCount)]))
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    isDefault: group.isDefault,
    productCount: countById.get(group.id) ?? 0,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  }))
}

@injectable()
export class ProductGroupService {
  async list(userId: number): Promise<{ items: ProductGroupResult[] }> {
    return sequelize.transaction(async (transaction) => {
      const groups = await ProductGroup.findAll({
        where: { userId },
        order: [
          ['isDefault', 'DESC'],
          ['name', 'ASC'],
          ['id', 'ASC'],
        ],
        transaction,
      })
      return { items: await serializeGroups(groups, transaction) }
    })
  }

  async create(userId: number, name: string): Promise<ProductGroupResult> {
    return sequelize.transaction(async (transaction) => {
      const duplicate = await ProductGroup.findOne({
        where: {
          userId,
          [Op.and]: [where(fn('lower', sequelize.col('name')), name.toLowerCase())],
        },
        transaction,
      })
      if (duplicate) throw ConflictError('Já existe um grupo de produtos com este nome')
      const group = await ProductGroup.create({ userId, name }, { transaction })
      return (await serializeGroups([group], transaction))[0]
    })
  }

  async update(userId: number, id: number, name: string): Promise<ProductGroupResult> {
    return sequelize.transaction(async (transaction) => {
      const group = await ProductGroup.findOne({
        where: { id, userId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      if (!group) throw NotFoundError('Grupo de produtos não encontrado')
      const duplicate = await ProductGroup.findOne({
        where: {
          userId,
          id: { [Op.ne]: id },
          [Op.and]: [where(fn('lower', sequelize.col('name')), name.toLowerCase())],
        },
        transaction,
      })
      if (duplicate) throw ConflictError('Já existe um grupo de produtos com este nome')
      group.name = name
      await group.save({ transaction })
      return (await serializeGroups([group], transaction))[0]
    })
  }

  async remove(userId: number, id: number): Promise<void> {
    await sequelize.transaction(async (transaction) => {
      const group = await ProductGroup.findOne({
        where: { id, userId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      if (!group) throw NotFoundError('Grupo de produtos não encontrado')
      await group.destroy({ transaction })
    })
  }

  async updateMemberships(
    userId: number,
    productIds: number[],
    groupIds: number[],
    mode: 'add' | 'remove' | 'set',
  ) {
    return sequelize.transaction(async (transaction) => {
      const uniqueProductIds = [...new Set(productIds)]
      const uniqueGroupIds = [...new Set(groupIds)]
      if (mode !== 'set' && !uniqueGroupIds.length) {
        throw BadRequestError('Selecione ao menos um grupo')
      }
      const products = await SavedProduct.findAll({
        attributes: ['id'],
        where: { userId, id: uniqueProductIds },
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      if (products.length !== uniqueProductIds.length) {
        throw NotFoundError('Um ou mais produtos salvos não foram encontrados')
      }
      if (uniqueGroupIds.length) {
        const groups = await ProductGroup.findAll({
          attributes: ['id'],
          where: { userId, id: uniqueGroupIds },
          transaction,
          lock: transaction.LOCK.UPDATE,
        })
        if (groups.length !== uniqueGroupIds.length) {
          throw NotFoundError('Um ou mais grupos de produtos não foram encontrados')
        }
      }

      if (mode === 'set') {
        await SavedProductGroupMembership.destroy({
          where: { savedProductId: uniqueProductIds },
          transaction,
        })
      } else if (mode === 'remove') {
        await SavedProductGroupMembership.destroy({
          where: { savedProductId: uniqueProductIds, productGroupId: uniqueGroupIds },
          transaction,
        })
      }

      if ((mode === 'add' || mode === 'set') && uniqueGroupIds.length) {
        await SavedProductGroupMembership.bulkCreate(
          uniqueProductIds.flatMap((savedProductId) =>
            uniqueGroupIds.map((productGroupId) => ({ savedProductId, productGroupId })),
          ),
          { transaction, ignoreDuplicates: true },
        )
      }

      return {
        updated: uniqueProductIds.length,
        productIds: uniqueProductIds,
        groupIds: uniqueGroupIds,
        mode,
      }
    })
  }
}

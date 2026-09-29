import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from 'sequelize'
import { sequelize } from '@/database'
import type { OfferInput } from '@/dtos/campaign'

export class SavedProduct extends Model<
  InferAttributes<SavedProduct>,
  InferCreationAttributes<SavedProduct>
> {
  declare id: CreationOptional<number>
  declare userId: number
  declare source: CreationOptional<string | null>
  declare productId: CreationOptional<string | null>
  declare affiliateUrl: string
  declare affiliateUrlHash: string
  declare offer: OfferInput
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

SavedProduct.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    source: { type: DataTypes.STRING(40), allowNull: true },
    productId: { type: DataTypes.STRING(60), allowNull: true, field: 'product_id' },
    affiliateUrl: { type: DataTypes.TEXT, allowNull: false, field: 'affiliate_url' },
    affiliateUrlHash: { type: DataTypes.CHAR(64), allowNull: false, field: 'affiliate_url_hash' },
    offer: { type: DataTypes.JSONB, allowNull: false },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
  },
  { sequelize, tableName: 'saved_products', underscored: true },
)

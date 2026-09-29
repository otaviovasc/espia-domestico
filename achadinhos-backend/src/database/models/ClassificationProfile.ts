import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
} from 'sequelize'
import { sequelize } from '@/database'
import type { ClassificationProfileInput } from '@/dtos/classificationProfile'

export class ClassificationProfileRecord extends Model<
  InferAttributes<ClassificationProfileRecord>,
  InferCreationAttributes<ClassificationProfileRecord>
> {
  declare id: CreationOptional<number>
  declare userId: number
  declare name: string
  declare nicheDescription: string
  declare relevanceInstructions: string
  declare weights: ClassificationProfileInput['weights']
  declare discountCap: number
  declare commissionCap: number
  declare thresholds: ClassificationProfileInput['thresholds']
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

ClassificationProfileRecord.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    name: { type: DataTypes.STRING(120), allowNull: false },
    nicheDescription: { type: DataTypes.TEXT, allowNull: false, field: 'niche_description' },
    relevanceInstructions: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: 'relevance_instructions',
    },
    weights: { type: DataTypes.JSONB, allowNull: false },
    discountCap: { type: DataTypes.FLOAT, allowNull: false, field: 'discount_cap' },
    commissionCap: { type: DataTypes.FLOAT, allowNull: false, field: 'commission_cap' },
    thresholds: { type: DataTypes.JSONB, allowNull: false },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
  },
  { sequelize, tableName: 'classification_profiles', underscored: true },
)

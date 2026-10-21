import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
} from 'sequelize'
import { sequelize } from '@/database'

export interface SmartAudienceProfile {
  instructions: string
  keywords: string[]
  negativeKeywords: string[]
}

export interface SmartAudienceDestination {
  groupId: string
  groupName: string
}

export interface SmartAudiencePolicy {
  dailyCap: number
  startTime: string
  endTime: string
  minGapSeconds: number
  maxGapSeconds: number
  maxStandouts: number
  freshnessHours: number
  timezone: string
  excludePolitical: boolean
  minPrice?: number
  maxPrice?: number
  minCommissionPercent?: number
  minEstimatedCommission?: number
}

export class SmartAudience extends Model<
  InferAttributes<SmartAudience>,
  InferCreationAttributes<SmartAudience>
> {
  declare id: CreationOptional<number>
  declare userId: number
  declare slug: string
  declare name: string
  declare description: string
  declare enabled: CreationOptional<boolean>
  declare classificationProfileId: CreationOptional<string | null>
  declare profile: SmartAudienceProfile
  declare destinations: CreationOptional<SmartAudienceDestination[]>
  declare policy: SmartAudiencePolicy
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

SmartAudience.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    slug: { type: DataTypes.STRING(32), allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    classificationProfileId: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: 'classification_profile_id',
    },
    profile: { type: DataTypes.JSONB, allowNull: false },
    destinations: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    policy: { type: DataTypes.JSONB, allowNull: false },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
  },
  { sequelize, tableName: 'smart_audiences', underscored: true },
)

import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
} from 'sequelize'
import { randomUUID } from 'node:crypto'
import { sequelize } from '@/database'

export enum SMART_PLAN_STATUS {
  ANALYZING = 'ANALYZING',
  REVIEW = 'REVIEW',
  SCHEDULED = 'SCHEDULED',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export class SmartPlan extends Model<InferAttributes<SmartPlan>, InferCreationAttributes<SmartPlan>> {
  declare id: CreationOptional<number>
  declare uuid: CreationOptional<string>
  declare userId: number
  declare status: CreationOptional<SMART_PLAN_STATUS>
  declare startDate: string
  declare days: number
  declare timezone: string
  declare audienceSlugs: string[]
  declare input: Record<string, unknown>
  declare items: CreationOptional<Record<string, unknown>[]>
  declare settings: Record<string, unknown>
  declare progress: CreationOptional<Record<string, unknown>>
  declare warnings: CreationOptional<string[]>
  declare revision: CreationOptional<number>
  declare approvedAt: CreationOptional<Date | null>
  declare completedAt: CreationOptional<Date | null>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

SmartPlan.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    uuid: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      defaultValue: () => randomUUID(),
    },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    status: {
      type: DataTypes.ENUM(...Object.values(SMART_PLAN_STATUS)),
      allowNull: false,
      defaultValue: SMART_PLAN_STATUS.ANALYZING,
    },
    startDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'start_date' },
    days: { type: DataTypes.SMALLINT, allowNull: false },
    timezone: { type: DataTypes.STRING(64), allowNull: false },
    audienceSlugs: { type: DataTypes.JSONB, allowNull: false, field: 'audience_slugs' },
    input: { type: DataTypes.JSONB, allowNull: false },
    items: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    settings: { type: DataTypes.JSONB, allowNull: false },
    progress: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    warnings: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    revision: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    approvedAt: { type: DataTypes.DATE, allowNull: true, field: 'approved_at' },
    completedAt: { type: DataTypes.DATE, allowNull: true, field: 'completed_at' },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
  },
  { sequelize, tableName: 'smart_plans', underscored: true },
)

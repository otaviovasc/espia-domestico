import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
} from 'sequelize'
import { sequelize } from '@/database'

export enum SMART_AI_REQUEST_STATUS {
  RESERVED = 'RESERVED',
  SUCCEEDED = 'SUCCEEDED',
  FAILED_UNKNOWN = 'FAILED_UNKNOWN',
}

/**
 * Cost ledger and tenant-owned semantic cache for paid product intelligence.
 * Prompts and credentials are deliberately never persisted.
 */
export class SmartAIRequest extends Model<
  InferAttributes<SmartAIRequest>,
  InferCreationAttributes<SmartAIRequest>
> {
  declare id: CreationOptional<number>
  declare userId: number
  declare requestKey: string
  declare cacheKey: string
  declare operation: string
  declare operationId: CreationOptional<string | null>
  declare model: string
  declare modelVersion: string
  declare status: CreationOptional<SMART_AI_REQUEST_STATUS>
  declare quotaDate: string
  declare reservedInputTokens: number
  declare reservedOutputTokens: number
  declare reservedCostMicros: number
  declare actualInputTokens: CreationOptional<number | null>
  declare actualOutputTokens: CreationOptional<number | null>
  declare accountedCostMicros: CreationOptional<number | null>
  declare responsePayload: CreationOptional<unknown | null>
  declare cacheExpiresAt: Date
  declare completedAt: CreationOptional<Date | null>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

SmartAIRequest.init(
  {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    requestKey: { type: DataTypes.STRING(64), allowNull: false, field: 'request_key' },
    cacheKey: { type: DataTypes.STRING(64), allowNull: false, field: 'cache_key' },
    operation: { type: DataTypes.STRING(64), allowNull: false },
    operationId: { type: DataTypes.STRING(120), allowNull: true, field: 'operation_id' },
    model: { type: DataTypes.STRING(160), allowNull: false },
    modelVersion: { type: DataTypes.STRING(80), allowNull: false, field: 'model_version' },
    status: {
      type: DataTypes.ENUM(...Object.values(SMART_AI_REQUEST_STATUS)),
      allowNull: false,
      defaultValue: SMART_AI_REQUEST_STATUS.RESERVED,
    },
    quotaDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'quota_date' },
    reservedInputTokens: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'reserved_input_tokens',
    },
    reservedOutputTokens: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'reserved_output_tokens',
    },
    reservedCostMicros: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'reserved_cost_micros',
    },
    actualInputTokens: { type: DataTypes.INTEGER, allowNull: true, field: 'actual_input_tokens' },
    actualOutputTokens: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'actual_output_tokens',
    },
    accountedCostMicros: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: 'accounted_cost_micros',
    },
    responsePayload: { type: DataTypes.JSONB, allowNull: true, field: 'response_payload' },
    cacheExpiresAt: { type: DataTypes.DATE, allowNull: false, field: 'cache_expires_at' },
    completedAt: { type: DataTypes.DATE, allowNull: true, field: 'completed_at' },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
  },
  { sequelize, tableName: 'smart_ai_requests', underscored: true },
)

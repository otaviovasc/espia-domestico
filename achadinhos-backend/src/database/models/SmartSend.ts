import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
} from 'sequelize'
import { randomUUID } from 'node:crypto'
import { sequelize } from '@/database'
import type { OfferInput } from '@/dtos/campaign'

export enum SMART_SEND_STATUS {
  PENDING = 'PENDING',
  SENDING = 'SENDING',
  SENT = 'SENT',
  SKIPPED = 'SKIPPED',
  FAILED = 'FAILED',
  UNKNOWN = 'UNKNOWN',
}

export class SmartSend extends Model<InferAttributes<SmartSend>, InferCreationAttributes<SmartSend>> {
  declare id: CreationOptional<number>
  declare uuid: CreationOptional<string>
  declare userId: number
  declare planId: number
  declare audienceSlug: string
  declare groupId: string
  declare groupName: string
  declare connectionScope: string
  declare savedProductId: CreationOptional<number | null>
  declare offerIdentity: string
  declare offer: OfferInput
  declare messageIntro: CreationOptional<string | null>
  declare scheduledAt: Date
  declare localDate: string
  declare timezone: string
  declare evidenceObservedAt: Date
  declare status: CreationOptional<SMART_SEND_STATUS>
  declare leaseOwner: CreationOptional<string | null>
  declare leaseExpiresAt: CreationOptional<Date | null>
  declare attempts: CreationOptional<number>
  declare maxAttempts: CreationOptional<number>
  declare lastError: CreationOptional<string | null>
  declare providerMessageId: CreationOptional<string | null>
  declare sentAt: CreationOptional<Date | null>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

SmartSend.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    uuid: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      defaultValue: () => randomUUID(),
    },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    planId: { type: DataTypes.INTEGER, allowNull: false, field: 'plan_id' },
    audienceSlug: { type: DataTypes.STRING(32), allowNull: false, field: 'audience_slug' },
    groupId: { type: DataTypes.STRING(120), allowNull: false, field: 'group_id' },
    groupName: { type: DataTypes.STRING, allowNull: false, field: 'group_name' },
    connectionScope: {
      type: DataTypes.STRING(200),
      allowNull: false,
      field: 'connection_scope',
    },
    savedProductId: { type: DataTypes.INTEGER, allowNull: true, field: 'saved_product_id' },
    offerIdentity: { type: DataTypes.STRING(255), allowNull: false, field: 'offer_identity' },
    offer: { type: DataTypes.JSONB, allowNull: false },
    messageIntro: { type: DataTypes.TEXT, allowNull: true, field: 'message_intro' },
    scheduledAt: { type: DataTypes.DATE, allowNull: false, field: 'scheduled_at' },
    localDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'local_date' },
    timezone: { type: DataTypes.STRING(64), allowNull: false },
    evidenceObservedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'evidence_observed_at',
    },
    status: {
      type: DataTypes.ENUM(...Object.values(SMART_SEND_STATUS)),
      allowNull: false,
      defaultValue: SMART_SEND_STATUS.PENDING,
    },
    leaseOwner: { type: DataTypes.STRING(120), allowNull: true, field: 'lease_owner' },
    leaseExpiresAt: { type: DataTypes.DATE, allowNull: true, field: 'lease_expires_at' },
    attempts: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
    maxAttempts: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 3, field: 'max_attempts' },
    lastError: { type: DataTypes.TEXT, allowNull: true, field: 'last_error' },
    providerMessageId: { type: DataTypes.STRING(200), allowNull: true, field: 'provider_message_id' },
    sentAt: { type: DataTypes.DATE, allowNull: true, field: 'sent_at' },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
  },
  { sequelize, tableName: 'smart_sends', underscored: true },
)

import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize'
import { randomUUID } from 'crypto'
import { sequelize } from '@/database'

export enum CAMPAIGN_STATUS_ENUM {
  DRAFT = 'DRAFT',
  SCHEDULED = 'SCHEDULED',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/**
 * A single product offer within a campaign. Prices are stored as numbers in the
 * base currency unit (e.g. 199.9 = R$199,90). The formatter derives the
 * discount percentage from original vs discounted price.
 */
export interface CampaignOffer {
  /** Stable local catalog identity; survives edits to URL/title/pricing. */
  savedProductId?: number
  title: string
  originalPrice?: number
  discountedPrice: number
  currency?: string
  description?: string
  affiliateUrl: string
  imageUrl?: string
  coupon?: string
  /** Rich fields from marketplace ingestors (optional). */
  installmentLabel?: string
  commissionPercent?: string
  productId?: string
  /** Source marketplace, e.g. 'mercadolivre' | 'amazon' | 'manual'. */
  source?: string
  /** True when affiliateUrl is a commissioned/affiliate link (vs. plain product URL). */
  commissioned?: boolean
  category?: 'A' | 'B' | 'C' | 'D'
  relevanceScore?: number
  discountPercent?: number
  commissionRate?: number
  classificationProfileId?: string
  classificationProfileName?: string
}

/**
 * Safe-send controls. All delays are in seconds. These shape the pacing of the
 * broadcast so a number does not get flagged for spam.
 */
export interface CampaignSafety {
  /** Minimum delay between messages (seconds). */
  minDelaySeconds: number
  /** Maximum delay between messages (seconds). Jitter is uniform in [min,max]. */
  maxDelaySeconds: number
  /** Shuffle group order before sending. */
  shuffleGroups: boolean
  /** Max messages sent per hour across the whole campaign (0 = unlimited). */
  maxPerHour: number
  /**
   * Warmup ramp: send this many messages, then pause maxDelaySeconds*warmupPauseFactor.
   * 0 disables warmup.
   */
  warmupBatchSize: number
  warmupPauseFactor: number
}

export interface CampaignGroup {
  id: string // JID ending in @g.us
  name: string
}

export class Campaign extends Model<InferAttributes<Campaign>, InferCreationAttributes<Campaign>> {
  declare id: CreationOptional<number>
  declare uuid: CreationOptional<string>
  declare userId: number
  declare name: string
  declare offers: CampaignOffer[]
  declare groups: CampaignGroup[]
  declare safety: CampaignSafety
  /** Optional custom message template with {placeholders}. Null = default format. */
  declare messageTemplate: CreationOptional<string | null>
  /** When false, offers are sent as text-only (link preview) even if they have an image. */
  declare sendImages: CreationOptional<boolean>
  declare status: CreationOptional<CAMPAIGN_STATUS_ENUM>
  declare scheduledAt: CreationOptional<Date | null>
  declare startedAt: CreationOptional<Date | null>
  declare completedAt: CreationOptional<Date | null>
  declare totalSent: CreationOptional<number>
  declare totalFailed: CreationOptional<number>
  /** Product/group pairs skipped because they were already sent or in-flight. */
  declare totalSkipped: CreationOptional<number>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

Campaign.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    uuid: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      defaultValue: () => randomUUID(),
    },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    name: { type: DataTypes.STRING, allowNull: false },
    offers: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    groups: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    safety: { type: DataTypes.JSONB, allowNull: false },
    messageTemplate: { type: DataTypes.TEXT, allowNull: true, field: 'message_template' },
    sendImages: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: 'send_images',
    },
    status: {
      type: DataTypes.ENUM(...Object.values(CAMPAIGN_STATUS_ENUM)),
      allowNull: false,
      defaultValue: CAMPAIGN_STATUS_ENUM.DRAFT,
    },
    scheduledAt: { type: DataTypes.DATE, allowNull: true, field: 'scheduled_at' },
    startedAt: { type: DataTypes.DATE, allowNull: true, field: 'started_at' },
    completedAt: { type: DataTypes.DATE, allowNull: true, field: 'completed_at' },
    totalSent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'total_sent' },
    totalFailed: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'total_failed',
    },
    totalSkipped: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'total_skipped',
    },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
  },
  {
    sequelize,
    tableName: 'campaigns',
    underscored: true,
  },
)

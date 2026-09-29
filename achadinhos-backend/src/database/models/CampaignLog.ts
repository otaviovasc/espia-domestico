import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize'
import { sequelize } from '@/database'

/**
 * One row per (offer × group) send attempt within a campaign. Gives a full
 * audit trail of what was sent where and whether it succeeded.
 */
export class CampaignLog extends Model<
  InferAttributes<CampaignLog>,
  InferCreationAttributes<CampaignLog>
> {
  declare id: CreationOptional<number>
  declare campaignId: number
  declare groupId: string
  declare groupName: string
  declare offerTitle: string
  /** Stable product identity for "already sent" checks (e.g. ML productId). */
  declare offerProductId: CreationOptional<string | null>
  /** Affiliate/product URL — fallback identity when productId is absent. */
  declare offerUrl: CreationOptional<string | null>
  declare success: boolean
  declare messageId: CreationOptional<string | null>
  declare error: CreationOptional<string | null>
  declare sentAt: CreationOptional<Date>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

CampaignLog.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    campaignId: { type: DataTypes.INTEGER, allowNull: false, field: 'campaign_id' },
    groupId: { type: DataTypes.STRING, allowNull: false, field: 'group_id' },
    groupName: { type: DataTypes.STRING, allowNull: false, field: 'group_name' },
    offerTitle: { type: DataTypes.STRING, allowNull: false, field: 'offer_title' },
    offerProductId: { type: DataTypes.STRING, allowNull: true, field: 'offer_product_id' },
    offerUrl: { type: DataTypes.TEXT, allowNull: true, field: 'offer_url' },
    success: { type: DataTypes.BOOLEAN, allowNull: false },
    messageId: { type: DataTypes.STRING, allowNull: true, field: 'message_id' },
    error: { type: DataTypes.TEXT, allowNull: true },
    sentAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'sent_at' },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
  },
  {
    sequelize,
    tableName: 'campaign_logs',
    underscored: true,
  },
)

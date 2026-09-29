import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize'
import { randomUUID } from 'node:crypto'
import { sequelize } from '@/database'

export enum PRODUCT_GROUP_DELIVERY_STATUS {
  SENDING = 'SENDING',
  SENT = 'SENT',
}

/**
 * Durable claim for a user/connection/product/group pair. The unique key makes
 * concurrent campaigns converge before either one calls the provider.
 */
export class ProductGroupDelivery extends Model<
  InferAttributes<ProductGroupDelivery>,
  InferCreationAttributes<ProductGroupDelivery>
> {
  declare id: CreationOptional<number>
  declare userId: number
  declare connectionScope: string
  declare offerIdentity: string
  declare offerSource: CreationOptional<string | null>
  declare offerProductId: CreationOptional<string | null>
  declare offerUrl: string
  declare offerTitle: string
  declare groupId: string
  declare groupName: string
  declare campaignId: CreationOptional<number | null>
  declare status: PRODUCT_GROUP_DELIVERY_STATUS
  declare claimToken: CreationOptional<string>
  declare heartbeatAt: CreationOptional<Date>
  declare messageId: CreationOptional<string | null>
  declare sentAt: CreationOptional<Date | null>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

ProductGroupDelivery.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    connectionScope: { type: DataTypes.STRING(160), allowNull: false, field: 'connection_scope' },
    offerIdentity: { type: DataTypes.STRING(255), allowNull: false, field: 'offer_identity' },
    offerSource: { type: DataTypes.STRING(40), allowNull: true, field: 'offer_source' },
    offerProductId: { type: DataTypes.STRING(60), allowNull: true, field: 'offer_product_id' },
    offerUrl: { type: DataTypes.TEXT, allowNull: false, field: 'offer_url' },
    offerTitle: { type: DataTypes.STRING, allowNull: false, field: 'offer_title' },
    groupId: { type: DataTypes.STRING, allowNull: false, field: 'group_id' },
    groupName: { type: DataTypes.STRING, allowNull: false, field: 'group_name' },
    campaignId: { type: DataTypes.INTEGER, allowNull: true, field: 'campaign_id' },
    status: {
      type: DataTypes.ENUM(...Object.values(PRODUCT_GROUP_DELIVERY_STATUS)),
      allowNull: false,
    },
    claimToken: {
      type: DataTypes.STRING(64),
      allowNull: false,
      field: 'claim_token',
      defaultValue: () => randomUUID(),
    },
    heartbeatAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'heartbeat_at',
      defaultValue: DataTypes.NOW,
    },
    messageId: { type: DataTypes.STRING, allowNull: true, field: 'message_id' },
    sentAt: { type: DataTypes.DATE, allowNull: true, field: 'sent_at' },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
  },
  { sequelize, tableName: 'product_group_deliveries', underscored: true },
)

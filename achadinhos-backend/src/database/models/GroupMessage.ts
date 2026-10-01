import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
} from 'sequelize'
import { sequelize } from '@/database'

/** Who sent the message relative to the connected number. */
export type GroupMessageDirection = 'in' | 'out'

/**
 * A single WhatsApp group message, inbound (ingested from the UAZAPI webhook)
 * or outbound (sent manually from the app). Rows are isolated per connection
 * instance via `connectionScope` (same scope string ProductGroupDelivery uses),
 * so a user only ever sees the history of their currently attached instance.
 *
 * `messageId` is the UAZAPI/WhatsApp message id; a unique index on
 * (connectionScope, messageId) makes webhook ingestion idempotent — WhatsApp
 * and UAZAPI happily redeliver the same event.
 */
export class GroupMessage extends Model<
  InferAttributes<GroupMessage>,
  InferCreationAttributes<GroupMessage>
> {
  declare id: CreationOptional<number>
  /** Stable, non-secret identity of the attached UAZAPI instance. */
  declare connectionScope: string
  /** Group JID (…@g.us). */
  declare groupId: string
  declare groupName: CreationOptional<string | null>
  declare direction: GroupMessageDirection
  /** UAZAPI/WhatsApp message id, when known. */
  declare messageId: CreationOptional<string | null>
  /** Sender JID for inbound messages. */
  declare sender: CreationOptional<string | null>
  /** Human-readable push name of the sender, when provided. */
  declare senderName: CreationOptional<string | null>
  /** True when the message was sent by the connected number itself. */
  declare fromMe: CreationOptional<boolean>
  /** Text body / caption. */
  declare text: CreationOptional<string | null>
  /** image | video | audio | document | sticker | null (plain text). */
  declare mediaType: CreationOptional<string | null>
  /** Public media URL when UAZAPI exposes one. */
  declare mediaUrl: CreationOptional<string | null>
  /** When the message happened on WhatsApp (provider timestamp). */
  declare timestamp: Date
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

GroupMessage.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    connectionScope: {
      type: DataTypes.STRING(200),
      allowNull: false,
      field: 'connection_scope',
    },
    groupId: { type: DataTypes.STRING(120), allowNull: false, field: 'group_id' },
    groupName: { type: DataTypes.STRING, allowNull: true, field: 'group_name' },
    direction: { type: DataTypes.ENUM('in', 'out'), allowNull: false },
    messageId: { type: DataTypes.STRING(200), allowNull: true, field: 'message_id' },
    sender: { type: DataTypes.STRING(120), allowNull: true },
    senderName: { type: DataTypes.STRING, allowNull: true, field: 'sender_name' },
    fromMe: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'from_me' },
    text: { type: DataTypes.TEXT, allowNull: true },
    mediaType: { type: DataTypes.STRING(20), allowNull: true, field: 'media_type' },
    mediaUrl: { type: DataTypes.TEXT, allowNull: true, field: 'media_url' },
    timestamp: { type: DataTypes.DATE, allowNull: false },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
  },
  { sequelize, tableName: 'group_messages', underscored: true },
)

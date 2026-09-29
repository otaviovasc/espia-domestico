import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize'
import { randomUUID } from 'crypto'
import { sequelize } from '@/database'

export enum CONNECTION_STATUS_ENUM {
  DISCONNECTED = 'DISCONNECTED',
  WAITING_QR = 'WAITING_QR',
  WAITING_PHONE_CODE = 'WAITING_PHONE_CODE',
  CONNECTED = 'CONNECTED',
}

/**
 * UAZAPI instance credentials stored per connection.
 * The instanceToken is sensitive and must never be logged or returned to the
 * frontend.
 */
export interface UazapiCredentials {
  baseUrl: string
  instanceId: string
  instanceToken: string
}

export class Connection extends Model<
  InferAttributes<Connection>,
  InferCreationAttributes<Connection>
> {
  declare id: CreationOptional<number>
  declare uuid: CreationOptional<string>
  declare userId: number
  /** UAZAPI instance credentials (JSONB). Sensitive. */
  declare credentials: UazapiCredentials | null
  declare status: CreationOptional<CONNECTION_STATUS_ENUM>
  /** Connected WhatsApp phone number (E.164 digits), when known. */
  declare phoneNumber: CreationOptional<string | null>
  /** Optional phone for pairing-code flow (instead of QR). */
  declare pairingPhoneNumber: CreationOptional<string | null>
  declare qrCode: CreationOptional<string | null>
  declare qrCodeExpiresAt: CreationOptional<Date | null>
  declare lastConnectedAt: CreationOptional<Date | null>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

Connection.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    uuid: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      defaultValue: () => randomUUID(),
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true, // one connection per user
      field: 'user_id',
    },
    credentials: { type: DataTypes.JSONB, allowNull: true },
    status: {
      type: DataTypes.ENUM(...Object.values(CONNECTION_STATUS_ENUM)),
      allowNull: false,
      defaultValue: CONNECTION_STATUS_ENUM.DISCONNECTED,
    },
    phoneNumber: { type: DataTypes.STRING, allowNull: true, field: 'phone_number' },
    pairingPhoneNumber: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'pairing_phone_number',
    },
    qrCode: { type: DataTypes.TEXT, allowNull: true, field: 'qr_code' },
    qrCodeExpiresAt: { type: DataTypes.DATE, allowNull: true, field: 'qr_code_expires_at' },
    lastConnectedAt: { type: DataTypes.DATE, allowNull: true, field: 'last_connected_at' },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
  },
  {
    sequelize,
    tableName: 'connections',
    underscored: true,
  },
)

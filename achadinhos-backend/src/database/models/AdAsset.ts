import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
} from 'sequelize'
import { sequelize } from '@/database'
import type { AdAssetKind } from '@/dtos/adProject'

export class AdAsset extends Model<InferAttributes<AdAsset>, InferCreationAttributes<AdAsset>> {
  declare id: CreationOptional<number>
  declare projectId: number
  declare kind: AdAssetKind
  declare originalName: string
  declare mimeType: string
  declare sizeBytes: number
  declare storagePath: string
  declare durationSeconds: number
  declare width: CreationOptional<number | null>
  declare height: CreationOptional<number | null>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

AdAsset.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    projectId: { type: DataTypes.INTEGER, allowNull: false, field: 'project_id' },
    kind: { type: DataTypes.ENUM('clip', 'music'), allowNull: false },
    originalName: { type: DataTypes.STRING(255), allowNull: false, field: 'original_name' },
    mimeType: { type: DataTypes.STRING(100), allowNull: false, field: 'mime_type' },
    sizeBytes: { type: DataTypes.INTEGER, allowNull: false, field: 'size_bytes' },
    storagePath: { type: DataTypes.TEXT, allowNull: false, field: 'storage_path' },
    durationSeconds: { type: DataTypes.FLOAT, allowNull: false, field: 'duration_seconds' },
    width: { type: DataTypes.INTEGER, allowNull: true },
    height: { type: DataTypes.INTEGER, allowNull: true },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
  },
  { sequelize, tableName: 'ad_assets', underscored: true },
)

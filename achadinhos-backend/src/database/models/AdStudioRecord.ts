import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
} from 'sequelize'
import { sequelize } from '@/database'
export class AdStudioRecord extends Model<
  InferAttributes<AdStudioRecord>,
  InferCreationAttributes<AdStudioRecord>
> {
  declare id: CreationOptional<number>
  declare userId: number
  declare projectId: CreationOptional<number | null>
  declare kind: string
  declare key: string
  declare payload: Record<string, unknown>
  declare revision: CreationOptional<number>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}
AdStudioRecord.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    projectId: { type: DataTypes.INTEGER, allowNull: true, field: 'project_id' },
    kind: { type: DataTypes.STRING(20), allowNull: false },
    key: { type: DataTypes.STRING(100), allowNull: false },
    payload: { type: DataTypes.JSONB, allowNull: false },
    revision: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
  },
  { sequelize, tableName: 'ad_studio_records', underscored: true },
)

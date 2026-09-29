import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
} from 'sequelize'
import { sequelize } from '@/database'
import type { AdProjectConfig } from '@/dtos/adProject'

export class AdProject extends Model<InferAttributes<AdProject>, InferCreationAttributes<AdProject>> {
  declare id: CreationOptional<number>
  declare userId: number
  declare name: string
  declare config: AdProjectConfig
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

AdProject.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    name: { type: DataTypes.STRING(120), allowNull: false },
    config: { type: DataTypes.JSONB, allowNull: false },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
  },
  { sequelize, tableName: 'ad_projects', underscored: true },
)

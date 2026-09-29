import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
} from 'sequelize'
import { sequelize } from '@/database'

export class SavedProductGroupMembership extends Model<
  InferAttributes<SavedProductGroupMembership>,
  InferCreationAttributes<SavedProductGroupMembership>
> {
  declare productGroupId: number
  declare savedProductId: number
  declare createdAt: CreationOptional<Date>
}

SavedProductGroupMembership.init(
  {
    productGroupId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      field: 'product_group_id',
    },
    savedProductId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      field: 'saved_product_id',
    },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
  },
  {
    sequelize,
    tableName: 'saved_product_group_memberships',
    underscored: true,
    updatedAt: false,
  },
)

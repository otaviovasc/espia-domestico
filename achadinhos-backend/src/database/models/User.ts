import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize'
import { randomUUID } from 'crypto'
import { sequelize } from '@/database'

export enum USER_ROLE_ENUM {
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
}

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<number>
  declare uuid: CreationOptional<string>
  declare name: string
  declare email: string
  declare passwordHash: string
  declare role: CreationOptional<USER_ROLE_ENUM>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

User.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    uuid: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      defaultValue: () => randomUUID(),
    },
    name: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING, allowNull: false, field: 'password_hash' },
    role: {
      type: DataTypes.ENUM(...Object.values(USER_ROLE_ENUM)),
      allowNull: false,
      defaultValue: USER_ROLE_ENUM.MEMBER,
    },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
  },
  {
    sequelize,
    tableName: 'users',
    underscored: true,
  },
)

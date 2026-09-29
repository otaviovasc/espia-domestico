'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize
    await queryInterface.createTable('saved_products', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      source: { type: DataTypes.STRING(40), allowNull: true },
      product_id: { type: DataTypes.STRING(60), allowNull: true },
      affiliate_url: { type: DataTypes.TEXT, allowNull: false },
      affiliate_url_hash: { type: DataTypes.CHAR(64), allowNull: false },
      offer: { type: DataTypes.JSONB, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    })
    await queryInterface.addIndex('saved_products', ['user_id', 'affiliate_url_hash'], {
      unique: true,
      name: 'saved_products_user_affiliate_url_hash_unique',
    })
    await queryInterface.addIndex('saved_products', ['user_id', 'source', 'product_id'], {
      unique: true,
      where: { source: { [Sequelize.Op.ne]: null }, product_id: { [Sequelize.Op.ne]: null } },
      name: 'saved_products_user_source_product_unique',
    })
    await queryInterface.addIndex('saved_products', ['user_id', 'created_at'], {
      name: 'saved_products_user_created_at',
    })
  },

  async down(queryInterface) {
    await queryInterface.dropTable('saved_products')
  },
}

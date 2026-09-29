'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addIndex('saved_products', ['user_id', 'product_id'], {
      unique: true,
      where: { source: null, product_id: { [Sequelize.Op.ne]: null } },
      name: 'saved_products_user_unsourced_product_unique',
    })
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('saved_products', 'saved_products_user_unsourced_product_unique')
  },
}

'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('saved_products', 'manual_overrides', {
      type: Sequelize.DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    })
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('saved_products', 'manual_overrides')
  },
}

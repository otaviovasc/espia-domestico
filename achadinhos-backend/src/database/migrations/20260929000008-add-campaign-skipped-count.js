'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('campaigns', 'total_skipped', {
      type: Sequelize.DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    })
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('campaigns', 'total_skipped')
  },
}

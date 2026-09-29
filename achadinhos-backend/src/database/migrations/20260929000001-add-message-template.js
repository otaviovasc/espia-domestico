'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('campaigns', 'message_template', {
      type: Sequelize.DataTypes.TEXT,
      allowNull: true,
    })
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('campaigns', 'message_template')
  },
}

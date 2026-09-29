'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('campaigns', 'allow_resend', {
      type: Sequelize.DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    })
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('campaigns', 'allow_resend')
  },
}

'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('campaigns', 'heartbeat_at', {
      type: Sequelize.DataTypes.DATE,
      allowNull: true,
    })
    // Help the scheduler scan RUNNING campaigns by liveness cheaply.
    await queryInterface.addIndex('campaigns', ['status', 'heartbeat_at'])
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('campaigns', ['status', 'heartbeat_at'])
    await queryInterface.removeColumn('campaigns', 'heartbeat_at')
  },
}

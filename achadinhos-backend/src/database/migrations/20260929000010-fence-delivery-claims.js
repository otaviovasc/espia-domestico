'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize
    await queryInterface.addColumn('product_group_deliveries', 'claim_token', {
      type: DataTypes.STRING(64),
      allowNull: true,
    })
    await queryInterface.addColumn('product_group_deliveries', 'heartbeat_at', {
      type: DataTypes.DATE,
      allowNull: true,
    })
    await queryInterface.sequelize.query(`
      UPDATE product_group_deliveries
      SET claim_token = md5(random()::text || clock_timestamp()::text || id::text),
          heartbeat_at = COALESCE(updated_at, created_at, NOW())
    `)
    await queryInterface.changeColumn('product_group_deliveries', 'claim_token', {
      type: DataTypes.STRING(64),
      allowNull: false,
    })
    await queryInterface.changeColumn('product_group_deliveries', 'heartbeat_at', {
      type: DataTypes.DATE,
      allowNull: false,
    })
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('product_group_deliveries', 'heartbeat_at')
    await queryInterface.removeColumn('product_group_deliveries', 'claim_token')
  },
}

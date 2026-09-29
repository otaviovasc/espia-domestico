'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize
    await queryInterface.addColumn('campaigns', 'send_images', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    })
    await queryInterface.addColumn('campaign_logs', 'offer_product_id', {
      type: DataTypes.STRING,
      allowNull: true,
    })
    await queryInterface.addColumn('campaign_logs', 'offer_url', {
      type: DataTypes.TEXT,
      allowNull: true,
    })
    await queryInterface.addIndex('campaign_logs', ['offer_product_id'])
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('campaigns', 'send_images')
    await queryInterface.removeColumn('campaign_logs', 'offer_product_id')
    await queryInterface.removeColumn('campaign_logs', 'offer_url')
  },
}

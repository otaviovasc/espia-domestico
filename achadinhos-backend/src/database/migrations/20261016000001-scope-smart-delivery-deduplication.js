'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('product_group_deliveries', 'plan_uuid', {
      type: Sequelize.DataTypes.UUID,
      allowNull: true,
    })

    await queryInterface.removeIndex('product_group_deliveries', 'product_group_delivery_pair_unique')
    await queryInterface.addIndex(
      'product_group_deliveries',
      ['user_id', 'connection_scope', 'offer_identity', 'group_id', 'campaign_id'],
      {
        unique: true,
        name: 'product_group_delivery_campaign_pair_unique',
        where: { campaign_id: { [Sequelize.Op.ne]: null }, plan_uuid: null },
      },
    )
    await queryInterface.addIndex(
      'product_group_deliveries',
      ['user_id', 'connection_scope', 'offer_identity', 'group_id'],
      {
        unique: true,
        name: 'product_group_delivery_legacy_pair_unique',
        where: { campaign_id: null, plan_uuid: null },
      },
    )
    await queryInterface.addIndex(
      'product_group_deliveries',
      ['user_id', 'connection_scope', 'offer_identity', 'group_id', 'plan_uuid'],
      {
        unique: true,
        name: 'product_group_delivery_plan_pair_unique',
        where: { plan_uuid: { [Sequelize.Op.ne]: null } },
      },
    )

    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeIndex('smart_sends', 'smart_sends_active_delivery_unique', { transaction })
      await queryInterface.addIndex(
        'smart_sends',
        ['plan_id', 'connection_scope', 'group_id', 'offer_identity'],
        {
          name: 'smart_sends_active_delivery_unique',
          unique: true,
          where: { status: { [Sequelize.Op.in]: ['PENDING', 'SENDING', 'UNKNOWN'] } },
          transaction,
        },
      )
    })
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeIndex('smart_sends', 'smart_sends_active_delivery_unique', { transaction })
      await queryInterface.addIndex(
        'smart_sends',
        ['connection_scope', 'group_id', 'offer_identity'],
        {
          name: 'smart_sends_active_delivery_unique',
          unique: true,
          where: { status: { [Sequelize.Op.in]: ['PENDING', 'SENDING', 'UNKNOWN'] } },
          transaction,
        },
      )
    })
    await queryInterface.removeIndex('product_group_deliveries', 'product_group_delivery_plan_pair_unique')
    await queryInterface.removeIndex('product_group_deliveries', 'product_group_delivery_campaign_pair_unique')
    await queryInterface.removeIndex('product_group_deliveries', 'product_group_delivery_legacy_pair_unique')
    await queryInterface.addIndex(
      'product_group_deliveries',
      ['user_id', 'connection_scope', 'offer_identity', 'group_id'],
      { unique: true, name: 'product_group_delivery_pair_unique' },
    )
    await queryInterface.removeColumn('product_group_deliveries', 'plan_uuid')
  },
}

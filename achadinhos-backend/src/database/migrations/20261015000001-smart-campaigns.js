'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'smart_audiences',
        {
          id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
          user_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'users', key: 'id' },
            onDelete: 'CASCADE',
          },
          slug: { type: DataTypes.STRING(32), allowNull: false },
          name: { type: DataTypes.STRING(80), allowNull: false },
          description: { type: DataTypes.TEXT, allowNull: false },
          enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
          classification_profile_id: { type: DataTypes.STRING(20), allowNull: true },
          profile: { type: DataTypes.JSONB, allowNull: false },
          destinations: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
          policy: { type: DataTypes.JSONB, allowNull: false },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction },
      )
      await queryInterface.addIndex('smart_audiences', ['user_id', 'slug'], {
        name: 'smart_audiences_user_slug_unique',
        unique: true,
        transaction,
      })

      await queryInterface.createTable(
        'smart_plans',
        {
          id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
          uuid: { type: DataTypes.UUID, allowNull: false, unique: true },
          user_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'users', key: 'id' },
            onDelete: 'CASCADE',
          },
          status: {
            type: DataTypes.ENUM(
              'ANALYZING',
              'REVIEW',
              'SCHEDULED',
              'PAUSED',
              'COMPLETED',
              'FAILED',
              'CANCELLED',
            ),
            allowNull: false,
            defaultValue: 'ANALYZING',
          },
          start_date: { type: DataTypes.DATEONLY, allowNull: false },
          days: { type: DataTypes.SMALLINT, allowNull: false },
          timezone: { type: DataTypes.STRING(64), allowNull: false },
          audience_slugs: { type: DataTypes.JSONB, allowNull: false },
          input: { type: DataTypes.JSONB, allowNull: false },
          items: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
          settings: { type: DataTypes.JSONB, allowNull: false },
          progress: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
          warnings: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
          revision: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
          approved_at: { type: DataTypes.DATE, allowNull: true },
          completed_at: { type: DataTypes.DATE, allowNull: true },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction },
      )
      await queryInterface.addIndex('smart_plans', ['user_id', 'created_at'], {
        name: 'smart_plans_user_created_idx',
        transaction,
      })
      await queryInterface.addIndex('smart_plans', ['status', 'updated_at'], {
        name: 'smart_plans_analysis_queue_idx',
        transaction,
      })

      await queryInterface.createTable(
        'smart_sends',
        {
          id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
          uuid: { type: DataTypes.UUID, allowNull: false, unique: true },
          user_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'users', key: 'id' },
            onDelete: 'CASCADE',
          },
          plan_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'smart_plans', key: 'id' },
            onDelete: 'CASCADE',
          },
          audience_slug: { type: DataTypes.STRING(32), allowNull: false },
          group_id: { type: DataTypes.STRING(120), allowNull: false },
          group_name: { type: DataTypes.STRING, allowNull: false },
          connection_scope: { type: DataTypes.STRING(200), allowNull: false },
          saved_product_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'saved_products', key: 'id' },
            onDelete: 'SET NULL',
          },
          offer_identity: { type: DataTypes.STRING(255), allowNull: false },
          offer: { type: DataTypes.JSONB, allowNull: false },
          message_intro: { type: DataTypes.TEXT, allowNull: true },
          scheduled_at: { type: DataTypes.DATE, allowNull: false },
          local_date: { type: DataTypes.DATEONLY, allowNull: false },
          timezone: { type: DataTypes.STRING(64), allowNull: false },
          evidence_observed_at: { type: DataTypes.DATE, allowNull: false },
          status: {
            type: DataTypes.ENUM('PENDING', 'SENDING', 'SENT', 'SKIPPED', 'FAILED', 'UNKNOWN'),
            allowNull: false,
            defaultValue: 'PENDING',
          },
          lease_owner: { type: DataTypes.STRING(120), allowNull: true },
          lease_expires_at: { type: DataTypes.DATE, allowNull: true },
          attempts: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
          max_attempts: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 3 },
          last_error: { type: DataTypes.TEXT, allowNull: true },
          provider_message_id: { type: DataTypes.STRING(200), allowNull: true },
          sent_at: { type: DataTypes.DATE, allowNull: true },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction },
      )
      await queryInterface.addIndex('smart_sends', ['status', 'scheduled_at'], {
        name: 'smart_sends_due_idx',
        transaction,
      })
      await queryInterface.addIndex('smart_sends', ['user_id', 'connection_scope', 'group_id', 'local_date'], {
        name: 'smart_sends_daily_budget_idx',
        transaction,
      })
      await queryInterface.addIndex(
        'smart_sends',
        ['plan_id', 'audience_slug', 'group_id', 'offer_identity'],
        { name: 'smart_sends_plan_route_offer_unique', unique: true, transaction },
      )
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
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('smart_sends', { transaction })
      await queryInterface.dropTable('smart_plans', { transaction })
      await queryInterface.dropTable('smart_audiences', { transaction })
    })
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_smart_sends_status" CASCADE;')
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_smart_plans_status" CASCADE;')
  },
}
